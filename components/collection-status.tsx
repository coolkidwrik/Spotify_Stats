// Two jobs in one line:
//  - "collecting since X" reframes young stats as early rather than thin
//  - the freshness dot is how a broken pipeline becomes visible from the site
//    itself, instead of being discovered weeks later as a gap in a chart
 
import type { CollectionInfo } from '@/lib/plays/queries';
import { relativeTime } from '@/lib/format';
 
export function CollectionStatus({
  info,
  now,
}: {
  info: CollectionInfo;
  now: number;
}) {
  if (!info.since) return null;
 
  const since = new Date(info.since).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
 
  const lastRun = info.lastRunAt ? new Date(info.lastRunAt).getTime() : null;
  const ageMinutes = lastRun ? (now - lastRun) / 60_000 : null;
 
  // The scheduler runs every 30 minutes and can be delayed, so 90 minutes is
  // the point where something is genuinely wrong rather than just late.
  const stale = ageMinutes === null || ageMinutes > 90;
  const failing = info.lastRunStatus === 'error';
  const unhealthy = stale || failing;
 
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-white/40 sm:justify-start">
      <span>
        {info.totalPlays.toLocaleString()} plays since {since}
      </span>
 
      <span aria-hidden className="text-white/20">
        ·
      </span>
 
      <span className="flex items-center gap-2">
        <span
          className={[
            'inline-block h-1.5 w-1.5 rounded-full',
            unhealthy ? 'bg-amber-400' : 'bg-(--accent)',
          ].join(' ')}
          aria-hidden
        />
        {failing ? (
          <span className="text-amber-400/80">last update failed</span>
        ) : info.lastRunAt ? (
          <span className={stale ? 'text-amber-400/80' : undefined}>
            updated {relativeTime(info.lastRunAt.toISOString(), now)}
          </span>
        ) : (
          <span className="text-amber-400/80">no updates recorded</span>
        )}
      </span>
    </p>
  );
}