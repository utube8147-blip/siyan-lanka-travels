'use client';
// Home page → "Where we stop": the route on a map, along the real road when the
// routing server answers (a dashed straight line until then, or if it doesn't).

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { fetchRoadRoute } from '@/lib/routing';
import type { RouteStop } from '@/lib/types';

const RouteShareMap = dynamic(() => import('./RouteShareMap').then((m) => m.RouteShareMap), {
  ssr: false,
  loading: () => <div className="w-full h-full rounded-2xl bg-[#e8ecef] animate-pulse" />,
});

export function StopsMap({ stops, className = '' }: { stops: RouteStop[]; className?: string }) {
  // The road follows every point (hidden ones shape it); only real stops get a pin.
  const all = stops.filter((s) => s.lat != null && s.lng != null).map((s) => ({ name: s.name, lat: s.lat!, lng: s.lng!, hidden: !!s.hidden }));
  const pinned = all.filter((p) => !p.hidden);
  const key = all.map((p) => `${p.lat},${p.lng}`).join(';');
  const [path, setPath] = useState<[number, number][] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    setPath(null);
    setSelected(null);
    if (all.length < 2) return;
    const ctl = new AbortController();
    fetchRoadRoute(all.map((p) => [p.lat, p.lng]), ctl.signal).then(({ route }) => route && setPath(route.path));
    return () => ctl.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (pinned.length < 2) return null;
  return (
    <div className={className}>
      {/* key: a new direction starts a fresh map, framed on that route */}
      <RouteShareMap key={key} className="h-full" stops={pinned} path={path} selected={selected} onSelect={setSelected} compactLabels />
    </div>
  );
}
