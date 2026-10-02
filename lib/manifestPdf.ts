'use client';
// Printable passenger list (A4 PDF) with tick boxes, grouped by boarding stop.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { OPERATOR } from '@/config/operator';
import type { StoreData } from './types';
import { isDue, manifestFor } from './manifest';
import { formatDateLabel, formatTime12, getTrip } from './trips';

const seatCount = (list: { seats: string[] }[]) => list.reduce((n, b) => n + b.seats.length, 0);

export function downloadManifestPdf(data: StoreData, scheduleId: string, date: string) {
  const schedule = data.schedules.find((s) => s.id === scheduleId)!;
  const route = data.routes.find((r) => r.id === schedule.routeId)!;
  const bus = data.buses.find((b) => b.id === schedule.busId)!;
  const first = route.stops[0].name;
  const last = route.stops[route.stops.length - 1].name;
  const trip = getTrip(data, scheduleId, date, first, last);
  const { groups, totals } = manifestFor(data, scheduleId, date);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold').setFontSize(16).text(`${OPERATOR.name} · Passenger list`, 14, 16);
  doc.setFont('helvetica', 'normal').setFontSize(10.5);
  doc.text(`${first} to ${last}   ·   ${formatDateLabel(date)}   ·   departs ${formatTime12(schedule.departure)}${trip ? `, arrives ${formatTime12(trip.arrival)}${trip.arrivalDayOffset ? ' (+1)' : ''}` : ''}`, 14, 23);
  doc.text(`Bus ${bus.name} · ${bus.regNo}   ·   ${totals.seats} seats sold${totals.bikes ? ` · ${totals.bikes} bike(s)` : ''}${totals.unpaid ? ` · LKR ${totals.unpaid.toLocaleString('en-LK')} to collect from ${totals.unpaidCount} passenger${totals.unpaidCount === 1 ? '' : 's'}` : ''}`, 14, 29);
  doc.setFontSize(8.5).setTextColor(110).text(`Printed ${new Date().toLocaleString('en-GB')}`, W - 14, 16, { align: 'right' }).setTextColor(0);

  let y = 35;
  for (const g of groups) {
    autoTable(doc, {
      startY: y,
      head: [[{ content: `Boarding at ${g.stop}  (${seatCount(g.bookings)} seat${seatCount(g.bookings) === 1 ? '' : 's'})`, colSpan: 7, styles: { fillColor: [5, 10, 68], textColor: 255, fontStyle: 'bold' } }],
        ['', 'Seat', 'Passenger', 'Phone', 'To', 'Pay', 'Ref / notes']],
      body: g.bookings.map((b) => [
        '',
        b.seats.join(', '),
        `${b.passenger.name}${b.passenger.gender === 'Female' ? ' (F)' : ''}`,
        b.passenger.phone || b.contact.phone || '',
        b.to,
        isDue(b)
          ? `COLLECT ${b.total.toLocaleString('en-LK')}${b.paymentMethod === 'bus' ? '\n(on bus)' : b.paymentMethod === 'counter' ? '\n(counter)' : b.paymentMethod === 'bank' ? '\n(bank)' : ''}`
          : b.paymentMethod === 'cash' ? 'paid cash' : b.paymentMethod === 'bank' ? 'paid (bank)' : b.channel === 'online' ? 'paid online' : `paid (${b.channel})`,
        [b.ref, b.bikes?.length ? `Bike: ${b.bikes.map((k) => `${k.kind} ${k.regNo || k.description}`).join('; ')}` : ''].filter(Boolean).join('\n'),
      ]),
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 1.8, valign: 'middle', lineColor: [200, 200, 205] },
      headStyles: { fillColor: [242, 244, 246], textColor: [5, 10, 68], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 9 }, 1: { cellWidth: 16, fontStyle: 'bold' }, 2: { cellWidth: 42 }, 3: { cellWidth: 28 }, 4: { cellWidth: 24 }, 5: { cellWidth: 28 }, 6: { cellWidth: 'auto', fontSize: 8 } },
      // Money still to collect stands out on paper.
      didParseCell: (c) => {
        if (c.section === 'body' && c.column.index === 5 && isDue(g.bookings[c.row.index])) {
          c.cell.styles.fontStyle = 'bold';
          c.cell.styles.fillColor = [255, 243, 205];
        }
      },
      didDrawCell: (c) => {
        // Tick box (pre-ticked for passengers already on board).
        if (c.section === 'body' && c.column.index === 0) {
          const s = 4.2;
          const x = c.cell.x + (c.cell.width - s) / 2;
          const yy = c.cell.y + (c.cell.height - s) / 2;
          doc.setDrawColor(5, 10, 68).setLineWidth(0.35).rect(x, yy, s, s);
          if (g.bookings[c.row.index]?.status === 'boarded') {
            doc.setLineWidth(0.6).line(x + 0.8, yy + 2.2, x + 1.8, yy + 3.3).line(x + 1.8, yy + 3.3, x + 3.6, yy + 0.9);
          }
        }
      },
      margin: { left: 14, right: 14 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
  }
  if (!groups.length) doc.setFontSize(11).text('No passengers booked on this departure yet.', 14, y + 4);

  const H = doc.internal.pageSize.getHeight();
  if (y > H - 30) {
    doc.addPage();
    y = 20;
  }
  doc.setFontSize(9.5).setTextColor(60);
  // Cash to collect on this departure, one line per passenger, with a box to tick when paid.
  const due = groups.flatMap((g) => g.bookings).filter(isDue);
  if (due.length) {
    autoTable(doc, {
      startY: y + 2,
      head: [[{ content: `Cash to collect: LKR ${totals.unpaid.toLocaleString('en-LK')} from ${due.length} passenger${due.length === 1 ? '' : 's'}`, colSpan: 5, styles: { fillColor: [124, 88, 0], textColor: 255, fontStyle: 'bold' } }],
        ['Paid', 'Seat', 'Passenger', 'Boards at', 'Amount (LKR)']],
      body: due.map((b) => ['', b.seats.join(', '), `${b.passenger.name}  ${b.passenger.phone || b.contact.phone || ''}`, b.from, b.total.toLocaleString('en-LK')]),
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 1.8, valign: 'middle', lineColor: [200, 200, 205] },
      headStyles: { fillColor: [255, 243, 205], textColor: [60, 45, 0], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 12 }, 1: { cellWidth: 16, fontStyle: 'bold' }, 3: { cellWidth: 36 }, 4: { cellWidth: 30, halign: 'right', fontStyle: 'bold' } },
      didDrawCell: (c) => {
        if (c.section === 'body' && c.column.index === 0) {
          const s = 4.2;
          doc.setDrawColor(60, 45, 0).setLineWidth(0.35).rect(c.cell.x + (c.cell.width - s) / 2, c.cell.y + (c.cell.height - s) / 2, s, s);
        }
      },
      margin: { left: 14, right: 14 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
    if (y > H - 30) {
      doc.addPage();
      y = 20;
    }
  }
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(60);
  doc.text(`Boarded: ______ / ${totals.seats}      Cash collected: LKR __________${totals.unpaid ? ` of ${totals.unpaid.toLocaleString('en-LK')}` : ''}`, 14, Math.max(y + 8, H - 24));
  doc.text('Conductor: ____________________   Driver: ____________________   Signed: ______________', 14, Math.max(y + 16, H - 16));
  doc.save(`passengers-${bus.regNo}-${date}-${schedule.departure.replace(':', '')}.pdf`);
}
