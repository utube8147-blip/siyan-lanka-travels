'use client';
// lib/pwa.ts — install prompt + notification helpers shared by the UI.

import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from './supabase/client';
import { tx } from '@/lib/i18n';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
declare global {
  interface Window {
    __installPrompt?: InstallEvent | null;
  }
}

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export const isIOS = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

/**
 * Whether the app can be installed right now, and how.
 * - 'prompt': Chrome/Edge/Samsung Internet gave us an install prompt.
 * - 'ios': iPhone/iPad Safari, which only supports Share → Add to Home Screen.
 * - null: already installed, or the browser doesn't offer install.
 */
export function useInstall() {
  const [mode, setMode] = useState<'prompt' | 'ios' | null>(null);
  useEffect(() => {
    const update = () => {
      if (isStandalone()) return setMode(null);
      if (window.__installPrompt) return setMode('prompt');
      setMode(isIOS() ? 'ios' : null);
    };
    update();
    window.addEventListener('installable', update);
    return () => window.removeEventListener('installable', update);
  }, []);

  const install = async (): Promise<'accepted' | 'dismissed' | 'ios' | 'unavailable'> => {
    if (mode === 'ios') return 'ios';
    const p = window.__installPrompt;
    if (!p) return 'unavailable';
    await p.prompt();
    const { outcome } = await p.userChoice;
    // Chrome allows each prompt event to be used once.
    window.__installPrompt = null;
    window.dispatchEvent(new Event('installable'));
    return outcome;
  };
  return { mode, install };
}

export type NotifyState = 'unsupported' | 'default' | 'granted' | 'denied';

