'use client';
// Settings — prices and policies used by the booking system (the database
// uses these to price every booking), plus the resale switch.

import { useEffect, useState } from 'react';
import { OPERATOR } from '@/config/operator';
import { useErp, type Settings } from '@/lib/erp';
import { formatLKR } from '@/lib/trips';
import { AdminOnly } from '@/components/admin/AdminOnly';
import { Button, Card, Field, PageHeader, inputClass, useToast } from '@/components/admin/ui';

export default function SettingsPage() {
  return (
    <AdminOnly>
      <SettingsForm />
    </AdminOnly>
  );
}

function SettingsForm() {
  const erp = useErp({ admin: true });
  const { toast, Toast } = useToast();
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    if (erp.data) setS(structuredClone(erp.data.settings));
  }, [erp.data]);
  if (!s) return <div className="skeleton h-64 rounded-2xl" />;
  const n = (v: string) => Math.max(0, Number(v) || 0);
  const kinds = Object.keys(s.bikes.kinds) as (keyof Settings['bikes']['kinds'])[];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Prices and rules the booking system uses. Changes apply to new bookings straight away."
        actions={<Button onClick={async () => {
          const r = await erp.saveSettings(s);
          toast(r.ok ? 'Settings saved' : r.reason ?? 'Could not save', r.ok ? 'ok' : 'error');
        }}>Save changes</Button>}
      />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">Booking</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Online booking fee (LKR)"><input type="number" className={inputClass} value={s.bookingFee} onChange={(e) => setS({ ...s, bookingFee: n(e.target.value) })} /></Field>
            <Field label="Max seats per booking"><input type="number" className={inputClass} value={s.maxSeats} onChange={(e) => setS({ ...s, maxSeats: Math.max(1, n(e.target.value)) })} /></Field>
          </div>
          <Field label="Online booking closes (minutes before departure)"><input type="number" className={inputClass} value={s.cutoffMinutes} onChange={(e) => setS({ ...s, cutoffMinutes: n(e.target.value) })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Promo code" hint="Leave empty for none"><input className={inputClass} value={s.promoCode} onChange={(e) => setS({ ...s, promoCode: e.target.value.toUpperCase().replace(/\s/g, '') })} /></Field>
            <Field label="Promo discount (%)"><input type="number" className={inputClass} value={s.promoPercent} onChange={(e) => setS({ ...s, promoPercent: Math.min(100, n(e.target.value)) })} /></Field>
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">Cancellation refunds</h2>
          <p className="text-[13px] text-[#46464f]">Passengers get back this share of the fare (the booking fee is never refunded).</p>
          {s.refundPolicy.map((t, i) => (
            <div key={i} className="grid grid-cols-2 gap-3">
              <Field label={i === s.refundPolicy.length - 1 ? 'Less than that' : 'At least (hours before)'}>
                <input type="number" className={inputClass} disabled={i === s.refundPolicy.length - 1} value={t.hoursBefore}
                  onChange={(e) => setS({ ...s, refundPolicy: s.refundPolicy.map((x, j) => (j === i ? { ...x, hoursBefore: n(e.target.value) } : x)) })} />
              </Field>
              <Field label="Refund (%)">
                <input type="number" className={inputClass} value={t.percent}
                  onChange={(e) => setS({ ...s, refundPolicy: s.refundPolicy.map((x, j) => (j === i ? { ...x, percent: Math.min(100, n(e.target.value)) } : x)) })} />
              </Field>
            </div>
          ))}
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">Bikes in the luggage compartment</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Minimum fee (LKR)"><input type="number" className={inputClass} value={s.bikes.minFee} onChange={(e) => setS({ ...s, bikes: { ...s.bikes, minFee: n(e.target.value) } })} /></Field>
            <Field label="Max bikes per booking"><input type="number" className={inputClass} value={s.bikes.maxPerBooking} onChange={(e) => setS({ ...s, bikes: { ...s.bikes, maxPerBooking: Math.max(1, n(e.target.value)) } })} /></Field>
          </div>
          {kinds.map((k) => (
            <div key={k} className="grid grid-cols-[1fr_1fr_1fr] gap-3 items-end">
              <p className="text-[14px] font-semibold text-[#050a44] pb-2.5">{OPERATOR.bikes.kinds[k].label}</p>
              <Field label="Spaces"><input type="number" className={inputClass} value={s.bikes.kinds[k].spaces} onChange={(e) => setS({ ...s, bikes: { ...s.bikes, kinds: { ...s.bikes.kinds, [k]: { ...s.bikes.kinds[k], spaces: Math.max(1, n(e.target.value)) } } } })} /></Field>
              <Field label="Full-route fee"><input type="number" className={inputClass} value={s.bikes.kinds[k].fullRouteFee} onChange={(e) => setS({ ...s, bikes: { ...s.bikes, kinds: { ...s.bikes.kinds, [k]: { ...s.bikes.kinds[k], fullRouteFee: n(e.target.value) } } } })} /></Field>
            </div>
          ))}
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">Seat resale</h2>
          <p className="text-[13px] text-[#46464f]">
            Lets passengers sell a seat they can&apos;t use to another passenger, for no more than they paid. The buyer pays the price plus the {formatLKR(s.bookingFee)} booking fee; the seller gets the price back.
          </p>
          <label className="flex items-center justify-between gap-4 rounded-xl bg-[#f2f4f6] p-4">
            <span>
              <span className="block text-[15px] font-semibold text-[#050a44]">{s.resaleEnabled ? 'On: customers can resell seats' : 'Off: hidden from customers'}</span>
              <span className="block text-[12px] text-[#6b6d78]">Save changes to apply.</span>
            </span>
            <button type="button" role="switch" aria-checked={s.resaleEnabled} onClick={() => setS({ ...s, resaleEnabled: !s.resaleEnabled })}
              className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${s.resaleEnabled ? 'bg-[#006e1c]' : 'bg-[#c7c5d1]'}`}>
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${s.resaleEnabled ? 'left-6' : 'left-1'}`} />
            </button>
          </label>
        </Card>
      </div>
      {erp.mode === 'demo' && <p className="text-[12px] text-[#6b6d78] mt-4">Demo mode: settings are saved in this browser only. With Supabase connected they price every booking.</p>}
      <Toast />
    </>
  );
}
