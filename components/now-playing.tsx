'use client';
 
// components/now-playing.tsx
//
// Styling here is structural, not final — swap the inline styles for your own
// classes. The behaviour is the part worth keeping.
 
import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import type { LastPlayed, NowPlaying } from '@/lib/spotify/types';
import { msToClock, relativeTime } from '@/lib/format';
 
const POLL_MS = 15_000;
const TICK_MS = 250;
 
interface Props {
  initial: NowPlaying;
  lastPlayed: LastPlayed | null;
  /** Server's render time, passed down so first paint matches on hydration. */
  serverNow: number;
}
 
export function NowPlayingCard({ initial, lastPlayed, serverNow }: Props) {
  const [state, setState] = useState<NowPlaying>(initial);
  const [elapsed, setElapsed] = useState(0);
 
  // Client-clock timestamp of when we last received data. Deliberately NOT
  // state.fetchedAt — that's the server's clock, and any skew between the two
  // would offset the progress bar by the difference.
  const receivedAt = useRef<number>(Date.now());
  const inFlight = useRef(false);
 
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch('/api/now-playing', { cache: 'no-store' });
      if (!res.ok) return;
      const data: NowPlaying = await res.json();
      receivedAt.current = Date.now();
      setState(data);
      setElapsed(0);
    } catch {
      // Network blip — keep showing the last known state and try again on the
      // next tick rather than blanking the card.
    } finally {
      inFlight.current = false;
    }
  }, []);
 
  // Poll on an interval, but never while the tab is hidden. Refresh
  // immediately when it becomes visible again so the bar isn't stale.
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
 
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
 
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);
 
  // Advance the bar locally between polls. This is what makes a 15s poll look
  // like a live progress bar.
  useEffect(() => {
    if (!state.isPlaying) return;
    const id = setInterval(
      () => setElapsed(Date.now() - receivedAt.current),
      TICK_MS
    );
    return () => clearInterval(id);
  }, [state.isPlaying, state.track?.id]);
 
  // Refetch the moment the current track should end, rather than waiting up to
  // 15s for the next poll to notice the song changed.
  useEffect(() => {
    if (!state.isPlaying || !state.durationMs || state.progressMs == null) return;
    const remaining = state.durationMs - state.progressMs;
    if (remaining <= 0) return;
    const id = setTimeout(refresh, remaining + 750);
    return () => clearTimeout(id);
  }, [state, refresh]);
 
  const { track, isPlaying, durationMs } = state;
 
  if (!track) {
    return <LastPlayedCard lastPlayed={lastPlayed} serverNow={serverNow} />;
  }
 
  const progress = Math.min(
    (state.progressMs ?? 0) + (isPlaying ? elapsed : 0),
    durationMs ?? Number.MAX_SAFE_INTEGER
  );
  const pct = durationMs ? (progress / durationMs) * 100 : 0;
 
  return (
    <section aria-label="Now playing" style={{ display: 'flex', gap: 16 }}>
      {track.album.artThumb && (
        <Image
          src={track.album.artThumb}
          alt={`${track.album.name} cover`}
          width={80}
          height={80}
          style={{ borderRadius: 6 }}
        />
      )}
 
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 12, color: 'var(--accent)', margin: 0 }}>
          {isPlaying ? 'Now playing' : 'Paused'}
        </p>
 
        <a href={track.url} style={{ fontWeight: 600 }}>
          {track.name}
        </a>
        <p style={{ margin: '2px 0 8px', opacity: 0.7 }}>
          {track.artists.join(', ')}
        </p>
 
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={durationMs ?? 0}
          aria-valuenow={Math.round(progress)}
          aria-valuetext={`${msToClock(progress)} of ${msToClock(durationMs ?? 0)}`}
          style={{
            height: 4,
            borderRadius: 2,
            background: 'var(--accent-soft)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: 'var(--accent)',
            }}
          />
        </div>
 
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            opacity: 0.6,
            marginTop: 4,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span>{msToClock(progress)}</span>
          <span>{msToClock(durationMs ?? 0)}</span>
        </div>
      </div>
    </section>
  );
}
 
function LastPlayedCard({
  lastPlayed,
  serverNow,
}: {
  lastPlayed: LastPlayed | null;
  serverNow: number;
}) {
  // Render with the server's reference time first so hydration matches, then
  // switch to live client time once mounted.
  const [now, setNow] = useState(serverNow);
 
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
 
  if (!lastPlayed) {
    return (
      <section aria-label="Now playing">
        <p style={{ opacity: 0.7 }}>Nothing playing right now.</p>
      </section>
    );
  }
 
  const { track, playedAt } = lastPlayed;
 
  return (
    <section aria-label="Last played" style={{ display: 'flex', gap: 16 }}>
      {track.album.artThumb && (
        <Image
          src={track.album.artThumb}
          alt={`${track.album.name} cover`}
          width={80}
          height={80}
          style={{ borderRadius: 6, filter: 'grayscale(1)', opacity: 0.85 }}
        />
      )}
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 12, opacity: 0.6, margin: 0 }}>Last played</p>
        <a href={track.url} style={{ fontWeight: 600 }}>
          {track.name}
        </a>
        <p style={{ margin: '2px 0 0', opacity: 0.7 }}>
          {track.artists.join(', ')}
        </p>
        <time dateTime={playedAt} style={{ fontSize: 12, opacity: 0.6 }}>
          {relativeTime(playedAt, now)}
        </time>
      </div>
    </section>
  );
}