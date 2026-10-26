// /app/(public)/(passenger)/payment/page.tsx
'use client';
import { useBikeConfig } from '@/lib/useBikeConfig';
import { bikeKind } from '@/lib/bikeConfig';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OPERATOR } from '@/config/operator';
import { useQrDataUrl } from '@/lib/qr';
import { NotificationOptIn } from '@/components/NotificationOptIn';
import { SuccessCheck } from '@/components/motion/SuccessCheck';
import { useLoyalty, usePublicSettings, useSavedPassengers, whatsappShareUrl } from '@/lib/extras';
import { addDays as addDaysIso } from '@/lib/trips';
import { isStandalone, notify } from '@/lib/pwa';
import { mockPaymentsOn } from '@/lib/mockVerification';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { InstallAppButton } from '@/components/InstallAppButton';
import { useAuth } from '@/contexts/AuthContext';
import { useStore, StoreLoading } from '@/lib/store';
import { formatDateLabel, formatLKR, formatTime12, getTrip, todayISO } from '@/lib/trips';
import type { BikeItem, Gender } from '@/lib/types';
import { useT, txr, txn } from '@/lib/i18n';
import { useBookingCode, CODE_CANCELLED } from '@/components/BookingCodeGate';
import { PaymentSlipCard } from '@/components/trip/PaymentSlipCard';
import { SLIP_ACCEPT, submitSlip } from '@/lib/money';
import { tx } from '@/lib/i18n';

import { fmtDate } from '@/lib/dates';
type PaymentMethod = 'card' | 'bank';
type PayState = 'idle' | 'processing' | 'success';

interface Passenger {
  name: string;
  gender: string;
  phone: string;
}

export default function PaymentPage() {
  return (
    <React.Suspense fallback={<StoreLoading />}>
      <PaymentPageInner />
    </React.Suspense>
  );
}