export function useNotificationPermission() {
  const [state, setState] = useState<NotifyState>('unsupported');
  useEffect(() => {
    if (!('Notification' in window)) return;
    setState(Notification.permission as NotifyState);
    const sync = () => setState(Notification.permission as NotifyState);
    window.addEventListener('notification-permission', sync);
    // Pick up changes made in the browser's site settings.
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('notification-permission', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  const request = async () => {
    if (!('Notification' in window)) return 'unsupported' as NotifyState;
    const result = (await Notification.requestPermission()) as NotifyState;
    window.dispatchEvent(new Event('notification-permission'));
    if (result === 'granted') await subscribeToPush();
    return result;
  };
  return { state, request };
}

/**
 * Show a notification now (through the service worker when available, so it
 * works on Android and when installed). Does nothing without permission.
 */
export async function notify(title: string, options: NotificationOptions & { url?: string } = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const { url, ...rest } = options;
  const opts: NotificationOptions = {
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon-48.png',
    ...rest,
    data: { url: url ?? '/my-bookings', ...(rest.data as object) },
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, opts);
      return true;
    }
  } catch {
    /* fall back below */
  }
  try {
    new Notification(title, opts);
    return true;
  } catch {
    return false;
  }
}

/**
 * Real push: reminders and updates that arrive when the site is closed.
 * With NEXT_PUBLIC_VAPID_PUBLIC_KEY set, this browser is subscribed and the
 * subscription is saved to the signed-in passenger's account
 * (push_subscriptions); /api/messages/dispatch sends to it. Safe to call
 * often: it reuses the existing subscription. See README → Notifications.
 */
export async function subscribeToPush() {
  return (await registerForPush()).sub;
}
// (Never asks for permission by itself: only registerForPush({ ask: true }), after a tap, does.)

export type PushProblem =
  | 'no_key' | 'bad_key' | 'unsupported' | 'denied' | 'ios_browser' | 'no_worker' | 'push_service' | 'save_failed' | 'unknown';

/** The public push key as built into the site, tidied (stray quotes or spaces from pasting it). */
function publicKey() {
  return (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim().replace(/^['"]|['"]$/g, '').trim();
}

/** A valid public key is 65 bytes starting with 0x04 (87 characters, starting with "B"). */
function keyBytes(key: string) {
  try {
    const b = urlBase64ToUint8Array(key);
    return b.length === 65 && b[0] === 4 ? b : null;
  } catch {
    return null;
  }
}

/** The service worker, registering it again if it isn't there (gives up after 10 s). */
async function worker(): Promise<ServiceWorkerRegistration | null> {
  try {
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) reg = await navigator.serviceWorker.register(process.env.NODE_ENV === 'production' ? '/sw.js' : '/sw.js?dev=1');
    return await Promise.race([navigator.serviceWorker.ready, new Promise<null>((ok) => setTimeout(() => ok(null), 10000))]);
  } catch {
    return null;
  }
}

/**
 * Subscribes this browser and saves it to the signed-in account, and says
 * exactly what went wrong when it can't. Repairs the usual case on its own:
 * an old subscription made with other server keys is thrown away and made again.
 */
export async function registerForPush({ ask = false }: { ask?: boolean } = {}): Promise<{ sub: PushSubscription | null; problem: PushProblem | null; detail?: string }> {
  const key = publicKey();
  if (!key) return { sub: null, problem: 'no_key' };
  const bytes = keyBytes(key);
  if (!bytes) return { sub: null, problem: 'bad_key' };
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { sub: null, problem: isIOS() && !isStandalone() ? 'ios_browser' : 'unsupported' };
  }
  if (Notification.permission === 'denied') return { sub: null, problem: 'denied' };
  if (Notification.permission === 'default') {
    if (!ask) return { sub: null, problem: 'denied' };
    const r = await Notification.requestPermission();
    window.dispatchEvent(new Event('notification-permission'));
    if (r !== 'granted') return { sub: null, problem: 'denied' };
  }
  const reg = await worker();
  if (!reg) return { sub: null, problem: 'no_worker' };
  let sub: PushSubscription | null = null;
  try {
    sub = await reg.pushManager.getSubscription();
    // Made with a different key (the keys were changed): it can never receive. Start again.
    const old = sub?.options?.applicationServerKey;
    if (sub && old && !sameBytes(new Uint8Array(old), bytes)) {
      await sub.unsubscribe();
      sub = null;
    }
  } catch {
    sub = null;
  }
  if (!sub) {
    const make = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    try {
      sub = await make();
    } catch (e) {
      // "A subscription with a different key already exists": drop it, try once more.
      try {
        const stale = await reg.pushManager.getSubscription();
        if (stale) await stale.unsubscribe();
        sub = await make();
      } catch (e2) {
        const err = (e2 || e) as Error;
        return { sub: null, problem: err?.name === 'NotAllowedError' ? 'denied' : 'push_service', detail: `${err?.name ?? 'Error'}: ${err?.message ?? ''}`.slice(0, 200) };
      }
    }
  }
  const json = sub.toJSON();
  if (isSupabaseConfigured && json.endpoint && json.keys?.p256dh && json.keys?.auth) {
    try {
      const { data } = await supabase().auth.getSession();
      // Not signed in yet: TripReminders calls this again after sign-in.
      if (data.session) {
        const { error } = await supabase().rpc('save_push_subscription', { p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth });
        if (error) return { sub, problem: 'save_failed', detail: error.message.slice(0, 200) };
      }
    } catch (e) {
      return { sub, problem: 'save_failed', detail: String((e as Error)?.message ?? e).slice(0, 200) };
    }
  }
  return { sub, problem: null };
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** What to tell the person when this device can't be registered. */
export function pushProblemText(problem: PushProblem, detail?: string) {
  const brave = typeof navigator !== 'undefined' && (navigator as Navigator & { brave?: unknown }).brave;
  switch (problem) {
    case 'no_key':
      return tx('Push is not set up on this site: the public push key (NEXT_PUBLIC_VAPID_PUBLIC_KEY) was missing when it was built. Add it in the hosting settings and redeploy.');
    case 'bad_key':
      return tx('The public push key on this site is not a valid key. In the hosting settings, NEXT_PUBLIC_VAPID_PUBLIC_KEY must be the public key (87 characters, starting with B), with no quotes; then redeploy.');
    case 'ios_browser':
      return tx('On iPhone, notifications only work in the installed app: add Siyan Lanka to your Home Screen, open it from there, then turn reminders on.');
    case 'unsupported':
      return tx('This browser can\'t receive push notifications. Try Chrome, Edge, Firefox or Safari.');
    case 'denied':
      return tx('Notifications are blocked for this site. Allow them in the browser\'s site settings (the icon next to the address), then try again.');
    case 'no_worker':
      return tx('The app\'s background helper (service worker) did not start. Reload the page and try again.');
    case 'push_service':
      return brave
        ? tx('Brave blocks push by default. Turn on “Use Google services for push messaging” in Brave settings → Privacy and security, restart Brave, then try again.')
        : tx('The browser\'s push service refused to register this device ({detail}). Try again in a minute; in a private window push doesn\'t work.', { detail: detail || '?' });
    case 'save_failed':
      return tx('This device registered, but it could not be saved to your account ({detail}). Run the latest database update, then try again.', { detail: detail || '?' });
    default:
      return tx('This device could not register for push. Check that notifications are allowed for this site, then try again.');
  }
}

/** On sign-out: stop sending this account's notifications to this browser. */
export async function forgetPushSubscription() {
  try {
    if (!isSupabaseConfigured || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) await supabase().rpc('remove_push_subscription', { p_endpoint: sub.endpoint });
  } catch {
    /* best effort */
  }
}

/** Drop the offline copies of pages (public/sw.js keeps them in "sl-pages-…"), e.g. on sign-out. */
export async function clearPageCache() {
  try {
    if (typeof caches === 'undefined') return;
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('sl-pages-')).map((k) => caches.delete(k)));
  } catch {
    /* best effort */
  }
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Throws away this browser's push subscription and makes a fresh one. Needed
 * when the saved one was made with different server keys (the push service
 * then refuses every message), e.g. after the keys were changed.
 */
export async function resubscribeToPush() {
  try {
    const reg = await worker();
    const existing = await reg?.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();
  } catch {
    /* fall through to a normal subscribe */
  }
  return subscribeToPush();
}

export type ServerPushTest = { ok: boolean; message: string };

/**
 * A real push, sent by the server to this person's devices through the same
 * path as trip reminders, with the reason in plain words when it can't arrive.
 * (The older "test" only asked this browser to show a notification itself,
 * which works even when server push is broken.)
 */
export async function testServerPush(): Promise<ServerPushTest> {
  const attempt = async () => {
    const res = await fetch('/api/messages/push-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true }) });
    return (await res.json().catch(() => ({}))) as { devices?: number; delivered?: number; problem?: string | null; code?: number | null };
  };
  // Make sure this device is registered to the signed-in person first.
  const reg = await registerForPush({ ask: true });
  if (reg.problem) return { ok: false, message: pushProblemText(reg.problem, reg.detail) };
  let r = await attempt();
  // Registered with other keys, or not saved yet: register again from scratch and try once more.
  if (r.problem === 'key_mismatch' || r.problem === 'no_device' || r.problem === 'refused') {
    await resubscribeToPush();
    r = await attempt();
  }
  if ((r.delivered ?? 0) > 0) return { ok: true, message: tx('Sent from the server. It should appear within a few seconds. If it does, reminders will reach this device.') };
  const why: Record<string, string> = {
    signed_out: 'Sign in first: reminders are sent to your account.',
    no_database: 'The site is not connected to its database.',
    no_secret_key: 'The server is missing its database key (SUPABASE_SECRET_KEY) in the hosting settings.',
    no_keys: 'The server\'s push keys are missing or not valid. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (a matching pair, no quotes) in the hosting settings and redeploy.',
    no_table: 'The database is missing the push tables. Run the latest database update.',
    no_device: 'This device is not saved to your account yet. Turn reminders off and on again for this site, then test again.',
    key_mismatch: "The push service refused the server's keys: the public and private push keys on the server don't belong together, or were changed. Check both keys in the hosting settings.",
    refused: `The push service did not accept the message${r.code ? ` (code ${r.code})` : ''}. Try again in a minute.`,
  };
  return { ok: false, message: why[r.problem ?? ''] ?? tx('The server could not send it. Try again in a minute.') };
}
