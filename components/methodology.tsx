import type { ReactNode } from 'react';
 
export function Methodology({
  children,
  label = 'How this is calculated',
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <details className="group mt-10 border-t border-white/10 pt-6">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-white/45 transition-colors hover:text-white/70 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="inline-block transition-transform group-open:rotate-90"
        >
          ›
        </span>
        {label}
      </summary>
 
      <div className="mt-5 max-w-3xl space-y-4 text-sm leading-relaxed text-white/55">
        {children}
      </div>
    </details>
  );
}
 
/** Inline highlight for field and function names. */
function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-white/8 px-1.5 py-0.5 text-[0.85em] text-white/75">
      {children}
    </code>
  );
}
 
/** A caveat worth reading before trusting the number above. */
function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="border-l-2 border-(--accent)/50 pl-4 text-white/45">
      {children}
    </p>
  );
}
 
// ---------------------------------------------------------------------------
 
export function DailyMethodology() {
  return (
    <Methodology>
      <p>
        Every 30 minutes a scheduled job asks Spotify for anything I&rsquo;ve
        played since the last check and appends it to a table. These counts are
        a straight read of that table, bounded to midnight today in Vancouver.
      </p>
      <p>
        The comparison is clipped to the same elapsed time. At 9am,
        &ldquo;yesterday&rdquo; means yesterday up to 9am — not the whole day.
        Without that, every morning would show an 80&ndash;90% drop that means
        nothing.
      </p>
      <Caveat>
        Listening time is an estimate, and it runs high. Spotify reports which
        tracks played but not how much of each I actually heard, so a song
        skipped at 40 seconds still counts as its full length. Play counts are
        exact; the hours are an upper bound.
      </Caveat>
      <Caveat>
        Anything played for under 30 seconds never appears at all — Spotify
        doesn&rsquo;t log it. Podcasts are excluded too, so total listening is
        understated in that direction.
      </Caveat>
    </Methodology>
  );
}
 
export function WeeklyMethodology() {
  return (
    <Methodology>
      <p>
        The same play log as the daily report, bounded to the start of the
        current week. Weeks begin on Monday.
      </p>
      <p>
        Clipped the same way: on a Tuesday afternoon this compares two days
        against the first two days of last week, not against a completed seven.
        Early in the week the numbers are small because the week is young, not
        because listening dropped.
      </p>
      <Caveat>
        The same listening-time caveat applies — it&rsquo;s derived from track
        durations, not from how much was actually heard.
      </Caveat>
    </Methodology>
  );
}
 
export function ChartsMethodology() {
  return (
    <Methodology label="Where these rankings come from">
      <p>
        These two lists come from Spotify&rsquo;s own ranking rather than my
        play log. Spotify computes them from a longer history than I&rsquo;ve
        been collecting, which is why they cover a year while everything else
        here starts from when logging began.
      </p>
      <p>
        The three ranges are Spotify&rsquo;s: roughly the last four weeks, six
        months, and year. They&rsquo;re recalculated about once a day, so this
        section is cached for 24 hours.
      </p>
      <Caveat>
        The exact weighting is Spotify&rsquo;s and isn&rsquo;t published — it
        factors in recency and repeat listening in ways that aren&rsquo;t a
        plain play count. These rankings and my own counts disagree more often
        than you&rsquo;d expect.
      </Caveat>
    </Methodology>
  );
}
 
export function ClockMethodology() {
  return (
    <Methodology>
      <p>
        Each play&rsquo;s timestamp is converted to local time and bucketed by
        hour, across the last 30 days. Midnight sits at the top and the day runs
        clockwise.
      </p>
      <p>
        Wedge length uses the square root of the play count, not the count
        itself. A wedge&rsquo;s area grows with the square of its radius, so
        scaling the radius directly would make the busiest hour look about four
        times more dominant than it is. Square root makes the visible area
        proportional to the number.
      </p>
      <Caveat>
        Timestamps are stored in UTC and converted for display, so travel across
        time zones lands plays in whatever hour they were in Vancouver time
        rather than local-to-me time.
      </Caveat>
    </Methodology>
  );
}
 
export function SourcesMethodology() {
  return (
    <Methodology>
      <p>
        Spotify records where each play was started from — a playlist, an album,
        an artist page — and I store that alongside the track. The bar is a
        straight share of plays by source type over the last 30 days.
      </p>
      <p>
        &ldquo;Search or links&rdquo; covers plays with no source attached,
        which is what happens when a track is started directly from search
        results or an external link.
      </p>
      <p>
        The right-hand list groups by the specific playlist or album rather than
        the type. Spotify only stores an ID there, so the names and covers are
        fetched separately and cached for a day.
      </p>
      <Caveat>
        A playlist that&rsquo;s since been deleted or made private can&rsquo;t
        be resolved and shows a generic label — the plays still count.
      </Caveat>
    </Methodology>
  );
}
 
export function AgeMethodology() {
  return (
    <Methodology>
      <p>
        Each play carries its album&rsquo;s release year, and this counts plays
        per year. It&rsquo;s weighted by plays rather than by track: a record on
        repeat counts every time, which is the point — this describes what was
        actually in my ears, not which songs appeared on a list.
      </p>
      <p>
        The median is play-weighted too, found by walking the distribution to
        its midpoint. It&rsquo;s the more useful headline than the mean, which a
        single much older record can drag back several years.
      </p>
      <Caveat>
        Release dates vary in precision — some albums report only a year, others
        a full date — so only the year is used. Reissues and remasters carry
        their reissue date, not the original release, so anything old that
        I&rsquo;m streaming from a remaster reads as more recent than it is.
      </Caveat>
      <Caveat>
        Release year was added to the log partway through, so plays recorded
        before that aren&rsquo;t counted here. The sample size below the chart
        says how many are.
      </Caveat>
    </Methodology>
  );
}
 
export function MosaicMethodology() {
  return (
    <Methodology label="How the colours are chosen">
      <p>
        The grid is the 25 most-played distinct albums from roughly the last
        month, filled in from a longer window if four weeks didn&rsquo;t produce
        25.
      </p>
      <p>
        The accent colour used across this site is extracted from those covers.
        Each is downscaled to a small grid — a cheap blur that removes
        compression noise — and every pixel is sorted into one of 36 hue
        buckets. The largest bucket wins.
      </p>
      <p>
        Grey, near-black and near-white pixels are discarded first. Album art is
        mostly dark backgrounds and white text, and including them produced a
        muddy brown regardless of what the covers actually looked like. Covers
        are also weighted by rank, so the current favourite carries several
        times the influence of the twenty-fifth.
      </p>
      <Caveat>
        The winning hue is then forced into a lightness and saturation range
        that stays readable on black, so the site&rsquo;s accent is a
        recognisable relative of the dominant colour rather than a literal
        sample of it.
      </Caveat>
    </Methodology>
  );
}