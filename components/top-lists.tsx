// Server Components — no 'use client'. Rendered on the server and handed to
// <Tabs> as props.
 
import Image from 'next/image';
import type { Artist, Track } from '@/lib/spotify/types';
import { msToClock } from '@/lib/format';
 
const rowBase =
  'group flex items-center gap-4 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-white/6';
 
const rankBase =
  'w-7 shrink-0 text-right text-base tabular-nums text-white/30 transition-colors group-hover:text-[var(--accent)]';
 
export function TrackList({
  tracks,
  limit = 10,
}: {
  tracks: Track[];
  limit?: number;
}) {
  if (!tracks.length) {
    return <p className="text-base text-white/45">No tracks for this period yet.</p>;
  }
 
  return (
    <ol className="flex flex-col gap-1">
      {tracks.slice(0, limit).map((track, i) => (
        <li key={track.id} className={rowBase}>
          <span className={rankBase}>{i + 1}</span>
 
          {track.album.artThumb && (
            <Image
              src={track.album.artThumb}
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 rounded-md"
            />
          )}
 
          <span className="flex min-w-0 flex-1 flex-col">
            <a
              href={track.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-base font-medium decoration-(--accent) underline-offset-2 hover:underline sm:text-lg"
            >
              {track.name}
            </a>
            <span className="truncate text-sm text-white/50">
              {track.artists.join(', ')}
            </span>
          </span>
 
          <span className="shrink-0 text-sm tabular-nums text-white/35">
            {msToClock(track.durationMs)}
          </span>
        </li>
      ))}
    </ol>
  );
}
 
export function ArtistList({
  artists,
  limit = 10,
}: {
  artists: Artist[];
  limit?: number;
}) {
  if (!artists.length) {
    return <p className="text-base text-white/45">No artists for this period yet.</p>;
  }
 
  return (
    <ol className="flex flex-col gap-1">
      {artists.slice(0, limit).map((artist, i) => (
        <li key={artist.id} className={rowBase}>
          <span className={rankBase}>{i + 1}</span>
 
          {artist.imageThumb && (
            <Image
              src={artist.imageThumb}
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 rounded-full object-cover"
            />
          )}
 
          <span className="flex min-w-0 flex-1 flex-col">
            <a
              href={artist.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-base font-medium decoration-(--accent) underline-offset-2 hover:underline sm:text-lg"
            >
              {artist.name}
            </a>
          </span>
        </li>
      ))}
    </ol>
  );
}