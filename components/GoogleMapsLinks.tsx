'use client';
// "Google Maps" button: opens directions through the stops. A long route is
// split into parts (a Google Maps link takes about 10 stops); the button then
// opens a small list: Part 1 Colombo → Dambulla, Part 2 Dambulla → Akkaraipattu…

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Navigation } from 'lucide-react';
import { googleMapsParts } from '@/lib/routeShare';

export function GoogleMapsLinks({
  stops,
  className = '',
  label = 'Google Maps',
}: {
  stops: { name: string; lat?: number; lng?: number }[];
  className?: string;
  label?: string;
}) {
  const parts = googleMapsParts(stops);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const btn = `inline-flex items-center justify-center gap-1.5 rounded-xl font-bold h-8 px-3 text-[12px] bg-white border border-[#c7c5d1] text-[#050a44] hover:bg-[#f2f4f6] disabled:opacity-40 ${className}`;
  if (parts.length === 0)
    return (
      <button type="button" className={btn} disabled title="The stops need map pins">
        <Navigation className="w-3.5 h-3.5" /> {label}
      </button>
    );
  if (parts.length === 1)
    return (
      <a className={btn} href={parts[0].url} target="_blank" rel="noreferrer" title="Open directions through all the stops in Google Maps">
        <Navigation className="w-3.5 h-3.5" /> {label}
      </a>
    );
  return (
    <div ref={box} className="relative inline-block">
      <button type="button" className={btn} aria-expanded={open} onClick={() => setOpen((v) => !v)} title="Open directions in Google Maps">
        <Navigation className="w-3.5 h-3.5" /> {label} ({parts.length} parts)
      </button>
      {open && (
        <div className="absolute z-[1000] mt-1 right-0 w-[280px] rounded-xl border border-[#e1e2e4] bg-white shadow-lg p-1.5">
          <p className="px-2 py-1.5 text-[11px] text-[#6b6d78]">Google Maps takes about 10 stops per link, so this route opens in {parts.length} parts, each starting where the last one ends.</p>
          {parts.map((p, i) => (
            <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-[#f2f4f6] text-[13px]" onClick={() => setOpen(false)}>
              <span className="font-bold text-[#050a44] shrink-0">Part {i + 1}</span>
              <span className="text-[#46464f] truncate">
                {p.from} → {p.to}
              </span>
              <span className="text-[11px] text-[#6b6d78] shrink-0">{p.stops} stops</span>
              <ExternalLink className="w-3.5 h-3.5 text-[#6b6d78] shrink-0 ml-auto" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
