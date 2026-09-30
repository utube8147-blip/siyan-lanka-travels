'use client';
// lib/erp.ts — business data for the staff/admin area: expenses (fuel,
// service, repairs, salaries…), other income, bus documents, crew, user
// accounts and settings. Supabase when connected (RLS decides who sees what),
// otherwise sample data kept in this browser.

import { useCallback, useEffect, useState } from 'react';
import { OPERATOR } from '@/config/operator';
import { friendlyError, isSupabaseConfigured, supabase } from './supabase/client';
import { addDays, genId, parseISODate, todayISO } from './trips';
import { SEED_SCHEDULES } from './seed';

// ------------------------------------------------------------------ types ---
export const EXPENSE_CATEGORIES = [
  'fuel', 'service', 'repair', 'tyres', 'salary', 'toll', 'parking', 'cleaning',
  'insurance', 'license', 'permit', 'commission', 'office', 'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
/** Categories regular staff may log from the road. */
export const RUNNING_COSTS: ExpenseCategory[] = ['fuel', 'toll', 'parking', 'cleaning'];
export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  fuel: 'Fuel', service: 'Service', repair: 'Repair', tyres: 'Tyres', salary: 'Salary', toll: 'Toll',
  parking: 'Parking', cleaning: 'Cleaning', insurance: 'Insurance', license: 'Licence', permit: 'Permit',
  commission: 'Commission', office: 'Office', other: 'Other',
};

export interface Expense {
  id: string;
  spentOn: string;
  category: ExpenseCategory;
  amount: number;
  busId?: string | null;
  description: string;
  vendor: string;
  paymentMethod: 'cash' | 'card' | 'bank' | 'cheque' | 'other';
  litres?: number | null;
  odometerKm?: number | null;
  nextDueDate?: string | null;
  nextDueKm?: number | null;
  createdAt?: string;
}
export type IncomeCategory = 'charter' | 'parcel' | 'advertising' | 'other';
export interface Income { id: string; receivedOn: string; category: IncomeCategory; amount: number; busId?: string | null; description: string }
export type DocumentKind = 'insurance' | 'revenue_license' | 'route_permit' | 'emission_test' | 'fitness_certificate' | 'other';
export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  insurance: 'Insurance', revenue_license: 'Revenue licence', route_permit: 'Route permit',
  emission_test: 'Emission test', fitness_certificate: 'Fitness certificate', other: 'Other',
};
export interface BusDocument { id: string; busId: string; kind: DocumentKind; number: string; expiresOn: string; notes: string }
export type CrewRole = 'driver' | 'conductor' | 'cleaner' | 'mechanic' | 'office';
export interface CrewMember {
  id: string; fullName: string; role: CrewRole; phone: string; licenseNo: string; licenseExpires?: string | null;
  monthlySalary: number; busId?: string | null; active: boolean; notes: string;
}
export type AccountRole = 'passenger' | 'staff' | 'admin';
export interface Account { id: string; email: string; fullName: string; phone: string; role: AccountRole; createdAt: string; lastSignIn?: string | null }
export interface Settings {
  bookingFee: number;
  promoCode: string;
  promoPercent: number;
  maxSeats: number;
  cutoffMinutes: number;
  refundPolicy: { hoursBefore: number; percent: number }[];
  bikes: { minFee: number; maxPerBooking: number; kinds: Record<'bicycle' | 'scooter' | 'motorbike', { spaces: number; fullRouteFee: number }> };
  resaleEnabled: boolean;
}
export interface ErpData {
  expenses: Expense[];
  income: Income[];
  documents: BusDocument[];
  crew: CrewMember[];
  accounts: Account[];
  settings: Settings;
}
type Result = { ok: boolean; reason?: string };

