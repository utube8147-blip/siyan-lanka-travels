// /app/(public)/(passenger)/payment/page.tsx
'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OPERATOR } from '@/config/operator';
import { useAuth } from '@/contexts/AuthContext';
import { useStore, StoreLoading } from '@/lib/store';
import { formatDateLabel, formatLKR, formatTime12, getTrip, todayISO } from '@/lib/trips';
import type { BikeItem, Gender } from '@/lib/types';

type PaymentMethod = 'card' | 'wallet';
type PayState = 'idle' | 'processing' | 'success';

interface Passenger {
  name: string;
  gender: string;
  phone: string;
}

function formatCardNumber(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export default function PaymentPage() {
  return (
    <React.Suspense fallback={<StoreLoading />}>
      <PaymentPageInner />
    </React.Suspense>
  );
}

function PaymentPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const date = searchParams.get('date') || todayISO();
  const { data, ready, createBooking } = useStore();
  const { user } = useAuth();
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

  const seatPrice = trip ? trip.fare : 0;
  const platformFee = OPERATOR.bookingFee;
  const basePrice = seats.length * seatPrice;
  const discount = promo === OPERATOR.promo.code ? Math.round((basePrice * OPERATOR.promo.percentOff) / 100) : 0;
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
  const totalPrice = basePrice - discount + bikeTotal + platformFee;

  const [method, setMethod] = useState<PaymentMethod>('card');
  const [cardNumber, setCardNumber] = useState('');
  const [cardName, setCardName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [wallet, setWallet] = useState<'ezcash' | 'mcash' | 'frimi' | ''>('');

  const [payState, setPayState] = useState<PayState>('idle');
  const [bookingRef, setBookingRef] = useState('');
  const [error, setError] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  const cardValid =
    cardNumber.replace(/\s/g, '').length === 16 &&
    cardName.trim().length > 1 &&
    /^\d{2}\/\d{2}$/.test(expiry) &&
    cvv.length === 3;
  const walletValid = wallet !== '';
  const canPay = trip && seats.length > 0 && (method === 'card' ? cardValid : walletValid);

  const handlePay = () => {
    setError('');
    if (!canPay) {
      setError(
        method === 'card'
          ? 'Fill in all card details correctly.'
          : 'Select a wallet provider to continue.'
      );
      return;
    }
    setPayState('processing');
    // Mock payment gateway: wait, then save the booking. Swap for a real
    // gateway (e.g. PayHere) and create the booking from its server callback.
    setTimeout(() => {
      if (!trip) return;
      const lead = passengers[0];
      const result = createBooking({
        scheduleId: trip.scheduleId,
        date,
        from: trip.from,
        to: trip.to,
        seats,
        passenger: {
          name: lead?.name || 'Passenger',
          gender: (lead?.gender as Gender) || '',
          phone: lead?.phone || contactPhone,
        },
        contact: { email: contactEmail, phone: contactPhone },
        userId: user?.role === 'passenger' ? user.id : undefined,
        channel: 'online',
        fare: seatPrice,
        fee: platformFee,
        bikes: bikes.length ? bikes : undefined,
        bikeFee: bikeTotal || undefined,
        discount,
        total: totalPrice,
      });
      if (!result.ok) {
        setPayState('idle');
        setError(`${result.reason} Go back and pick another seat — you have not been charged.`);
        return;
      }
      setPaidTrip(trip);
      try {
        window.sessionStorage.removeItem(`bikes:${scheduleId}:${date}`);
      } catch {
        /* ignore */
      }
      setBookingRef(result.booking.ref);
      setPayState('success');
    }, 1800);
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

  const qrImageUrl = qrPayload
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(qrPayload)}`
    : '';

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
      setError('Could not download the ticket right now.');
    } finally {
      setIsDownloading(false);
    }
  };

  const passengerNames = passengers.map((p) => p.name).filter(Boolean).join(', ') || '—';

  if (!ready) return <StoreLoading />;

  if (!trip) {
    return (
      <main className="max-w-[600px] mx-auto px-4 py-[64px] text-center">
        <p className="text-[16px] font-semibold text-[#46464f]">
          We couldn't find that trip. Please start your booking again.
        </p>
        <button
          onClick={() => router.push('/search')}
          className="mt-[16px] px-6 py-3 bg-black text-white rounded-xl font-bold text-sm"
        >
          Back to Search
        </button>
      </main>
    );
  }

  if (payState === 'success') {
        return (
        <main className="max-w-[1200px] mx-auto px-4 md:px-[64px] py-[40px]">
            {/* Success Banner */}
            <div className="flex flex-col items-center justify-center text-center mb-[32px]">
            <div className="w-16 h-16 bg-[#e8f6ea] rounded-full flex items-center justify-center mb-[12px]">
                <span className="material-symbols-outlined text-[#006e1c] text-[32px]">check</span>
            </div>
            <h1 className="text-[24px] font-bold mb-[4px]">Booking Confirmed!</h1>
            <p className="text-[14px] text-[#46464f]">
                Your ticket has been sent to <span className="font-bold">{contactEmail || 'your email'}</span> and is ready for boarding.
            </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-[24px] items-stretch">
            {/* Main ticket + info */}
            <div className="lg:col-span-8 flex flex-col gap-[24px] lg:h-full">
                {/* E-Ticket Card */}
                <div className="bg-white rounded-xl shadow-sm border border-[#c7c5d1] overflow-hidden">
                <div className="px-[24px] py-[16px] bg-[#f2f4f6] flex justify-between items-center border-b border-[#c7c5d1]">
                    <div>
                    <h3 className="text-[16px] font-semibold">{OPERATOR.name}</h3>
                    <p className="text-[11px] text-[#46464f]">Bus No. {scheduleId.toUpperCase()}</p>
                    </div>
                    <div className="text-right">
                    <span className="bg-[#feb700]/20 text-[#6b4b00] px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide">
                        {trip.bus.type} · {trip.bus.name}
                    </span>
                    <p className="mt-[6px] text-[11px] text-[#46464f]">PNR: {bookingRef}</p>
                    </div>
                </div>

                <div className="p-[24px] grid grid-cols-1 md:grid-cols-3 gap-[24px]">
                    <div className="flex flex-col">
                    <span className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-1">Departure</span>
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
                    <span className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-1">Arrival</span>
                    <span className="text-[18px] font-semibold">{drop}</span>
                    <span className="text-[13px] text-[#46464f]">{formatTime12(trip.arrival)}{trip.arrivalDayOffset ? ' (+1 day)' : ''}</span>
                    </div>
                </div>

                <div className="px-[24px] py-[16px] border-t border-[#c7c5d1] bg-white grid grid-cols-2 md:grid-cols-4 gap-[16px]">
                    <div>
                    <span className="text-[11px] text-[#46464f] block">Passenger</span>
                    <span className="text-[13px] font-bold">{passengerNames}</span>
                    </div>
                    <div>
                    <span className="text-[11px] text-[#46464f] block">Seat Number</span>
                    <span className="text-[13px] font-bold">{seats.join(', ') || '—'}</span>
                    </div>
                    {bikes.length > 0 && (
                      <div>
                        <span className="text-[11px] text-[#46464f] block">Luggage compartment</span>
                        <span className="text-[13px] font-bold">
                          {bikes.map((b) => `${OPERATOR.bikes.kinds[b.kind].label}${b.regNo ? ` (${b.regNo})` : ''}`).join(', ')}
                        </span>
                      </div>
                    )}
                    <div>
                    <span className="text-[11px] text-[#46464f] block">Boarding Point</span>
                    <span className="text-[13px] font-bold">{pickup}</span>
                    </div>
                    <div>
                    <span className="text-[11px] text-[#46464f] block">Total Fare</span>
                    <span className="text-[13px] font-bold">{formatLKR(totalPrice)}</span>
                    </div>
                </div>
                </div>

                {/* Secondary info cards — grows to fill remaining left-column height */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-[24px] flex-1">
                <div className="bg-white p-[20px] rounded-xl border border-[#c7c5d1] shadow-sm h-full flex flex-col">
                    <h4 className="text-[14px] font-semibold mb-[12px] flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">info</span>
                    Travel Guidelines
                    </h4>
                    <ul className="space-y-[8px] text-[13px] text-[#46464f]">
                    <li className="flex gap-2">
                        <span className="font-bold">•</span>
                        Please report at the boarding point 20 minutes before departure.
                    </li>
                    <li className="flex gap-2">
                        <span className="font-bold">•</span>
                        Carry a valid photo ID for verification.
                    </li>
                    <li className="flex gap-2">
                        <span className="font-bold">•</span>
                        Maximum luggage allowance: 20kg per person.
                    </li>
                    </ul>
                </div>

                <div className="bg-white p-[20px] rounded-xl border border-[#c7c5d1] shadow-sm h-full flex flex-col">
                    <h4 className="text-[14px] font-semibold mb-[12px] flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">support_agent</span>
                    Support &amp; Help
                    </h4>
                    <p className="text-[13px] text-[#46464f] mb-[12px]">
                    Need to change your travel plans? Get in touch and we'll help.
                    </p>
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
                <span className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-[16px]">
                    Boarding QR Code
                </span>

                <div className="p-3 bg-white border border-[#c7c5d1] rounded-xl mb-[16px]">
                    {qrImageUrl ? (
                    <img
                        src={qrImageUrl}
                        alt={`QR code for booking ${bookingRef}`}
                        className="w-[160px] h-[160px]"
                    />
                    ) : (
                    <div className="w-[160px] h-[160px] flex items-center justify-center text-[11px] font-medium text-[#46464f]">
                        Generating QR…
                    </div>
                    )}
                </div>

                <p className="text-center text-[12px] text-[#46464f] mb-[20px]">
                    Scan this QR code at the counter or during boarding to verify your e-ticket.
                </p>

                {error && (
                    <p className="text-[11px] font-medium text-[#ba1a1a] mb-[12px] text-center">{error}</p>
                )}

                <div className="w-full space-y-[10px]">
                    <button
                    onClick={handleDownload}
                    disabled={isDownloading || !qrImageUrl}
                    className={`w-full py-3 px-4 rounded-xl font-bold text-[13px] flex items-center justify-center gap-2 transition-all ${
                        isDownloading || !qrImageUrl
                        ? 'bg-[#e1e2e4] text-[#9a9ba5] cursor-not-allowed'
                        : 'bg-black text-white hover:opacity-90 active:scale-95'
                    }`}
                    >
                    {isDownloading ? (
                        <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                    ) : (
                        <>
                        <span className="material-symbols-outlined text-[16px]">download</span>
                        Download Ticket
                        </>
                    )}
                    </button>

                    <button
                    onClick={() => router.push('/')}
                    className="w-full py-3 px-4 rounded-xl font-bold text-[13px] bg-white text-black border border-[#c7c5d1] hover:bg-[#f2f4f6] active:scale-95 transition-all"
                    >
                    Back to Home
                    </button>
                </div>
                </div>

                {/* Grows to fill remaining right-column height, matching left side's bottom edge */}
                <div className="bg-[#f2f4f6] rounded-xl p-[20px] border border-[#c7c5d1] flex-1 flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-[8px]">
                    <span className="material-symbols-outlined text-[18px] text-[#46464f]">notifications_active</span>
                    <span className="text-[13px] font-bold">Trip Reminder</span>
                </div>
                <p className="text-[12px] text-[#46464f]">
                    We'll send a reminder to {contactPhone || 'your registered number'} a few hours before departure.
                </p>
                </div>
            </div>
            </div>
        </main>
        );
  }

  return (
    <main className="max-w-[1200px] mx-auto px-4 md:px-[64px] py-[32px]">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center space-x-2 text-[12px] font-medium mb-[24px] text-[#46464f]">
        <div className="flex items-center">
          <span className="cursor-default">Search Results</span>
          <span className="material-symbols-outlined text-[16px] mx-1">chevron_right</span>
        </div>
        <div className="flex items-center">
          <span className="cursor-default">Passenger Details</span>
          <span className="material-symbols-outlined text-[16px] mx-1 text-[#46464f]">chevron_right</span>
        </div>
        <div className="flex items-center">
          <span className="text-[#000000] font-bold">Payment</span>
        </div>
      </nav>

      <h1 className="text-[20px] font-semibold mb-[24px]">Complete your payment</h1>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-[24px]">
        <div className="lg:col-span-7 space-y-[24px]">
          <div className="bg-white rounded-xl p-[24px] shadow-sm border border-[#c7c5d1]">
            <h2 className="text-[16px] font-semibold mb-[16px]">Payment Method</h2>

            <div className="flex p-1 bg-[#f2f4f6] rounded-xl mb-[20px] border border-[#e1e2e4]/60 max-w-sm">
              <button
                onClick={() => setMethod('card')}
                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                  method === 'card' ? 'bg-white shadow-sm text-[#050a44] border border-[#e1e2e4]' : 'text-[#46464f]'
                }`}
              >
                Card
              </button>
              <button
                onClick={() => setMethod('wallet')}
                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                  method === 'wallet' ? 'bg-white shadow-sm text-[#050a44] border border-[#e1e2e4]' : 'text-[#46464f]'
                }`}
              >
                Mobile Wallet
              </button>
            </div>

            {method === 'card' ? (
              <div className="space-y-[12px]">
                <div>
                  <label className="text-[11px] font-bold text-[#46464f] px-1">Card number</label>
                  <input
                    value={cardNumber}
                    onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                    placeholder="1234 5678 9012 3456"
                    inputMode="numeric"
                    className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44] placeholder:text-[#9a9ba5] placeholder:font-normal"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-[#46464f] px-1">Name on card</label>
                  <input
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                    placeholder="As printed on card"
                    className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44] placeholder:text-[#9a9ba5] placeholder:font-normal"
                  />
                </div>
                <div className="grid grid-cols-2 gap-[12px]">
                  <div>
                    <label className="text-[11px] font-bold text-[#46464f] px-1">Expiry</label>
                    <input
                      value={expiry}
                      onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                      placeholder="MM/YY"
                      inputMode="numeric"
                      className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44] placeholder:text-[#9a9ba5] placeholder:font-normal"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-[#46464f] px-1">CVV</label>
                    <input
                      value={cvv}
                      onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 3))}
                      placeholder="123"
                      inputMode="numeric"
                      type="password"
                      className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44] placeholder:text-[#9a9ba5] placeholder:font-normal"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-[8px]">
                {(
                  [
                    { id: 'ezcash', label: 'eZ Cash' },
                    { id: 'mcash', label: 'mCash' },
                    { id: 'frimi', label: 'FriMi' },
                  ] as const
                ).map((w) => (
                  <button
                    key={w.id}
                    onClick={() => setWallet(w.id)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border text-left transition-colors ${
                      wallet === w.id
                        ? 'border-[#050a44] bg-[#050a44]/5'
                        : 'border-[#e1e2e4] hover:bg-[#f2f4f6]'
                    }`}
                  >
                    <span className="text-sm font-bold">{w.label}</span>
                    <span
                      className={`w-4 h-4 rounded-full border-2 ${
                        wallet === w.id ? 'border-[#050a44] bg-[#050a44]' : 'border-[#c7c5d1]'
                      }`}
                    />
                  </button>
                ))}
                {wallet && (
                  <p className="text-[11px] text-[#9a9ba5] mt-[8px] px-1">
                    You'll receive a payment prompt on {contactPhone || 'your registered number'} to confirm.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl p-[24px] shadow-sm border border-[#c7c5d1]">
            <h2 className="text-[16px] font-semibold mb-[16px]">Passenger</h2>
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
            <h2 className="text-[20px] font-semibold mb-[24px]">Order Summary</h2>

            <div className="space-y-[12px] mb-[20px] text-[14px]">
              <div className="flex justify-between">
                <span className="text-[#46464f]">Route</span>
                <span className="font-bold">{from} → {to}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#46464f]">Bus</span>
                <span className="font-bold">{trip.bus.name} · {trip.bus.regNo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#46464f]">Seats</span>
                <span className="font-bold">{seats.join(', ') || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#46464f]">Pickup</span>
                <span className="font-bold">{pickup}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#46464f]">Drop-off</span>
                <span className="font-bold">{drop}</span>
              </div>
            </div>

            <div className="h-px bg-[#c7c5d1] w-full mb-[20px]"></div>

            <div className="space-y-[8px] mb-[20px] text-[14px]">
              <div className="flex justify-between">
                <span className="text-[#46464f]">Fare ({seats.length} × {formatLKR(seatPrice)})</span>
                <span className="font-bold">{formatLKR(basePrice)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-[#006e1c]">
                  <span className="font-medium">Discount ({OPERATOR.promo.code})</span>
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
                    <span className="truncate">
                      {OPERATOR.bikes.kinds[b.kind].label} space{bikes.length > 1 ? ` ${i + 1}` : ''}
                    </span>
                  </span>
                  <span className="font-bold">{formatLKR(b.fee)}</span>
                </div>
              ))}
              <div className="flex justify-between">
                <span className="text-[#46464f]">Booking fee</span>
                <span className="font-bold">{formatLKR(platformFee)}</span>
              </div>
            </div>

            <div className="bg-[#f2f4f6] rounded-xl p-[20px] mb-[20px]">
              <div className="flex justify-between items-center">
                <span className="text-[16px] font-semibold">Total</span>
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
                  <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                  Processing…
                </>
              ) : (
                <>Pay {formatLKR(totalPrice)}</>
              )}
            </button>

            <p className="text-center text-[12px] font-semibold text-[#7c5800] bg-[#feb700]/10 rounded-lg px-3 py-2 mt-[16px]">
              Demo checkout: no card is charged. Any 16-digit number works.
            </p>
            <p className="text-center text-[11px] font-medium text-[#46464f] mt-[12px]">
              Payments are securely processed. By paying you agree to our{' '}
              <a className="text-[#000000] underline" href="#">Terms of Service</a>.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}