'use client';
// Branches: the places you sell tickets from (counters, offices, agents).
// Each staff account belongs to one; every booking remembers the branch that
// made it and the branch that took the money (database, migration 25).
// Without Supabase there is one built-in branch and no report.

import { useCallback, useEffect, useState } from 'react';
import { OPERATOR } from '@/config/operator';
import { friendlyError, isSupabaseConfigured, supabase } from './supabase/client';

export interface Branch {
  id: string;
  name: string;
  address: string;
  phone: string;
  takesPayments: boolean;
  active: boolean;
}

export interface BranchSalesPerson {
  id: string;
  name: string;
  role: string;
  bookings: number;
  seats: number;
  value: number;
  cash: number;
  other: number;
  refunded: number;
}
export interface BranchSalesRow extends Omit<BranchSalesPerson, 'id' | 'role'> {
  /** A branch id, 'online' (passengers booking themselves) or 'none' (staff with no branch yet). */
  key: string;
  people: BranchSalesPerson[];
}

type Result = { ok: true } | { ok: false; reason: string };

const DEMO: Branch[] = [{ id: 'demo-branch', name: OPERATOR.contact.address.split(',')[0], address: OPERATOR.contact.address, phone: '', takesPayments: true, active: true }];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const from = (r: any): Branch => ({ id: r.id, name: r.name, address: r.address ?? '', phone: r.phone ?? '', takesPayments: r.takes_payments !== false, active: r.active !== false });

/** Every branch (public: the payment page names the counters). */
export function useBranches() {
  const [branches, setBranches] = useState<Branch[] | null>(isSupabaseConfigured ? null : DEMO);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error: e } = await supabase().from('branches').select('*').order('created_at');
    // The table is missing until migration 25 has been run: behave as before it.
    if (e) {
      setError(friendlyError(e));
      setBranches([]);
      return;
    }
    setError(null);
    setBranches((data ?? []).map(from));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const write = async (op: () => PromiseLike<{ error: { message?: string } | null }>): Promise<Result> => {
    if (!isSupabaseConfigured) return { ok: false, reason: 'Connect the database to manage branches.' };
    const { error: e } = await op();
    if (e) return { ok: false, reason: /branches_name_key/.test(e.message ?? '') ? 'There is already a branch with that name.' : friendlyError(e) };
    await load();
    return { ok: true };
  };
  const save = (b: Omit<Branch, 'id'> & { id?: string }) => {
    const row = { name: b.name.trim(), address: b.address.trim(), phone: b.phone.trim(), takes_payments: b.takesPayments, active: b.active };
    return write(() => (b.id ? supabase().from('branches').update(row).eq('id', b.id) : supabase().from('branches').insert(row)));
  };

  return { branches, error, save, reload: load };
}

/** "our Bastian Mawatha counter" / "our Bastian Mawatha or Kalmunai counter", for passengers paying a held seat. */
export function counterPlaces(branches: Branch[] | null) {
  const open = (branches ?? []).filter((b) => b.active && b.takesPayments);
  if (open.length === 0) return { text: 'our counter', list: [] as Branch[] };
  return { text: `our ${open.map((b) => b.name).join(' or ')} counter`, list: open };
}

/** Sales and cash by branch for a range of days (super admins). */
export function useBranchSales(fromDate: string, toDate: string) {
  const [rows, setRows] = useState<BranchSalesRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setRows([]);
      return;
    }
    let stale = false;
    setRows(null);
    supabase()
      .rpc('branch_sales', { p_from: fromDate, p_to: toDate })
      .then(({ data, error: e }) => {
        if (stale) return;
        setError(e ? friendlyError(e) : null);
        setRows(e ? [] : ((data as BranchSalesRow[] | null) ?? []));
      });
    return () => {
      stale = true;
    };
  }, [fromDate, toDate]);
  return { rows, error };
}