// ---------------------------------------------------------------- mapping ---
/* eslint-disable @typescript-eslint/no-explicit-any */
const expFrom = (r: any): Expense => ({
  id: r.id, spentOn: r.spent_on, category: r.category, amount: r.amount, busId: r.bus_id, description: r.description,
  vendor: r.vendor, paymentMethod: r.payment_method, litres: r.litres != null ? Number(r.litres) : null, odometerKm: r.odometer_km,
  nextDueDate: r.next_due_date, nextDueKm: r.next_due_km, createdAt: r.created_at,
});
const expTo = (e: Expense) => ({
  id: e.id, spent_on: e.spentOn, category: e.category, amount: e.amount, bus_id: e.busId || null, description: e.description,
  vendor: e.vendor, payment_method: e.paymentMethod, litres: e.litres ?? null, odometer_km: e.odometerKm ?? null,
  next_due_date: e.nextDueDate || null, next_due_km: e.nextDueKm ?? null,
});
const incFrom = (r: any): Income => ({ id: r.id, receivedOn: r.received_on, category: r.category, amount: r.amount, busId: r.bus_id, description: r.description });
const incTo = (i: Income) => ({ id: i.id, received_on: i.receivedOn, category: i.category, amount: i.amount, bus_id: i.busId || null, description: i.description });
const docFrom = (r: any): BusDocument => ({ id: r.id, busId: r.bus_id, kind: r.kind, number: r.number, expiresOn: r.expires_on, notes: r.notes });
const docTo = (d: BusDocument) => ({ id: d.id, bus_id: d.busId, kind: d.kind, number: d.number, expires_on: d.expiresOn, notes: d.notes });
const crewFrom = (r: any): CrewMember => ({
  id: r.id, fullName: r.full_name, role: r.role, phone: r.phone, licenseNo: r.license_no, licenseExpires: r.license_expires,
  monthlySalary: r.monthly_salary, busId: r.bus_id, active: r.active, notes: r.notes,
});
const crewTo = (c: CrewMember) => ({
  id: c.id, full_name: c.fullName, role: c.role, phone: c.phone, license_no: c.licenseNo, license_expires: c.licenseExpires || null,
  monthly_salary: c.monthlySalary, bus_id: c.busId || null, active: c.active, notes: c.notes,
});
const settingsFrom = (r: any): Settings => ({
  bookingFee: r.booking_fee, promoCode: r.promo_code ?? '', promoPercent: r.promo_percent, maxSeats: r.max_seats_per_booking,
  cutoffMinutes: r.booking_cutoff_minutes, refundPolicy: r.refund_policy, bikes: r.bikes, resaleEnabled: !!r.resale_enabled,
});
const settingsTo = (s: Settings) => ({
  booking_fee: s.bookingFee, promo_code: s.promoCode || null, promo_percent: s.promoPercent, max_seats_per_booking: s.maxSeats,
  booking_cutoff_minutes: s.cutoffMinutes, refund_policy: s.refundPolicy, bikes: s.bikes, resale_enabled: s.resaleEnabled,
});

export const DEFAULT_SETTINGS: Settings = {
  bookingFee: OPERATOR.bookingFee,
  promoCode: OPERATOR.promo.code,
  promoPercent: OPERATOR.promo.percentOff,
  maxSeats: OPERATOR.maxSeatsPerBooking,
  cutoffMinutes: OPERATOR.bookingCutoffMinutes,
  refundPolicy: OPERATOR.refundPolicy.map((t) => ({ ...t })),
  bikes: {
    minFee: OPERATOR.bikes.minFee,
    maxPerBooking: OPERATOR.bikes.maxPerBooking,
    kinds: {
      bicycle: { spaces: OPERATOR.bikes.kinds.bicycle.spaces, fullRouteFee: OPERATOR.bikes.kinds.bicycle.fullRouteFee },
      scooter: { spaces: OPERATOR.bikes.kinds.scooter.spaces, fullRouteFee: OPERATOR.bikes.kinds.scooter.fullRouteFee },
      motorbike: { spaces: OPERATOR.bikes.kinds.motorbike.spaces, fullRouteFee: OPERATOR.bikes.kinds.motorbike.fullRouteFee },
    },
  },
  resaleEnabled: OPERATOR.features.resale,
};

