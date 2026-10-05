'use client';
// The conductor's printable trip sheet (A4 PDF), two parts:
//   1. The bus drawn as its seat layout: every seat is a box in its real
//      place with the passenger, where they get on and off, what they owe and
//      a box to tick when they board. Free seats have room to write a walk-on.
//   2. The sheet filled in on the road, in the same order as "Close this trip"
//      in the app (components/staff/TripSheet.tsx): odometer at the start and
//      end (the start is printed from the last reading), fuel, tolls and other
//      costs, seats sold on the bus and the cash totals. Who owes what is on
//      the seat plan only, so it is not repeated here.
// Standard PDF fonts only cover Latin letters, so arrows and symbols are
// written as words.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { OPERATOR } from '@/config/operator';
import type { Booking, StoreData } from './types';
import { isDue, manifestFor } from './manifest';
import { busSeatMap, layoutSegments, type SeatCell } from './seatLayout';
import { formatDateLabel, formatTime12, getTrip } from './trips';

const NAVY: [number, number, number] = [5, 10, 68];
const GREY: [number, number, number] = [110, 110, 120];
const LINE: [number, number, number] = [170, 170, 180];
const DUE_FILL: [number, number, number] = [255, 243, 205];
const money = (n: number) => n.toLocaleString('en-LK');

