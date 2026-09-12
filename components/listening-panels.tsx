import Image from 'next/image';
import type {
  ContextBreakdown,
  PeriodComparison,
  PeriodHighlights,
  TopContext,
} from '@/lib/plays/queries';
import type { ContextInfo } from '@/lib/spotify/contexts';
 
// ---------------------------------------------------------------------------
// Where listening comes from
// ---------------------------------------------------------------------------
 
const CONTEXT_LABELS: Record<string, string> = {
  playlist: 'Playlists',
  album: 'Albums',
  artist: 'Artist pages',
  collection: 'Liked Songs',
  show: 'Shows',
  direct: 'Search or links',
};
 
const SINGULAR: Record<string, string> = {
  playlist: 'Playlist',
  album: 'Album',
  artist: 'Artist',
  collection: 'Liked Songs',
  show: 'Show',
};
 
export function ContextSources({
  breakdown,
  topContexts,
  names,
}: {
  breakdown: ContextBreakdown[];
  topContexts: TopContext[];
  names: Map<string, ContextInfo>;
}) {
  if (!breakdown.length) {
    return <p className="text-base text-white/45">Not enough data yet.</p>;
  }
 
  return (
    <div className="grid gap-14 lg:grid-cols-2 lg:gap-16">
      <div>
        {/* Single stacked bar — a pie reads worse at these proportions */}
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-white/10">
          {breakdown.map((b, i) => (
            <div
              key={b.contextType}
              className="h-full"
              style={{
                width: `${b.share * 100}%`,
                background: 'var(--accent)',
                // Successive segments step down in opacity so they separate
                // without needing a second hue.
                opacity: Math.max(0.25, 1 - i * 0.18),
              }}
              title={`${CONTEXT_LABELS[b.contextType] ?? b.contextType}: ${Math.round(b.share * 100)}%`}
            />
          ))}
        </div>
 
        <ul className="mt-6 flex flex-col gap-3">
          {breakdown.map((b, i) => (
            <li
              key={b.contextType}
              className="flex items-center justify-between gap-4 text-base"
            >
              <span className="flex items-center gap-3">
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{
                    background: 'var(--accent)',
                    opacity: Math.max(0.25, 1 - i * 0.18),
                  }}
                />
                {CONTEXT_LABELS[b.contextType] ?? b.contextType}
              </span>
              <span className="tabular-nums text-white/55">
                {Math.round(b.share * 100)}%
                <span className="ml-2 text-white/35">({b.plays})</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
 
      {topContexts.length > 0 && (
        <div>
          <h3 className="mb-5 text-sm uppercase tracking-[0.14em] text-white/40">
            Biggest single sources
          </h3>
          <ol className="flex flex-col gap-3">
            {topContexts.map((c) => {
              const info = names.get(c.contextUri);
              const label =
                info?.name ?? SINGULAR[c.contextType] ?? c.contextType;
              const href =
                info?.url ??
                `https://open.spotify.com/${c.contextType}/${c.contextUri.split(':').pop()}`;
 
              return (
                <li key={c.contextUri} className="flex items-center gap-3">
                  {info?.image ? (
                    <Image
                      src={info.image}
                      alt=""
                      width={44}
                      height={44}
                      className="h-11 w-11 shrink-0 rounded"
                    />
                  ) : (
                    <div className="h-11 w-11 shrink-0 rounded bg-white/10" />
                  )}
 
                  <span className="flex min-w-0 flex-1 flex-col">
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-base decoration-(--accent) underline-offset-2 hover:underline"
                    >
                      {label}
                    </a>
                    <span className="truncate text-sm text-white/40">
                      {SINGULAR[c.contextType] ?? c.contextType} ·{' '}
                      {c.sampleTrack}
                    </span>
                  </span>
 
                  <span className="shrink-0 tabular-nums text-white/55">
                    {c.plays}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
 
// ---------------------------------------------------------------------------
// Period report — daily and weekly share this
// ---------------------------------------------------------------------------
 
function Delta({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) {
    return <span className="text-sm text-white/35">no comparison</span>;
  }
 
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return <span className="text-sm text-white/45">level</span>;
 
  return (
    <span
      className={
        pct > 0 ? 'text-sm text-(--accent)' : 'text-sm text-white/45'
      }
    >
      {pct > 0 ? '↑' : '↓'} {Math.abs(pct)}%
    </span>
  );
}
 
function Metric({
  label,
  current,
  previous,
  format = (n: number) => String(n),
}: {
  label: string;
  current: number;
  previous: number;
  format?: (n: number) => string;
}) {
  return (
    <div>
      <dt className="text-sm uppercase tracking-[0.14em] text-white/40">
        {label}
      </dt>
      <dd className="mt-1.5 text-4xl font-bold tabular-nums">
        {format(current)}
      </dd>
      <dd className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-white/40">
        <Delta current={current} previous={previous} />
        <span>vs {format(previous)}</span>
      </dd>
    </div>
  );
}
 
function HighlightCard({
  label,
  name,
  detail,
  art,
  plays,
  round,
}: {
  label: string;
  name: string;
  detail?: string | null;
  art: string | null;
  plays: number;
  round?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      {art ? (
        <Image
          src={art}
          alt=""
          width={72}
          height={72}
          className={[
            'h-16 w-16 shrink-0 sm:h-18 sm:w-18',
            round ? 'rounded-full object-cover' : 'rounded-lg',
          ].join(' ')}
        />
      ) : (
        <div className="h-16 w-16 shrink-0 rounded-lg bg-white/10 sm:h-18 sm:w-18" />
      )}
 
      <div className="min-w-0">
        <p className="text-sm uppercase tracking-[0.14em] text-white/40">
          {label}
        </p>
        <p className="mt-1 truncate text-lg font-semibold sm:text-xl">{name}</p>
        <p className="truncate text-sm text-white/45">
          {detail ? `${detail} · ` : ''}
          {plays} {plays === 1 ? 'play' : 'plays'}
        </p>
      </div>
    </div>
  );
}
 
export function PeriodReport({
  comparison,
  highlights,
  comparisonLabel,
  emptyMessage,
}: {
  comparison: PeriodComparison;
  highlights: PeriodHighlights;
  /** e.g. "the same point yesterday" */
  comparisonLabel: string;
  emptyMessage: string;
}) {
  const { current, previous } = comparison;
 
  if (!current.plays) {
    return <p className="text-base text-white/45">{emptyMessage}</p>;
  }
 
  const hours = (ms: number) => `${(ms / 3_600_000).toFixed(1)}h`;
 
  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-10 text-center sm:grid-cols-4 sm:text-left">
        <Metric
          label="Plays"
          current={current.plays}
          previous={previous.plays}
        />
        <Metric
          label="Unique tracks"
          current={current.tracks}
          previous={previous.tracks}
        />
        <Metric
          label="Artists"
          current={current.artists}
          previous={previous.artists}
        />
        <Metric
          label="Listening"
          current={current.ms}
          previous={previous.ms}
          format={hours}
        />
      </dl>
 
      {(highlights.topTrack || highlights.topArtist) && (
        <div className="mt-12 grid gap-8 border-t border-white/10 pt-10 sm:grid-cols-2">
          {highlights.topTrack && (
            <HighlightCard
              label="Most played track"
              name={highlights.topTrack.name}
              detail={highlights.topTrack.detail}
              art={highlights.topTrack.art}
              plays={highlights.topTrack.plays}
            />
          )}
          {highlights.topArtist && (
            <HighlightCard
              label="Most played artist"
              name={highlights.topArtist.name}
              art={highlights.topArtist.art}
              plays={highlights.topArtist.plays}
              round
            />
          )}
        </div>
      )}
 
      <p className="mt-8 text-center text-sm text-white/35 sm:text-left">
        Compared against {comparisonLabel}. Listening time is estimated —
        Spotify reports which tracks played, not how much of each was heard.
      </p>
    </div>
  );
}