import Image from 'next/image';
import type { ListeningAge } from '@/lib/plays/age';
 
export function AgeHistogram({ age }: { age: ListeningAge }) {
  if (!age.sampleSize || !age.byYear.length) {
    return (
      <p className="max-w-xl text-base text-white/45">
        No release dates recorded yet. Release years are captured on plays
        logged from the point the field was added, so this fills in as more
        listening is collected.
      </p>
    );
  }
 
  const bins = age.byYear;
  const peak = Math.max(...bins.map((b) => b.count), 1);
 
  // Often 50+ bars, so label sparsely and let hover supply the exact year.
  const span = bins.length;
  const labelEvery = span > 40 ? 10 : span > 18 ? 5 : 2;
 
  return (
    <div>
      <div className="flex h-64 items-end gap-px overflow-visible sm:h-72">
        {bins.map((bin) => (
          <div
            key={bin.key}
            className="group relative flex h-full flex-1 items-end"
          >
            <div
              className="w-full rounded-t-[3px] bg-(--accent) opacity-65 transition-opacity group-hover:opacity-100"
              style={{
                height: `${(bin.count / peak) * 100}%`,
                minHeight: bin.count ? '4px' : '0',
              }}
            />
 
            {/* Full-height hit area so thin and empty bars stay hoverable */}
            <div className="absolute inset-0" />
 
            <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-black/90 px-3 py-2 text-sm shadow-xl backdrop-blur-sm group-hover:block">
              <span className="font-semibold">{bin.label}</span>
              <span className="ml-2 text-white/60">
                {bin.count} {bin.count === 1 ? 'play' : 'plays'}
              </span>
            </div>
          </div>
        ))}
      </div>
 
      <div className="mt-3 flex gap-px border-t border-white/12 pt-3">
        {bins.map((bin, i) => (
          <span
            key={bin.key}
            className="flex-1 text-center text-xs tabular-nums text-white/35"
          >
            {i % labelEvery === 0 ? bin.label : '\u00A0'}
          </span>
        ))}
      </div>
 
      <dl className="mt-12 grid grid-cols-2 gap-x-8 gap-y-8 text-center sm:grid-cols-4 sm:text-left">
        <Stat label="Median year" value={String(age.medianYear)} />
        <Stat label="Mean year" value={String(age.meanYear)} />
        <Stat
          label="Oldest"
          value={String(age.oldest?.year ?? '—')}
          detail={
            age.oldest ? `${age.oldest.name} · ${age.oldest.artist}` : undefined
          }
        />
        <Stat
          label="Newest"
          value={String(age.newest?.year ?? '—')}
          detail={
            age.newest ? `${age.newest.name} · ${age.newest.artist}` : undefined
          }
        />
      </dl>
 
      <p className="mt-8 text-center text-sm text-white/35 sm:text-left">
        Weighted by plays, not by track — a record on repeat counts every time.
        Based on {age.sampleSize.toLocaleString()} plays across{' '}
        {age.distinctTracks.toLocaleString()} tracks with a known release year.
      </p>
    </div>
  );
}
 
function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div>
      <dt className="text-sm uppercase tracking-[0.14em] text-white/40">
        {label}
      </dt>
      <dd className="mt-1.5 text-4xl font-bold tabular-nums text-(--accent)">
        {value}
      </dd>
      {detail && (
        <dd className="mt-1 truncate text-sm text-white/50">{detail}</dd>
      )}
    </div>
  );
}
 
// ---------------------------------------------------------------------------
 
export function Mosaic({ urls, label }: { urls: string[]; label: string }) {
  if (!urls.length) return null;
 
  return (
    <div
      role="img"
      aria-label={label}
      className="mx-auto grid w-full max-w-2xl grid-cols-5 gap-0.5 overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10"
    >
      {urls.slice(0, 25).map((url, i) => (
        <Image
          key={url}
          src={url}
          alt=""
          width={200}
          height={200}
          priority={i < 5}
          className="aspect-square w-full object-cover"
        />
      ))}
    </div>
  );
}