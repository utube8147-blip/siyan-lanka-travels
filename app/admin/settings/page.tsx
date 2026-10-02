'use client';
// Settings — prices and policies used by the booking system (the database
// uses these to price every booking), plus the resale switch.

import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { OPERATOR } from '@/config/operator';
import { useErp, type Settings, type BikeKind } from '@/lib/erp';
import { formatLKR } from '@/lib/trips';
import { REWARDS_ENABLED } from '@/lib/features';
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
    if (erp.data) {
      const clone = structuredClone(erp.data.settings);
      // Drop any stale "bicycle" entry that may still be stored
      delete (clone.bikes.kinds as Record<string, unknown>).bicycle;
      setS(clone);
    }
  }, [erp.data]);
  if (!s) return <div className="skeleton h-64 rounded-2xl" />;
  const n = (v: string) => Math.max(0, Number(v) || 0);
  // Loop over the config (single source of truth), not stored data
  const kinds = Object.keys(OPERATOR.bikes.kinds) as BikeKind[];

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
          <h2 className="text-[16px] font-semibold text-[#050a44]">Payments</h2>
          <Field label="Online card & wallet payments" hint="Switch to PayHere once your merchant account is approved and its keys are on the server (README → Payments).">
            <select className={inputClass} value={s.paymentsMode} onChange={(e) => setS({ ...s, paymentsMode: e.target.value as Settings['paymentsMode'] })}>
              <option value="demo">Demo: no money taken (testing only)</option>
              <option value="payhere">PayHere: cards, eZ Cash, mCash, Genie</option>
            </select>
          </Field>
          {s.paymentsMode === 'demo' && <p className="text-[12px] font-semibold text-[#ba1a1a]">While on demo, online bookings are confirmed without payment. Don&apos;t go live like this.</p>}
          <Field label="Bank details shown for bank transfers"><input className={inputClass} value={s.bankDetails} onChange={(e) => setS({ ...s, bankDetails: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hold for counter payment (minutes)"><input type="number" className={inputClass} value={s.holdMinutesCounter} onChange={(e) => setS({ ...s, holdMinutesCounter: Math.max(15, n(e.target.value)) })} /></Field>
            <Field label="Hold for bank transfer (minutes)"><input type="number" className={inputClass} value={s.holdMinutesBank} onChange={(e) => setS({ ...s, holdMinutesBank: Math.max(30, n(e.target.value)) })} /></Field>
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">{REWARDS_ENABLED ? 'Rewards & messages' : 'Messages'}</h2>
          {REWARDS_ENABLED && <Field label="Free trip after every … completed trips" hint="0 turns rewards off"><input type="number" className={inputClass} value={s.rewardEvery} onChange={(e) => setS({ ...s, rewardEvery: n(e.target.value) })} /></Field>}
          <div className="flex flex-wrap gap-4">
            {(['sms', 'whatsapp'] as const).map((ch) => (
              <label key={ch} className="flex items-center gap-2 text-[14px] font-semibold text-[#050a44]">
                <input type="checkbox" className="w-4 h-4 accent-[#050a44]" checked={s.messaging[ch]} onChange={(e) => setS({ ...s, messaging: { ...s.messaging, [ch]: e.target.checked } })} />
                Send {ch === 'sms' ? 'SMS' : 'WhatsApp'} messages
              </label>
            ))}
          </div>
          <p className="text-[12px] text-[#6b6d78]">Booking confirmations, payment reminders, trip updates and waitlist offers. Needs the provider keys on the server (README → Messages).</p>
          <Field label="Website address used in messages"><input className={inputClass} value={s.siteUrl} onChange={(e) => setS({ ...s, siteUrl: e.target.value.trim() })} placeholder="https://www.siyanlanka.lk" /></Field>
          <MessageLog />
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

        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">Ways to pay online</h2>
          <p className="text-[13px] text-[#46464f]">
            Bank transfer and pay at the counter are always offered. Passengers are told when their payment is recorded.
          </p>
          <label className="flex items-center justify-between gap-4 rounded-xl bg-[#f2f4f6] p-4">
            <span>
              <span className="block text-[15px] font-semibold text-[#050a44]">{s.payOnBus ? 'Pay on the bus: on' : 'Pay on the bus: off'}</span>
              <span className="block text-[12px] text-[#6b6d78]">The seat is reserved without payment; the conductor collects cash on the bus. Turn off if too many reserved seats go unused.</span>
            </span>
            <button type="button" role="switch" aria-checked={s.payOnBus} aria-label="Pay on the bus" onClick={() => setS({ ...s, payOnBus: !s.payOnBus })}
              className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${s.payOnBus ? 'bg-[#006e1c]' : 'bg-[#c7c5d1]'}`}>
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${s.payOnBus ? 'left-6' : 'left-1'}`} />
            </button>
          </label>
          <label className="flex items-center justify-between gap-4 rounded-xl bg-[#f2f4f6] p-4">
            <span>
              <span className="block text-[15px] font-semibold text-[#050a44]">{s.cardPayments ? 'Card & wallet: open' : 'Card & wallet: locked (shown as not available yet)'}</span>
              <span className="block text-[12px] text-[#6b6d78]">Leave locked until the payment gateway is set up. Unlocked with Payments on Demo, card bookings are confirmed without any money.</span>
            </span>
            <button type="button" role="switch" aria-checked={s.cardPayments} aria-label="Card and wallet payments" onClick={() => setS({ ...s, cardPayments: !s.cardPayments })}
              className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${s.cardPayments ? 'bg-[#006e1c]' : 'bg-[#c7c5d1]'}`}>
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${s.cardPayments ? 'left-6' : 'left-1'}`} />
            </button>
          </label>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">Code on every booking</h2>
          <p className="text-[13px] text-[#46464f]">
            Passengers stay signed in, and before paying for an online booking they verify with a fresh 6-digit code sent to their phone (or email, for accounts without a phone). A code works for one booking, for 20 minutes. Counter and phone bookings by staff are never asked. Each code is one text message.
          </p>
          <label className="flex items-center justify-between gap-4 rounded-xl bg-[#f2f4f6] p-4">
            <span>
              <span className="block text-[15px] font-semibold text-[#050a44]">{s.bookingOtp ? 'On: a code is needed to book' : 'Off: signed-in passengers book without a code'}</span>
              <span className="block text-[12px] text-[#6b6d78]">Turn off if text messages are down, so people can still book. Save changes to apply.</span>
            </span>
            <button type="button" role="switch" aria-checked={s.bookingOtp} aria-label="Code on every booking" onClick={() => setS({ ...s, bookingOtp: !s.bookingOtp })}
              className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${s.bookingOtp ? 'bg-[#006e1c]' : 'bg-[#c7c5d1]'}`}>
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${s.bookingOtp ? 'left-6' : 'left-1'}`} />
            </button>
          </label>
        </Card>
      </div>
      {erp.mode === 'demo' && <p className="text-[12px] text-[#6b6d78] mt-4">Demo mode: settings are saved in this browser only. With Supabase connected they price every booking.</p>}
      <Toast />
    </>
  );
}

