'use client';
// lib/money.ts — money that isn't a card payment:
//  * Payouts: refunds and resale sale money the company owes a passenger.
//    Created by the database (cancel, cheaper change, resale); the passenger
//    adds a bank account; office staff pay and tick them off.
//  * Bank-transfer slips: the passenger uploads a photo for a held booking;
//    office staff check it and mark the booking paid, or send it back.
// Supabase when connected; otherwise kept in this browser (demo).

import { useCallback, useEffect, useState } from 'react';
import { useAuth, isOfficeRole } from '@/contexts/AuthContext';
import { friendlyError, isSupabaseConfigured as DB, supabase } from './supabase/client';
import { useStore } from './store';
import { compressPhoto } from './trips';
import { uuid } from './uuid';
import type { Booking } from './types';

type Result = { ok: boolean; reason?: string };

export interface Payee { bank: string; branch: string; account_no: string; account_name: string }
export const EMPTY_PAYEE: Payee = { bank: '', branch: '', account_no: '', account_name: '' };
export const hasPayee = (p?: Partial<Payee> | null) => !!p?.account_no;

export type PayoutMethod = 'bank' | 'cash' | 'gateway' | 'other';
export interface Payout {
  id: string;
  kind: 'refund' | 'resale';
  bookingId?: string | null;
  bookingRef: string;
  /** e.g. "Colombo → Batticaloa · 12 Oct" */
  trip: string;
  userId?: string | null;
  name: string;
  phone: string;
  amount: number;
  status: 'pending' | 'paid' | 'cancelled';
  payee: Payee;
  method: PayoutMethod | '';
  reference: string;
  notes: string;
  createdAt: string;
  paidAt?: string | null;
}

