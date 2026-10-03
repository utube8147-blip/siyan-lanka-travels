'use client';
// Small dependency-free charts and the shared date / bus / route filter for
// Finance and Analytics. Every chart has a text alternative (title on each
// bar, and an aria-label on the figure).

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { PRESETS, daysIn, presetDates, type Preset, type Range } from '@/lib/analytics';
import { formatDateLabel, routeLabel, todayISO } from '@/lib/trips';
import { Card, inputClass } from './ui';

/** Date range + bus + route. `value` is controlled by the page. */
export function RangeFilter({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const { data } = useStore();
  const [preset, setPreset] = useState<Preset>('month');
  const pill = (on: boolean) => `px-3 h-9 rounded-lg text-[13px] font-bold border ${on ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white text-[#050a44] border-[#c7c5d1] hover:bg-[#f2f4f6]'}`;
  return (
    <Card className="p-4 mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={pill(preset === p.id)}
            aria-pressed={preset === p.id}
            onClick={() => {
              setPreset(p.id);
              if (p.id !== 'custom') onChange({ ...value, ...presetDates(p.id) });
            }}
          >
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <span className="flex flex-wrap items-center gap-2">
            <input type="date" aria-label="From" className={`${inputClass} !w-auto !h-9 !py-0`} value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
            <span className="text-[13px] text-[#46464f]">to</span>
            <input type="date" aria-label="To" className={`${inputClass} !w-auto !h-9 !py-0`} value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Bus" className={`${inputClass} !w-auto !h-9 !py-0`} value={value.busId} onChange={(e) => onChange({ ...value, busId: e.target.value })}>
          <option value="">All buses</option>
          {data.buses.map((b) => (
            <option key={b.id} value={b.id}>{b.name} · {b.regNo}</option>
          ))}
        </select>
        <select aria-label="Route" className={`${inputClass} !w-auto !h-9 !py-0`} value={value.routeId} onChange={(e) => onChange({ ...value, routeId: e.target.value })}>
          <option value="">Both directions</option>
          {data.routes.map((r) => (
            <option key={r.id} value={r.id}>{routeLabel(r)}</option>
          ))}
        </select>
        <span className="text-[12px] text-[#6b6d78]">
          {formatDateLabel(value.from, false)} to {formatDateLabel(value.to, false)} · {daysIn(value)} day{daysIn(value) === 1 ? '' : 's'}
          {value.to > todayISO() ? ' (includes days still to come)' : ''}
        </span>
      </div>
    </Card>
  );
}

/** A headline number with its change against the previous period. `goodWhenUp` colours the change. */
export function Stat({ label, value, note, delta, goodWhenUp = true, tone }: { label: string; value: string; note?: string; delta?: number | null; goodWhenUp?: boolean; tone?: 'good' | 'bad' }) {
  const up = (delta ?? 0) > 0;
  return (
    <Card className="p-5">
      <p className="text-[12px] font-bold text-[#46464f]">{label}</p>
      <p className={`text-[24px] font-semibold tabular-nums mt-1 ${tone === 'good' ? 'text-[#006e1c]' : tone === 'bad' ? 'text-[#ba1a1a]' : 'text-[#050a44]'}`}>{value}</p>
      <p className="text-[12px] text-[#6b6d78] mt-1">
        {delta != null && delta !== 0 && (
          <span className={`font-bold ${up === goodWhenUp ? 'text-[#006e1c]' : 'text-[#ba1a1a]'}`}>
            {up ? '▲' : '▼'} {Math.abs(delta)}%{' '}
          </span>
        )}
        {delta != null ? 'vs the same number of days before' : note ?? ''}
        {delta != null && note ? ` · ${note}` : ''}
      </p>
    </Card>
  );
}

/** `negativeColor`: used for values below zero (e.g. a loss in red), with its own legend entry `negativeName`. */
export interface Series { name: string; color: string; values: number[]; negativeColor?: string; negativeName?: string }

/** Chart colours that read on both the light and the dark theme (the brand navy disappears on a dark background). */
export const CHART = { income: '#3b82f6', expenses: '#feb700', profit: '#16a34a', loss: '#dc2626', muted: '#9ca3af' } as const;
/**
 * Grouped vertical bars over time buckets, e.g. income and expenses per day.
 * Each bucket (a day, a week, a month) is its own column: alternate columns
 * are shaded, and the bars of one bucket sit together with space either side,
 * so it is clear which bars belong to which date. Hovering, focusing or
 * tapping a column shows that date and every figure for it under the chart.
 * Negative values hang below the line.
 */
export function Bars({ labels, titles, series, format, height = 190, label }: { labels: string[]; titles?: string[]; series: Series[]; format: (n: number) => string; height?: number; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const span = max - min;
  const zero = (max / span) * 100; // % from the top where the zero line sits
  const every = Math.ceil(labels.length / 16); // don't crowd the axis
  const name = (i: number) => titles?.[i] ?? labels[i];
  const nameOf = (s: Series, v: number) => (v < 0 && s.negativeName ? s.negativeName : s.name);
  const colorOf = (s: Series, v: number) => (v < 0 && s.negativeColor ? s.negativeColor : s.color);
  return (
    <figure aria-label={label}>
      <div className="relative flex items-stretch w-full overflow-hidden" style={{ height }} onMouseLeave={() => setActive(null)}>
        {labels.map((l, i) => (
          <button
            type="button"
            key={i}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={() => setActive(i)}
            aria-label={`${name(i)}: ${series.map((s) => `${nameOf(s, s.values[i] ?? 0)} ${format(s.values[i] ?? 0)}`).join(', ')}`}
            className="relative block flex-1 min-w-0 h-full p-0 m-0 border-0 outline-none cursor-default"
            style={{ background: active === i ? 'rgba(59,130,246,0.16)' : i % 2 === 1 ? 'rgba(127,127,127,0.07)' : 'transparent' }}
          >
            {/* The bars of this column, inset from its edges. (Positioned, not padded: a percentage
                padding on a flex item is measured against the whole chart and pushed the columns
                off the page.) */}
            <span className="absolute inset-y-0 flex justify-center gap-[2px]" style={{ left: '14%', right: '14%' }}>
              {series.map((s) => {
                const v = s.values[i] ?? 0;
                const h = (Math.abs(v) / span) * 100;
                return (
                  <span key={s.name} className="relative block h-full" style={{ flex: '1 1 0', maxWidth: 16, minWidth: 2 }}>
                    <span
                      className={`absolute block ${v >= 0 ? 'rounded-t' : 'rounded-b'}`}
                      style={{ left: 0, right: 0, height: `${h}%`, top: v >= 0 ? `${zero - h}%` : `${zero}%`, background: colorOf(s, v), minHeight: v !== 0 ? 2 : 0 }}
                    />
                  </span>
                );
              })}
            </span>
          </button>
        ))}
        <div className="pointer-events-none absolute inset-x-0 border-t border-[#9ca3af]/60" style={{ top: `${zero}%` }} aria-hidden />
      </div>
      <div className="flex mt-1.5">
        {labels.map((l, i) => (
          <span key={i} className={`flex-1 min-w-0 text-center text-[10px] truncate ${active === i ? 'font-bold text-[#050a44]' : 'text-[#6b6d78]'}`}>{i % every === 0 || active === i ? l : ''}</span>
        ))}
      </div>
      {/* The figures for the column under the pointer (or the last one tapped). */}
      <p aria-live="polite" className="mt-2 min-h-[20px] text-[13px] text-[#46464f] flex flex-wrap gap-x-4 gap-y-0.5">
        {active == null ? (
          <span className="text-[12px] text-[#6b6d78]">Hover or tap a {labels.length > 1 ? 'column' : 'bar'} to see its date and figures.</span>
        ) : (
          <>
            <b className="text-[#050a44]">{name(active)}</b>
            {series.map((s) => {
              const v = s.values[active] ?? 0;
              return (
                <span key={s.name} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colorOf(s, v) }} /> {nameOf(s, v)} <b className="tabular-nums text-[#050a44]">{format(v)}</b>
                </span>
              );
            })}
          </>
        )}
      </p>
      <figcaption className="flex flex-wrap gap-4 mt-2 text-[12px] text-[#46464f]">
        {series.map((s) => (
          <span key={s.name} className="contents">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: s.color }} /> {s.name}</span>
            {s.negativeColor && s.values.some((v) => v < 0) && (
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: s.negativeColor }} /> {s.negativeName ?? `${s.name} (below zero)`}</span>
            )}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Slice colours for pie charts: distinct on both the light and the dark theme. */
export const PIE_COLORS = ['#3b82f6', '#feb700', '#16a34a', '#a855f7', '#f97316', '#14b8a6', '#ec4899', '#9ca3af'];

/**
 * A pie chart (drawn as a ring) with its legend: each slice's name, amount
 * and share. Hovering or tapping a slice or a legend row highlights it and
 * puts its figure in the middle. Slices under 1% are still listed.
 */
export function Pie({ rows, format, label, total: totalLabel = 'Total', stack = false, centerFormat }: { rows: { label: string; value: number }[]; format: (n: number) => string; label: string; total?: string; /** Shorter wording for the figure in the middle of the ring. */ centerFormat?: (n: number) => string; /** Put the legend under the ring (for narrow cards). */ stack?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const data = rows.filter((r) => r.value > 0);
  const sum = data.reduce((n, r) => n + r.value, 0);
  if (sum <= 0) return <Empty>Nothing to show for this period.</Empty>;
  const R = 54;
  const C = 2 * Math.PI * R;
  let run = 0;
  const pct = (v: number) => {
    const p = (v / sum) * 100;
    return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
  };
  return (
    <figure aria-label={label} className={`flex flex-col ${stack ? '' : 'sm:flex-row'} items-center gap-5`}>
      <div className="relative shrink-0" style={{ width: 150, height: 150 }}>
        <svg viewBox="0 0 150 150" width="150" height="150" role="img" aria-label={label} onMouseLeave={() => setActive(null)}>
          <g transform="rotate(-90 75 75)">
            {data.map((r, i) => {
              const len = (r.value / sum) * C;
              const el = (
                <circle
                  key={r.label}
                  cx="75" cy="75" r={R} fill="none"
                  stroke={PIE_COLORS[i % PIE_COLORS.length]}
                  strokeWidth={active === i ? 26 : 22}
                  strokeDasharray={`${Math.max(0, len - (data.length > 1 ? 1.5 : 0))} ${C}`}
                  strokeDashoffset={-run}
                  opacity={active == null || active === i ? 1 : 0.35}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => setActive(i)}
                >
                  <title>{`${r.label}: ${format(r.value)} (${pct(r.value)})`}</title>
                </circle>
              );
              run += len;
              return el;
            })}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-7">
          <span className="text-[10px] font-bold text-[#6b6d78] leading-tight line-clamp-2">{active == null ? totalLabel : data[active].label}</span>
          <span className="text-[13px] font-bold text-[#050a44] tabular-nums leading-tight">{(centerFormat ?? format)(active == null ? sum : data[active].value)}</span>
          {active != null && <span className="text-[11px] font-semibold text-[#46464f]">{pct(data[active].value)}</span>}
        </div>
      </div>
      <ul className="flex-1 min-w-0 w-full space-y-1.5">
        {data.map((r, i) => (
          <li key={r.label}>
            <button
              type="button"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(i)}
              className={`w-full flex items-center gap-2 text-left text-[13px] rounded-md px-1.5 py-0.5 ${active === i ? 'bg-[#3b82f6]/15' : ''}`}
            >
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
              <span className="flex-1 min-w-0 font-semibold text-[#050a44] break-words">{r.label}</span>
              <span className="tabular-nums text-[#46464f] shrink-0">{format(r.value)}</span>
              <span className="tabular-nums font-bold text-[#050a44] w-10 text-right shrink-0">{pct(r.value)}</span>
            </button>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** A grid of cells shaded by a 0–100 value, e.g. how full the bus is by weekday and direction. */
export function HeatGrid({ rows, cols, value, note, label }: { rows: string[]; cols: string[]; value: (r: number, c: number) => number | null; note?: (r: number, c: number) => string; label: string }) {
  return (
    <figure role="img" aria-label={label} className="overflow-x-auto">
      <div className="grid gap-1 min-w-[420px]" style={{ gridTemplateColumns: `minmax(120px, 1.4fr) repeat(${cols.length}, minmax(0, 1fr))` }}>
        <span />
        {cols.map((c) => (
          <span key={c} className="text-center text-[11px] font-bold text-[#46464f]">{c}</span>
        ))}
        {rows.map((r, ri) => (
          <div key={r} className="contents">
            <span className="text-[12px] font-semibold text-[#050a44] self-center pr-2">{r}</span>
            {cols.map((c, ci) => {
              const v = value(ri, ci);
              return (
                <span
                  key={c}
                  title={v == null ? `${r}, ${c}: no trips` : `${r}, ${c}: ${v}% full${note ? ` · ${note(ri, ci)}` : ''}`}
                  className="h-11 rounded-lg flex items-center justify-center text-[12px] font-bold tabular-nums"
                  style={v == null ? { background: 'rgba(156,163,175,0.15)', color: '#9ca3af' } : { background: `rgba(59,130,246,${0.12 + (v / 100) * 0.83})`, color: v > 45 ? '#fff' : 'inherit' }}
                >
                  {v == null ? '–' : `${v}%`}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </figure>
  );
}

/** Section card with a title and a one-line explanation. */
export function Panel({ title, hint, children, className = '' }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`p-5 ${className}`}>
      <h2 className="text-[16px] font-semibold text-[#050a44]">{title}</h2>
      {hint && <p className="text-[12px] text-[#6b6d78] mt-0.5 mb-4">{hint}</p>}
      {!hint && <div className="mb-4" />}
      {children}
    </Card>
  );
}
export const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-[14px] text-[#46464f]">{children}</p>;