function MessageLog() {
  const [rows, setRows] = useState<{ id: string; channel: string; to_phone: string; body: string; status: string; created_at: string; error: string | null }[] | null>(null);
  useEffect(() => {
    if (!isSupabaseConfigured) return setRows([]);
    supabase().from('message_queue').select('id, channel, to_phone, body, status, created_at, error').order('created_at', { ascending: false }).limit(15).then(({ data }) => setRows(data ?? []));
  }, []);
  if (!rows) return null;
  return (
    <details className="rounded-xl bg-[#f8f9fb] border border-[#edeef0] p-3">
      <summary className="text-[13px] font-bold text-[#050a44] cursor-pointer">Recent messages ({rows.length})</summary>
      {rows.length === 0 ? (
        <p className="text-[12px] text-[#6b6d78] mt-2">{isSupabaseConfigured ? 'Nothing sent yet.' : 'Messages are queued in the database; connect Supabase to see them.'}</p>
      ) : (
        <ul className="mt-2 space-y-2 max-h-72 overflow-y-auto">
          {rows.map((m) => (
            <li key={m.id} className="text-[12px]">
              <span className={`font-bold ${m.status === 'sent' ? 'text-[#006e1c]' : m.status === 'pending' ? 'text-[#7c5800]' : 'text-[#ba1a1a]'}`}>{m.status}</span>{' '}
              <span className="text-[#6b6d78]">{m.channel} → {m.to_phone} · {new Date(m.created_at).toLocaleString('en-GB')}</span>
              <span className="block text-[#46464f]">{m.body}</span>
              {m.error && m.status !== 'sent' && <span className="block text-[#6b6d78]">{m.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}