function PaymentPageInner() {
  const { t } = useT();
  const router = useRouter();
  const searchParams = useSearchParams();

  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const date = searchParams.get('date') || todayISO();
  const { data, ready, createBooking, reload } = useStore();
  const bookingCode = useBookingCode();
  const { user, mode: authMode, isLoading: authLoading } = useAuth();
  // With real accounts, bookings belong to a signed-in passenger.
  useEffect(() => {
    if (authMode === 'supabase' && !authLoading && !user) {
      router.replace(`/auth/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
  }, [authMode, authLoading, user, router]);
  const scheduleId = searchParams.get('scheduleId') || '';
  const seats = (searchParams.get('seats') || '').split(',').filter(Boolean);
  const pickup = searchParams.get('pickup') || from;
  const drop = searchParams.get('drop') || to;
  const contactEmail = searchParams.get('contactEmail') || '';
  const contactPhone = searchParams.get('contactPhone') || '';
  const promo = searchParams.get('promo');

  const passengers: Passenger[] = useMemo(() => {
    const raw = searchParams.get('passengers');
    if (!raw) return [];
    try {
      return JSON.parse(decodeURIComponent(raw));
    } catch {
      return [];
    }
  }, [searchParams]);

  // Once paid, the booking's own seats show as taken — freeze the trip at that point.
  const [paidTrip, setPaidTrip] = useState<ReturnType<typeof getTrip>>(null);
  const liveTrip = useMemo(() => (ready ? getTrip(data, scheduleId, date, from, to) : null), [ready, data, scheduleId, date, from, to]);
  const trip = paidTrip ?? liveTrip;

  const pub = usePublicSettings();
  useBikeConfig(); // bike fees follow Settings → Bikes
  const seatPrice = trip ? trip.fare : 0;
  const platformFee = pub.bookingFee;
  const basePrice = seats.length * seatPrice;
  // The promo: shown and applied by itself when it applies (Settings: code, percent, first trip only,
  // installed app only). The database checks the same rules, so nobody gets it by typing it in.
  const [inApp, setInApp] = useState(false);
  useEffect(() => setInApp(isStandalone()), []);
  const earlierTrips = user ? data.bookings.filter((b) => b.userId === user.id && b.status !== 'cancelled').length : 0;
  const promoRulesOk = !!pub.promoCode && pub.promoPercent > 0 && (!pub.promoFirstOrder || earlierTrips === 0);
  const promoEligible = promoRulesOk && (!pub.promoAppOnly || inApp);
  const promoNeedsApp = promoRulesOk && pub.promoAppOnly && !inApp;
  const [promoOn, setPromoOn] = useState(true);
  const promoApplied = promoEligible && promoOn && (!promo || promo.toUpperCase() === pub.promoCode?.toUpperCase());
  const discount = promoApplied ? Math.round((basePrice * pub.promoPercent) / 100) : 0;
  // Bikes chosen on the seat page (photos travel via sessionStorage).
  const [bikes, setBikes] = useState<BikeItem[]>([]);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(`bikes:${scheduleId}:${date}`);
      if (raw) setBikes(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, [scheduleId, date]);
  const bikeTotal = bikes.reduce((n, b) => n + b.fee, 0);
  // Online, a seat is sold only when it's paid: through the payment gateway (card or mobile wallet),
  // or by bank transfer with the slip. The gateway is PayHere when it's live; on your own computer
  // with NEXT_PUBLIC_MOCK_PAYMENTS=true it's a test page; in demo mode (no database) it's simulated.
  const payhereLive = pub.paymentsMode === 'payhere';
  const mockGateway = mockPaymentsOn();
  const cardOpen = payhereLive ? pub.cardPayments : mockGateway || !isSupabaseConfigured;
  const [method, setMethod] = useState<PaymentMethod>('bank');
  const [picked, setPicked] = useState(false);
  useEffect(() => {
    if (!picked && cardOpen) setMethod('card');
    if (!cardOpen && method === 'card') setMethod('bank');
  }, [cardOpen, picked, method]);
  const loyalty = useLoyalty(user?.id);
  const [useReward, setUseReward] = useState(false);
  const rewardOff = useReward && (loyalty?.available ?? 0) > 0 ? Math.min(seatPrice, basePrice - discount) : 0;
  // What goes through the gateway also pays its cut (Settings → card fee); none for bank transfer.
  const subtotal = basePrice - discount - rewardOff + bikeTotal + platformFee;
  const gatewayFee = method === 'card' && subtotal > 0 ? Math.ceil((subtotal * pub.gatewayFeePercent) / 100) : 0;
  const totalPrice = subtotal + gatewayFee;

  const [payState, setPayState] = useState<PayState>('idle');
  const [bookingRef, setBookingRef] = useState('');
  const [error, setError] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  const holdMethod = method === 'bank';
  const saved = useSavedPassengers(user?.id);
  const [heldUntil, setHeldUntil] = useState<string | null>(null);
  // Bank transfer: a slip chosen here is uploaded as soon as the seat is held.
  const slipInput = useRef<HTMLInputElement>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipRef, setSlipRef] = useState('');
  const [slipNote, setSlipNote] = useState('');
  const canPay = !!trip && seats.length > 0 && (method === 'bank' || cardOpen);

  const handlePay = () => {
    setError('');
    if (!canPay) return;
    setPayState('processing');
    void (async () => {
      if (!trip) return;
      const lead = passengers[0];
      // Asks for the one-time code first when the database requires it.
      const result = await bookingCode.run(() => createBooking({
        scheduleId: trip.scheduleId,
        date,
        from: trip.from,
        to: trip.to,
        seats,
        passenger: {
          name: lead?.name || tx('Passenger'),
          gender: (lead?.gender as Gender) || '',
          phone: lead?.phone || contactPhone,
        },
        contact: { email: contactEmail, phone: contactPhone },
        userId: user?.role === 'passenger' ? user.id : undefined,
        channel: 'online',
        fare: seatPrice,
        fee: platformFee,
        gatewayFee,
        bikes: bikes.length ? bikes : undefined,
        bikeFee: bikeTotal || undefined,
        discount,
        total: totalPrice,
        promo: promoApplied ? pub.promoCode ?? undefined : undefined,
        inApp,
        payment: method,
        useReward: useReward && (loyalty?.available ?? 0) > 0,
      }), contactPhone);
      if (!result.ok) {
        setPayState('idle');
        // Only a seat problem is fixed by picking another seat; anything else just says what went wrong.
        setError(result.reason === CODE_CANCELLED ? tx(CODE_CANCELLED) : /seat/i.test(result.reason ?? '') && !/hold|reserve/i.test(result.reason ?? '') ? tx('{reason} Go back and pick another seat. You have not been charged.', { reason: result.reason }) : tx('{reason} You have not been charged.', { reason: result.reason }));
        return;
      }
      // Already transferred: send the slip with the booking, so the office can check it straight away.
      if (method === 'bank' && slipFile && result.booking.status === 'held') {
        const up = await submitSlip(result.booking, slipFile, slipRef.trim());
        setSlipNote(up.ok ? '' : tx("Your seat is held, but the slip didn't upload ({reason}). Upload it below.", { reason: up.reason ?? tx('try again') }));
        // Re-read the booking so the next screen shows "Slip received" and doesn't ask for it again.
        if (up.ok) await reload();
      }
      setPaidTrip(trip);
      saved.remember({ name: lead?.name || '', gender: (lead?.gender as Gender) || '', phone: lead?.phone || contactPhone });
      // Test gateway on your own computer: choose there whether the payment goes through.
      if (result.booking.status === 'held' && method === 'card' && !payhereLive && mockGateway) {
        router.push(`/mock-gateway?${new URLSearchParams({ ref: result.booking.ref, amount: String(result.booking.total) })}`);
        return;
      }
      // PayHere live: the booking is held; send the passenger to PayHere to pay.
      if (result.booking.status === 'held' && !holdMethod) {
        const res = await fetch('/api/payhere/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId: result.booking.id }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setPayState('idle');
          setError(j.error ?? tx('Could not start the payment. Your seat is held for 20 minutes; try again from My trips.'));
          return;
        }
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = j.action;
        Object.entries(j.fields as Record<string, string>).forEach(([k, v]) => {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = k;
          input.value = v;
          form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
        return;
      }
      setHeldUntil(result.booking.status === 'held' ? result.booking.holdExpiresAt ?? null : null);
      notify(tx('Booking confirmed'), {
        body: tx('{from} → {to}, {date} at {time} · Seat {seats} · {ref}', { from: trip.from, to: trip.to, date: formatDateLabel(trip.boardingDate), time: formatTime12(trip.departure), seats: seats.join(', '), ref: result.booking.ref }),
        tag: `booking-${result.booking.id}`,
        url: '/my-bookings',
      });
      try {
        window.sessionStorage.removeItem(`bikes:${scheduleId}:${date}`);
      } catch {
        /* ignore */
      }
      setBookingRef(result.booking.ref);
      setPayState('success');
    })();
  };

  const qrPayload = useMemo(() => {
    if (!trip || !bookingRef) return '';
    return JSON.stringify({
      ref: bookingRef,
      route: `${from}-${to}`,
      seats,
      operator: OPERATOR.name,
    });
  }, [trip, bookingRef, from, to, seats]);

  const qrImageUrl = useQrDataUrl(qrPayload);

  const handleDownload = async () => {
    if (!qrImageUrl) return;
    setIsDownloading(true);
    try {
      const res = await fetch(qrImageUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${bookingRef || 'ticket'}-qr.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(tx('Could not download the ticket right now.'));
    } finally {
      setIsDownloading(false);
    }
  };

  const passengerNames = passengers.map((p) => p.name).filter(Boolean).join(', ') || '—';

  if (!ready) return <StoreLoading />;

  if (!trip) {
    return (
      <main className="max-w-[600px] mx-auto px-4 py-[64px] text-center">
        <p className="text-[16px] font-semibold text-[#46464f]">{tx('We couldn\'t find that trip. Please start your booking again.')}</p>
        <button
          onClick={() => router.push('/search')}
          className="mt-[16px] px-6 py-3 bg-black text-white rounded-xl font-bold text-sm"
        >{tx('Back to Search')}</button>
      </main>
    );
  }

  if (payState === 'success') {
        return (
        <main className="max-w-[1200px] mx-auto px-4 md:px-[64px] py-[40px]">
            {/* Success Banner */}
            <div className="flex flex-col items-center justify-center text-center mb-[32px]">
            <div className="mb-[14px]">
                <SuccessCheck size={68} />
            </div>
            <h1 className="text-[24px] font-bold mb-[4px]">{heldUntil ? t('Seat held') : t('Booking Confirmed!')}</h1>
            <p className="text-[14px] text-[#46464f] max-w-xl">
                {heldUntil ? (
                  <>
                    {txr("Pay <b>{amount}</b> by <b2>{until}</b2> to {bankDetails}, reference {bookingRef}. We've texted you the details.", { amount: formatLKR(totalPrice), until: fmtDate(new Date(heldUntil), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), bankDetails: pub.bankDetails, bookingRef, b: (c) => <span className="font-bold">{c}</span>, b2: (c) => <span className="font-bold">{c}</span> })}
                  </>
                ) : (
                  <>{tx('Your ticket is in My trips and we\'ve texted you the details. Show the QR code when you board.')}</>
                )}
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              <a
                href={whatsappShareUrl(`My Siyan Lanka bus ticket ${bookingRef}: ${trip.from} → ${trip.to}, ${formatDateLabel(trip.boardingDate)} at ${formatTime12(trip.departure)}, seat ${seats.join(', ')}. ${OPERATOR.siteUrl}/my-bookings`)}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#25D366] text-white text-[14px] font-bold"
              >
                <span className="material-symbols-outlined text-[18px]">chat</span> {t('Share on WhatsApp')}
              </a>
              <a
                href={`/search?${new URLSearchParams({ from: trip.to, to: trip.from, date: addDaysIso(trip.boardingDate, 2) }).toString()}`}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-[#c7c5d1] text-[#050a44] text-[14px] font-bold"
              >
                <span className="material-symbols-outlined text-[18px]">swap_horiz</span> {t('Book your return trip')}
              </a>
            </div>
            {/* Bank transfer: upload the slip straight away (also possible later from My trips). */}
            {method === 'bank' && heldUntil && (
              <div className="mt-5 text-left">
                {slipNote && <p role="alert" className="mb-2 text-[13px] font-semibold text-[#ba1a1a]">{slipNote}</p>}
                <PaymentSlipCard />
              </div>
            )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-[24px] items-stretch">
            {/* Main ticket + info */}
            <div className="lg:col-span-8 flex flex-col gap-[24px] lg:h-full">
                {/* E-Ticket Card */}
                <div className="bg-white rounded-xl shadow-sm border border-[#c7c5d1] overflow-hidden">
                <div className="px-[24px] py-[16px] bg-[#f2f4f6] flex justify-between items-center border-b border-[#c7c5d1]">
                    <div>
                    <h3 className="text-[16px] font-semibold">{OPERATOR.name}</h3>
                    <p className="text-[11px] text-[#46464f]">{tx('Bus No. {scheduleId}', { scheduleId: scheduleId.toUpperCase() })}</p>
                    </div>
                    <div className="text-right">
                    <span className="bg-[#feb700]/20 text-[#6b4b00] px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide">
                        {trip.bus.type} · {trip.bus.name}
                    </span>
                    <p className="mt-[6px] text-[11px] text-[#46464f]">{tx('PNR: {bookingRef}', { bookingRef })}</p>
                    </div>
                </div>

                <div className="p-[24px] grid grid-cols-1 md:grid-cols-3 gap-[24px]">
                    <div className="flex flex-col">
                    <span className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-1">{tx('Departure')}</span>
                    <span className="text-[18px] font-semibold">{pickup}</span>
                    <span className="text-[13px] text-[#46464f]">{formatDateLabel(trip.boardingDate)} • {formatTime12(trip.departure)}</span>
                    </div>

                    <div className="flex flex-col items-center justify-center py-2 md:py-0">
                    <div className="w-full flex items-center gap-2">
                        <div className="h-px flex-1 border-b-2 border-dashed border-[#c7c5d1]"></div>
                        <span className="material-symbols-outlined text-[#46464f]">directions_bus</span>
                        <div className="h-px flex-1 border-b-2 border-dashed border-[#c7c5d1]"></div>
                    </div>
                    <span className="text-[11px] text-[#46464f] mt-[8px]">{from} → {to}</span>
                    </div>

                    <div className="flex flex-col md:text-right">
                    <span className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-1">{tx('Arrival')}</span>
                    <span className="text-[18px] font-semibold">{drop}</span>
                    <span className="text-[13px] text-[#46464f]">{formatTime12(trip.arrival)}{trip.arrivalDayOffset ? tx(' (+1 day)') : ''}</span>
                    </div>
                </div>

                <div className="px-[24px] py-[16px] border-t border-[#c7c5d1] bg-white grid grid-cols-2 md:grid-cols-4 gap-[16px]">
                    <div>
                    <span className="text-[11px] text-[#46464f] block">{tx('Passenger')}</span>
                    <span className="text-[13px] font-bold">{passengerNames}</span>
                    </div>
                    <div>
                    <span className="text-[11px] text-[#46464f] block">{tx('Seat Number')}</span>
                    <span className="text-[13px] font-bold">{seats.join(', ') || '—'}</span>
                    </div>
                    {bikes.length > 0 && (
                      <div>
                        <span className="text-[11px] text-[#46464f] block">{tx('Luggage compartment')}</span>
                        <span className="text-[13px] font-bold">
                          {bikes.map((b) => `${bikeKind(b.kind).label}${b.regNo ? ` (${b.regNo})` : ''}`).join(', ')}
                        </span>
                      </div>
                    )}
                    <div>
                    <span className="text-[11px] text-[#46464f] block">{tx('Boarding Point')}</span>
                    <span className="text-[13px] font-bold">{pickup}</span>
                    </div>
                    <div>
                    <span className="text-[11px] text-[#46464f] block">{tx('Total Fare')}</span>
                    <span className="text-[13px] font-bold">{formatLKR(totalPrice)}</span>
                    </div>
                </div>
                </div>

                {/* Secondary info cards — grows to fill remaining left-column height */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-[24px] flex-1">
                <div className="bg-white p-[20px] rounded-xl border border-[#c7c5d1] shadow-sm h-full flex flex-col">
                    <h4 className="text-[14px] font-semibold mb-[12px] flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">info</span>{tx('Travel Guidelines')}</h4>
                    <ul className="space-y-[8px] text-[13px] text-[#46464f]">
                    <li className="flex gap-2">
                        <span className="font-bold">•</span>{tx('Please report at the boarding point 20 minutes before departure.')}</li>
                    <li className="flex gap-2">
                        <span className="font-bold">•</span>{tx('Carry a valid photo ID for verification.')}</li>
                    <li className="flex gap-2">
                        <span className="font-bold">•</span>{tx('Maximum luggage allowance: 20kg per person.')}</li>
                    </ul>
                </div>

                <div className="bg-white p-[20px] rounded-xl border border-[#c7c5d1] shadow-sm h-full flex flex-col">
                    <h4 className="text-[14px] font-semibold mb-[12px] flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">support_agent</span>{tx('Support & Help')}</h4>
                    <p className="text-[13px] text-[#46464f] mb-[12px]">{tx('Need to change your travel plans? Get in touch and we\'ll help.')}</p>
                    <div className="flex flex-col gap-[6px]">
                    {OPERATOR.contact.phone ? (<a className="flex items-center gap-2 text-[13px] font-bold hover:underline" href={OPERATOR.contact.phoneHref}><span className="material-symbols-outlined text-[16px]">call</span>{OPERATOR.contact.phone}</a>) : null}
                    <a className="flex items-center gap-2 text-[13px] font-bold hover:underline" href={`mailto:${OPERATOR.contact.email}`}>
                        <span className="material-symbols-outlined text-[16px]">mail</span>
                        {OPERATOR.contact.email}
                    </a>
                    </div>
                </div>
                </div>
            </div>

            {/* QR & Actions */}
            <div className="lg:col-span-4 flex flex-col gap-[24px] lg:h-full">
                <div className="bg-white rounded-xl shadow-sm border border-[#c7c5d1] overflow-hidden p-[24px] flex flex-col items-center">
                <span className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-[16px]">{tx('Boarding QR Code')}</span>

                <div className="p-3 bg-white border border-[#c7c5d1] rounded-xl mb-[16px]">
                    {qrImageUrl ? (
                    <img
                        src={qrImageUrl}
                        alt={tx('QR code for booking {bookingRef}', { bookingRef })}
                        className="w-[160px] h-[160px]"
                    />
                    ) : (
                    <div className="w-[160px] h-[160px] flex items-center justify-center text-[11px] font-medium text-[#46464f]">{tx('Generating QR…')}</div>
                    )}
                </div>

                <p className="text-center text-[12px] text-[#46464f] mb-[20px]">{tx('Scan this QR code at the counter or during boarding to verify your e-ticket.')}</p>

                {error && (
                    <p className="text-[11px] font-medium text-[#ba1a1a] mb-[12px] text-center">{error}</p>
                )}

                <div className="w-full space-y-[10px]">
                    <button
                    onClick={handleDownload}
                    disabled={isDownloading || !qrImageUrl}
                    className={`w-full py-3 px-4 rounded-xl font-bold text-[13px] flex items-center justify-center gap-2 transition-all ${
                        isDownloading || !qrImageUrl
                        ? 'bg-[#e1e2e4] text-[#6b6d78] cursor-not-allowed'
                        : 'bg-black text-white hover:opacity-90 active:scale-95'
                    }`}
                    >
                    {isDownloading ? (
                        <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                    ) : (
                        <>
                        <span className="material-symbols-outlined text-[16px]">download</span>{tx('Download Ticket')}</>
                    )}
                    </button>

                    <button
                    onClick={() => router.push('/')}
                    className="w-full py-3 px-4 rounded-xl font-bold text-[13px] bg-white text-black border border-[#c7c5d1] hover:bg-[#f2f4f6] active:scale-95 transition-all"
                    >{tx('Back to Home')}</button>
                    <NotificationOptIn compact />
                </div>
                </div>

                {/* Grows to fill remaining right-column height, matching left side's bottom edge */}
                <div className="bg-[#f2f4f6] rounded-xl p-[20px] border border-[#c7c5d1] flex-1 flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-[8px]">
                    <span className="material-symbols-outlined text-[18px] text-[#46464f]">notifications_active</span>
                    <span className="text-[13px] font-bold">{tx('Trip Reminder')}</span>
                </div>
                <p className="text-[12px] text-[#46464f]">{tx("We'll send a reminder to {phone} a few hours before departure.", { phone: contactPhone || tx('your registered number') })}</p>
                </div>
            </div>
            </div>
        </main>
        );
  }

  return (
    <main className="max-w-[1200px] mx-auto px-4 md:px-[64px] py-[32px]">
      {bookingCode.modal}
      <nav aria-label={tx('Breadcrumb')} className="hidden md:flex flex-wrap items-center space-x-2 text-[12px] font-medium mb-[24px] text-[#46464f]">
        <div className="flex items-center">
          <span className="cursor-default">{tx('Search Results')}</span>
          <span className="material-symbols-outlined text-[16px] mx-1">chevron_right</span>
        </div>
        <div className="flex items-center">
          <span className="cursor-default">{tx('Passenger Details')}</span>
          <span className="material-symbols-outlined text-[16px] mx-1 text-[#46464f]">chevron_right</span>
        </div>
        <div className="flex items-center">
          <span className="text-[#000000] font-bold">{tx('Payment')}</span>
        </div>
      </nav>

      <h1 className="text-[20px] font-semibold mb-[24px]">{tx('Complete your payment')}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-[24px]">
        <div className="lg:col-span-7 space-y-[24px]">
          <div className="bg-white rounded-xl p-[24px] shadow-sm border border-[#c7c5d1]">
            <h2 className="text-[16px] font-semibold mb-[16px]">{t('Payment Method')}</h2>

            {(promoEligible || promoNeedsApp) && (
              <div className={`rounded-xl px-4 py-3 mb-[16px] flex items-center gap-3 border ${promoApplied ? 'border-[#16a34a]/40 bg-[#16a34a]/10' : 'border-[#feb700]/50 bg-[#feb700]/10'}`}>
                <span className="material-symbols-outlined text-[22px] text-[#7c5800]">sell</span>
                <span className="flex-1 min-w-0 text-[14px]">
                  {promoEligible ? (
                    <>
                      <span className="font-bold text-[#050a44]">{promoApplied ? tx('{code} applied: {p}% off your first trip', { code: pub.promoCode, p: pub.promoPercent }) : tx('{code}: {p}% off your first trip', { code: pub.promoCode, p: pub.promoPercent })}</span>
                      <span className="block text-[12px] text-[#46464f]">{tx('Thanks for booking in the app.')}</span>
                    </>
                  ) : (
                    <>
                      <span className="font-bold text-[#050a44]">{tx('{p}% off your first trip in the app', { p: pub.promoPercent })}</span>
                      <span className="block text-[12px] text-[#46464f]">{tx('Install the Siyan Lanka app and book from it: code {code} is applied for you.', { code: pub.promoCode })}</span>
                    </>
                  )}
                </span>
                {promoEligible ? (
                  <button type="button" onClick={() => setPromoOn((v) => !v)} className="shrink-0 text-[13px] font-bold text-[#050a44] underline">{promoApplied ? tx('Remove') : tx('Apply')}</button>
                ) : (
                  <InstallAppButton variant="icon" className="shrink-0" />
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mb-[20px]">
              {([
                { id: 'card' as const, icon: 'credit_card', label: tx('Card or mobile wallet'), sub: cardOpen ? tx('Pay now · {p}% card fee', { p: pub.gatewayFeePercent }) : tx('Not available yet') },
                { id: 'bank' as const, icon: 'account_balance', label: tx('Bank transfer'), sub: tx('Upload your slip · no card fee') },
              ]).map((m) => {
                const off = m.id === 'card' && !cardOpen;
                const on = method === m.id;
                return (
                  <button key={m.id} type="button" disabled={off} aria-pressed={on} onClick={() => { setPicked(true); setMethod(m.id); }}
                    className={`text-left rounded-xl border p-3 transition-all ${off ? 'border-[#e1e2e4] text-[#9a9ba5] cursor-not-allowed' : on ? 'border-[#050a44] bg-[#050a44]/5 ring-1 ring-[#050a44]' : 'border-[#e1e2e4] hover:border-[#050a44]/50'}`}>
                    <span className={`material-symbols-outlined text-[22px] ${off ? '' : 'text-[#050a44]'}`}>{off ? 'lock' : m.icon}</span>
                    <span className={`block text-[14px] font-bold mt-1 ${off ? '' : 'text-[#050a44]'}`}>{m.label}</span>
                    <span className="block text-[12px] text-[#46464f]">{m.sub}</span>
                  </button>
                );
              })}
            </div>

            {(loyalty?.available ?? 0) > 0 && (
              <label className="flex items-center gap-3 rounded-xl border border-[#feb700]/50 bg-[#feb700]/10 px-4 py-3 mb-[16px] cursor-pointer">
                <input type="checkbox" checked={useReward} onChange={(e) => setUseReward(e.target.checked)} className="w-5 h-5 accent-[#050a44]" />
                <span className="text-[14px]">
                  <span className="font-bold text-[#050a44]">{t('Use my free trip')}</span>
                  <span className="block text-[12px] text-[#46464f]">{tx('You\'ve earned it: one seat on this booking is free ({amount} off).', { amount: formatLKR(seatPrice) })}</span>
                </span>
              </label>
            )}

            {holdMethod ? (
              <div className="rounded-xl bg-[#f8f9fb] border border-[#e1e2e4] p-4 space-y-2 text-[14px] text-[#46464f]">
                <p className="font-bold text-[#050a44]">{tx('We hold your seat while you transfer')}</p>
                <>
                <p>{txn(Math.round(pub.holdMinutesBank / 60), "Your seat is held for {n} hour (or until online booking closes, if sooner). If it isn't paid by then, it's released for others.", "Your seat is held for {n} hours (or until online booking closes, if sooner). If it isn't paid by then, it's released for others.")}</p>
                {method === 'bank' ? (
                  <>
                  <p className="rounded-lg bg-white border border-[#e1e2e4] px-3 py-2 font-semibold text-[#050a44]">
                    {pub.bankDetails}
                    <span className="block text-[12px] font-normal text-[#46464f]">{tx('Use your booking reference as the payment reference. We\'ll confirm when it arrives.')}</span>
                  </p>
                  <div className="rounded-lg bg-white border border-[#e1e2e4] px-3 py-3 space-y-2">
                    <p className="font-bold text-[#050a44]">{tx('Upload your payment slip')}</p>
                    <p className="text-[13px]">{tx('Already transferred? Attach the slip now (photo, screenshot or PDF) and it goes to our office with your booking. Not yet? Hold your seat first; you can upload it on the next screen or later in My trips.')}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => slipInput.current?.click()} className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-[#050a44] text-white text-[13px] font-bold">
                        <span className="material-symbols-outlined text-[18px]">upload</span> {slipFile ? tx('Change file') : tx('Choose slip (photo or PDF)')}
                      </button>
                      {slipFile && (
                        <span className="text-[13px] font-semibold text-[#006e1c] flex items-center gap-1 min-w-0">
                          <span className="material-symbols-outlined text-[16px]">check_circle</span>
                          <span className="truncate max-w-[180px]">{slipFile.name}</span>
                          <button type="button" onClick={() => setSlipFile(null)} className="underline text-[#46464f] font-medium ml-1">{tx('Remove')}</button>
                        </span>
                      )}
                    </div>
                    {slipFile && (
                      <input
                        value={slipRef}
                        onChange={(e) => setSlipRef(e.target.value)}
                        placeholder={tx('Bank reference no. (optional)')}
                        aria-label={tx('Bank reference number')}
                        className="w-full max-w-[320px] h-10 px-3 rounded-xl bg-[#f2f4f6] text-[14px] font-medium outline-none focus:ring-1 focus:ring-[#050a44]"
                      />
                    )}
                    <input ref={slipInput} type="file" accept={SLIP_ACCEPT} className="hidden" onChange={(e) => { setSlipFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                  </div>
                  </>
                ) : null}
                </>
              </div>
            ) : (
              <div className="rounded-xl bg-[#f8f9fb] border border-[#e1e2e4] p-4 text-[14px] text-[#46464f]">
                <p className="font-bold text-[#050a44]">{payhereLive ? tx('You\'ll pay securely on PayHere') : mockGateway ? tx('Test payment gateway') : tx('Demo payment')}</p>
                <p className="mt-1">
                  {payhereLive
                    ? tx('Visa, Mastercard, Amex, eZ Cash, mCash and Genie. Your seat is held for 20 minutes while you pay.')
                    : mockGateway
                      ? tx('Test mode on this computer: the next page lets you choose whether the payment goes through. No money moves.')
                      : tx('Demo mode: the payment is simulated and confirmed straight away.')}
                </p>
                <p className="mt-2 text-[12px]">{tx('The payment company charges {p}% to process a card or wallet payment; it is added to your total. Bank transfer has no such fee.', { p: pub.gatewayFeePercent })}</p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl p-[24px] shadow-sm border border-[#c7c5d1]">
            <h2 className="text-[16px] font-semibold mb-[16px]">{tx('Passenger')}</h2>
            {passengers.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-[14px] py-[6px]">
                <span className="font-bold">{p.name}</span>
                <span className="text-[#46464f]">{p.gender}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="bg-white rounded-xl p-[32px] shadow-lg border border-[#c7c5d1] lg:sticky lg:top-24 lg:self-start">
            <h2 className="text-[20px] font-semibold mb-[24px]">{tx('Order Summary')}</h2>

            <div className="space-y-[12px] mb-[20px] text-[14px]">
              <div className="flex justify-between">
                <span className="text-[#46464f]">{tx('Route')}</span>
                <span className="font-bold">{from} → {to}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#46464f]">{tx('Bus')}</span>
                <span className="font-bold">{trip.bus.name} · {trip.bus.regNo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#46464f]">{tx('Seats')}</span>
                <span className="font-bold">{seats.join(', ') || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#46464f]">{tx('Pickup')}</span>
                <span className="font-bold">{pickup}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#46464f]">{tx('Drop-off')}</span>
                <span className="font-bold">{drop}</span>
              </div>
            </div>

            <div className="h-px bg-[#c7c5d1] w-full mb-[20px]"></div>

            <div className="space-y-[8px] mb-[20px] text-[14px]">
              <div className="flex justify-between">
                <span className="text-[#46464f]">{tx('Fare ({length} × {amount})', { length: seats.length, amount: formatLKR(seatPrice) })}</span>
                <span className="font-bold">{formatLKR(basePrice)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-[#006e1c]">
                  <span className="font-medium">{tx('Discount ({promoCode})', { promoCode: pub.promoCode })}</span>
                  <span className="font-bold">-{formatLKR(discount)}</span>
                </div>
              )}
              {bikes.map((b, i) => (
                <div key={b.id} className="flex justify-between items-center gap-3">
                  <span className="text-[#46464f] flex items-center gap-2 min-w-0">
                    {b.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.photo} alt="" className="w-8 h-8 rounded-md object-cover border border-[#e1e2e4] shrink-0" />
                    ) : null}
                    <span className="truncate">{bikes.length > 1 ? tx('{label} space {n}', { label: tx(bikeKind(b.kind).label), n: i + 1 }) : tx('{label} space', { label: tx(bikeKind(b.kind).label) })}
                    </span>
                  </span>
                  <span className="font-bold">{formatLKR(b.fee)}</span>
                </div>
              ))}
              {rewardOff > 0 && (
                <div className="flex justify-between text-[#006e1c]">
                  <span className="font-medium">{tx('Free trip')}</span>
                  <span className="font-bold">-{formatLKR(rewardOff)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[#46464f]">{tx('Platform fee')}</span>
                <span className="font-bold">{formatLKR(platformFee)}</span>
              </div>
              {gatewayFee > 0 && (
                <div className="flex justify-between">
                  <span className="text-[#46464f]">{tx('Card payment fee ({p}%)', { p: pub.gatewayFeePercent })}</span>
                  <span className="font-bold">{formatLKR(gatewayFee)}</span>
                </div>
              )}
            </div>

            <div className="bg-[#f2f4f6] rounded-xl p-[20px] mb-[20px]">
              <div className="flex justify-between items-center">
                <span className="text-[16px] font-semibold">{tx('Total')}</span>
                <span className="text-[20px] font-semibold">{formatLKR(totalPrice)}</span>
              </div>
            </div>

            {error && (
              <p className="text-[12px] font-medium text-[#ba1a1a] mb-[12px] text-center">{error}</p>
            )}

            <button
              onClick={handlePay}
              disabled={payState === 'processing'}
              className={`w-full h-14 bg-black text-white rounded-xl font-bold flex items-center justify-center gap-3 transition-all ${
                payState === 'processing' ? 'opacity-70 cursor-wait' : 'hover:scale-[0.98]'
              }`}
            >
              {payState === 'processing' ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>{tx('Processing…')}</>
              ) : (
                <>{method === 'bank' && slipFile ? tx('Hold my seat · send my slip') : holdMethod ? tx('Hold my seat · pay {amount} by transfer', { amount: formatLKR(totalPrice) }) : tx('Pay {amount}', { amount: formatLKR(totalPrice) })}</>
              )}
            </button>

            {!holdMethod && !payhereLive && (
            <p className="text-center text-[12px] font-semibold text-[#7c5800] bg-[#feb700]/10 rounded-lg px-3 py-2 mt-[16px]">{mockGateway ? tx('Test mode: no money moves.') : tx('Demo checkout: no card is charged.')}</p>
            )}
            <p className="text-center text-[11px] font-medium text-[#46464f] mt-[12px]">{txr('Payments are securely processed. By paying you agree to our <a>Terms of Service</a>.', { a: (c) => <a className="text-[#000000] underline" href="/legal#terms" target="_blank" rel="noopener">{c}</a> })}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}