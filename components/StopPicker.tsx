'use client';
// A stop picker for the search forms (instead of the browser's own datalist,
// which looks different in every browser and gets cut off). Type to filter;
// stops that start with what you typed come first; arrow keys + Enter, or tap.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, MapPin, Search } from 'lucide-react';
import { tx } from '@/lib/i18n';

const low = (s: string) => s.trim().toLowerCase();

function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(low(q)) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-transparent text-inherit font-extrabold underline decoration-[#feb700] decoration-2 underline-offset-2">{text.slice(i, i + q.trim().length)}</mark>
      {text.slice(i + q.trim().length)}
    </>
  );
}

export function StopPicker({
  value, onChange, options, hints = {}, placeholder, ariaLabel, id, className = '', icon, onEnter, align = 'left',
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  /** A line under each stop (its landmark / area), also matched when typing. */
  hints?: Record<string, string>;
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
  /** Classes for the input (keeps each form's own look). */
  className?: string;
  icon?: React.ReactNode;
  /** Enter with the list closed (e.g. run the search). */
  onEnter?: () => void;
  /** Which edge the list lines up with when it's wider than the field (the right-hand field on phones). */
  align?: 'left' | 'right';
}) {
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [hi, setHi] = useState(0);

  // While the box shows a chosen stop, list every stop; once typing, filter.
  const q = typed ? value : '';
  const shown = useMemo(() => {
    const n = low(q);
    const all = [...new Set(options)].sort((a, b) => a.localeCompare(b));
    if (!n) return all;
    const starts = all.filter((o) => low(o).startsWith(n));
    const word = all.filter((o) => !starts.includes(o) && low(o).split(/[\s,()/-]+/).some((w) => w.startsWith(n)));
    const has = all.filter((o) => !starts.includes(o) && !word.includes(o) && low(o).includes(n));
    const hinted = all.filter((o) => !starts.includes(o) && !word.includes(o) && !has.includes(o) && low(hints[o] ?? '').includes(n));
    return [...starts, ...word, ...has, ...hinted];
  }, [options, hints, q]);
  // Typed a place that isn't one of the stops: offer to look for stops near it.
  const near = typed && value.trim().length >= 3 && !options.some((o) => low(o) === low(value)) ? value.trim() : null;
  const count = shown.length + (near ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);

  const choose = (v: string) => {
    onChange(v);
    setTyped(false);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      {icon}
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[hi] ? `${listId}-${hi}` : undefined}
        autoComplete="off"
        spellCheck={false}
        onFocus={(e) => { setOpen(true); setTyped(false); setHi(Math.max(0, shown.indexOf(value))); e.currentTarget.select(); }}
        onChange={(e) => { onChange(e.target.value); setTyped(true); setOpen(true); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(count - 1, h + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === 'Escape') setOpen(false);
          else if (e.key === 'Tab') { if (open && typed && shown[hi]) choose(shown[hi]); else setOpen(false); }
          else if (e.key === 'Enter') {
            if (open && shown[hi] && (typed || low(shown[hi]) !== low(value))) { e.preventDefault(); choose(shown[hi]); }
            else { setOpen(false); setTyped(false); onEnter?.(); }
          }
        }}
        className={className}
        type="text"
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className={`absolute top-[calc(100%+6px)] z-[80] w-full min-w-[230px] max-h-[300px] overflow-y-auto overscroll-contain rounded-2xl bg-white border border-[#e1e2e4] shadow-[0_18px_40px_-12px_rgba(5,10,68,.35)] py-1.5 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {shown.length === 0 && !near ? (
            <li className="px-4 py-3 text-[13px] text-[#46464f]">{tx('No stop called “{q}”. Try another spelling.', { q: value.trim() })}</li>
          ) : (
            shown.map((o, i) => {
              const picked = low(o) === low(value);
              return (
                <li
                  key={o}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === hi}
                  onMouseDown={(e) => { e.preventDefault(); choose(o); }}
                  onMouseEnter={() => setHi(i)}
                  className={`mx-1.5 px-3 py-2.5 rounded-xl flex items-center gap-2.5 cursor-pointer text-[14px] text-[#050a44] ${i === hi ? 'bg-[#f2f4f6]' : ''}`}
                >
                  <MapPin className={`w-4 h-4 shrink-0 ${picked ? 'text-[#feb700]' : 'text-[#9a9ba5]'}`} />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium"><Highlight text={o} q={q} /></span>
                    {hints[o] && <span className="block truncate text-[12px] text-[#6b6d78]"><Highlight text={hints[o]} q={q} /></span>}
                  </span>
                  {picked && <Check className="w-4 h-4 shrink-0 text-[#16a34a]" />}
                </li>
              );
            })
          )}
          {near && (
            <li
              id={`${listId}-${shown.length}`}
              role="option"
              aria-selected={hi === shown.length}
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); setTyped(false); onEnter?.(); }}
              onMouseEnter={() => setHi(shown.length)}
              className={`mx-1.5 mt-1 px-3 py-2.5 rounded-xl flex items-center gap-2.5 cursor-pointer text-[14px] text-[#050a44] border-t border-[#edeef0] ${hi === shown.length ? 'bg-[#f2f4f6]' : ''}`}
            >
              <Search className="w-4 h-4 shrink-0 text-[#7c5800]" />
              <span className="flex-1 min-w-0">
                <span className="block truncate font-semibold">{tx('Find stops near “{q}”', { q: near })}</span>
                <span className="block text-[12px] text-[#6b6d78]">{tx('We look it up on the map and show the nearest bus stops.')}</span>
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
