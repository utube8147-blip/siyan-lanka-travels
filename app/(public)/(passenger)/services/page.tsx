'use client';
// Parcels & charters — passengers send a request; staff reply with a quote
// (Staff area → Requests). Works without signing in.

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Package, BusFront, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/lib/store';
import { allStopNames, todayISO } from '@/lib/trips';
import { submitRequest, type RequestKind } from '@/lib/extras';

const input = 'w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] rounded-lg text-[14px] font-medium outline-none focus:ring-1 focus:ring-[#050a44]';

export default function ServicesPage() {
  const { user } = useAuth();
  const { data } = useStore();
  const stops = allStopNames(data);
  const [kind, setKind] = useState<RequestKind>(() => (typeof window !== 'undefined' && window.location.hash === '#charter' ? 'charter' : 'parcel'));
  const [name, setName] = useState(user?.user_metadata.full_name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [d, setD] = useState<Record<string, string | number>>({ from: 'Colombo', to: 'Batticaloa', date: todayISO() });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string | number) => setD((p) => ({ ...p, [k]: v }));

  const valid = name.trim().length > 1 && phone.replace(/\D/g, '').length >= 9 && (kind === 'parcel' ? String(d.contents ?? '').length > 2 : Number(d.people ?? 0) > 0);

  return (
    <main className="max-w-[720px] mx-auto px-4 py-6 md:py-10">
      <h1 className="hidden md:block text-[30px] font-semibold text-[#050a44]">Parcels & bus hire</h1>
      <p className="text-[15px] text-[#46464f] mt-1 mb-6">Tell us what you need and we&apos;ll call or text you with a price, usually within a few hours.</p>

      <div role="tablist" className="grid grid-cols-2 gap-2 mb-6">
        {([
          ['parcel', 'Send a parcel', Package, 'On our night bus, collected at the other end'],
          ['charter', 'Hire a bus', BusFront, 'Weddings, school trips, pilgrimages, events'],
        ] as const).map(([k, label, Icon, hint]) => (
          <button key={k} role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setDone(false); }}
            className={`text-left rounded-2xl border p-4 transition-colors ${kind === k ? 'border-[#050a44] bg-[#050a44] text-white' : 'border-[#c7c5d1] bg-white text-[#050a44]'}`}>
            <Icon className={`w-6 h-6 ${kind === k ? 'text-[#feb700]' : 'text-[#7c5800]'}`} />
            <span className="block text-[16px] font-semibold mt-2">{label}</span>
            <span className={`block text-[12px] ${kind === k ? 'text-white/70' : 'text-[#46464f]'}`}>{hint}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {done ? (
          <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl border border-[#c7c5d1] p-8 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto text-[#006e1c]" />
            <h2 className="text-[20px] font-semibold text-[#050a44] mt-3">Request sent</h2>
            <p className="text-[14px] text-[#46464f] mt-1">We&apos;ll contact you on {phone} with a price.</p>
            <button onClick={() => setDone(false)} className="mt-5 px-5 h-11 rounded-xl border border-[#c7c5d1] text-[14px] font-bold text-[#050a44]">Send another</button>
          </motion.div>
        ) : (
          <motion.form key={kind} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setErr(null);
              const r = await submitRequest(kind, { name: name.trim(), phone: phone.trim(), email: email.trim(), details: d });
              setBusy(false);
              if (!r.ok) return setErr(r.reason ?? 'Could not send');
              setDone(true);
            }}
            className="bg-white rounded-2xl border border-[#c7c5d1] p-5 md:p-6 space-y-4">
            <datalist id="svc-stops">{stops.map((s) => <option key={s} value={s} />)}</datalist>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="text-[12px] font-bold text-[#46464f]">From</span><input list="svc-stops" className={input} value={String(d.from ?? '')} onChange={(e) => set('from', e.target.value)} /></label>
              <label className="block"><span className="text-[12px] font-bold text-[#46464f]">To</span><input list="svc-stops" className={input} value={String(d.to ?? '')} onChange={(e) => set('to', e.target.value)} /></label>
            </div>
            {kind === 'parcel' ? (
              <>
                <label className="block"><span className="text-[12px] font-bold text-[#46464f]">What&apos;s in it?</span><input className={input} placeholder="e.g. Clothes, documents, sweets box" value={String(d.contents ?? '')} onChange={(e) => set('contents', e.target.value)} /></label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className="text-[12px] font-bold text-[#46464f]">Approx. weight (kg)</span><input type="number" min={0} className={input} value={d.weightKg ?? ''} onChange={(e) => set('weightKg', Number(e.target.value))} /></label>
                  <label className="block"><span className="text-[12px] font-bold text-[#46464f]">Send on</span><input type="date" min={todayISO()} className={input} value={String(d.date)} onChange={(e) => set('date', e.target.value)} /></label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className="text-[12px] font-bold text-[#46464f]">Receiver&apos;s name</span><input className={input} value={String(d.receiverName ?? '')} onChange={(e) => set('receiverName', e.target.value)} /></label>
                  <label className="block"><span className="text-[12px] font-bold text-[#46464f]">Receiver&apos;s phone</span><input inputMode="tel" className={input} value={String(d.receiverPhone ?? '')} onChange={(e) => set('receiverPhone', e.target.value)} /></label>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <label className="block"><span className="text-[12px] font-bold text-[#46464f]">Date</span><input type="date" min={todayISO()} className={input} value={String(d.date)} onChange={(e) => set('date', e.target.value)} /></label>
                  <label className="block"><span className="text-[12px] font-bold text-[#46464f]">People</span><input type="number" min={1} max={60} className={input} value={d.people ?? ''} onChange={(e) => set('people', Number(e.target.value))} /></label>
                  <label className="block"><span className="text-[12px] font-bold text-[#46464f]">Days</span><input type="number" min={1} className={input} value={d.days ?? 1} onChange={(e) => set('days', Number(e.target.value))} /></label>
                </div>
                <label className="block"><span className="text-[12px] font-bold text-[#46464f]">Occasion / plan</span><input className={input} placeholder="e.g. Wedding party, return the same night" value={String(d.notes ?? '')} onChange={(e) => set('notes', e.target.value)} /></label>
              </>
            )}
            <div className="border-t border-[#edeef0] pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block"><span className="text-[12px] font-bold text-[#46464f]">Your name</span><input className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
              <label className="block"><span className="text-[12px] font-bold text-[#46464f]">Mobile</span><input inputMode="tel" className={input} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /></label>
              <label className="block"><span className="text-[12px] font-bold text-[#46464f]">Email (optional)</span><input type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
            </div>
            {err && <p role="alert" className="text-[13px] font-semibold text-[#ba1a1a]">{err}</p>}
            <button disabled={!valid || busy} className="w-full h-12 rounded-xl bg-[#feb700] text-[#14120a] text-[15px] font-bold disabled:opacity-50">
              {busy ? 'Sending…' : kind === 'parcel' ? 'Ask for a parcel price' : 'Ask for a hire quote'}
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </main>
  );
}
