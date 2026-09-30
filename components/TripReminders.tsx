'use client';
// Sends "your bus leaves soon" reminders for the signed-in passenger's trips
// while the site/app is open (checks every minute). Each trip is reminded once.
// For reminders when the app is fully closed you need server push; see README.

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/lib/store';
import { departureDate, formatTime12, getTrip } from '@/lib/trips';
import { notify } from '@/lib/pwa';

const HOURS_BEFORE = 3;

export function TripReminders() {
  const { user } = useAuth();
  const { data, ready } = useStore();

  useEffect(() => {
    if (!ready || !user || !('Notification' in window)) return;
    const check = () => {
      if (Notification.permission !== 'granted') return;
      const now = Date.now();
      for (const b of data.bookings) {
        if (b.userId !== user.id || b.status !== 'confirmed') continue;
        const trip = getTrip(data, b.scheduleId, b.date, b.from, b.to);
        if (!trip) continue;
        const leaves = departureDate(trip.boardingDate, trip.departure).getTime();
        const mins = (leaves - now) / 60_000;
        if (mins <= 0 || mins > HOURS_BEFORE * 60) continue;
        const key = `reminded:${b.id}`;
        try {
          if (localStorage.getItem(key)) continue;
          localStorage.setItem(key, String(now));
        } catch {
          continue;
        }
        notify(`Your bus leaves at ${formatTime12(trip.departure)}`, {
          body: `${b.from} → ${b.to} · Seat ${b.seats.join(', ')} · ${trip.bus.regNo}. Be at the boarding point 20 minutes early.`,
          tag: `trip-${b.id}`,
          url: '/my-bookings',
          requireInteraction: true,
        });
      }
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [ready, user, data]);

  return null;
}
