// Server Components — no 'use client'. These render on the server and get
// handed to <Tabs> as props.
 
import Image from 'next/image';
import type { Artist, Track } from '@/lib/spotify/types';
import { msToClock } from '@/lib/format';
 
export function TrackList({ tracks, limit = 10 }: { tracks: Track[]; limit?: number }) {
  if (!tracks.length) {
    return <p className="empty">No tracks for this period yet.</p>;
  }
 
  return (
    <ol className="ranked">
      {tracks.slice(0, limit).map((track, i) => (
        <li key={track.id} className="ranked__row">
          <span className="ranked__num">{i + 1}</span>
 
          {track.album.artThumb && (
            <Image
              src={track.album.artThumb}
              alt=""
              width={48}
              height={48}
              className="ranked__art"
            />
          )}
 
          <span className="ranked__body">
            <a href={track.url} className="ranked__title">
              {track.name}
            </a>
            <span className="ranked__sub">{track.artists.join(', ')}</span>
          </span>
 
          <span className="ranked__meta">{msToClock(track.durationMs)}</span>
        </li>
      ))}
    </ol>
  );
}
 
export function ArtistList({ artists, limit = 10 }: { artists: Artist[]; limit?: number }) {
  if (!artists.length) {
    return <p className="empty">No artists for this period yet.</p>;
  }
 
  return (
    <ol className="ranked">
      {artists.slice(0, limit).map((artist, i) => (
        <li key={artist.id} className="ranked__row">
          <span className="ranked__num">{i + 1}</span>
 
          {artist.imageThumb && (
            <Image
              src={artist.imageThumb}
              alt=""
              width={48}
              height={48}
              className="ranked__art ranked__art--round"
            />
          )}
 
          <span className="ranked__body">
            <a href={artist.url} className="ranked__title">
              {artist.name}
            </a>
            <span className="ranked__sub">
              {artist.genres.slice(0, 2).join(' · ') || '—'}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}