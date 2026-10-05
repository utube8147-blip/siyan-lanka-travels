'use client';
// The bell on a trip: reminders on or off for that one booking (1 day, 3 hours
// and 1 hour before, trip started, and the conductor's updates). The first
// tap also asks the browser for permission, because nothing can be shown
// without it. Texts are not affected. Database: migration 29.

import { useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { isIOS, isStandalone, notify, subscribeToPush, useNotificationPermission } from '@/lib/pwa';
import { friendlyError, isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';

export function TripBell({ bookingId, className = '', size = 'md' }: { bookingId: string; className?: string; /** 'sm' matches the small buttons on the trip cards. */ size?: 'sm' | 'md' }) {
  const { data, updateBooking, reload } = useStore();
  const { state, request } = useNotificationPermission();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const booking = data.bookings.find((b) => b.id === bookingId);
  if (!booking) return null;

  const wanted = booking.notify !== false; // what the passenger chose for this trip
  const on = wanted && state === 'granted'; // …and this device can actually show them

  const save = async (next: boolean) => {
    if (!isSupabaseConfigured) {
      await updateBooking(bookingId, { notify: next });
      return true;
    }
    const { error } = await supabase().rpc('set_trip_notifications', { p_booking: bookingId, p_on: next });
    if (error) {
      setNote(/set_trip_notifications|schema cache/i.test(error.message ?? '') ? 'Not available yet: the database needs its latest update.' : friendlyError(error));
      return false;
    }
    await reload();
    return true;
  };

  const tap = async () => {
    setNote(null);
    if (on) {
      setBusy(true);
      if (await save(false)) setNote('Reminders are off for this trip. You still get texts.');
      return setBusy(false);
    }
    if (state === 'unsupported') {
      return setNote(isIOS() && !isStandalone() ? 'On iPhone, add Siyan Lanka to your Home Screen (Share, then Add to Home Screen), open it from there and tap the bell again.' : "This browser can't show notifications. You still get texts.");
    }
    if (state === 'denied') return setNote('Notifications are blocked for this site. Allow them in the browser settings (the icon beside the address), then tap the bell again.');
    setBusy(true);
    const permission = state === 'granted' ? 'granted' : await request();
    if (permission !== 'granted') {
      setBusy(false);
      return setNote(permission === 'denied' ? 'Notifications were blocked. Allow them in the browser settings to get reminders.' : 'Reminders are still off: the browser was not given permission.');
    }
    await subscribeToPush();
    if (await save(true)) {
      setNote('Reminders are on for this trip.');
      notify('Reminders are on for this trip', { body: `${booking.from} to ${booking.to}: the day before, 3 hours and 1 hour before, and when the bus sets off.`, tag: `bell-${bookingId}` });
    }
    setBusy(false);
  };

  const Icon = on ? BellRing : state === 'denied' ? BellOff : Bell;
  return (
    <span className={`inline-flex flex-col items-stretch gap-1 min-w-0 ${className}`}>
      <button
        type="button"
        onClick={tap}
        disabled={busy}
        aria-pressed={on}
        className={`inline-flex items-center justify-center gap-1.5 rounded-xl ${size === 'sm' ? 'px-2 sm:px-3' : 'px-3'} font-bold whitespace-nowrap border ${size === 'sm' ? 'h-[38px] text-[12px]' : 'h-10 text-[13px]'} transition-colors disabled:opacity-60 ${on ? 'bg-[#e8f6ea] border-[#006e1c]/30 text-[#006e1c]' : 'bg-white border-[#c7c5d1] text-[#050a44] hover:bg-[#f2f4f6]'}`}
      >
        <Icon className="w-4 h-4 shrink-0" /> {busy ? 'One moment…' : on ? 'Reminders on' : 'Remind me'}
      </button>
      {note && <span role="status" className="text-[12px] text-[#46464f] max-w-[260px] leading-snug">{note}</span>}
    </span>
  );
}