// ------------------------------------------------------------- demo data ---
const DEMO_KEY = 'erp-demo-data-v1';

function demoSeed(): ErpData {
  const today = todayISO();
  const expenses: Expense[] = [];
  let odo = 118_000;
  let n = 0;
  const e = (x: Omit<Expense, 'id' | 'vendor' | 'paymentMethod' | 'description'> & Partial<Expense>) =>
    expenses.push({ id: genId('exp'), vendor: '', paymentMethod: 'cash', description: '', ...x });
  for (let d = -60; d <= -1; d++) {
    const date = addDays(today, d);
    const wd = parseISODate(date).getDay();
    const runs = SEED_SCHEDULES.filter((s) => s.days.includes(wd as never));
    for (const s of runs) {
      odo += 530;
      n++;
      const litres = 57 + ((n * 7) % 9);
      // Sample bookings cover the last two weeks, so log running costs for the same period.
      if (d >= -14) {
        e({ spentOn: date, category: 'fuel', amount: Math.round(litres * 362), busId: 'bus-1', litres, odometerKm: odo, vendor: s.routeId.endsWith('east') ? 'Ceypetco Kadawatha' : 'Lanka IOC Batticaloa' });
        e({ spentOn: date, category: 'toll', amount: 400, busId: 'bus-1', description: 'Expressway / ferry tolls' });
      }
      if (n % 19 === 0) e({ spentOn: date, category: 'service', amount: 46_500, busId: 'bus-1', odometerKm: odo, nextDueKm: odo + 10_000, nextDueDate: addDays(date, 60), vendor: 'Lanka Ashok Leyland, Peliyagoda', description: 'Full service: oil, filters, brakes check' });
    }
    if (parseISODate(date).getDate() === 1) {
      e({ spentOn: date, category: 'salary', amount: 90_000, description: 'Driver: Mohamed Rizvi', paymentMethod: 'bank' });
      e({ spentOn: date, category: 'salary', amount: 62_000, description: 'Conductor: Suresh Kumar', paymentMethod: 'bank' });
      e({ spentOn: date, category: 'salary', amount: 35_000, description: 'Cleaner: Nimal Perera', paymentMethod: 'cash' });
      e({ spentOn: date, category: 'office', amount: 12_000, description: 'Counter rent, Bastian Mawatha', paymentMethod: 'bank' });
    }
  }
  e({ spentOn: addDays(today, -33), category: 'tyres', amount: 184_000, busId: 'bus-1', vendor: 'DSI Tyres', description: '2 rear tyres', paymentMethod: 'bank' });
  e({ spentOn: addDays(today, -18), category: 'repair', amount: 27_500, busId: 'bus-1', vendor: 'City Auto AC', description: 'AC compressor belt' });
  const income: Income[] = [
    { id: genId('inc'), receivedOn: addDays(today, -40), category: 'charter', amount: 115_000, busId: 'bus-1', description: 'Wedding party, Kalmunai → Kandy' },
    { id: genId('inc'), receivedOn: addDays(today, -12), category: 'charter', amount: 95_000, busId: 'bus-1', description: 'School trip, Batticaloa' },
    { id: genId('inc'), receivedOn: addDays(today, -6), category: 'parcel', amount: 8_400, busId: 'bus-1', description: 'Parcels Colombo → Kalmunai' },
  ];
  const documents: BusDocument[] = [
    { id: genId('doc'), busId: 'bus-1', kind: 'insurance', number: 'CEY/MV/2026/88121', expiresOn: addDays(today, 41), notes: 'Ceylinco, full cover' },
    { id: genId('doc'), busId: 'bus-1', kind: 'revenue_license', number: 'EP-RL-44102', expiresOn: addDays(today, 196), notes: '' },
    { id: genId('doc'), busId: 'bus-1', kind: 'route_permit', number: 'NTC-48-0913', expiresOn: addDays(today, 12), notes: 'NTC Route 48' },
    { id: genId('doc'), busId: 'bus-1', kind: 'emission_test', number: 'VET-29931', expiresOn: addDays(today, -3), notes: '' },
  ];
  const crew: CrewMember[] = [
    { id: genId('crew'), fullName: 'Mohamed Rizvi', role: 'driver', phone: '+94 77 410 2211', licenseNo: 'B3341920', licenseExpires: addDays(today, 25), monthlySalary: 90_000, busId: 'bus-1', active: true, notes: 'Heavy vehicle licence' },
    { id: genId('crew'), fullName: 'Ahamed Farook', role: 'driver', phone: '+94 75 882 1043', licenseNo: 'B2210876', licenseExpires: addDays(today, 400), monthlySalary: 0, busId: 'bus-1', active: true, notes: 'Relief driver, paid per trip' },
    { id: genId('crew'), fullName: 'Suresh Kumar', role: 'conductor', phone: '+94 71 553 9087', licenseNo: '', licenseExpires: null, monthlySalary: 62_000, busId: 'bus-1', active: true, notes: '' },
    { id: genId('crew'), fullName: 'Nimal Perera', role: 'cleaner', phone: '+94 76 118 7720', licenseNo: '', licenseExpires: null, monthlySalary: 35_000, busId: 'bus-1', active: true, notes: '' },
  ];
  const accounts: Account[] = [
    { id: 'mock-admin-1', email: 'owner@siyanlanka.lk', fullName: 'Owner (super admin)', phone: '', role: 'admin', createdAt: addDays(today, -90) },
    { id: 'mock-staff-1', email: 'counter@siyanlanka.lk', fullName: 'Operations Desk', phone: '', role: 'staff', createdAt: addDays(today, -80) },
    { id: 'mock-user-1', email: 'alex.ham@example.com', fullName: 'Alex Ham', phone: '+94771234567', role: 'passenger', createdAt: addDays(today, -30) },
  ];
  return { expenses, income, documents, crew, accounts, settings: DEFAULT_SETTINGS };
}

