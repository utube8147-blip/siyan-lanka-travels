'use client';
// Close the day: what the system says you took in cash (counter & phone sales
// you made today + held seats you took cash for) vs what's in the drawer.

import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/lib/store';
import { useCashCounts } from '@/lib/extras';
import { formatDateLabel, formatLKR, todayISO } from '@/lib/trips';
import { Button, Card, Field, PageHeader, inputClass, useToast } from '@/components/admin/ui';

export default function CashPage() {
  const { user } = useAuth();
  const { data } = useStore();
  const { counts, save } = useCashCounts();
  const { toast, Toast } = useToast();
  const today = todayISO();
  const [counted, setCounted] = useState<number | ''>('');
  const [notes, setNotes] = useState('');

  const sales = useMemo(
    () =>
      data.bookings.filter(
        (b) =>
          b.status !== 'cancelled' &&
          !b.id.startsWith('avail-') &&
          ((b.channel !== 'online' && b.createdAt.slice(0, 10) === today) || (b.paymentMethod === 'cash' && b.channel === 'online' && b.createdAt.slice(0, 10) <= today && b.status === 'confirmed')),
      ),
    [data.bookings, today],
  );
  const expected = sales.reduce((n, b) => n + b.total, 0);
  const closedToday = counts.find((c) => c.date === today);
  const diff = typeof counted === 'number' ? counted - expected : 0;

  return (
    <>
      <PageHeader title="Close the day" description={`Cash count for ${formatDateLabel(today)}${user ? ` · ${user.user_metadata.full_name}` : ''}.`} />
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-6">
        <Card className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[12px] font-bold text-[#46464f]">Cash you should have</p>
              <p className="text-[26px] font-semibold text-[#050a44] tabular-nums">{formatLKR(expected)}</p>
              <p className="text-[12px] text-[#6b6d78]">{sales.length} cash sale{sales.length === 1 ? '' : 's'} today</p>
            </div>
            {closedToday && (
              <div>
                <p className="text-[12px] font-bold text-[#46464f]">Counted</p>
                <p className="text-[26px] font-semibold text-[#050a44] tabular-nums">{formatLKR(closedToday.counted)}</p>
                <p className={`text-[12px] font-bold ${closedToday.counted - closedToday.expected === 0 ? 'text-[#006e1c]' : 'text-[#ba1a1a]'}`}>
                  {closedToday.counted - closedToday.expected === 0 ? 'Balanced' : `${closedToday.counted > closedToday.expected ? 'Over' : 'Short'} by ${formatLKR(Math.abs(closedToday.counted - closedToday.expected))}`}
                </p>
              </div>
            )}
          </div>
          {!closedToday ? (
            <>
              <Field label="Cash in the drawer (LKR)">
                <input type="number" min={0} inputMode="numeric" className={inputClass} value={counted} onChange={(e) => setCounted(e.target.value === '' ? '' : Number(e.target.value))} />
              </Field>
              {typeof counted === 'number' && (
                <p className={`text-[14px] font-semibold ${diff === 0 ? 'text-[#006e1c]' : 'text-[#ba1a1a]'}`}>
                  {diff === 0 ? 'Balanced. Nice.' : `${diff > 0 ? 'Over' : 'Short'} by ${formatLKR(Math.abs(diff))}. Add a note below.`}
                </p>
              )}
              <Field label="Notes"><input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={diff ? 'What happened?' : 'Optional'} /></Field>
              <Button variant="gold" disabled={counted === '' || (diff !== 0 && notes.trim().length < 3)} onClick={async () => {
                const r = await save({ date: today, expected, counted: Number(counted), notes: notes.trim() });
                toast(r.ok ? 'Day closed' : r.reason ?? 'Could not save', r.ok ? 'ok' : 'error');
              }}>
                Close the day
              </Button>
            </>
          ) : (
            <p className="text-[14px] text-[#46464f]">Today is closed{closedToday.notes ? `: ${closedToday.notes}` : '.'}</p>
          )}
        </Card>
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-[#edeef0]"><h2 className="text-[16px] font-semibold text-[#050a44]">Today&apos;s cash sales</h2></div>
          {sales.length === 0 ? <p className="p-5 text-[14px] text-[#46464f]">None yet.</p> : (
            <ul className="divide-y divide-[#edeef0] max-h-[420px] overflow-y-auto">
              {sales.map((b) => (
                <li key={b.id} className="px-5 py-3 flex justify-between gap-3 text-[13px]">
                  <span><span className="block font-semibold text-[#050a44]">{b.passenger.name} · {b.seats.join(', ')}</span><span className="text-[#6b6d78]">{b.from} → {b.to} · {b.ref}</span></span>
                  <span className="font-semibold tabular-nums">{formatLKR(b.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {counts.length > 0 && (
        <Card className="mt-6 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#edeef0]"><h2 className="text-[16px] font-semibold text-[#050a44]">Past days</h2></div>
          <ul className="divide-y divide-[#edeef0]">
            {counts.slice(0, 14).map((c) => (
              <li key={c.id} className="px-5 py-3 grid grid-cols-[1fr_auto_auto] gap-4 text-[13px]">
                <span>{formatDateLabel(c.date, false)}{c.notes ? <span className="text-[#6b6d78]"> · {c.notes}</span> : null}</span>
                <span className="tabular-nums">{formatLKR(c.counted)} / {formatLKR(c.expected)}</span>
                <span className={`font-bold ${c.counted === c.expected ? 'text-[#006e1c]' : 'text-[#ba1a1a]'}`}>{c.counted === c.expected ? 'OK' : formatLKR(c.counted - c.expected)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Toast />
    </>
  );
}
