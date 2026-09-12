import { getAllTopData, fetchNowPlaying } from '@/lib/spotify/queries';
import { resolveContexts, type ContextInfo } from '@/lib/spotify/contexts';
import {
  getListeningClock,
  getContextBreakdown,
  getTopContexts,
  getDailyComparison,
  getWeeklyComparison,
  getTodayHighlights,
  getWeekHighlights,
  getCollectionInfo,
  emptyComparison,
  emptyHighlights,
  emptyCollectionInfo,
  type ClockHour,
  type ContextBreakdown,
  type TopContext,
  type CollectionInfo,
  type PeriodComparison,
  type PeriodHighlights,
} from '@/lib/plays/queries';
import { getMosaicArt } from '@/lib/mosaic';
import { musicalAge } from '@/lib/stats/musical-age';
 
import { NowPlayingCard } from '@/components/now-playing';
import { Tabs } from '@/components/tabs';
import { TrackList, ArtistList } from '@/components/top-lists';
import { AgeHistogram, Mosaic } from '@/components/stats-panels';
import { ListeningClock } from '@/components/listening-clock';
import { ContextSources, PeriodReport } from '@/components/listening-panels';
import { CollectionStatus } from '@/components/collection-status';
 
/**
 * The rendered page is cached for 10 minutes, so visitors are served static
 * HTML and don't each trigger a round of database queries. Roughly matches the
 * 30-minute ingest cadence.
 *
 * While developing against cached data, swap this for
 * `export const dynamic = 'force-dynamic'` — and remember that Next's data
 * cache persists in .next/cache across restarts, so `rm -rf .next` is
 * sometimes the only way to see a change.
 */
export const revalidate = 600;
 
const CLOCK_DAYS = 30;
// Five rather than eight: fewer Spotify lookups to resolve names for, and the
// tail of that list is rarely interesting.
const TOP_CONTEXT_COUNT = 5;
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
  // Spotify and database reads are independent. allSettled so a database
  // problem degrades those sections rather than 500ing the whole page.
  const [spotify, nowPlaying, art, db] = await Promise.all([
    getAllTopData(),
    fetchNowPlaying(),
    getMosaicArt(25),
    Promise.allSettled([
      getListeningClock(CLOCK_DAYS),
      getContextBreakdown(CLOCK_DAYS),
      getTopContexts(CLOCK_DAYS, TOP_CONTEXT_COUNT),
      getDailyComparison(),
      getCollectionInfo(),
      getTodayHighlights(),
      getWeeklyComparison(),
      getWeekHighlights(),
    ]),
  ]);
 
  // Log rejections rather than swallowing them. A section silently falling
  // back to its empty state looks identical to "you listened to nothing",
  // which is how a dead database connection went unnoticed for a while.
  db.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[page] db query ${i} failed:`, r.reason?.message ?? r.reason);
    }
  });
 
  // Explicit type arguments: allSettled over a heterogeneous array loses the
  // per-index types, so inference from the fallback alone gives never[].
  const unwrap = <T,>(i: number, fallback: T): T =>
    db[i].status === 'fulfilled'
      ? (db[i] as PromiseFulfilledResult<T>).value
      : fallback;
 
  const clock = unwrap<ClockHour[]>(0, []);
  const breakdown = unwrap<ContextBreakdown[]>(1, []);
  const topContexts = unwrap<TopContext[]>(2, []);
  const daily = unwrap<PeriodComparison>(3, emptyComparison);
  const collection = unwrap<CollectionInfo>(4, emptyCollectionInfo);
  const dailyHighlights = unwrap<PeriodHighlights>(5, emptyHighlights);
  const weekly = unwrap<PeriodComparison>(6, emptyComparison);
  const weeklyHighlights = unwrap<PeriodHighlights>(7, emptyHighlights);
 
  // Depends on topContexts, so it can't join the batch above. resolveContexts
  // never throws and caps itself at 3s, falling back to generic labels — the
  // render can't be blocked longer than that regardless of what Spotify does.
  const contextNames: Map<string, ContextInfo> = await resolveContexts(
    topContexts.map((c) => c.contextUri),
    3000
  );
 
  const { tracks, artists, lastPlayed, deepPool } = spotify;
  const age = musicalAge(deepPool);
  const now = Date.now();
 
  return (
    <div className="relative isolate w-full overflow-x-clip">
      {/* Hero glow. z-0, not -z-10: a negative index paints beneath the opaque
          body background and would be invisible. */}
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
        {/* Now playing --------------------------------------------------- */}
        <section id="now" className="flex min-h-[80vh] items-center pt-36 pb-20">
          <div className="w-full">
            <NowPlayingCard
              initial={nowPlaying}
              lastPlayed={lastPlayed}
              serverNow={now}
            />
          </div>
        </section>
 
        {/* Daily report --------------------------------------------------- */}
        <section id="daily" className="py-20 sm:py-28">
          <SectionTitle center>Daily report</SectionTitle>
          <PeriodReport
            comparison={daily}
            highlights={dailyHighlights}
            comparisonLabel="the same point yesterday"
            emptyMessage="Nothing played yet today."
          />
          <div className="mt-10">
            <CollectionStatus info={collection} now={now} />
          </div>
        </section>
 
        {/* Weekly report -------------------------------------------------- */}
        <section id="weekly" className="py-20 sm:py-28">
          <SectionTitle center>Weekly report</SectionTitle>
          <PeriodReport
            comparison={weekly}
            highlights={weeklyHighlights}
            comparisonLabel="the same point last week"
            emptyMessage="Nothing played yet this week."
          />
        </section>
 
        {/* Top tracks + artists (Spotify) --------------------------------- */}
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
 
        {/* Listening clock ------------------------------------------------ */}
        <section id="clock" className="py-20 sm:py-28">
          <h2 className="mb-10 text-center text-3xl font-bold tracking-tight sm:text-4xl">
            When I listen
          </h2>
          <ListeningClock hours={clock} days={CLOCK_DAYS} />
        </section>
 
        {/* Where listening comes from ------------------------------------- */}
        <section id="sources" className="py-20 sm:py-28">
          <SectionTitle center>Where it comes from</SectionTitle>
          <ContextSources
            breakdown={breakdown}
            topContexts={topContexts}
            names={contextNames}
          />
        </section>
 
        {/* Musical age ---------------------------------------------------- */}
        <section id="timeline" className="py-20 sm:py-28">
          <SectionTitle center>Musical age</SectionTitle>
          <AgeHistogram age={age} />
        </section>
 
        {/* Mosaic ---------------------------------------------------------- */}
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