function loadDemo(): ErpData {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return demoSeed();
}

// -------------------------------------------------------------------- hook ---
export function useErp({ admin }: { admin: boolean }) {
  const db = isSupabaseConfigured;
  const [data, setData] = useState<ErpData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!db) {
      setData(loadDemo());
      return;
    }
    const sb = supabase();
    const [exp, inc, docs, crew, settings, accounts] = await Promise.all([
      sb.from('expenses').select('*').order('spent_on', { ascending: false }).limit(5000),
      admin ? sb.from('other_income').select('*').order('received_on', { ascending: false }) : Promise.resolve({ data: [], error: null }),
      sb.from('bus_documents').select('*').order('expires_on'),
      admin ? sb.from('crew').select('*').order('full_name') : Promise.resolve({ data: [], error: null }),
      sb.from('app_settings').select('*').maybeSingle(),
      admin ? sb.rpc('admin_list_users') : Promise.resolve({ data: [], error: null }),
    ]);
    const err = exp.error || inc.error || docs.error || crew.error || settings.error || accounts.error;
    if (err) setError(friendlyError(err));
    setData({
      expenses: (exp.data ?? []).map(expFrom),
      income: (inc.data ?? []).map(incFrom),
      documents: (docs.data ?? []).map(docFrom),
      crew: (crew.data ?? []).map(crewFrom),
      settings: settings.data ? settingsFrom(settings.data) : DEFAULT_SETTINGS,
      accounts: ((accounts.data as any[]) ?? []).map((a) => ({
        id: a.id, email: a.email, fullName: a.full_name ?? '', phone: a.phone ?? '', role: a.role, createdAt: a.created_at, lastSignIn: a.last_sign_in_at,
      })),
    });
  }, [db, admin]);

  useEffect(() => {
    load();
  }, [load]);

  const demoWrite = (fn: (d: ErpData) => ErpData): Result => {
    setData((d) => {
      const next = fn(d ?? demoSeed());
      try {
        localStorage.setItem(DEMO_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    return { ok: true };
  };
  const dbWrite = async (op: () => PromiseLike<{ error: { message?: string } | null }>): Promise<Result> => {
    const { error: e } = await op();
    if (e) return { ok: false, reason: friendlyError(e) };
    await load();
    return { ok: true };
  };
  const upsertLocal = <T extends { id: string }>(list: T[], item: T) => (list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list]);

  const makeCrud = <T extends { id: string }>(key: 'expenses' | 'income' | 'documents' | 'crew', table: string, to: (x: T) => object) => ({
    save: (item: T) => (db ? dbWrite(() => supabase().from(table).upsert(to(item))) : Promise.resolve(demoWrite((d) => ({ ...d, [key]: upsertLocal(d[key] as unknown as T[], item) })))),
    remove: (id: string) =>
      db ? dbWrite(() => supabase().from(table).delete().eq('id', id)) : Promise.resolve(demoWrite((d) => ({ ...d, [key]: (d[key] as unknown as T[]).filter((x) => x.id !== id) }))),
  });

  const expenses = makeCrud<Expense>('expenses', 'expenses', expTo);
  const income = makeCrud<Income>('income', 'other_income', incTo);
  const documents = makeCrud<BusDocument>('documents', 'bus_documents', docTo);
  const crew = makeCrud<CrewMember>('crew', 'crew', crewTo);

  const setRole = (userId: string, role: AccountRole) =>
    db
      ? dbWrite(() => supabase().rpc('set_user_role', { p_user: userId, p_role: role }))
      : Promise.resolve(demoWrite((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === userId ? { ...a, role } : a)) })));

  const saveSettings = (s: Settings) =>
    db ? dbWrite(() => supabase().from('app_settings').update(settingsTo(s)).eq('id', true)) : Promise.resolve(demoWrite((d) => ({ ...d, settings: s })));

  const resetDemo = () => {
    try {
      localStorage.removeItem(DEMO_KEY);
    } catch {
      /* ignore */
    }
    setData(demoSeed());
  };

  return { data, error, reload: load, expenses, income, documents, crew, setRole, saveSettings, resetDemo, mode: db ? ('supabase' as const) : ('demo' as const) };
}

