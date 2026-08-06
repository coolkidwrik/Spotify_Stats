'use client';

// Only the switching is client-side. The panels themselves are Server
// Components passed in as props — React streams all three in the RSC payload,
// so changing tabs is a state flip with no fetch, no spinner, and no client
// rendering of the lists.
 
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
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tabs__list">
        {TIME_RANGES.map((range, i) => (
          <button
            key={range.value}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`${baseId}-tab-${range.value}`}
            aria-selected={active === range.value}
            aria-controls={`${baseId}-panel-${range.value}`}
            tabIndex={active === range.value ? 0 : -1}
            className="tabs__tab"
            onClick={() => setActive(range.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {range.label}
          </button>
        ))}
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
 