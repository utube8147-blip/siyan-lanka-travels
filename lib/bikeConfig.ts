// Bike categories and fees for the luggage compartment.
// The list is managed in Staff area → Settings → Bikes (stored in
// app_settings.bikes) and read here by every screen. config/operator.ts only
// supplies the starting categories. No React in this file, so server code
// can use the helpers too; the hook is in lib/useBikeConfig.ts.
import { OPERATOR } from '@/config/operator';

export interface BikeKindCfg {
  /** Stable key saved on bookings, e.g. "scooter". */
  id: string;
  label: string;
  /** Material Symbols icon name. */
  icon: string;
  /** Luggage-compartment spaces one of these takes. */
  spaces: number;
  /** Fee for the whole route (LKR); shorter trips pay a share. */
  fullRouteFee: number;
  /** Ask for a number plate. */
  needsPlate: boolean;
  /** Offered to passengers. Switched-off categories stay for old bookings. */
  active: boolean;
  order: number;
}
export interface BikeConfig {
  minFee: number;
  maxPerBooking: number;
  /** Every category, including switched-off ones, in display order. */
  kinds: BikeKindCfg[];
}

/** Icons the admin can choose from. */
export const BIKE_ICONS = [
  { id: 'moped', label: 'Scooter' },
  { id: 'two_wheeler', label: 'Motorbike' },
  { id: 'pedal_bike', label: 'Bicycle' },
  { id: 'electric_scooter', label: 'Kick scooter' },
  { id: 'electric_bike', label: 'E-bike' },
  { id: 'luggage', label: 'Other / cargo' },
] as const;

const DEFAULTS = OPERATOR.bikes.kinds as Record<string, { label: string; icon: string; spaces: number; fullRouteFee: number }>;
const titleCase = (id: string) => id.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

type RawKind = Partial<Omit<BikeKindCfg, 'id'>>;
type RawConfig = { minFee?: number; maxPerBooking?: number; kinds?: Record<string, RawKind> } | null | undefined;

/** Turns the stored JSON into a full list, filling gaps from the starting config. */
export function parseBikeConfig(raw: RawConfig): BikeConfig {
  const source: Record<string, RawKind> = raw?.kinds && Object.keys(raw.kinds).length ? raw.kinds : DEFAULTS;
  const defaultOrder = Object.keys(DEFAULTS);
  const kinds = Object.entries(source).map(([id, v], i): BikeKindCfg => {
    const def = DEFAULTS[id];
    const named = v.label?.trim() || def?.label; // an empty name counts as no name
    return {
      id,
      label: named ?? titleCase(id),
      icon: v.icon ?? def?.icon ?? 'two_wheeler',
      spaces: Math.max(1, Number(v.spaces ?? def?.spaces ?? 2)),
      fullRouteFee: Math.max(0, Number(v.fullRouteFee ?? def?.fullRouteFee ?? 0)),
      needsPlate: v.needsPlate ?? id !== 'bicycle',
      // An old entry nobody named in the app (e.g. the database's original "bicycle") stays hidden until switched on.
      active: v.active ?? named !== undefined,
      order: v.order ?? (defaultOrder.includes(id) ? defaultOrder.indexOf(id) : 50 + i),
    };
  });
  kinds.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  return {
    minFee: Number(raw?.minFee ?? OPERATOR.bikes.minFee),
    maxPerBooking: Math.max(1, Number(raw?.maxPerBooking ?? OPERATOR.bikes.maxPerBooking)),
    kinds,
  };
}

/** Back to the JSON shape stored in app_settings.bikes. */
export function bikeConfigToJson(c: BikeConfig) {
  return {
    minFee: c.minFee,
    maxPerBooking: c.maxPerBooking,
    kinds: Object.fromEntries(c.kinds.map((k, i) => [k.id, { label: k.label, icon: k.icon, spaces: k.spaces, fullRouteFee: k.fullRouteFee, needsPlate: k.needsPlate, active: k.active, order: i }])),
  };
}

let current: BikeConfig = parseBikeConfig(null);
const listeners = new Set<() => void>();
export const getBikeConfig = () => current;
export function setBikeConfig(raw: RawConfig) {
  current = parseBikeConfig(raw);
  listeners.forEach((fn) => fn());
}
export function subscribeBikeConfig(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Categories passengers can choose. */
export const activeBikeKinds = (c: BikeConfig = current) => c.kinds.filter((k) => k.active);
/** One category by id; a category that no longer exists still gets a readable label. */
export function bikeKind(id: string, c: BikeConfig = current): BikeKindCfg {
  return c.kinds.find((k) => k.id === id) ?? { id, label: titleCase(id), icon: 'two_wheeler', spaces: 2, fullRouteFee: 0, needsPlate: true, active: false, order: 99 };
}
/** A new category's id from its name: "Three wheeler" → "three-wheeler" (unique within the list). */
export function newBikeKindId(label: string, taken: string[]) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bike';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}
