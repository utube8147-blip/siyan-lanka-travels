'use client';
// Settings — prices and policies used by the booking system (the database
// uses these to price every booking), plus the resale switch.

import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { OPERATOR } from '@/config/operator';
import { useErp, type Settings, type BikeKind } from '@/lib/erp';
import { formatLKR, dateLocale } from '@/lib/trips';
import { REWARDS_ENABLED } from '@/lib/features';
import { BIKE_ICONS, newBikeKindId } from '@/lib/bikeConfig';
import { AdminOnly } from '@/components/admin/AdminOnly';
import { Button, Card, Field, PageHeader, inputClass, useToast } from '@/components/admin/ui';
import { tx } from '@/lib/i18n';

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
  // Bike categories in display order (ids are fixed once created; names can change).
  const kinds = Object.keys(s.bikes.kinds).sort((x, y) => s.bikes.kinds[x].order - s.bikes.kinds[y].order) as BikeKind[];

  return (
    <>
      <PageHeader
        title={tx('Settings')}
        description={tx('Prices and rules the booking system uses. Changes apply to new bookings straight away.')}
        actions={<Button onClick={async () => {
          const r = await erp.saveSettings(s);
          toast(r.ok ? tx('Settings saved') : r.reason ?? tx('Could not save'), r.ok ? 'ok' : 'error');
        }}>{tx('Save changes')}</Button>}
      />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">{tx('Booking')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label={tx('Online booking fee (LKR)')}><input type="number" className={inputClass} value={s.bookingFee} onChange={(e) => setS({ ...s, bookingFee: n(e.target.value) })} /></Field>
            <Field label={tx('Max seats per booking')}><input type="number" className={inputClass} value={s.maxSeats} onChange={(e) => setS({ ...s, maxSeats: Math.max(1, n(e.target.value)) })} /></Field>
          </div>
          <Field label={tx('Online booking closes (minutes before departure)')}><input type="number" className={inputClass} value={s.cutoffMinutes} onChange={(e) => setS({ ...s, cutoffMinutes: n(e.target.value) })} /></Field>
          <Field label={tx('Passengers can book up to (days ahead)')} hint={tx('Later dates aren\'t offered on the website. 0 means no limit. Staff can always book any date.')}><input type="number" min={0} max={365} className={inputClass} value={s.bookingWindowDays ?? 7} onChange={(e) => setS({ ...s, bookingWindowDays: Math.min(365, Math.max(0, n(e.target.value))) })} /></Field>
          <Field label="On-request stops decided (hours before departure)" hint="A stop marked “on request” in Routes & timetable is settled this long before the bus leaves its first stop: it runs if enough seats are booked, otherwise those passengers are moved to the nearest main stop and told by text and notification."><input type="number" min={0} max={72} className={inputClass} value={s.optionalStopCutoffHours ?? 3} onChange={(e) => setS({ ...s, optionalStopCutoffHours: Math.min(72, Math.max(0, n(e.target.value))) })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={tx('Promo code')} hint={tx('Leave empty for none')}><input className={inputClass} value={s.promoCode} onChange={(e) => setS({ ...s, promoCode: e.target.value.toUpperCase().replace(/\s/g, '') })} /></Field>
            <Field label={tx('Promo discount (%)')}><input type="number" className={inputClass} value={s.promoPercent} onChange={(e) => setS({ ...s, promoPercent: Math.min(100, n(e.target.value)) })} /></Field>
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">{tx('Cancellation refunds')}</h2>
          <p className="text-[13px] text-[#46464f]">{tx('Passengers get back this share of the fare (the booking fee is never refunded).')}</p>
          {s.refundPolicy.map((t, i) => (
            <div key={i} className="grid grid-cols-2 gap-3">
              <Field label={i === s.refundPolicy.length - 1 ? tx('Less than that') : tx('At least (hours before)')}>
                <input type="number" className={inputClass} disabled={i === s.refundPolicy.length - 1} value={t.hoursBefore}
                  onChange={(e) => setS({ ...s, refundPolicy: s.refundPolicy.map((x, j) => (j === i ? { ...x, hoursBefore: n(e.target.value) } : x)) })} />
              </Field>
              <Field label={tx('Refund (%)')}>
                <input type="number" className={inputClass} value={t.percent}
                  onChange={(e) => setS({ ...s, refundPolicy: s.refundPolicy.map((x, j) => (j === i ? { ...x, percent: Math.min(100, n(e.target.value)) } : x)) })} />
              </Field>
            </div>
          ))}
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">{tx('Bikes in the luggage compartment')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label={tx('Minimum fee (LKR)')}><input type="number" className={inputClass} value={s.bikes.minFee} onChange={(e) => setS({ ...s, bikes: { ...s.bikes, minFee: n(e.target.value) } })} /></Field>
            <Field label={tx('Max bikes per booking')}><input type="number" className={inputClass} value={s.bikes.maxPerBooking} onChange={(e) => setS({ ...s, bikes: { ...s.bikes, maxPerBooking: Math.max(1, n(e.target.value)) } })} /></Field>
          </div>
          <p className="text-[13px] text-[#46464f]">{tx('The categories passengers can choose, and what each costs for the whole route. Shorter trips pay a share, never less than the minimum fee. Switch a category off to stop offering it; bookings that already have it keep it.')}</p>
          <div className="space-y-3">
            {kinds.map((k, i) => {
              const v = s.bikes.kinds[k];
              const setKind = (patch: Partial<typeof v>) => setS({ ...s, bikes: { ...s.bikes, kinds: { ...s.bikes.kinds, [k]: { ...v, ...patch } } } });
              return (
                <div key={k} className={`rounded-xl border p-3 space-y-2 ${v.active ? 'border-[#c7c5d1]' : 'border-dashed border-[#c7c5d1] opacity-70'}`}>
                  <div className="grid grid-cols-[1fr_150px] gap-3">
                    <Field label={tx('Category {v} name', { v: i + 1 })}><input className={inputClass} value={v.label} onChange={(e) => setKind({ label: e.target.value })} placeholder={tx('e.g. Three-wheeler')} /></Field>
                    <Field label={tx('Icon')}>
                      <select className={inputClass} value={v.icon} onChange={(e) => setKind({ icon: e.target.value })}>
                        {BIKE_ICONS.map((ic) => (
                          <option key={ic.id} value={ic.id}>{tx(ic.label)}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={tx('Full-route price (LKR)')}><input type="number" className={inputClass} value={v.fullRouteFee} onChange={(e) => setKind({ fullRouteFee: n(e.target.value) })} /></Field>
                    <Field label={tx('Spaces it takes')}><input type="number" className={inputClass} value={v.spaces} onChange={(e) => setKind({ spaces: Math.max(1, n(e.target.value)) })} /></Field>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] font-semibold text-[#050a44]">
                    <label className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4" checked={v.active} onChange={(e) => setKind({ active: e.target.checked })} />{' '}{tx('Offered to passengers')}</label>
                    <label className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4" checked={v.needsPlate} onChange={(e) => setKind({ needsPlate: e.target.checked })} />{' '}{tx('Number plate required')}</label>
                  </div>
                </div>
              );
            })}
          </div>
          {kinds.some((k) => s.bikes.kinds[k].active && s.bikes.kinds[k].label.trim().length < 2) && <p className="text-[12px] font-semibold text-[#ba1a1a]">{tx('Give every category you offer a name.')}</p>}
          <Button
            variant="secondary"
            onClick={() => {
              const id = newBikeKindId(`category ${kinds.length + 1}`, kinds);
              setS({ ...s, bikes: { ...s.bikes, kinds: { ...s.bikes.kinds, [id]: { label: '', icon: 'two_wheeler', spaces: 2, fullRouteFee: 1000, needsPlate: true, active: true, order: kinds.length } } } });
            }}
          >{tx('+ Add a category')}</Button>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">{tx('Payments')}</h2>
          <Field label={tx('Online card & wallet payments')} hint={tx('Switch to PayHere once your merchant account is approved and its keys are on the server (README → Payments).')}>
            <select className={inputClass} value={s.paymentsMode} onChange={(e) => setS({ ...s, paymentsMode: e.target.value as Settings['paymentsMode'] })}>
              <option value="demo">{tx('Demo: no money taken (testing only)')}</option>
              <option value="payhere">{tx('PayHere: cards, eZ Cash, mCash, Genie')}</option>
            </select>
          </Field>
          {s.paymentsMode === 'demo' && <p className="text-[12px] font-semibold text-[#ba1a1a]">{tx('While on demo, online bookings are confirmed without payment. Don\'t go live like this.')}</p>}
          <Field label={tx('Bank details shown for bank transfers')}><input className={inputClass} value={s.bankDetails} onChange={(e) => setS({ ...s, bankDetails: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={tx('Hold for counter payment (minutes)')}><input type="number" className={inputClass} value={s.holdMinutesCounter} onChange={(e) => setS({ ...s, holdMinutesCounter: Math.max(15, n(e.target.value)) })} /></Field>
            <Field label={tx('Hold for bank transfer (minutes)')}><input type="number" className={inputClass} value={s.holdMinutesBank} onChange={(e) => setS({ ...s, holdMinutesBank: Math.max(30, n(e.target.value)) })} /></Field>
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">{REWARDS_ENABLED ? tx('Rewards & messages') : tx('Messages')}</h2>
          {REWARDS_ENABLED && <Field label={tx('Free trip after every … completed trips')} hint={tx('0 turns rewards off')}><input type="number" className={inputClass} value={s.rewardEvery} onChange={(e) => setS({ ...s, rewardEvery: n(e.target.value) })} /></Field>}
          <div className="flex flex-wrap gap-4">
            {(['sms', 'whatsapp', 'email'] as const).map((ch) => (
              <label key={ch} className="flex items-center gap-2 text-[14px] font-semibold text-[#050a44]">
                <input type="checkbox" className="w-4 h-4 accent-[#050a44]" checked={ch === 'email' ? s.messaging.email !== false : s.messaging[ch]} onChange={(e) => setS({ ...s, messaging: { ...s.messaging, [ch]: e.target.checked } })} />
                {ch === 'email' ? tx('Email the ticket') : tx('Send {v} messages', { v: ch === 'sms' ? 'SMS' : 'WhatsApp' })}
              </label>
            ))}
          </div>
          <p className="text-[12px] text-[#6b6d78]">{tx('Booking confirmations (with the ticket and tracking links), payment reminders and waitlist offers. Conductor updates go as notifications, not texts. The ticket is emailed when the passenger gave an email address. Needs the provider keys on the server (README → Messages).')}</p>
          <Field label={tx('Website address used in messages')}><input className={inputClass} value={s.siteUrl} onChange={(e) => setS({ ...s, siteUrl: e.target.value.trim() })} placeholder="https://www.siyanlanka.lk" /></Field>
          <MessageLog />
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">{tx('Seat resale')}</h2>
          <p className="text-[13px] text-[#46464f]">{tx('Lets passengers sell a seat they can\'t use to another passenger, for no more than they paid. The buyer pays the price plus the {amount} booking fee; the seller gets the price back.', { amount: formatLKR(s.bookingFee) })}</p>
          <label className="flex items-center justify-between gap-4 rounded-xl bg-[#f2f4f6] p-4">
            <span>
              <span className="block text-[15px] font-semibold text-[#050a44]">{s.resaleEnabled ? tx('On: customers can resell seats') : tx('Off: hidden from customers')}</span>
              <span className="block text-[12px] text-[#6b6d78]">{tx('Save changes to apply.')}</span>
            </span>
            <button type="button" role="switch" aria-checked={s.resaleEnabled} onClick={() => setS({ ...s, resaleEnabled: !s.resaleEnabled })}
              className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${s.resaleEnabled ? 'bg-[#006e1c]' : 'bg-[#c7c5d1]'}`}>
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${s.resaleEnabled ? 'left-6' : 'left-1'}`} />
            </button>
          </label>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">{tx('Ways to pay online')}</h2>
          <p className="text-[13px] text-[#46464f]">{tx('Bank transfer and pay at the counter are always offered. Passengers are told when their payment is recorded.')}</p>
          <label className="flex items-center justify-between gap-4 rounded-xl bg-[#f2f4f6] p-4">
            <span>
              <span className="block text-[15px] font-semibold text-[#050a44]">{s.payOnBus ? tx('Pay on the bus: on') : tx('Pay on the bus: off')}</span>
              <span className="block text-[12px] text-[#6b6d78]">{tx('The seat is reserved without payment; the conductor collects cash on the bus. Turn off if too many reserved seats go unused.')}</span>
            </span>
            <button type="button" role="switch" aria-checked={s.payOnBus} aria-label={tx('Pay on the bus')} onClick={() => setS({ ...s, payOnBus: !s.payOnBus })}
              className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${s.payOnBus ? 'bg-[#006e1c]' : 'bg-[#c7c5d1]'}`}>
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${s.payOnBus ? 'left-6' : 'left-1'}`} />
            </button>
          </label>
          <label className="flex items-center justify-between gap-4 rounded-xl bg-[#f2f4f6] p-4">
            <span>
              <span className="block text-[15px] font-semibold text-[#050a44]">{s.cardPayments ? tx('Card & wallet: open') : tx('Card & wallet: locked (shown as not available yet)')}</span>
              <span className="block text-[12px] text-[#6b6d78]">{tx('Leave locked until the payment gateway is set up. Unlocked with Payments on Demo, card bookings are confirmed without any money.')}</span>
            </span>
            <button type="button" role="switch" aria-checked={s.cardPayments} aria-label={tx('Card and wallet payments')} onClick={() => setS({ ...s, cardPayments: !s.cardPayments })}
              className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${s.cardPayments ? 'bg-[#006e1c]' : 'bg-[#c7c5d1]'}`}>
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${s.cardPayments ? 'left-6' : 'left-1'}`} />
            </button>
          </label>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">{tx('Seat beside a woman travelling alone')}</h2>
          <p className="text-[13px] text-[#46464f]">{tx('When a woman has booked one seat, the seat right beside hers (same side of the aisle) is kept for women. A man booking online is told why and asked to pick another seat. It doesn\'t apply when the same account books the next seat, or when two or more seats are booked together. Office staff can override it when selling at the counter.')}</p>
          <label className="flex items-center justify-between gap-4 rounded-xl bg-[#f2f4f6] p-4">
            <span>
              <span className="block text-[15px] font-semibold text-[#050a44]">{s.ladiesAdjacent ? tx('On: the seat beside her is kept for women') : tx('Off: anyone can book the seat beside her')}</span>
              <span className="block text-[12px] text-[#6b6d78]">{tx('Ladies-only seats set on each bus are separate and always apply. Save changes to apply.')}</span>
            </span>
            <button type="button" role="switch" aria-checked={s.ladiesAdjacent} aria-label={tx('Seat beside a woman travelling alone')} onClick={() => setS({ ...s, ladiesAdjacent: !s.ladiesAdjacent })}
              className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${s.ladiesAdjacent ? 'bg-[#006e1c]' : 'bg-[#c7c5d1]'}`}>
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${s.ladiesAdjacent ? 'left-6' : 'left-1'}`} />
            </button>
          </label>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[#050a44]">{tx('Code on every booking')}</h2>
          <p className="text-[13px] text-[#46464f]">{tx('Passengers stay signed in, and before paying for an online booking they give a mobile number and confirm it with a 6-digit code we text to it, whether they signed in with an email address or a phone number. A code works for one booking, for 20 minutes. Counter and phone bookings by staff are never asked. Each code is one text message.')}</p>
          <label className="flex items-center justify-between gap-4 rounded-xl bg-[#f2f4f6] p-4">
            <span>
              <span className="block text-[15px] font-semibold text-[#050a44]">{s.bookingOtp ? tx('On: a code is needed to book') : tx('Off: signed-in passengers book without a code')}</span>
              <span className="block text-[12px] text-[#6b6d78]">{tx('Turn off if text messages are down, so people can still book. Save changes to apply.')}</span>
            </span>
            <button type="button" role="switch" aria-checked={s.bookingOtp} aria-label={tx('Code on every booking')} onClick={() => setS({ ...s, bookingOtp: !s.bookingOtp })}
              className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${s.bookingOtp ? 'bg-[#006e1c]' : 'bg-[#c7c5d1]'}`}>
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${s.bookingOtp ? 'left-6' : 'left-1'}`} />
            </button>
          </label>
        </Card>
      </div>
      {erp.mode === 'demo' && <p className="text-[12px] text-[#6b6d78] mt-4">{tx('Demo mode: settings are saved in this browser only. With Supabase connected they price every booking.')}</p>}
      <Toast />
    </>
  );
}

function MessageLog() {
  const [rows, setRows] = useState<{ id: string; channel: string; to_phone: string; to_email: string | null; body: string; status: string; created_at: string; error: string | null }[] | null>(null);
  useEffect(() => {
    if (!isSupabaseConfigured) return setRows([]);
    supabase().from('message_queue').select('id, channel, to_phone, to_email, body, status, created_at, error').order('created_at', { ascending: false }).limit(15).then(({ data }) => setRows(data ?? []));
  }, []);
  if (!rows) return null;
  return (
    <details className="rounded-xl bg-[#f8f9fb] border border-[#edeef0] p-3">
      <summary className="text-[13px] font-bold text-[#050a44] cursor-pointer">{tx('Recent messages ({length})', { length: rows.length })}</summary>
      {rows.length === 0 ? (
        <p className="text-[12px] text-[#6b6d78] mt-2">{isSupabaseConfigured ? tx('Nothing sent yet.') : tx('Messages are queued in the database; connect Supabase to see them.')}</p>
      ) : (
        <ul className="mt-2 space-y-2 max-h-72 overflow-y-auto">
          {rows.map((m) => (
            <li key={m.id} className="text-[12px]">
              <span className={`font-bold ${m.status === 'sent' ? 'text-[#006e1c]' : m.status === 'pending' ? 'text-[#7c5800]' : 'text-[#ba1a1a]'}`}>{m.status}</span>{' '}
              <span className="text-[#6b6d78]">{m.channel} → {m.to_email || m.to_phone} · {new Date(m.created_at).toLocaleString(dateLocale())}</span>
              <span className="block text-[#46464f]">{m.body}</span>
              {m.error && m.status !== 'sent' && <span className="block text-[#6b6d78]">{m.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}