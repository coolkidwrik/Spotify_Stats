import { getAllTopData, fetchNowPlaying } from '@/lib/spotify/queries';
import { topGenres } from '@/lib/stats/genres';
import { topAlbums, mosaicArt } from '@/lib/stats/albums';
import { musicalAge } from '@/lib/stats/musical-age';
 
import { NowPlayingCard } from '@/components/now-playing';
import { Tabs } from '@/components/tabs';
import { TrackList, ArtistList } from '@/components/top-lists';
import {
  GenreList,
  AlbumGrid,
  Mosaic,
  AgeHistogram,
} from '@/components/stats-panels';
 
export const revalidate = 3600;
 
export default async function Home() {
  const [{ tracks, artists, lastPlayed }, nowPlaying] = await Promise.all([
    getAllTopData(),
    fetchNowPlaying(),
  ]);
 
  // Derived stats are pinned to medium_term deliberately: six months reads as
  // "your taste" where four weeks reads as "this month's obsession".
  const baseline = tracks.medium_term;
  const genres = topGenres(artists.medium_term, 10);
  const albums = topAlbums(baseline, { limit: 10 });
  const age = musicalAge(baseline);
  const art = mosaicArt(baseline, 25);
 
  return (
    <main className="page">
      <NowPlayingCard
        initial={nowPlaying}
        lastPlayed={lastPlayed}
        serverNow={Date.now()}
      />
 
      <section>
        <h2 className="section__title">Top tracks</h2>
        <Tabs
          label="Time range for top tracks"
          panels={{
            short_term: <TrackList tracks={tracks.short_term} />,
            medium_term: <TrackList tracks={tracks.medium_term} />,
            long_term: <TrackList tracks={tracks.long_term} />,
          }}
        />
      </section>
 
      <section>
        <h2 className="section__title">Top artists</h2>
        <Tabs
          label="Time range for top artists"
          panels={{
            short_term: <ArtistList artists={artists.short_term} />,
            medium_term: <ArtistList artists={artists.medium_term} />,
            long_term: <ArtistList artists={artists.long_term} />,
          }}
        />
      </section>
 
      <section>
        <h2 className="section__title">Top genres</h2>
        <GenreList genres={genres} />
      </section>
 
      <section>
        <h2 className="section__title">Top albums</h2>
        <AlbumGrid albums={albums} />
      </section>
 
      <section>
        <h2 className="section__title">Musical age</h2>
        <AgeHistogram age={age} />
      </section>
 
      <section>
        <h2 className="section__title">The last six months, in covers</h2>
        <Mosaic urls={art} />
      </section>
    </main>
  );
}
 