// ------------------------------------------------------------------ demo ---
const DEMO_PAYOUTS = 'demo-payouts';
const DEMO_SLIPS = 'demo-slips';
type DemoPayoutPatch = Partial<Pick<Payout, 'payee' | 'status' | 'method' | 'reference' | 'paidAt'>>;
type DemoSlip = { dataUrl: string; reference: string; uploadedAt: string } | { rejected: string };

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  } catch {
    /* storage full or disabled */
  }
}
function useLocal<T>(key: string, fallback: T): T {
  const [v, setV] = useState<T>(fallback);
  useEffect(() => {
    setV(readLocal(key, fallback));
    const on = (e: StorageEvent) => e.key === key && setV(readLocal(key, fallback));
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return v;
}

const shortDate = (iso?: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

// --------------------------------------------------------------- payouts ---
/** 'mine' = the signed-in passenger's refunds and resale payouts; 'all' = office staff's list. */
export function usePayouts(scope: 'mine' | 'all') {
  const { user } = useAuth();
  const { data, ready } = useStore();
  const [remote, setRemote] = useState<Payout[] | null>(null);
  const patches = useLocal<Record<string, DemoPayoutPatch>>(DEMO_PAYOUTS, {});
  const userId = user?.id;
  const allowed = scope === 'mine' ? !!user : isOfficeRole(user?.role);

  const load = useCallback(async () => {
    if (!DB || !allowed) return;
    let q = supabase()
      .from('payouts')
      .select('*, bookings(ref, passenger_name, passenger_phone, contact_phone, from_stop, to_stop, travel_date), profiles!payouts_user_id_fkey(full_name, phone)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (scope === 'mine' && userId) q = q.eq('user_id', userId);
    const { data: rows } = await q;
    setRemote(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((rows as any[]) ?? []).map((r) => ({
        id: r.id,
        kind: r.kind,
        bookingId: r.booking_id,
        bookingRef: r.bookings?.ref ?? '',
        trip: r.bookings ? `${r.bookings.from_stop} → ${r.bookings.to_stop} · ${shortDate(r.bookings.travel_date)}` : '',
        userId: r.user_id,
        name: r.profiles?.full_name || r.bookings?.passenger_name || 'Passenger',
        phone: r.bookings?.contact_phone || r.bookings?.passenger_phone || r.profiles?.phone || '',
        amount: r.amount,
        status: r.status,
        payee: { ...EMPTY_PAYEE, ...(r.payee ?? {}) },
        method: r.method ?? '',
        reference: r.reference ?? '',
        notes: r.notes ?? '',
        createdAt: r.created_at,
        paidAt: r.paid_at,
      })),
    );
  }, [allowed, scope, userId]);

  useEffect(() => {
    load();
    // Bookings changing (a cancel, a seat change) is what creates payouts.
  }, [load, data.bookings.length, data.bookings.filter((b) => b.status === 'cancelled').length]);

  if (!allowed) return { payouts: [] as Payout[], ready: true, reload: load };
  if (DB) return { payouts: remote ?? [], ready: remote !== null, reload: load };

  // Demo: every cancelled booking with a refund is a payout; edits live in this browser.
  const payouts: Payout[] = data.bookings
    .filter((b) => b.status === 'cancelled' && (b.refund?.amount ?? 0) > 0 && (scope === 'all' || b.userId === user?.id))
    .map((b) => {
      const p = patches[b.id] ?? {};
      return {
        id: b.id,
        kind: 'refund' as const,
        bookingId: b.id,
        bookingRef: b.ref,
        trip: `${b.from} → ${b.to} · ${shortDate(b.date)}`,
        userId: b.userId,
        name: b.passenger.name,
        phone: b.contact.phone || b.passenger.phone,
        amount: b.refund!.amount,
        status: p.status ?? 'pending',
        payee: { ...EMPTY_PAYEE, ...(p.payee ?? {}) },
        method: p.method ?? '',
        reference: p.reference ?? '',
        notes: `Booking ${b.ref} cancelled`,
        createdAt: b.refund!.at,
        paidAt: p.paidAt,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { payouts, ready, reload: load };
}

const demoPatch = (id: string, patch: DemoPayoutPatch): Result => {
  const all = readLocal<Record<string, DemoPayoutPatch>>(DEMO_PAYOUTS, {});
  writeLocal(DEMO_PAYOUTS, { ...all, [id]: { ...all[id], ...patch } });
  return { ok: true };
};
const rpc = async (fn: string, args: Record<string, unknown>): Promise<Result> => {
  const { error } = await supabase().rpc(fn, args);
  return error ? { ok: false, reason: friendlyError(error) } : { ok: true };
};

/** Passenger: where to send the money. */
export async function setPayoutDetails(id: string, payee: Payee): Promise<Result> {
  if (payee.bank.trim().length < 2 || payee.account_no.trim().length < 5 || payee.account_name.trim().length < 2)
    return { ok: false, reason: 'Add the bank, account number and the name on the account.' };
  return DB ? rpc('set_payout_details', { p_id: id, p_payee: payee }) : demoPatch(id, { payee });
}
/** Office staff: the money has been sent. */
export async function markPayoutPaid(id: string, method: PayoutMethod, reference: string): Promise<Result> {
  return DB
    ? rpc('mark_payout_paid', { p_id: id, p_method: method, p_reference: reference })
    : demoPatch(id, { status: 'paid', method, reference, paidAt: new Date().toISOString() });
}
/** Office staff: nothing is owed after all. */
export async function cancelPayout(id: string, reason: string): Promise<Result> {
  return DB ? rpc('cancel_payout', { p_id: id, p_reason: reason }) : demoPatch(id, { status: 'cancelled' });
}

// ----------------------------------------------------------------- slips ---
export interface SlipInfo { uploadedAt: string; reference: string; rejectedReason?: string | null }

/** Slip state for held bookings, the same shape in both modes. */
export function useSlips() {
  const demo = useLocal<Record<string, DemoSlip>>(DEMO_SLIPS, {});
  return useCallback(
    (b: Booking): SlipInfo | { rejectedReason: string } | null => {
      if (DB) return b.slip ? { uploadedAt: b.slip.uploadedAt, reference: b.slip.reference } : b.slipRejectedReason ? { rejectedReason: b.slipRejectedReason } : null;
      const s = demo[b.id];
      if (!s) return null;
      return 'rejected' in s ? { rejectedReason: s.rejected } : { uploadedAt: s.uploadedAt, reference: s.reference };
    },
    [demo],
  );
}
export const slipOnFile = (s: ReturnType<ReturnType<typeof useSlips>>): s is SlipInfo => !!s && 'uploadedAt' in s;

/** What the slip picker accepts: a photo / screenshot, or the bank's PDF receipt. */
export const SLIP_ACCEPT = 'image/*,application/pdf';
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const isPdfFile = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const readAsDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(f);
  });

/** Passenger: upload the bank slip (photo, screenshot or PDF) for a held booking. */
export async function submitSlip(booking: Booking, file: File, reference: string): Promise<Result> {
  const pdf = isPdfFile(file);
  if (!pdf && !file.type.startsWith('image/')) return { ok: false, reason: 'Upload a photo, a screenshot or a PDF of the slip.' };
  if (pdf && file.size > MAX_PDF_BYTES) return { ok: false, reason: 'That PDF is larger than 5 MB. Upload a smaller one or a screenshot.' };
  let dataUrl: string;
  try {
    // Photos are shrunk before upload; a PDF goes up as it is.
    dataUrl = pdf ? await readAsDataUrl(file) : await compressPhoto(file, 1400);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  if (!DB) {
    writeLocal(DEMO_SLIPS, { ...readLocal<Record<string, DemoSlip>>(DEMO_SLIPS, {}), [booking.id]: { dataUrl, reference, uploadedAt: new Date().toISOString() } });
    return { ok: true };
  }
  const sb = supabase();
  const { data: sess } = await sb.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) return { ok: false, reason: 'Please sign in again.' };
  const path = `${uid}/${booking.ref}-${uuid().slice(0, 8)}.${pdf ? 'pdf' : 'jpg'}`;
  const blob = pdf ? file : await (await fetch(dataUrl)).blob();
  const up = await sb.storage.from('payment-slips').upload(path, blob, { contentType: pdf ? 'application/pdf' : 'image/jpeg' });
  if (up.error) return { ok: false, reason: friendlyError(up.error, "Couldn't upload the slip. Try again.") };
  return rpc('submit_payment_slip', { p_booking: booking.id, p_path: path, p_reference: reference });
}

/** Office staff: send the slip back with a reason; the passenger is told. */
export async function rejectSlip(bookingId: string, reason: string): Promise<Result> {
  if (!DB) {
    writeLocal(DEMO_SLIPS, { ...readLocal<Record<string, DemoSlip>>(DEMO_SLIPS, {}), [bookingId]: { rejected: reason || "We couldn't match it to a payment" } });
    return { ok: true };
  }
  return rpc('reject_payment_slip', { p_booking: bookingId, p_reason: reason });
}

/** True when a slip link points at a PDF (shown as a link, not a picture). */
export const slipIsPdf = (url: string) => url.startsWith('data:application/pdf') || /\.pdf(\?|$)/i.test(url);

/** A link to look at the slip (signed, 10 minutes; a data URL in demo). */
export async function slipUrl(booking: Booking): Promise<string | null> {
  if (!DB) {
    const s = readLocal<Record<string, DemoSlip>>(DEMO_SLIPS, {})[booking.id];
    return s && 'dataUrl' in s ? s.dataUrl : null;
  }
  if (!booking.slip) return null;
  const { data } = await supabase().storage.from('payment-slips').createSignedUrl(booking.slip.path, 600);
  return data?.signedUrl ?? null;
}
