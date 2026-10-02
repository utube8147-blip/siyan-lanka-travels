// Seat layouts.
// A bus's seats are a grid: rows from the front to the back, each row a list
// of cells from the left side of the bus to the right. A cell is a seat (its
// number, e.g. "17" or "3A") or null (no seat there: the aisle, a door, a gap).
// Rows may have different lengths, e.g. a back bench with more seats across.
//
// Buses saved before this existed have no stored grid; legacyGrid() builds the
// classic one (2+2 rows named 1A…, plus a back bench) from rows/backRowSeats.
// Staff area → Buses → Edit has the editor (components/admin/SeatLayoutEditor).
import type { Bus } from './types';

export type SeatCell = string | null;
export interface SeatMap {
  /** Seats left of the aisle in a normal row. */
  left: number;
  /** Seats right of the aisle in a normal row. */
  right: number;
  /** Front row first; each row left to right. */
  cells: SeatCell[][];
  /**
   * The two sides don't line up: one side has more rows than the other, and
   * each side's rows are spread evenly along the bus (so a row of 12 on the
   * right sits beside 11 on the left, not level with them). In the grid,
   * leave the shorter side's boxes empty in any one row.
   */
  stagger?: boolean;
}

/**
 * How the layout is drawn, top to bottom:
 *  - "row":   one row across the bus (cells left to right, null = gap);
 *  - "split": the left and right sides as two separate stacks of rows that
 *             share the same length of bus (used when `stagger` is on).
 */
export type LayoutSegment = { kind: 'row'; cells: SeatCell[] } | { kind: 'split'; left: SeatCell[][]; right: SeatCell[][] };

export function layoutSegments(map: SeatMap): LayoutSegment[] {
  if (!map.stagger) return map.cells.map((cells) => ({ kind: 'row', cells }));
  const width = map.left + 1 + map.right;
  const out: LayoutSegment[] = [];
  let block: SeatCell[][] = [];
  const flush = () => {
    if (!block.length) return;
    const some = (r: SeatCell[]) => r.some((c) => c !== null);
    out.push({ kind: 'split', left: block.map((r) => r.slice(0, map.left)).filter(some), right: block.map((r) => r.slice(map.left + 1)).filter(some) });
    block = [];
  };
  for (const row of map.cells) {
    // a normal row: seats either side of an empty aisle position
    if (row.length === width && row[map.left] === null) block.push(row);
    else {
      flush();
      out.push({ kind: 'row', cells: row });
    }
  }
  flush();
  return out;
}

/** How "Build" and "Renumber" name the seats. */
export type Numbering = 'letters' | 'ltr' | 'sheet';
export const NUMBERINGS: { id: Numbering; label: string; hint: string }[] = [
  { id: 'sheet', label: '1, 2, 3… right side first', hint: 'Like a printed booking sheet: in each row the right pair is numbered first (aisle seat, then window), then the left pair.' },
  { id: 'ltr', label: '1, 2, 3… left to right', hint: 'Row by row, from the left window to the right window.' },
  { id: 'letters', label: '1A, 1B, 1C… row + letter', hint: 'Row number and a letter across the row.' },
];

const LETTERS = 'ABCDEFGHJK';

/** The classic layout for buses saved without a grid: 2+2 rows "1A 1B _ 1C 1D" and a back bench. */
export function legacyGrid(bus: Pick<Bus, 'rows' | 'backRowSeats'>): SeatMap {
  const cells: SeatCell[][] = [];
  for (let r = 1; r <= bus.rows; r++) cells.push([`${r}A`, `${r}B`, null, `${r}C`, `${r}D`]);
  const n = bus.backRowSeats;
  const back = bus.rows + 1;
  if (n === 4) cells.push([`${back}A`, `${back}B`, null, `${back}C`, `${back}D`]);
  else if (n > 0) cells.push(Array.from({ length: n }, (_, i) => `${back}${'ABCDEF'[i]}`));
  return { left: 2, right: 2, cells };
}

/** The bus's seat grid: the stored one, or the classic one. */
export function busSeatMap(bus: Pick<Bus, 'rows' | 'backRowSeats' | 'seatMap'>): SeatMap {
  return bus.seatMap && bus.seatMap.cells?.length ? bus.seatMap : legacyGrid(bus);
}

/** Every seat number on the bus, front to back, left to right. */
export function seatIdsOf(map: SeatMap): string[] {
  return map.cells.flatMap((row) => row.filter((c): c is string => !!c));
}

/** Width of a normal row in cells (left seats + aisle + right seats). */
export const normalWidth = (m: Pick<SeatMap, 'left' | 'right'>) => m.left + 1 + m.right;

