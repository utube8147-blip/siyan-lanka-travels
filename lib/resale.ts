'use client';
// lib/resale.ts — passenger seat resale. With Supabase: real listings and the
// database transfer (buy_resale). The on/off switch is app_settings.resale_enabled
// (Staff area → Settings); the database refuses resale while it's off.
// Demo mode: sample listings, on/off from config/operator.ts.

import { useCallback, useEffect, useState } from 'react';
import { OPERATOR } from '@/config/operator';
import { RESALE_TICKETS, type ResaleTicket } from '@/data/resale-tickets';
import { friendlyError, isSupabaseConfigured, supabase } from './supabase/client';
import { useStore } from './store';
import { formatDateLabel, formatTime12, getTrip } from './trips';
import type { Gender } from './types';

let cachedEnabled: boolean | null = null;

export function useResaleEnabled() {
  const [on, setOn] = useState<boolean | null>(isSupabaseConfigured ? cachedEnabled : OPERATOR.features.resale);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase()
      .from('app_settings')
      .select('resale_enabled')
      .maybeSingle()
      .then(({ data }) => {
        cachedEnabled = !!data?.resale_enabled;
        setOn(cachedEnabled);
      });
  }, []);
  return on ?? false;
}

/** Open listings for the marketplace, in the shape its cards use. */
export function useResaleListings() {
  const { data, ready } = useStore();
  const [rows, setRows] = useState<ResaleTicket[] | null>(isSupabaseConfigured ? null : RESALE_TICKETS);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data: list, error } = await supabase().rpc('get_resale_listings');
    if (error) return setRows([]);
    setRows(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (list as any[]).map((l) => {
        const trip = getTrip(data, l.schedule_id, l.travel_date, l.from_stop, l.to_stop);
        return {
          id: l.id,
          operator: OPERATOR.name,
          operatorInitials: OPERATOR.initials,
          direction: data.routes.find((r) => r.id === data.schedules.find((s) => s.id === l.schedule_id)?.routeId)?.stops[0].name === 'Colombo' ? 'east' : 'west',
          from: l.from_stop,
          to: l.to_stop,
          date: formatDateLabel(trip?.boardingDate ?? l.travel_date),
          departureTime: trip ? formatTime12(trip.departure) : '',
          arrivalTime: trip ? formatTime12(trip.arrival) : '',
          seats: (l.seats as string[]).join(', '),
          busType: trip ? `${trip.bus.type} coach` : 'Coach',
          originalPrice: l.paid,
          listedPrice: l.price,
          sellerHandle: 'Verified passenger',
          tag: l.price < l.paid ? 'Save' : undefined,
        } satisfies ResaleTicket;
      }),
    );
  }, [data]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);
  return { listings: rows ?? [], ready: rows !== null, reload: load };
}

type R<T = unknown> = { ok: true; data?: T } | { ok: false; reason: string };

export async function buyResale(listingId: string, passenger: { name: string; gender: Gender; phone: string }, contact: { email: string; phone: string }): Promise<R<{ ref: string }>> {
  const { data, error } = await supabase().rpc('buy_resale', { p_listing: listingId, p_passenger: passenger, p_contact: contact });
  if (error) return { ok: false, reason: friendlyError(error) };
  return { ok: true, data: { ref: (data as { ref: string }).ref } };
}

export async function listForResale(bookingId: string, price: number): Promise<R> {
  const { error } = await supabase().rpc('list_for_resale', { p_booking: bookingId, p_price: price });
  return error ? { ok: false, reason: friendlyError(error) } : { ok: true };
}

export async function withdrawListing(listingId: string): Promise<R> {
  const { error } = await supabase().rpc('withdraw_listing', { p_listing: listingId });
  return error ? { ok: false, reason: friendlyError(error) } : { ok: true };
}

export interface MyListing {
  id: string;
  bookingId: string;
  route: string;
  date: string;
  seat: string;
  originalPrice: number;
  listedPrice: number;
  status: 'active' | 'sold' | 'expired';
}

/** The signed-in passenger's own listings (for the account page). */
export function useMyListings(userId?: string | null) {
  const [rows, setRows] = useState<MyListing[]>([]);
  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !userId) return;
    const { data } = await supabase()
      .from('resale_listings')
      .select('id, booking_id, price, status, bookings!resale_listings_booking_id_fkey(from_stop, to_stop, travel_date, seats, total, fee)')
      .eq('seller_id', userId)
      .order('created_at', { ascending: false });
    setRows(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((data as any[]) ?? []).map((l) => ({
        id: l.id,
        bookingId: l.booking_id,
        route: `${l.bookings?.from_stop ?? ''} → ${l.bookings?.to_stop ?? ''}`,
        date: formatDateLabel(l.bookings?.travel_date, false),
        seat: (l.bookings?.seats ?? []).join(', '),
        originalPrice: (l.bookings?.total ?? 0) - (l.bookings?.fee ?? 0),
        listedPrice: l.price,
        status: l.status === 'listed' ? 'active' : l.status === 'sold' ? 'sold' : 'expired',
      })),
    );
  }, [userId]);
  useEffect(() => {
    load();
  }, [load]);
  return { listings: rows, reload: load };
}