export function downloadManifestPdf(
  data: StoreData,
  scheduleId: string,
  date: string,
  /** The bus's last odometer reading, printed as the start so only the end is written by hand. */
  opts: { lastOdometer?: { km: number; date: string } | null } = {},
) {
  const schedule = data.schedules.find((s) => s.id === scheduleId)!;
  const route = data.routes.find((r) => r.id === schedule.routeId)!;
  const bus = data.buses.find((b) => b.id === schedule.busId)!;
  const first = route.stops[0].name;
  const last = route.stops[route.stops.length - 1].name;
  const trip = getTrip(data, scheduleId, date, first, last);
  const { list, totals } = manifestFor(data, scheduleId, date);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 10;
  const tripLine = `${first} to ${last}   |   ${formatDateLabel(date)}   |   departs ${formatTime12(schedule.departure)}${trip ? `, arrives ${formatTime12(trip.arrival)}${trip.arrivalDayOffset ? ' (+1)' : ''}` : ''}   |   ${bus.name} ${bus.regNo}`;

  const header = (title: string) => {
    doc.setTextColor(0).setFont('helvetica', 'bold').setFontSize(15).text(`${OPERATOR.name}: ${title}`, M, 14);
    doc.setFont('helvetica', 'normal').setFontSize(9.5).text(tripLine, M, 20);
    doc.setFontSize(8).setTextColor(...GREY).text(`Printed ${new Date().toLocaleString('en-GB')}`, W - M, 14, { align: 'right' }).setTextColor(0);
  };
  /** Shortens text with "..." so it fits a width at the current font size. */
  const fit = (text: string, width: number) => {
    if (doc.getTextWidth(text) <= width) return text;
    let t = text;
    while (t.length > 1 && doc.getTextWidth(`${t}...`) > width) t = t.slice(0, -1);
    return `${t.trimEnd()}...`;
  };
  const tickBox = (x: number, y: number, s: number, ticked: boolean) => {
    doc.setDrawColor(...NAVY).setLineWidth(0.35).setFillColor(255, 255, 255).rect(x, y, s, s, 'FD');
    if (ticked) doc.setLineWidth(0.6).line(x + s * 0.2, y + s * 0.55, x + s * 0.42, y + s * 0.8).line(x + s * 0.42, y + s * 0.8, x + s * 0.85, y + s * 0.2);
  };

  // ------------------------------------------------------- 1. the seat map ---
  header('Seat plan');
  doc.setFontSize(9).text(
    `${totals.seats} seats sold${totals.bikes ? `, ${totals.bikes} bike(s)` : ''}. ${totals.unpaid ? `Collect LKR ${money(totals.unpaid)} from ${totals.unpaidCount} (shaded seats). ` : 'Everyone has paid. '}Tick Boarded when they get on${totals.unpaid ? ', Paid when they pay' : ''}.`,
    M, 26,
  );

  // Who is in each seat. A booking with several seats shows the money once.
  const bySeat = new Map<string, Booking>();
  for (const b of list) if (b.status !== 'no-show') for (const s of b.seats) bySeat.set(s, b);

  const map = busSeatMap(bus);
  const segments = layoutSegments(map);
  const rowCount = segments.reduce((n, sg) => n + (sg.kind === 'row' ? 1 : Math.max(sg.left.length, sg.right.length)), 0) || 1;
  const top = 34;
  const aisle = 9;
  const usableW = W - 2 * M;
  const rowH = Math.min(25, (H - top - 12) / rowCount);
  const sideUnits = map.left + map.right;
  const seatW = (usableW - aisle) / Math.max(1, sideUnits);
  const gap = 1.2;

  doc.setFontSize(8).setTextColor(...GREY).text('Front of the bus (driver)', W / 2, top - 2.5, { align: 'center' }).setTextColor(0);

  const drawSeat = (id: SeatCell, x: number, y: number, w: number, h: number) => {
    if (!id) return;
    const b = bySeat.get(id);
    const due = !!b && isDue(b);
    const bx = x + gap / 2;
    const by = y + gap / 2;
    const bw = w - gap;
    const bh = h - gap;
    const pad = 1.6;
    const inner = bw - 2 * pad;
    doc.setDrawColor(...(b ? NAVY : LINE)).setLineWidth(b ? 0.35 : 0.2);
    if (due) doc.setFillColor(...DUE_FILL).roundedRect(bx, by, bw, bh, 1.2, 1.2, 'FD');
    else doc.roundedRect(bx, by, bw, bh, 1.2, 1.2, 'S');

    // Seat number, always.
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...(b ? NAVY : GREY)).text(id, bx + pad, by + 5);
    const small = bh < 17; // tight rows: fewer lines
    if (!b) {
      // Free: room to write in someone who pays on the bus.
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...GREY).text('free', bx + bw - pad, by + 4.6, { align: 'right' });
      if (!small) {
        doc.setDrawColor(...LINE).setLineWidth(0.15);
        doc.text('Name', bx + pad, by + bh - 8.2).line(bx + pad + 8, by + bh - 8, bx + bw - pad, by + bh - 8);
        doc.text('To', bx + pad, by + bh - 3.2).line(bx + pad + 5, by + bh - 3, bx + bw * 0.55, by + bh - 3);
        doc.text('LKR', bx + bw * 0.58, by + bh - 3.2).line(bx + bw * 0.58 + 6, by + bh - 3, bx + bw - pad, by + bh - 3);
      }
      doc.setTextColor(0);
      return;
    }
    // Two different ticks, each with its name: on the bus, and (shaded seats only) money collected.
    tickBox(bx + bw - pad - 4.2, by + 1.6, 4.2, b.status === 'boarded');
    doc.setFont('helvetica', 'normal').setFontSize(6).setTextColor(...GREY).text('Boarded', bx + bw - pad - 5.2, by + 4.6, { align: 'right' });
    doc.setTextColor(0);
    const firstSeat = b.seats[0] === id;
    // Name
    doc.setFont('helvetica', 'bold').setFontSize(small ? 8 : 9);
    doc.text(fit(`${b.passenger.name}${b.passenger.gender === 'Female' ? ' (F)' : ''}`, inner), bx + pad, by + (small ? 9 : 10));
    // Where they get on and off
    doc.setFont('helvetica', 'normal').setFontSize(7.2).setTextColor(60);
    doc.text(fit(`${b.from} to ${b.to}`, inner), bx + pad, by + (small ? 12.3 : 14));
    // Bottom line.
    const payY = by + bh - 2;
    const phone = `${b.passenger.phone || b.contact.phone || ''}${b.bikes?.length && firstSeat ? ' + bike' : ''}`;
    if (due && firstSeat) {
      // Owes money: the amount on the left, and its own "Paid" box on the right to tick when collected.
      tickBox(bx + bw - pad - 4.2, by + bh - 5.6, 4.2, false);
      doc.setFont('helvetica', 'normal').setFontSize(6).setTextColor(...GREY).text('Paid', bx + bw - pad - 5.2, payY - 0.6, { align: 'right' });
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(60, 45, 0);
      doc.text(fit(`COLLECT ${money(b.total)}${b.seats.length > 1 ? ` for ${b.seats.length}` : ''}`, inner - 11), bx + pad, payY);
    } else {
      // Paid already (or covered by the booking's first seat): say so on the right, phone on the left if it fits.
      const pay = firstSeat ? 'paid' : `${due ? 'pays' : 'paid'} with seat ${b.seats[0]}`;
      doc.setFont('helvetica', 'normal').setFontSize(7.2).setTextColor(...GREY);
      const payText = fit(pay, inner);
      doc.text(payText, bx + bw - pad, payY, { align: 'right' });
      if (phone && doc.getTextWidth(phone) <= inner - doc.getTextWidth(payText) - 2) doc.text(phone, bx + pad, payY);
    }
    doc.setTextColor(0);
  };

  let y = top;
  for (const sg of segments) {
    if (sg.kind === 'row') {
      const cells = sg.cells;
      const normal = cells.length === map.left + 1 + map.right && cells[map.left] === null;
      if (normal) {
        cells.slice(0, map.left).forEach((c, i) => drawSeat(c, M + i * seatW, y, seatW, rowH));
        cells.slice(map.left + 1).forEach((c, i) => drawSeat(c, M + map.left * seatW + aisle + i * seatW, y, seatW, rowH));
      } else {
        // A row that runs across the aisle (the back bench): spread over the full width.
        const w = usableW / cells.length;
        cells.forEach((c, i) => drawSeat(c, M + i * w, y, w, rowH));
      }
      y += rowH;
    } else {
      // The two sides don't line up: each side's rows share the same length of bus.
      const rows = Math.max(sg.left.length, sg.right.length);
      const blockH = rows * rowH;
      const lh = sg.left.length ? blockH / sg.left.length : 0;
      const rh = sg.right.length ? blockH / sg.right.length : 0;
      sg.left.forEach((r, ri) => r.forEach((c, i) => drawSeat(c, M + i * seatW, y + ri * lh, seatW, lh)));
      sg.right.forEach((r, ri) => r.forEach((c, i) => drawSeat(c, M + map.left * seatW + aisle + i * seatW, y + ri * rh, seatW, rh)));
      y += blockH;
    }
  }
  // Booked on a seat that isn't on this bus's layout (the bus was changed): never lose them.
  const drawn = new Set(map.cells.flat().filter(Boolean) as string[]);
  const stray = [...bySeat.entries()].filter(([s]) => !drawn.has(s));
  if (stray.length) {
    doc.setFontSize(8.5).setTextColor(150, 0, 0).text(fit(`Not on this layout: ${stray.map(([s, b]) => `${s} ${b.passenger.name}`).join('; ')}`, usableW), M, Math.min(H - 6, y + 4)).setTextColor(0);
  }
  const noShows = list.filter((b) => b.status === 'no-show');
  if (noShows.length) doc.setFontSize(8).setTextColor(...GREY).text(fit(`No-show: ${noShows.map((b) => `${b.seats.join(', ')} ${b.passenger.name}`).join('; ')}`, usableW), M, H - 5).setTextColor(0);

  // --------------------------------------------- 2. the sheet for the road ---
  doc.addPage();
  header('Trip sheet');
  doc.setFontSize(9.5).text('Conductor: fill this in on the road and hand it to the booking centre with the cash. They enter it and close the trip.', M, 26);
  let py = 33;
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const room = (need: number) => {
    if (py + need > H - 7) {
      doc.addPage();
      py = 16;
    }
  };
  const section = (title: string) => {
    room(16);
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...NAVY).text(title, M, py);
    doc.setFont('helvetica', 'normal').setTextColor(0);
    py += 3;
  };
  const blank = (cols: number, rows: number) => Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
  const table = { theme: 'grid' as const, styles: { fontSize: 9, cellPadding: 1.8, minCellHeight: 8, valign: 'middle' as const, lineColor: [150, 150, 160] as [number, number, number], lineWidth: 0.2 }, headStyles: { fillColor: [242, 244, 246] as [number, number, number], textColor: NAVY, fontStyle: 'bold' as const }, margin: { left: M, right: M } };
  /** A small empty box in the last column of a write-in row ("paid from the trip cash"). */
  const boxInLast = (col: number) => (c: { section: string; column: { index: number }; cell: { x: number; y: number; width: number; height: number } }) => {
    if (c.section === 'body' && c.column.index === col) tickBox(c.cell.x + (c.cell.width - 4.2) / 2, c.cell.y + (c.cell.height - 4.2) / 2, 4.2, false);
  };

  section('1. Odometer');
  const lastOdo = opts.lastOdometer ?? null;
  autoTable(doc, {
    ...table,
    startY: py,
    head: [['At the start (km)', 'At the end (km)', 'Distance (km)']],
    body: [[lastOdo ? lastOdo.km.toLocaleString('en-LK') : '', '', '']],
    styles: { ...table.styles, minCellHeight: 10, fontSize: 12, fontStyle: 'bold' },
    headStyles: { ...table.headStyles, fontSize: 9 },
  });
  py = lastY() + 4;
  doc.setFontSize(8.5).setTextColor(...GREY);
  doc.text(lastOdo ? `The start is the last reading on record (${formatDateLabel(lastOdo.date, false)}). If the dashboard shows a different number before setting off, cross it out and write the right one.` : 'No reading on record for this bus yet: write the number on the dashboard before setting off.', M, py);
  doc.setTextColor(0);
  py += 6;

  section('2. Fuel put in on this trip');
  autoTable(doc, { ...table, startY: py, head: [['Litres', 'Paid (LKR)', 'Filling station', 'Odometer at the pump', 'From trip cash']], body: blank(5, 2), columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 30 }, 3: { cellWidth: 40 }, 4: { cellWidth: 26, halign: 'center' } }, didDrawCell: boxInLast(4) });
  py = lastY() + 6;

  section('3. Tolls and other costs');
  autoTable(doc, { ...table, startY: py, head: [['What for (toll, parking, cleaning, other)', 'Note', 'Paid (LKR)', 'From trip cash']], body: blank(4, 4), columnStyles: { 0: { cellWidth: 62 }, 2: { cellWidth: 30 }, 3: { cellWidth: 26, halign: 'center' } }, didDrawCell: boxInLast(3) });
  py = lastY() + 6;

  section('4. Cash');
  // Who owes what is on the seat plan (shaded seats). Only the total is repeated here.
  doc.setFontSize(9.5);
  doc.text(totals.unpaid ? `To collect on this trip: LKR ${money(totals.unpaid)} from ${totals.unpaidCount} passenger${totals.unpaidCount === 1 ? '' : 's'}. They are the shaded seats on the seat plan: tick each one there when paid.` : 'Nobody on the seat plan owes money for this trip.', M, py + 3);
  py += 8;
  room(50);
  autoTable(doc, { ...table, startY: py, head: [[{ content: 'Seats sold on the bus (not on the seat plan)', colSpan: 6 }], ['Seat', 'Name', 'Phone', 'From', 'To', 'Paid (LKR)']], body: blank(6, 6), columnStyles: { 0: { cellWidth: 16 }, 2: { cellWidth: 32 }, 3: { cellWidth: 28 }, 4: { cellWidth: 28 }, 5: { cellWidth: 26 } } });
  py = lastY() + 7;

  room(19);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(0);
  doc.text('Cash collected  LKR ____________   less paid out from it  LKR ____________   =  cash to hand in  LKR ____________', M, py + 1);
  doc.text(`On board: ______ / ${totals.seats} seats sold            Cash counted: LKR ____________`, M, py + 9);
  doc.text('Conductor: ______________________   Driver: ______________________   Received by: ______________________', M, py + 18);

  doc.save(`trip-sheet-${bus.regNo}-${date}-${schedule.departure.replace(':', '')}.pdf`);
}
