'use client';

// Only the switching is client-side. The panels are Server Components passed
// in as props, so changing tabs is a state flip over markup that is already in
// the DOM — no fetch, no spinner, no list rendering shipped to the browser.
 
import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { TIME_RANGES, type TimeRange } from '@/lib/spotify/types';
 
interface Props {
  label: string;
  panels: Record<TimeRange, ReactNode>;
  initial?: TimeRange;
}
 
export function Tabs({ label, panels, initial = 'medium_term' }: Props) {
  const [active, setActive] = useState<TimeRange>(initial);
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
 
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + TIME_RANGES.length) % TIME_RANGES.length;
    setActive(TIME_RANGES[next].value);
    tabRefs.current[next]?.focus();
  }
 
  return (
    <div>
      <div role="tablist" aria-label={label} className="mb-6 flex flex-wrap gap-2.5">
        {TIME_RANGES.map((range, i) => {
          const selected = active === range.value;
          return (
            <button
              key={range.value}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              id={`${baseId}-tab-${range.value}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${range.value}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(range.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={[
                'rounded-full px-4.5 py-2 text-sm font-medium transition-colors sm:text-base',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)',
                selected
                  ? 'bg-(--accent) text-black'
                  : 'bg-white/8 text-white/60 hover:bg-white/15 hover:text-white/90',
              ].join(' ')}
            >
              {range.label}
            </button>
          );
        })}
      </div>
 
      {TIME_RANGES.map((range) => (
        <div
          key={range.value}
          role="tabpanel"
          id={`${baseId}-panel-${range.value}`}
          aria-labelledby={`${baseId}-tab-${range.value}`}
          hidden={active !== range.value}
        >
          {panels[range.value]}
        </div>
      ))}
    </div>
  );
}