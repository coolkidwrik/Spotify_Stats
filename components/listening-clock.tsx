import type { ClockHour } from '@/lib/plays/queries';
 
const SIZE = 320;
const CENTER = SIZE / 2;
const INNER = 46;
const OUTER = 148;
 
function polar(angleDeg: number, radius: number) {
  // -90 so hour 0 sits at the top, like a real clock face.
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(rad),
    y: CENTER + radius * Math.sin(rad),
  };
}
 
function wedgePath(hour: number, radius: number): string {
  const start = hour * 15 + 1.2; // 360/24 = 15 degrees, minus a small gap
  const end = (hour + 1) * 15 - 1.2;
 
  const p1 = polar(start, INNER);
  const p2 = polar(end, INNER);
  const p3 = polar(end, radius);
  const p4 = polar(start, radius);
 
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${INNER} ${INNER} 0 0 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${radius} ${radius} 0 0 0 ${p4.x} ${p4.y}`,
    'Z',
  ].join(' ');
}
 
function formatHour(h: number): string {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
 
export function ListeningClock({
  hours,
  days,
}: {
  hours: ClockHour[];
  days: number;
}) {
  const total = hours.reduce((sum, h) => sum + h.plays, 0);
 
  if (!total) {
    return (
      <p className="text-center text-base text-white/45">
        No plays recorded yet in this window.
      </p>
    );
  }
 
  const peak = Math.max(...hours.map((h) => h.plays));
  const busiest = hours.reduce((a, b) => (b.plays > a.plays ? b : a));
  const quietest = hours.reduce((a, b) => (b.plays < a.plays ? b : a));
 
  return (
    <div className="flex flex-col items-center gap-12">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full max-w-85 overflow-visible"
        role="img"
        aria-label={`Plays by hour of day over the last ${days} days. Busiest at ${formatHour(
          busiest.hour
        )}.`}
      >
        {/* Reference rings */}
        {[0.5, 1].map((r) => (
          <circle
            key={r}
            cx={CENTER}
            cy={CENTER}
            r={INNER + (OUTER - INNER) * r}
            fill="none"
            stroke="rgba(255,255,255,0.09)"
            strokeWidth="1"
          />
        ))}
 
        {hours.map((h) => {
          // Square-root scaling: a wedge's AREA grows with the square of its
          // radius, so linear radius makes the peak hour look ~4x bigger than
          // it is. sqrt makes area proportional to the value.
          const scale = peak ? Math.sqrt(h.plays / peak) : 0;
          const radius = INNER + (OUTER - INNER) * scale;
 
          return (
            <g key={h.hour} className="group">
              {/* Full-size invisible wedge so zero-play hours stay hoverable */}
              <path d={wedgePath(h.hour, OUTER)} fill="transparent" />
              <path
                d={wedgePath(h.hour, Math.max(radius, INNER + 1))}
                fill="var(--accent)"
                opacity={h.plays ? 0.72 : 0.12}
                className="transition-opacity group-hover:opacity-100"
              />
              {/* Must be a single string child — React treats SVG <title>
                  like the document title element. */}
              <title>{`${formatHour(h.hour)} — ${h.plays} ${
                h.plays === 1 ? 'play' : 'plays'
              }`}</title>
            </g>
          );
        })}
 
        {/* Quarter labels only — 24 would be unreadable at this size */}
        {[0, 6, 12, 18].map((h) => {
          const pos = polar(h * 15 + 7.5, OUTER + 18);
          return (
            <text
              key={h}
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="central"
              fill="rgba(255,255,255,0.4)"
              fontSize="11"
            >
              {formatHour(h)}
            </text>
          );
        })}
      </svg>
 
      <dl className="grid w-full max-w-2xl grid-cols-1 gap-x-8 gap-y-8 text-center sm:grid-cols-3">
        <div>
          <dt className="text-sm uppercase tracking-[0.14em] text-white/40">
            Busiest hour
          </dt>
          <dd className="mt-1 text-3xl font-bold text-(--accent)">
            {formatHour(busiest.hour)}
          </dd>
          <dd className="text-sm text-white/45">{busiest.plays} plays</dd>
        </div>
 
        <div>
          <dt className="text-sm uppercase tracking-[0.14em] text-white/40">
            Quietest hour
          </dt>
          <dd className="mt-1 text-3xl font-bold">
            {formatHour(quietest.hour)}
          </dd>
          <dd className="text-sm text-white/45">{quietest.plays} plays</dd>
        </div>
 
        <div>
          <dt className="text-sm uppercase tracking-[0.14em] text-white/40">
            Total plays
          </dt>
          <dd className="mt-1 text-3xl font-bold tabular-nums">{total}</dd>
          <dd className="text-sm text-white/45">last {days} days</dd>
        </div>
      </dl>
    </div>
  );
}