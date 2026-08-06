import { getAllTopData, fetchNowPlaying } from '@/lib/spotify/queries';
import { getMosaicArt } from '@/lib/mosaic';
import { musicalAge } from '@/lib/stats/musical-age';
 
import { NowPlayingCard } from '@/components/now-playing';
import { Tabs } from '@/components/tabs';
import { TrackList, ArtistList } from '@/components/top-lists';
import { AgeHistogram, Mosaic } from '@/components/stats-panels';
 
export const revalidate = 3600;
 
const MOSAIC_HEADING = 'Lately, in covers';
const MOSAIC_LABEL =
  'Album art from the tracks I have played most over the last few weeks';
 
function SectionTitle({
  children,
  center,
}: {
  children: React.ReactNode;
  center?: boolean;
}) {
  return (
    <h2
      className={[
        'mb-8 text-3xl font-bold tracking-tight sm:text-4xl',
        center ? 'text-center sm:text-left' : '',
      ].join(' ')}
    >
      {children}
    </h2>
  );
}
 
export default async function Home() {
  const [{ tracks, artists, lastPlayed, deepPool }, nowPlaying, art] =
    await Promise.all([getAllTopData(), fetchNowPlaying(), getMosaicArt(25)]);
 
  // The histogram uses the full deduped pool across all time ranges and
  // offsets — typically 150-200 tracks instead of 50.
  const age = musicalAge(deepPool);
 
  return (
    <div className="relative isolate w-full overflow-x-clip">
      {/* Hero glow.
       *
       * z-0, NOT -z-10. A negative z-index would paint beneath the opaque
       * background of <body>, which renders after negative-index descendants
       * in the root stacking context — the glow would be invisible. A
       * positioned element at z-0 paints after block backgrounds and before
       * the z-10 content below.
       */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 z-0 h-[95vh] w-screen -translate-x-1/2"
        style={{
          background:
            'radial-gradient(ellipse 90% 62% at 50% 10%, var(--accent), transparent 70%)',
          opacity: 0.4,
          maskImage:
            'linear-gradient(to bottom, black 0%, black 45%, transparent 88%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, black 0%, black 45%, transparent 88%)',
        }}
      />
 
      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 sm:px-8">
        {/* Now playing / last played ------------------------------------ */}
        <section id="now" className="flex min-h-[80vh] items-center pt-36 pb-20">
          <div className="w-full">
            <NowPlayingCard
              initial={nowPlaying}
              lastPlayed={lastPlayed}
              serverNow={Date.now()}
            />
          </div>
        </section>
 
        {/* Top tracks + top artists, side by side ------------------------ */}
        <section id="charts" className="py-20 sm:py-28">
          <div className="grid gap-16 lg:grid-cols-2 lg:gap-12">
            <div>
              <SectionTitle>Top tracks</SectionTitle>
              <Tabs
                label="Time range for top tracks"
                panels={{
                  short_term: <TrackList tracks={tracks.short_term} />,
                  medium_term: <TrackList tracks={tracks.medium_term} />,
                  long_term: <TrackList tracks={tracks.long_term} />,
                }}
              />
            </div>
 
            <div>
              <SectionTitle>Top artists</SectionTitle>
              <Tabs
                label="Time range for top artists"
                panels={{
                  short_term: <ArtistList artists={artists.short_term} />,
                  medium_term: <ArtistList artists={artists.medium_term} />,
                  long_term: <ArtistList artists={artists.long_term} />,
                }}
              />
            </div>
          </div>
        </section>
 
        {/* Release-year histogram ---------------------------------------- */}
        <section id="timeline" className="py-20 sm:py-28">
          <SectionTitle center>Musical age</SectionTitle>
          <AgeHistogram age={age} />
        </section>
 
        {/* Mosaic --------------------------------------------------------- */}
        <section id="covers" className="py-24 sm:py-32">
          <h2 className="mb-10 text-center text-3xl font-bold tracking-tight sm:text-4xl">
            {MOSAIC_HEADING}
          </h2>
          <Mosaic urls={art} label={MOSAIC_LABEL} />
        </section>
      </main>
    </div>
  );
}
 