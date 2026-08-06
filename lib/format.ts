export function msToClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
 
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 1000],
  ['minute', 60_000],
  ['hour', 3_600_000],
  ['day', 86_400_000],
  ['week', 604_800_000],
  ['month', 2_629_800_000],
  ['year', 31_557_600_000],
];
 
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
 
/**
 * Converts an ISO string to a relative time string.
 * 
 * `now` is injectable so the server and the client can be handed the same
 * reference time, avoiding a hydration mismatch when the boundary falls
 * between "59 minutes ago" and "1 hour ago".
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
 
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  let size = 1000;
  for (const [u, ms] of UNITS) {
    if (abs >= ms) {
      unit = u;
      size = ms;
    }
  }
 
  return rtf.format(Math.round(diff / size), unit);
}