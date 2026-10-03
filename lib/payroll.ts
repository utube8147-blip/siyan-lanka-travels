'use client';
// Salary settlement: what each crew member has earned for a month, what they
// have already had (advances, salary paid) and what is still owed.
//   earned  = monthly salary + pay per trip × trips their bus ran + bonuses − deductions
//   balance = earned − advances − salary already paid
// Advances and salary payments are money out, so each is also saved as an
// expense (category "salary") and shows in Finance. Supabase when connected
// (super admin only); otherwise kept in this browser (demo).

import { useCallback, useEffect, useState } from 'react';
import { friendlyError, isSupabaseConfigured as DB, supabase } from './supabase/client';
import type { CrewMember, Expense } from './erp';
import { uuid } from './uuid';

export type PayKind = 'advance' | 'salary' | 'bonus' | 'deduction';
export const PAY_KIND_LABEL: Record<PayKind, string> = { advance: 'Advance', salary: 'Salary paid', bonus: 'Bonus', deduction: 'Deduction' };
export interface PayEntry {
  id: string;
  crewId: string;
  /** "YYYY-MM": the month the pay is for. */
  month: string;
  kind: PayKind;
  amount: number;
  paidOn: string;
  method: 'cash' | 'bank' | 'cheque' | 'other';
  notes: string;
  expenseId?: string | null;
}
type Result = { ok: boolean; reason?: string };
const KEY = 'demo-crew-pay';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromRow = (r: any): PayEntry => ({ id: r.id, crewId: r.crew_id, month: r.month, kind: r.kind, amount: r.amount, paidOn: r.paid_on, method: r.method, notes: r.notes ?? '', expenseId: r.expense_id });

/** One person's figures for one month. */
export interface Settlement { basic: number; trips: number; tripPay: number; bonus: number; deduction: number; earned: number; advance: number; paid: number; balance: number; entries: PayEntry[] }
export function settle(member: CrewMember, month: string, entries: PayEntry[], trips: number): Settlement {
  const mine = entries.filter((e) => e.crewId === member.id && e.month === month).sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const sum = (k: PayKind) => mine.filter((e) => e.kind === k).reduce((n, e) => n + e.amount, 0);
  const tripPay = (member.perTripPay ?? 0) * trips;
  const earned = member.monthlySalary + tripPay + sum('bonus') - sum('deduction');
  return { basic: member.monthlySalary, trips, tripPay, bonus: sum('bonus'), deduction: sum('deduction'), earned, advance: sum('advance'), paid: sum('salary'), balance: earned - sum('advance') - sum('salary'), entries: mine };
}

/**
 * `saveExpense` / `removeExpense` come from useErp, so the Expenses and
 * Finance pages update at once.
 */
export function usePayroll(saveExpense: (e: Expense) => Promise<Result>, removeExpense: (id: string) => Promise<Result>) {
  const [entries, setEntries] = useState<PayEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!DB) {
      try {
        setEntries(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
      } catch {
        setEntries([]);
      }
      return setReady(true);
    }
    const { data, error } = await supabase().from('crew_pay').select('*').order('paid_on');
    if (error) setError('Salary records couldn’t be loaded. If this is new, run supabase/setup.sql, then reload.');
    setEntries((data ?? []).map(fromRow));
    setReady(true);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const writeDemo = (next: PayEntry[]) => {
    setEntries(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage full */
    }
  };

  /** Records an advance, a salary payment, a bonus or a deduction. Money out also becomes an expense. */
  const add = async (member: CrewMember, e: Omit<PayEntry, 'id' | 'crewId' | 'expenseId'>): Promise<Result> => {
    if (!(e.amount > 0)) return { ok: false, reason: 'Enter an amount.' };
    let expenseId: string | null = null;
    if (e.kind === 'advance' || e.kind === 'salary') {
      expenseId = uuid();
      const monthName = new Date(`${e.month}-01T00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      const r = await saveExpense({
        id: expenseId,
        spentOn: e.paidOn,
        category: 'salary',
        amount: e.amount,
        busId: member.busId ?? null,
        description: `${e.kind === 'advance' ? 'Salary advance' : 'Salary'}: ${member.fullName} (${member.role}), ${monthName}${e.notes ? `. ${e.notes}` : ''}`,
        vendor: '',
        paymentMethod: e.method,
      });
      if (!r.ok) return r;
    }
    const entry: PayEntry = { ...e, id: uuid(), crewId: member.id, expenseId };
    if (!DB) {
      writeDemo([...entries, entry]);
      return { ok: true };
    }
    const { error } = await supabase().from('crew_pay').insert({ id: entry.id, crew_id: entry.crewId, month: entry.month, kind: entry.kind, amount: entry.amount, paid_on: entry.paidOn, method: entry.method, notes: entry.notes, expense_id: expenseId });
    if (error) {
      if (expenseId) await removeExpense(expenseId); // don't leave an expense with no pay record
      return { ok: false, reason: friendlyError(error) };
    }
    await load();
    return { ok: true };
  };

  /** Removes a record (and, for money out, its expense). */
  const remove = async (entry: PayEntry): Promise<Result> => {
    if (!DB) {
      if (entry.expenseId) await removeExpense(entry.expenseId);
      writeDemo(entries.filter((x) => x.id !== entry.id));
      return { ok: true };
    }
    const { error } = await supabase().from('crew_pay').delete().eq('id', entry.id);
    if (error) return { ok: false, reason: friendlyError(error) };
    // the database removed the expense with it; refresh the expense list the pages hold
    if (entry.expenseId) await removeExpense(entry.expenseId).catch(() => undefined);
    await load();
    return { ok: true };
  };

  return { entries, ready, error, add, remove };
}
