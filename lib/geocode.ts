'use client';
// Where a place is, for search words that aren't one of our stops
// ("Colombo", "Moratuwa", "University of Kelaniya"): looked up on
// OpenStreetMap (Photon, then Nominatim), inside Sri Lanka only. Answers are
// remembered in this browser for a month, so each place is looked up once.

export type Place = { lat: number; lng: number; label: string };

const LK = { minLng: 79.4, minLat: 5.8, maxLng: 82.0, maxLat: 10.0 };
const KEY = 'geocode-cache-v1';
const MONTH = 30 * 864e5;
const inLK = (lat: number, lng: number) => lat >= LK.minLat && lat <= LK.maxLat && lng >= LK.minLng && lng <= LK.maxLng;

function readCache(): Record<string, { at: number; p: Place | null }> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}
function writeCache(k: string, p: Place | null) {
  try {
    const c = readCache();
    c[k] = { at: Date.now(), p };
    const keys = Object.keys(c);
    if (keys.length > 200) for (const old of keys.sort((a, b) => c[a].at - c[b].at).slice(0, keys.length - 200)) delete c[old];
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* storage off: fine, just not remembered */
  }
}

const pending = new Map<string, Promise<Place | null>>();

export async function geocodePlace(text: string, signal?: AbortSignal): Promise<Place | null> {
  const q = text.trim();
  if (q.length < 3) return null;
  const k = q.toLowerCase();
  const hit = readCache()[k];
  if (hit && Date.now() - hit.at < MONTH) return hit.p;
  const busy = pending.get(k);
  if (busy) return busy;
  const job = (async () => {
    let p: Place | null = null;
    try {
      const url = `https://photon.komoot.io/api/?${new URLSearchParams({ q, limit: '3', lang: 'en', bbox: `${LK.minLng},${LK.minLat},${LK.maxLng},${LK.maxLat}` })}`;
      const r = await fetch(url, { signal });
      if (r.ok) {
        const j = await r.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const f = (j?.features ?? []).find((x: any) => x?.properties?.countrycode === 'LK' || inLK(x?.geometry?.coordinates?.[1], x?.geometry?.coordinates?.[0]));
        if (f) {
          const [lng, lat] = f.geometry.coordinates;
          const pr = f.properties ?? {};
          p = { lat, lng, label: [pr.name, pr.city && pr.city !== pr.name ? pr.city : null].filter(Boolean).join(', ') || q };
        }
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return null;
    }
    if (!p) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: 'jsonv2', countrycodes: 'lk', limit: '1' })}`;
        const r = await fetch(url, { signal, headers: { 'Accept-Language': 'en' } });
        if (r.ok) {
          const [f] = await r.json();
          if (f && inLK(+f.lat, +f.lon)) p = { lat: +f.lat, lng: +f.lon, label: String(f.name || f.display_name || q).split(',')[0] };
        }
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return null;
      }
    }
    writeCache(k, p);
    return p;
  })().finally(() => pending.delete(k));
  pending.set(k, job);
  return job;
}
