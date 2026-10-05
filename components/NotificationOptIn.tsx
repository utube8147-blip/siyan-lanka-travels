'use client';
// "Trip reminders" opt-in. Chrome only allows asking for notification
// permission after the visitor taps something, so this is a button, never an
// automatic pop-up. Handles every state: not asked, on, blocked, and iPhone
// (where the app must be on the Home Screen before notifications work).

import { useState } from 'react';
import { Bell, BellOff, BellRing, Check } from 'lucide-react';
import { isIOS, isStandalone, notify, testServerPush, useNotificationPermission, type ServerPushTest } from '@/lib/pwa';

export function NotificationOptIn({ compact = false }: { compact?: boolean }) {
  const { state, request } = useNotificationPermission();
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<ServerPushTest | null>(null);
  const iosNeedsInstall = typeof window !== 'undefined' && isIOS() && !isStandalone() && state === 'unsupported';

  const turnOn = async () => {
    setBusy(true);
    const r = await request();
    setBusy(false);
    if (r === 'granted') notify('Trip reminders are on', { body: "We'll remind you the day before, 3 hours and 1 hour before your bus leaves, and when it sets off.", tag: 'reminders-on' });
  };

  const wrap = compact ? 'rounded-xl bg-[#f2f4f6] border border-[#e1e2e4] p-4' : 'bg-white rounded-2xl p-[20px] shadow-sm border border-[#c7c5d1]';

  if (state === 'unsupported' && !iosNeedsInstall) return null;

  return (
    <div className={wrap}>
      <div className="flex items-start gap-3">
        <span
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
            state === 'granted' ? 'bg-[#e8f6ea] text-[#006e1c]' : state === 'denied' ? 'bg-[#ba1a1a]/10 text-[#ba1a1a]' : 'bg-[#feb700]/15 text-[#7c5800]'
          }`}
          aria-hidden
        >
          {state === 'granted' ? <BellRing className="w-[18px] h-[18px]" /> : state === 'denied' ? <BellOff className="w-[18px] h-[18px]" /> : <Bell className="w-[18px] h-[18px]" />}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="font-bold text-[#050a44] text-[14px]">{state === 'granted' ? 'Trip reminders are on' : 'Trip reminders'}</h4>

          {state === 'default' && (
            <>
              <p className="text-[12px] text-[#46464f] mt-1">Get a notification when your booking is confirmed, the day before, 3 hours and 1 hour before your bus leaves, and when the trip starts.</p>
              <button
                onClick={turnOn}
                disabled={busy}
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#050a44] text-white text-[12px] font-bold hover:opacity-90 disabled:opacity-60"
              >
                <Bell className="w-3.5 h-3.5" /> {busy ? 'Waiting for your answer…' : 'Turn on reminders'}
              </button>
            </>
          )}

          {state === 'granted' && (
            <>
              <p className="text-[12px] text-[#46464f] mt-1">We&apos;ll notify you on this device before each trip.</p>
              {/* A real push from the server, through the same path as reminders: if this arrives, they will. */}
              <button
                disabled={testing}
                onClick={async () => {
                  setTesting(true);
                  setTest(null);
                  setTest(await testServerPush());
                  setTesting(false);
                }}
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-[#050a44] hover:underline disabled:opacity-60"
              >
                {testing ? 'Sending…' : 'Send a test from the server'}
              </button>
              {test && (
                <p role="status" className={`mt-2 text-[12px] leading-snug ${test.ok ? 'text-[#006e1c]' : 'text-[#ba1a1a]'}`}>
                  {test.ok && <Check className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />}
                  {test.message}
                </p>
              )}
            </>
          )}

          {state === 'denied' && (
            <p className="text-[12px] text-[#46464f] mt-1">
              Notifications are blocked for this site. In Chrome, tap the icon to the left of the web address, open <strong>Site settings</strong> (or <strong>Permissions</strong>), set
              <strong> Notifications</strong> to <strong>Allow</strong>, then reload.
            </p>
          )}

          {iosNeedsInstall && (
            <p className="text-[12px] text-[#46464f] mt-1">
              On iPhone, add Siyan Lanka to your Home Screen first (Share → Add to Home Screen), then open it from there to turn on reminders.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
