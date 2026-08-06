// Four presentational Server Components. Each takes already-derived data and
// does no computation beyond layout.
 
import Image from 'next/image';
import type { GenreScore } from '@/lib/stats/genres';
import type { AlbumStat } from '@/lib/stats/albums';
import type { MusicalAge } from '@/lib/stats/musical-age';
 
// ---------------------------------------------------------------------------
 
export function GenreList({ genres }: { genres: GenreScore[] }) {
  if (!genres.length) return <p className="empty">No genre data.</p>;
 
  return (
    <ul className="genres">
      {genres.map((g) => (
        <li key={g.genre} className="genres__row">
          <span className="genres__name">{g.genre}</span>
          <span className="genres__track">
            <span
              className="genres__bar"
              style={{ width: `${Math.max(g.weight * 100, 3)}%` }}
            />
          </span>
          <span className="genres__count">{g.artistCount}</span>
        </li>
      ))}
    </ul>
  );
}
 
// ---------------------------------------------------------------------------
 
export function AlbumGrid({ albums }: { albums: AlbumStat[] }) {
  if (!albums.length) return <p className="empty">No album data.</p>;
 
  return (
    <ul className="albums">
      {albums.map(({ album, trackCount }) => (
        <li key={album.id} className="albums__item">
          <a href={album.url}>
            {album.art && (
              <Image
                src={album.art}
                alt={`${album.name} cover`}
                width={180}
                height={180}
                className="albums__art"
              />
            )}
            <span className="albums__name">{album.name}</span>
          </a>
          <span className="albums__meta">
            {trackCount} {trackCount === 1 ? 'track' : 'tracks'} · {album.releaseYear}
          </span>
        </li>
      ))}
    </ul>
  );
}
 
// ---------------------------------------------------------------------------
 
export function Mosaic({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
 
  return (
    <div className="mosaic" aria-label="Album art from your top tracks" role="img">
      {urls.map((url, i) => (
        <Image
          key={url}
          src={url}
          alt=""
          width={160}
          height={160}
          priority={i < 5}
          className="mosaic__tile"
        />
      ))}
    </div>
  );
}
 
// ---------------------------------------------------------------------------
 
export function AgeHistogram({ age }: { age: MusicalAge }) {
  if (!age.sampleSize) return <p className="empty">No release dates available.</p>;
 
  const peak = Math.max(...age.byDecade.map((b) => b.count));
 
  return (
    <div className="age">
      <p className="age__headline">
        Median release year <strong>{age.medianYear}</strong>
      </p>
 
      <div className="age__chart">
        {age.byDecade.map((bucket) => (
          <div key={bucket.key} className="age__col">
            <span
              className="age__bar"
              style={{ height: `${(bucket.count / peak) * 100}%` }}
              title={`${bucket.count} tracks from the ${bucket.label}`}
            />
            <span className="age__value">{bucket.count || ''}</span>
            <span className="age__label">{bucket.label}</span>
          </div>
        ))}
      </div>
 
      <p className="age__footnote">
        Oldest: {age.oldest?.track.name} ({age.oldest?.year}) · Newest:{' '}
        {age.newest?.track.name} ({age.newest?.year})
        {age.meanYear !== age.medianYear && <> · Mean {age.meanYear}</>}
      </p>
    </div>
  );
}
 