'use client';
 
 
import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import type { LastPlayed, NowPlaying } from '@/lib/spotify/types';
import { msToClock, relativeTime } from '@/lib/format';
 
const POLL_MS = 15_000;
const TICK_MS = 250;
 
interface Props {
  initial: NowPlaying;
  lastPlayed: LastPlayed | null;
  serverNow: number;
}
 
export function NowPlayingCard({ initial, lastPlayed, serverNow }: Props) {
  const [state, setState] = useState<NowPlaying>(initial);
  const [elapsed, setElapsed] = useState(0);
 
  // Client-clock reference. Not state.fetchedAt — that's the server's clock,
  // and any skew between the two would offset the bar by the difference.
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
      // Keep the last known state rather than blanking on a network blip.
    } finally {
      inFlight.current = false;
    }
  }, []);
 
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
 
  // Advance the bar locally so a 15s poll looks continuous.
  useEffect(() => {
    if (!state.isPlaying) return;
    const id = setInterval(
      () => setElapsed(Date.now() - receivedAt.current),
      TICK_MS
    );
    return () => clearInterval(id);
  }, [state.isPlaying, state.track?.id]);
 
  // Refetch when the track should end rather than waiting for the next poll.
  useEffect(() => {
    if (!state.isPlaying || !state.durationMs || state.progressMs == null) return;
    const remaining = state.durationMs - state.progressMs;
    if (remaining <= 0) return;
    const id = setTimeout(refresh, remaining + 750);
    return () => clearTimeout(id);
  }, [state, refresh]);
 
  const { track, isPlaying, durationMs } = state;
 
  if (!track) {
    return <LastPlayedHero lastPlayed={lastPlayed} serverNow={serverNow} />;
  }
 
  const progress = Math.min(
    (state.progressMs ?? 0) + (isPlaying ? elapsed : 0),
    durationMs ?? Number.MAX_SAFE_INTEGER
  );
  const pct = durationMs ? (progress / durationMs) * 100 : 0;
 
  return (
    <div className="flex flex-col items-center gap-8 text-center sm:flex-row sm:items-end sm:gap-10 sm:text-left">
      {track.album.art && (
        <Image
          src={track.album.art}
          alt={`${track.album.name} cover`}
          width={288}
          height={288}
          priority
          className="h-56 w-56 shrink-0 rounded-xl shadow-2xl sm:h-64 sm:w-64 lg:h-72 lg:w-72"
        />
      )}
 
      <div className="w-full min-w-0">
        <p className="flex items-center justify-center gap-2.5 text-sm font-medium uppercase tracking-[0.2em] text-(--accent) sm:justify-start">
          {isPlaying && (
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-(--accent)" />
          )}
          {isPlaying ? 'Now playing' : 'Paused'}
        </p>
 
        <a
          href={track.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block text-4xl font-bold leading-tight decoration-(--accent) underline-offset-[6px] hover:underline sm:text-5xl lg:text-6xl"
        >
          {track.name}
        </a>
 
        <p className="mt-2 text-xl text-white/65 sm:text-2xl">
          {track.artists.join(', ')}
        </p>
 
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={durationMs ?? 0}
          aria-valuenow={Math.round(progress)}
          aria-valuetext={`${msToClock(progress)} of ${msToClock(durationMs ?? 0)}`}
          className="mt-8 h-2 w-full overflow-hidden rounded-full bg-white/15"
        >
          <div
            className="h-full rounded-full bg-(--accent)"
            style={{ width: `${pct}%` }}
          />
        </div>
 
        <div className="mt-2.5 flex justify-between text-sm tabular-nums text-white/50">
          <span>{msToClock(progress)}</span>
          <span>{msToClock(durationMs ?? 0)}</span>
        </div>
      </div>
    </div>
  );
}
 
function LastPlayedHero({
  lastPlayed,
  serverNow,
}: {
  lastPlayed: LastPlayed | null;
  serverNow: number;
}) {
  // Start from the server's reference time so hydration matches, then go live.
  const [now, setNow] = useState(serverNow);
 
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
 
  if (!lastPlayed) {
    return (
      <p className="text-center text-lg text-white/50">
        Nothing playing right now.
      </p>
    );
  }
 
  const { track, playedAt } = lastPlayed;
 
  return (
    <div className="flex flex-col items-center gap-8 text-center sm:flex-row sm:items-end sm:gap-10 sm:text-left">
      {track.album.art && (
        <Image
          src={track.album.art}
          alt={`${track.album.name} cover`}
          width={288}
          height={288}
          priority
          className="h-56 w-56 shrink-0 rounded-xl opacity-90 shadow-2xl grayscale sm:h-64 sm:w-64 lg:h-72 lg:w-72"
        />
      )}
 
      <div className="w-full min-w-0">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-white/45">
          Last played
        </p>
 
        <a
          href={track.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block text-4xl font-bold leading-tight decoration-(--accent) underline-offset-[6px] hover:underline sm:text-5xl lg:text-6xl"
        >
          {track.name}
        </a>
 
        <p className="mt-2 text-xl text-white/65 sm:text-2xl">
          {track.artists.join(', ')}
        </p>
 
        <time
          dateTime={playedAt}
          className="mt-5 inline-block text-lg text-(--accent)"
        >
          {relativeTime(playedAt, now)}
        </time>
      </div>
    </div>
  );
}