// ------------------------------------------------------------ calculations ---
export const monthKey = (iso: string) => iso.slice(0, 7);
export const daysUntil = (iso: string) => Math.round((parseISODate(iso).getTime() - parseISODate(todayISO()).getTime()) / 86_400_000);

/** km per litre between consecutive fuel fills for a bus (needs odometer readings). */
export function fuelEfficiency(expenses: Expense[], busId: string) {
  const fills = expenses
    .filter((e) => e.category === 'fuel' && e.busId === busId && e.odometerKm && e.litres)
    .sort((a, b) => (a.odometerKm! - b.odometerKm!));
  if (fills.length < 2) return null;
  const km = fills[fills.length - 1].odometerKm! - fills[0].odometerKm!;
  const litres = fills.slice(1).reduce((n, f) => n + (f.litres ?? 0), 0);
  const cost = fills.slice(1).reduce((n, f) => n + f.amount, 0);
  return litres > 0 ? { kmPerLitre: km / litres, costPerKm: cost / Math.max(1, km), km, litres } : null;
}

export function latestOdometer(expenses: Expense[], busId: string) {
  return expenses.filter((e) => e.busId === busId && e.odometerKm).reduce((m, e) => Math.max(m, e.odometerKm!), 0) || null;
}

export function nextService(expenses: Expense[], busId: string) {
  return expenses
    .filter((e) => e.busId === busId && (e.category === 'service') && (e.nextDueDate || e.nextDueKm))
    .sort((a, b) => b.spentOn.localeCompare(a.spentOn))[0] ?? null;
}