/**
 * (Re)numbers the seats that are in the grid, leaving the gaps where they are.
 * - letters: 1A 1B | 1C 1D
 * - ltr:     1 2 | 3 4, then 5 6 | 7 8 …
 * - sheet:   right side first, each side from the aisle outwards (3 on the
 *            left-aisle seat, 4 at the left window); on a bench with a seat
 *            in the aisle position, the left pair first and then the rest.
 */
export function renumber(map: SeatMap, style: Numbering): SeatMap {
  const aisle = map.left;
  let n = 0;
  const cells = map.cells.map((row, r) => {
    const out: SeatCell[] = row.map(() => null);
    const here = row.map((c, i) => (c !== null ? i : -1)).filter((i) => i >= 0);
    if (style === 'letters') {
      // In a normal row the letter follows the column (A B | C D), so a side with no seats in this row doesn't shift the letters.
      const normal = row.length === normalWidth(map) && row[aisle] === null;
      here.forEach((i, k) => (out[i] = `${r + 1}${LETTERS[normal ? (i < aisle ? i : i - 1) : k] ?? k + 1}`));
      return out;
    }
    let order = here;
    if (style === 'sheet') {
      const normal = row.length === normalWidth(map);
      const leftSide = here.filter((i) => i < aisle).reverse(); // from the aisle outwards
      if (normal && row[aisle] === null) order = [...here.filter((i) => i > aisle), ...leftSide];
      else if (normal) order = [...leftSide, ...here.filter((i) => i >= aisle)];
    }
    order.forEach((i) => (out[i] = String(++n)));
    return out;
  });
  return { ...map, cells };
}

/**
 * A fresh layout: `left` seats in each of `rowsLeft` rows on the left side,
 * `right` seats in each of `rowsRight` rows on the right side, and a back
 * bench of `back` seats. When the two sides have different numbers of rows
 * (say 11 and 12) they share the same length of bus, so the layout is marked
 * as staggered: the side with more rows is drawn a little closer together.
 */
export function buildSeatMap(spec: { rowsLeft: number; rowsRight: number; left: number; right: number; back: number; numbering: Numbering }): SeatMap {
  const width = spec.left + 1 + spec.right;
  const cells: SeatCell[][] = [];
  const rows = Math.max(spec.rowsLeft, spec.rowsRight);
  for (let r = 0; r < rows; r++)
    cells.push(Array.from({ length: width }, (_, i) => (i === spec.left ? null : i < spec.left ? (r < spec.rowsLeft ? 'x' : null) : r < spec.rowsRight ? 'x' : null)));
  if (spec.back > 0) {
    if (spec.back === width - 1) cells.push(Array.from({ length: width }, (_, i) => (i === spec.left ? null : 'x'))); // same as a normal row
    else cells.push(Array.from({ length: spec.back }, () => 'x')); // a bench across (may be wider or narrower than a row)
  }
  return renumber({ left: spec.left, right: spec.right, cells, stagger: spec.rowsLeft !== spec.rowsRight }, spec.numbering);
}

/** "window" / "aisle" / "middle", worked out from where the seat is in its row. */
export function seatPosition(map: SeatMap, r: number, c: number): 'window' | 'aisle' | 'middle' {
  const row = map.cells[r];
  if (c === 0 || c === row.length - 1) return 'window';
  if (row.length === normalWidth(map) && (c === map.left - 1 || c === map.left + 1) && row[map.left] === null) return 'aisle';
  return 'middle';
}

/** Where a seat is, for labels like "window". */
export function findSeat(map: SeatMap, id: string): { r: number; c: number } | null {
  for (let r = 0; r < map.cells.length; r++) {
    const c = map.cells[r].indexOf(id);
    if (c >= 0) return { r, c };
  }
  return null;
}

export const SEAT_LABEL = /^[A-Z0-9]{1,4}$/;
/** What stops a layout being saved. */
export function seatMapProblems(map: SeatMap): string[] {
  const out: string[] = [];
  const ids = seatIdsOf(map);
  if (map.cells.some((row) => row.some((c) => c === ''))) out.push('Give every seat a number, or remove its row.');
  if (ids.length === 0) out.push('Add at least one seat.');
  if (ids.length > 80) out.push('A bus can have at most 80 seats.');
  const bad = ids.filter((s) => !SEAT_LABEL.test(s));
  if (bad.length) out.push(`Seat numbers can use letters and digits only, up to 4 characters: ${[...new Set(bad)].slice(0, 5).join(', ')}`);
  const dup = ids.filter((s, i) => ids.indexOf(s) !== i);
  if (dup.length) out.push(`Each seat needs its own number. Used twice: ${[...new Set(dup)].slice(0, 8).join(', ')}`);
  return out;
}

/** "2+2", "2+3"… for the fleet list. */
export const layoutName = (m: SeatMap) => `${m.left}+${m.right}`;
