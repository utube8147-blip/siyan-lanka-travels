'use client';
// Tools for one departure. useLocationSharing() is the conductor's: it shares
// the phone's GPS from the conductor page, because that phone is on the bus.
// TripTools is the office version (Departures): it never shares this
// computer's position, which would put the bus at the back office. It shows
// whether the conductor is sharing, and lets the office post updates and scan
// tickets.

import { useEffect, useRef, useState } from 'react';
import { MapPin, Megaphone, QrCode, Radio } from 'lucide-react';
import { useStore } from '@/lib/store';
import { postTripEvent, shareLocation, useLiveTrip, type TripEvent } from '@/lib/extras';
import type { Booking } from '@/lib/types';
import type { Run } from '@/lib/trips';
import { Button, Card, Field, Modal, inputClass, useToast } from './ui';
import { QrScanner } from '@/components/staff/QrScanner';
import { scanTicket } from '@/lib/manifest';

export type SharingStatus = { lastSentAt: number | null; accuracy: number | null; problem: string | null };
const intentKey = (s: string, d: string) => `share-location:${s}|${d}`;

/**
 * Share this phone's GPS for a departure, from the conductor's own phone (no
 * tracker needed). Built for a night on the road:
 *  - sends on movement, plus a heartbeat every 30 s while stopped
 *  - keeps the screen on (Wake Lock) and re-acquires it when the page returns
 *  - resumes by itself after the screen locks, the app is switched, or the
 *    page is reopened (the choice to share is remembered on the phone)
 *  - positions taken with no signal are sent when the connection is back
 * Browsers pause GPS when the page isn't on screen, so keep this page open.
 */
export function useLocationSharing(scheduleId: string, date: string, notify: (msg: string, kind?: 'ok' | 'error') => void) {
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState<SharingStatus>({ lastSentAt: null, accuracy: null, problem: null });
  const watchId = useRef<number | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSent = useRef(0);
  const lastPos = useRef<GeolocationPosition | null>(null);
  const pending = useRef(false);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const active = useRef(false);

  const send = async (pos: GeolocationPosition, force = false) => {
    lastPos.current = pos;
    if (!force && Date.now() - lastSent.current < 15_000) return;
    lastSent.current = Date.now();
    const r = await shareLocation(scheduleId, date, pos);
    if (r.ok) {
      pending.current = false;
      setStatus({ lastSentAt: Date.now(), accuracy: Math.round(pos.coords.accuracy), problem: null });
    } else {
      pending.current = true; // retry when back online / next heartbeat
      setStatus((st) => ({ ...st, problem: navigator.onLine ? r.reason ?? 'Could not send location' : 'No signal: will send when back online' }));
    }
  };

  const keepAwake = async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
      wake.current = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      /* optional */
    }
  };

  const startWatch = () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => send(pos),
      (err) => setStatus((st) => ({ ...st, problem: err.code === 1 ? 'Location permission is off for this site' : 'Looking for GPS signal…' })),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    if (heartbeat.current) clearInterval(heartbeat.current);
    heartbeat.current = setInterval(() => {
      // Standing still sends nothing from watchPosition, so check in every 30 s.
      navigator.geolocation.getCurrentPosition((pos) => send(pos, true), () => lastPos.current && pending.current && send(lastPos.current, true), {
        enableHighAccuracy: true,
        maximumAge: 20_000,
        timeout: 15_000,
      });
    }, 30_000);
  };

  const stopAll = async () => {
    active.current = false;
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    if (heartbeat.current) clearInterval(heartbeat.current);
    heartbeat.current = null;
    await wake.current?.release().catch(() => {});
    wake.current = null;
    setSharing(false);
  };

  const begin = async () => {
    if (!scheduleId || !('geolocation' in navigator)) return false;
    active.current = true;
    await keepAwake();
    startWatch();
    setSharing(true);
    return true;
  };

  // Switching departure: stop, then resume if this phone was sharing it before.
  useEffect(() => {
    stopAll();
    if (!scheduleId) return;
    let resume = false;
    try {
      resume = localStorage.getItem(intentKey(scheduleId, date)) === 'on';
    } catch {
      /* ignore */
    }
    if (resume) begin();
    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      if (heartbeat.current) clearInterval(heartbeat.current);
    };
  }, [scheduleId, date]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back on screen (after a lock or app switch): wake lock + GPS again, send now.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !active.current) return;
      keepAwake();
      startWatch();
      navigator.geolocation.getCurrentPosition((pos) => send(pos, true), () => {}, { enableHighAccuracy: true, timeout: 15_000 });
    };
    const onOnline = () => active.current && lastPos.current && pending.current && send(lastPos.current, true);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }); // re-bind with the latest scheduleId/date

  const toggle = async () => {
    if (sharing) {
      try {
        localStorage.removeItem(intentKey(scheduleId, date));
      } catch {
        /* ignore */
      }
      await stopAll();
      return notify('Stopped sharing location');
    }
    if (!('geolocation' in navigator)) return notify('This phone can\u2019t share its location', 'error');
    try {
      localStorage.setItem(intentKey(scheduleId, date), 'on');
    } catch {
      /* ignore */
    }
    await begin();
    notify('Sharing this phone\u2019s location with passengers. Keep this page open.');
  };

  return { sharing, toggle, status };
}

