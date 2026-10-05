'use client';
// Reminders for the signed-in passenger's trips while the site/app is open
// (checks every minute): 1 day, 3 hours and 1 hour before boarding, and when
// the trip starts. Each one shows once. The server pushes the same four with
// the same tags (queue_trip_reminders in the database), so a phone that gets
// both shows one. For reminders with the app closed you need that server push;
// see README → Notifications.

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/lib/store';
import { departureDate, formatTime12, getTrip } from '@/lib/trips';
import { notify, subscribeToPush } from '@/lib/pwa';

/** Minutes before boarding. Checked nearest-first; 'start' covers the 20 minutes after. */
const STAGES = [
  { id: 'start', mins: 0 },
  { id: '1h', mins: 60 },
  { id: '3h', mins: 180 },
  { id: '24h', mins: 1440 },
] as const;

export function TripReminders() {
  const { user } = useAuth();
  const { data, ready } = useStore();

  // Keep this browser's push subscription tied to whoever is signed in, so
  // reminders also arrive when the app is closed (sent by the server).
  useEffect(() => {
    if (!user || !('Notification' in window) || Notification.permission !== 'granted') return;
    subscribeToPush();
  }, [user]);

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
        if (mins <= -20 || mins > 1440) continue;
        const stage = STAGES.find((st) => mins <= st.mins)!;
        // The day-before one only near its time, never hours late.
        if (stage.id === '24h' && mins < 1440 - 360) continue;
        // Booked after this reminder's moment: the next one is enough.
        if (new Date(b.createdAt).getTime() > leaves - stage.mins * 60_000) continue;
        const key = `reminded:${b.id}:${stage.id}`;
        try {
          if (localStorage.getItem(key)) continue;
          localStorage.setItem(key, String(now));
        } catch {
          continue;
        }
        const at = formatTime12(trip.departure);
        const what = `${b.from} → ${b.to} · Seat ${b.seats.join(', ')} · ${trip.bus.regNo}.`;
        const text = {
          '24h': [`Your trip is tomorrow at ${at}`, `${what} Your ticket is ready in My trips.`],
          '3h': [`Your bus leaves at ${at}`, `${what} 3 hours to go. Be at the boarding point 20 minutes early.`],
          '1h': ['Your bus leaves in 1 hour', `${what} Leaves ${b.from} at ${at}. Time to head to the boarding point.`],
          start: ['Your trip is starting', `${what} The bus is due at ${b.from} now (${at}). Tap to see where it is.`],
        }[stage.id];
        notify(text[0], {
          body: text[1],
          tag: `trip-${b.id}-${stage.id}`,
          url: stage.id === '1h' || stage.id === 'start' ? `/track?ref=${b.ref}` : `/my-bookings?ref=${b.ref}`,
          requireInteraction: stage.id !== '24h',
        });
      }
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [ready, user, data]);

  return null;
}
