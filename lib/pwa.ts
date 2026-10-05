'use client';
// lib/pwa.ts — install prompt + notification helpers shared by the UI.

import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from './supabase/client';

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
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key || !('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      }));
    const json = sub.toJSON();
    if (isSupabaseConfigured && json.endpoint && json.keys?.p256dh && json.keys?.auth) {
      const { data } = await supabase().auth.getSession();
      // Not signed in yet: TripReminders calls this again after sign-in.
      if (data.session) await supabase().rpc('save_push_subscription', { p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth });
    }
    return sub;
  } catch {
    return null;
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
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
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
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return { ok: false, message: 'Push is not set up on this site: the public push key (NEXT_PUBLIC_VAPID_PUBLIC_KEY) was missing when it was built. Add it in the hosting settings and redeploy.' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return { ok: false, message: "This browser can't receive push notifications. On iPhone, open the app from the Home Screen icon." };
  const attempt = async () => {
    const res = await fetch('/api/messages/push-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true }) });
    return (await res.json().catch(() => ({}))) as { devices?: number; delivered?: number; problem?: string | null; code?: number | null };
  };
  // Make sure this device is registered to the signed-in person first.
  if (!(await subscribeToPush())) return { ok: false, message: 'This device could not register for push. Check that notifications are allowed for this site, then try again.' };
  let r = await attempt();
  // Registered with other keys, or not saved yet: register again from scratch and try once more.
  if (r.problem === 'key_mismatch' || r.problem === 'no_device' || r.problem === 'refused') {
    await resubscribeToPush();
    r = await attempt();
  }
  if ((r.delivered ?? 0) > 0) return { ok: true, message: 'Sent from the server. It should appear within a few seconds. If it does, reminders will reach this device.' };
  const why: Record<string, string> = {
    signed_out: 'Sign in first: reminders are sent to your account.',
    no_database: 'The site is not connected to its database.',
    no_secret_key: 'The server is missing its database key (SUPABASE_SECRET_KEY) in the hosting settings.',
    no_keys: 'The server has no push keys. Add NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in the hosting settings and redeploy.',
    no_table: 'The database is missing the push tables. Run the latest database update.',
    no_device: 'This device is not saved to your account yet. Turn reminders off and on again for this site, then test again.',
    key_mismatch: "The push service refused the server's keys: the public and private push keys on the server don't belong together, or were changed. Check both keys in the hosting settings.",
    refused: `The push service did not accept the message${r.code ? ` (code ${r.code})` : ''}. Try again in a minute.`,
  };
  return { ok: false, message: why[r.problem ?? ''] ?? 'The server could not send it. Try again in a minute.' };
}