export function TripTools({ run, bookings }: { run: Run; bookings: Booking[] }) {
  const { updateBooking } = useStore();
  const { toast, Toast } = useToast();
  const { location, events } = useLiveTrip(run.schedule.id, run.date);
  const { confirmPayment } = useStore();
  const [posting, setPosting] = useState<TripEvent['kind'] | null>(null);
  const [scanning, setScanning] = useState(false);
  const stops = run.route.stops.map((s) => s.name);

  const scan = (text: string) =>
    scanTicket(text, bookings, {
      board: (b) => updateBooking(b.id, { status: 'boarded' }),
      takeCash: (b) => confirmPayment(b.id, 'cash'),
    });

  // Where the bus is comes only from the conductor's phone. Checked again every 20 s so "live" turns to "stopped" by itself.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);
  const ageMin = location ? Math.max(0, Math.round((now - new Date(location.updatedAt).getTime()) / 60_000)) : null;
  const live = ageMin !== null && ageMin <= 3;
  const at = location ? new Date(location.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setScanning(true)}><QrCode className="w-4 h-4" /> Scan tickets</Button>
        <Button variant="secondary" onClick={() => setPosting('departed')}><Megaphone className="w-4 h-4" /> Update passengers</Button>
      </div>
      <div role="status" className={`rounded-xl px-3 py-2.5 text-[13px] ${live ? 'bg-[#e8f6ea]' : location ? 'bg-[#feb700]/15' : 'bg-[#f2f4f6]'}`}>
        <p className="flex items-center gap-2 font-bold text-[#050a44]">
          {live ? <Radio className="w-4 h-4 text-[#006e1c] animate-pulse" /> : <MapPin className="w-4 h-4" />}
          {live
            ? `Bus location: live from the conductor's phone (${ageMin === 0 ? 'just now' : `${ageMin} min ago`})`
            : location
              ? `Bus location: the conductor's phone stopped sharing at ${at} (${ageMin! < 90 ? `${ageMin} min` : `${Math.round(ageMin! / 60)} h`} ago)`
              : 'Bus location: the conductor is not sharing it yet'}
        </p>
        <p className="text-[12px] text-[#46464f] mt-0.5">
          {location ? (
            <>
              {live ? 'Passengers see the bus on their ticket. ' : 'Passengers see this last position. '}
              <a href={`https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`} target="_blank" rel="noopener" className="font-semibold text-[#050a44] underline">Open on the map</a>
              {live ? '' : '. Ask the conductor to open the conductor app and turn on Share location.'}
            </>
          ) : (
            'It is shared from the phone on the bus: conductor app, Share location. This computer is never used as the bus position.'
          )}
          {events[0] && ` Last update to passengers: ${events[0].kind}${events[0].stop ? ` (${events[0].stop})` : ''}.`}
        </p>
      </div>

      {posting && <UpdateModal stops={stops} initial={posting} onClose={() => setPosting(null)} onSend={async (ev) => {
        const r = await postTripEvent(run.schedule.id, run.date, ev);
        if (!r.ok) return toast(r.reason ?? 'Could not post', 'error');
        setPosting(null);
        toast('Update sent to passengers');
      }} />}
      {scanning && <QrScanner onClose={() => setScanning(false)} onCode={scan} />}
      <Toast />
    </Card>
  );
}

export function UpdateModal({ stops, initial, onClose, onSend }: { stops: string[]; initial: TripEvent['kind']; onClose: () => void; onSend: (e: Omit<TripEvent, 'id' | 'createdAt'>) => void }) {
  const [kind, setKind] = useState<TripEvent['kind']>(initial);
  const [stop, setStop] = useState(stops[0]);
  const [minutes, setMinutes] = useState(15);
  const [message, setMessage] = useState('');
  const preview =
    kind === 'departed' ? `Your bus has left ${stop}.` : kind === 'delayed' ? `Your bus is running about ${minutes} min late.` : kind === 'arriving' ? `Your bus is about ${minutes} min from ${stop}.` : kind === 'arrived' ? `Your bus has reached ${stop}.` : message;
  return (
    <Modal title="Update passengers" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="gold" disabled={kind === 'note' && message.trim().length < 3} onClick={() => onSend({ kind, stop: kind === 'delayed' || kind === 'note' ? '' : stop, minutes: kind === 'delayed' || kind === 'arriving' ? minutes : null, message: kind === 'note' ? message.trim() : message.trim() })}>Send to everyone on board</Button></>}>
      <div className="grid grid-cols-3 gap-1.5">
        {(['departed', 'delayed', 'arriving', 'arrived', 'note'] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className={`h-10 rounded-lg text-[13px] font-bold border capitalize ${kind === k ? 'bg-[#050a44] text-white border-[#050a44]' : 'border-[#c7c5d1] text-[#46464f]'}`}>{k === 'note' ? 'Message' : k}</button>
        ))}
      </div>
      {kind !== 'delayed' && kind !== 'note' && (
        <Field label="Stop"><select className={inputClass} value={stop} onChange={(e) => setStop(e.target.value)}>{stops.map((s) => <option key={s}>{s}</option>)}</select></Field>
      )}
      {(kind === 'delayed' || kind === 'arriving') && (
        <Field label="Minutes"><input type="number" min={1} className={inputClass} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></Field>
      )}
      <Field label={kind === 'note' ? 'Message' : 'Extra detail (optional)'}><input className={inputClass} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={kind === 'delayed' ? 'e.g. Traffic at Kadawatha' : ''} /></Field>
      <p className="text-[13px] text-[#46464f] bg-[#f2f4f6] rounded-lg p-3">Passengers will see: <b className="text-[#050a44]">{preview}{message && kind !== 'note' ? ` ${message}` : ''}</b></p>
    </Modal>
  );
}
