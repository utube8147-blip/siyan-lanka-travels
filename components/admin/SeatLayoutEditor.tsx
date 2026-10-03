'use client';
// Seat layout editor for a bus (Staff area → Buses → Edit).
// 1. "Build" lays out rows quickly: seats left of the aisle, seats right, a
//    back bench, and how to number them.
// 2. Every box in the grid can then be changed by hand: type a seat number,
//    or clear the box where there is no seat (a door, a missing seat).
// 3. "Renumber" numbers the seats that are left, in order.

import { useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { NUMBERINGS, buildSeatMap, layoutSegments, normalWidth, renumber, seatIdsOf, seatMapProblems, type Numbering, type SeatMap } from '@/lib/seatLayout';
import { Button, Field, inputClass } from './ui';

export function SeatLayoutEditor({ value, onChange }: { value: SeatMap; onChange: (m: SeatMap) => void }) {
  const lastRow = value.cells[value.cells.length - 1] ?? [];
  const hasBench = value.cells.length > 1 && (lastRow.length !== normalWidth(value) || lastRow[value.left] !== null);
  const [left, setLeft] = useState(value.left);
  const [right, setRight] = useState(value.right);
  const [back, setBack] = useState(hasBench ? lastRow.filter(Boolean).length : 0);
  const [numbering, setNumbering] = useState<Numbering>(/^\d+$/.test(seatIdsOf(value)[0] ?? '') ? 'sheet' : 'letters');

  // Rows that have seats on each side (not counting a bench): when they differ, the sides can't line up.
  const normal = value.cells.filter((r) => r.length === normalWidth(value) && r[value.left] === null);
  const leftRows = normal.filter((r) => r.slice(0, value.left).some(Boolean)).length;
  const rightRows = normal.filter((r) => r.slice(value.left + 1).some(Boolean)).length;
  // The two sides are set separately: a bus can have 11 rows on the left and 12 on the right.
  const [rowsLeft, setRowsLeft] = useState(Math.max(1, leftRows));
  const [rowsRight, setRowsRight] = useState(Math.max(1, rightRows));
  const build = () => onChange(buildSeatMap({ rowsLeft, rowsRight, left, right, back, numbering }));
  const isNormalRow = (row: (string | null)[]) => row.length === normalWidth(value) && row[value.left] === null;
  const setCell = (r: number, c: number, text: string) => {
    const label = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    // Sides not level: a cleared box stays a seat waiting for its number (the row must not vanish while typing). Otherwise it becomes a gap.
    const empty = value.stagger && isNormalRow(value.cells[r]) ? '' : null;
    onChange({ ...value, cells: value.cells.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? label || empty : cell)) : row)) });
  };
  const removeRow = (r: number) => onChange({ ...value, cells: value.cells.filter((_, i) => i !== r) });
  // A new normal row goes in above the back bench (or at the end when there is none).
  const addRow = () => {
    const row = Array.from({ length: normalWidth(value) }, (_, i) => (i === value.left ? null : '?'));
    const at = hasBench ? value.cells.length - 1 : value.cells.length;
    onChange(renumber({ ...value, cells: [...value.cells.slice(0, at), row, ...value.cells.slice(at)] }, numbering));
  };
  const resizeRow = (r: number, by: 1 | -1) =>
    onChange({ ...value, cells: value.cells.map((row, i) => (i !== r ? row : by === 1 ? [...row, null] : row.length > 1 ? row.slice(0, -1) : row)) });

  // ---- Editing when the sides don't line up: each side is edited as its own stack of rows.
  const isNormal = (row: (string | null)[]) => row.length === normalWidth(value) && row[value.left] === null;
  const sideCells = (row: (string | null)[], side: 'left' | 'right') => (side === 'left' ? row.slice(0, value.left) : row.slice(value.left + 1));
  const hasSide = (row: (string | null)[], side: 'left' | 'right') => sideCells(row, side).some((c) => c !== null);
  /** The layout top to bottom, with the grid row each piece comes from. */
  const indexedSegments: ({ kind: 'row'; r: number } | { kind: 'split'; left: number[]; right: number[] })[] = [];
  {
    let block: number[] = [];
    const flush = () => {
      if (block.length) indexedSegments.push({ kind: 'split', left: block.filter((r) => hasSide(value.cells[r], 'left')), right: block.filter((r) => hasSide(value.cells[r], 'right')) });
      block = [];
    };
    value.cells.forEach((row, r) => {
      if (isNormal(row)) block.push(r);
      else {
        flush();
        indexedSegments.push({ kind: 'row', r });
      }
    });
    flush();
  }
  /** Removes one side's seats from a row; a row left with no seats at all goes too. Then renumbers. */
  const removeSideRow = (r: number, side: 'left' | 'right') => {
    const cells = value.cells
      .map((row, i) => (i !== r ? row : row.map((c, j) => ((side === 'left' ? j < value.left : j > value.left) ? null : c))))
      .filter((row) => row.some((c) => c !== null));
    onChange(renumber({ ...value, cells }, numbering));
  };
  /** Adds a row of seats to one side: into the first row where that side is empty, else as a new row before the bench. Then renumbers. */
  const addSideRow = (side: 'left' | 'right') => {
    const fill = (row: (string | null)[]) => row.map((c, j) => ((side === 'left' ? j < value.left : j > value.left) ? '?' : c));
    const free = value.cells.findIndex((row) => isNormal(row) && !hasSide(row, side));
    let cells: (string | null)[][];
    if (free >= 0) cells = value.cells.map((row, i) => (i === free ? fill(row) : row));
    else {
      const lastNormal = value.cells.reduce((at, row, i) => (isNormal(row) ? i : at), -1);
      const fresh = fill(Array.from({ length: normalWidth(value) }, () => null));
      cells = [...value.cells.slice(0, lastNormal + 1), fresh, ...value.cells.slice(lastNormal + 1)];
    }
    onChange(renumber({ ...value, cells }, numbering));
  };
  /** One editable seat box. `tight`: the side with more rows, drawn slightly shorter so it fits the same length. */
  const cellInput = (r: number, c: number, cell: string | null, tight = false) => (
    <input
      key={c}
      value={cell ?? ''}
      onChange={(e) => setCell(r, c, e.target.value)}
      aria-label={`Seat number, row ${r + 1}, position ${c + 1}`}
      placeholder="·"
      className={`${tight ? 'h-8' : 'h-9'} min-w-0 w-full rounded-lg text-center text-[13px] font-bold outline-none focus:ring-2 focus:ring-[#050a44] ${
        cell ? 'bg-white border-2 border-[#8b90a8] text-[#050a44] hover:border-[#3b82f6] cursor-text' : cell === '' ? 'bg-white border border-[#ba1a1a] text-[#050a44]' : 'bg-transparent border border-dashed border-[#c7c5d1] text-[#6b6d78] placeholder:text-[#c7c5d1]'
      }`}
    />
  );

  const problems = seatMapProblems(value);
  const total = seatIdsOf(value).length;
  const widest = Math.max(1, ...value.cells.map((r) => r.length));
  const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[#f2f4f6] p-4 space-y-3">
        <p className="text-[13px] font-bold text-[#050a44]">1. Build the layout</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Left side: rows">
            <input type="number" min={1} max={20} className={inputClass} value={rowsLeft} onChange={(e) => setRowsLeft(num(e.target.value, 1, 20))} />
          </Field>
          <Field label="Right side: rows">
            <input type="number" min={1} max={20} className={inputClass} value={rowsRight} onChange={(e) => setRowsRight(num(e.target.value, 1, 20))} />
          </Field>
          <Field label="Left side: seats per row">
            <select className={inputClass} value={left} onChange={(e) => setLeft(Number(e.target.value))}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Right side: seats per row">
            <select className={inputClass} value={right} onChange={(e) => setRight(Number(e.target.value))}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Back bench seats">
            <select className={inputClass} value={back} onChange={(e) => setBack(Number(e.target.value))}>
              {Array.from({ length: left + right + 3 }, (_, n) => n).map((n) => <option key={n} value={n}>{n === 0 ? 'None' : n}</option>)}
            </select>
          </Field>
        </div>
        {rowsLeft !== rowsRight && (
          <p className="text-[12px] font-semibold text-[#050a44]">
            {rowsLeft} rows on the left and {rowsRight} on the right share the same length of bus, so the side with more rows is drawn with its seats a little closer together.
          </p>
        )}
        <Field label="Seat numbers" hint={NUMBERINGS.find((n) => n.id === numbering)?.hint}>
          <select className={inputClass} value={numbering} onChange={(e) => setNumbering(e.target.value as Numbering)}>
            {NUMBERINGS.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
        </Field>
        <Button variant="secondary" onClick={build}>
          <RotateCcw className="w-4 h-4" /> Build: left {rowsLeft} × {left}, right {rowsRight} × {right}{back ? `, ${back} at the back` : ''} = {rowsLeft * left + rowsRight * right + back} seats
        </Button>
        <p className="text-[12px] text-[#6b6d78]">Building replaces the grid below, including any changes made by hand.</p>
      </div>

      <div className="space-y-2">
        <p className="text-[13px] font-bold text-[#050a44]">2. Adjust any seat</p>
        <p className="text-[12px] text-[#46464f]">
          {value.stagger
            ? 'Each side is shown as its own stack of rows, front of the bus at the top. Every box can be typed in: click a seat and type its number (17, 3A…). To number them all at once, pick a style under "Seat numbers" and press "Renumber the seats". Use the bin to remove a row from one side, or "Add a row" under a side.'
            : 'Each box is one position, front of the bus at the top, left side on the left. Every box can be typed in: click a seat and type its number (17, 3A…), or clear the box where there is no seat (a door, a gap). To number them all at once, pick a style under "Seat numbers" and press "Renumber the seats".'}
        </p>
        {value.stagger ? (
          // Sides with different numbers of rows: each side is its own stack, exactly as passengers
          // will see it. No empty boxes: the side with more rows simply sits a little closer together.
          <div className="rounded-xl border border-[#c7c5d1] p-3 overflow-x-auto">
            <p className="text-[10px] font-bold text-[#686873] text-right mb-2">Front · driver</p>
            <div className="mx-auto space-y-1.5" style={{ width: 'fit-content' }}>
              {indexedSegments.map((seg, i) =>
                seg.kind === 'row' ? (
                  <div key={i} className="flex items-center gap-2 pt-1">
                    <div className="grid gap-1.5" style={{ width: (value.left + value.right) * 46 + 38, gridTemplateColumns: `repeat(${value.cells[seg.r].length}, minmax(0, 1fr))` }}>
                      {value.cells[seg.r].map((cell, c) => cellInput(seg.r, c, cell))}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button type="button" onClick={() => resizeRow(seg.r, -1)} title="One seat fewer on this bench" aria-label="Bench: one position fewer" className="w-6 h-7 rounded text-[14px] font-bold text-[#46464f] hover:bg-[#f2f4f6]">−</button>
                      <button type="button" onClick={() => resizeRow(seg.r, 1)} title="One more seat on this bench" aria-label="Bench: one more position" className="w-6 h-7 rounded text-[14px] font-bold text-[#46464f] hover:bg-[#f2f4f6]">+</button>
                      <button type="button" onClick={() => removeRow(seg.r)} title="Remove this bench" aria-label="Remove bench" className="w-7 h-7 rounded flex items-center justify-center text-[#ba1a1a] hover:bg-[#ba1a1a]/10">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex items-stretch gap-6">
                    {(['left', 'right'] as const).map((side) => {
                      const rowsHere = seg[side];
                      const more = rowsHere.length > Math.min(seg.left.length, seg.right.length);
                      const from = side === 'left' ? 0 : value.left + 1;
                      const count = side === 'left' ? value.left : value.right;
                      return (
                        <div key={side} className="flex flex-col">
                          <p className="text-[10px] font-bold text-[#686873] mb-1">{side === 'left' ? 'Left side' : 'Right side'} · {rowsHere.length} rows</p>
                          <div className="flex-1 flex flex-col justify-between" style={{ rowGap: more ? 2 : 6 }}>
                            {rowsHere.map((r, k) => (
                              <div key={r} className="flex items-center gap-1.5">
                                <span className="w-4 text-[10px] font-bold text-[#6b6d78] text-right">{k + 1}</span>
                                <div className="grid gap-1.5" style={{ width: count * 46 - 6, gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
                                  {Array.from({ length: count }, (_, j) => cellInput(r, from + j, value.cells[r][from + j], more))}
                                </div>
                                <button type="button" onClick={() => removeSideRow(r, side)} title="Remove this row from this side" aria-label={`Remove row ${k + 1} on the ${side} side`} className="w-6 h-6 rounded flex items-center justify-center text-[#ba1a1a] hover:bg-[#ba1a1a]/10">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                          <button type="button" onClick={() => addSideRow(side)} className="mt-2 self-start text-[12px] font-bold text-[#050a44] underline">+ Add a row on the {side}</button>
                        </div>
                      );
                    })}
                  </div>
                ),
              )}
            </div>
          </div>
        ) : (
        <div className="rounded-xl border border-[#c7c5d1] p-3 overflow-x-auto">
          <p className="text-[10px] font-bold text-[#686873] text-right mb-2">Front · driver</p>
          <div className="space-y-1.5 mx-auto" style={{ width: 'fit-content' }}>
            {value.cells.map((row, r) => (
              <div key={r} className="flex items-center gap-2">
                <span className="w-5 text-[10px] font-bold text-[#6b6d78] text-right">{r + 1}</span>
                <div className="grid gap-1.5" style={{ width: widest * 46 - 6, gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
                  {row.map((cell, c) => (
                    <input
                      key={c}
                      value={cell ?? ''}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      aria-label={`Row ${r + 1}, position ${c + 1}`}
                      placeholder="·"
                      className={`h-9 min-w-0 w-full rounded-lg text-center text-[13px] font-bold outline-none focus:ring-2 focus:ring-[#050a44] ${
                        cell ? 'bg-white border-2 border-[#8b90a8] text-[#050a44] hover:border-[#3b82f6] cursor-text' : 'bg-transparent border border-dashed border-[#c7c5d1] text-[#6b6d78] placeholder:text-[#c7c5d1]'
                      }`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button type="button" onClick={() => resizeRow(r, -1)} title="One position fewer in this row" aria-label={`Row ${r + 1}: one position fewer`} className="w-6 h-7 rounded text-[14px] font-bold text-[#46464f] hover:bg-[#f2f4f6]">−</button>
                  <button type="button" onClick={() => resizeRow(r, 1)} title="One more position in this row" aria-label={`Row ${r + 1}: one more position`} className="w-6 h-7 rounded text-[14px] font-bold text-[#46464f] hover:bg-[#f2f4f6]">+</button>
                  <button type="button" onClick={() => removeRow(r)} title="Remove this row" aria-label={`Remove row ${r + 1}`} className="w-7 h-7 rounded flex items-center justify-center text-[#ba1a1a] hover:bg-[#ba1a1a]/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        )}
        <div className="flex flex-wrap gap-2">
          {!value.stagger && <Button size="sm" variant="secondary" onClick={addRow}><Plus className="w-3.5 h-3.5" /> Add a row</Button>}
          <Button size="sm" variant="secondary" onClick={() => onChange(renumber(value, numbering))}>Renumber the seats</Button>
        </div>
        <p className="text-[12px] text-[#6b6d78]">
          Renumber uses the style chosen above and keeps the gaps where they are. Do it after clearing or adding boxes, then fix any single number by hand.
        </p>
      </div>

      <div className="rounded-xl bg-[#f2f4f6] p-4 space-y-3">
        <p className="text-[13px] font-bold text-[#050a44]">3. Do the two sides line up?</p>
        <label className="flex items-start gap-2 text-[13px] font-semibold text-[#050a44]">
          <input type="checkbox" className="mt-0.5 w-4 h-4" checked={!!value.stagger} onChange={(e) => onChange({ ...value, stagger: e.target.checked })} />
          <span>
            One side has more rows than the other, so the rows are not level
            <span className="block text-[12px] font-normal text-[#46464f] mt-0.5">
              Ticked automatically when you build with different row counts for the two sides (for example 11 on the left and 12 on the right). The side with more rows is drawn with its seats a little closer together, as below. Untick it only if the empty boxes are a real gap, such as a door.
            </span>
          </span>
        </label>
        {leftRows !== rightRows && !value.stagger && (
          <p className="text-[12px] font-semibold text-[#7c5800]">The left side has {leftRows} rows and the right has {rightRows}. Tick the box if they share the same length of bus; leave it off if there is a real gap (a door) where the empty boxes are.</p>
        )}
        {value.stagger && (
          <div>
            <p className="text-[11px] font-bold text-[#686873] mb-1.5">How passengers will see it</p>
            <div className="rounded-xl bg-white border border-[#c7c5d1] p-3 mx-auto space-y-1.5" style={{ width: widest * 40, maxWidth: '100%' }}>
              {layoutSegments(value).map((seg, i) =>
                seg.kind === 'row' ? (
                  <div key={i} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${seg.cells.length}, minmax(0, 1fr))` }}>
                    {seg.cells.map((cell, c) => (cell ? <PreviewSeat key={c} label={cell} /> : <span key={c} />))}
                  </div>
                ) : (
                  <div key={i} className="flex items-stretch">
                    {[seg.left, seg.right].map((side, k) => (
                      <div key={k} className={`flex flex-col justify-between min-w-0 ${k === 1 ? 'ml-auto' : ''}`} style={{ width: `${((k === 0 ? value.left : value.right) / normalWidth(value)) * 100}%`, rowGap: side.length > Math.min(seg.left.length, seg.right.length) ? 1 : 6 }}>
                        {side.map((cells, r) => (
                          <div key={r} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
                            {cells.map((cell, c) => (cell ? <PreviewSeat key={c} label={cell} /> : <span key={c} />))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ),
              )}
            </div>
          </div>
        )}
      </div>

      <p className="text-[13px] font-semibold text-[#050a44]">{total} seats in total</p>
      {problems.map((p) => (
        <p key={p} className="text-[12px] font-semibold text-[#ba1a1a]">{p}</p>
      ))}
    </div>
  );
}

function PreviewSeat({ label }: { label: string }) {
  return <span className="h-6 rounded bg-[#f2f4f6] border border-[#c7c5d1] text-[10px] font-bold text-[#050a44] flex items-center justify-center">{label}</span>;
}
