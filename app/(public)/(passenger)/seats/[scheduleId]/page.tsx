// app/(public)/(passenger)/seats/[scheduleId]/page.tsx
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import SeatSelectionDrawer, { formatTime, type Gender } from '@/components/SeatSelectionDrawer';
import { OPERATOR } from '@/config/operator';
import AnimatedNumber from '@/components/motion/AnimatedNumber';
import { BikeAddon, bikesProblem } from '@/components/BikeAddon';
import type { BikeItem } from '@/lib/types';
import { useStore, StoreLoading } from '@/lib/store';
import { formatDateLabel, formatLKR, formatTime12, getTrip, takenSeats, todayISO } from '@/lib/trips';

const MAX_SEATS_PER_BOOKING = OPERATOR.maxSeatsPerBooking;
const HOLD_SECONDS = OPERATOR.seatHoldMinutes * 60;

type BookingFor = 'self' | 'other';

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

function useLocalToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = (message: string, type: ToastItem['type'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  const ToastHost = () => (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-3 rounded-xl shadow-lg text-sm font-semibold text-white max-w-xs animate-[fadeIn_0.2s_ease-out] ${
            t.type === 'error' ? 'bg-[#ba1a1a]' : t.type === 'success' ? 'bg-[#006e1c]' : 'bg-[#050a44]'
          }`}
        >
          {t.message}
        </div>
      ))}
      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );

  return { addToast, ToastHost };
}

export default function BookingPage() {
  return (
    <React.Suspense fallback={<StoreLoading />}>
      <BookingPageInner />
    </React.Suspense>
  );
}

function BookingPageInner() {
  const router = useRouter();
  const params = useParams<{ scheduleId: string }>();
  const searchParams = useSearchParams();
  const { addToast, ToastHost } = useLocalToast();
  const { user, isLoggedIn, mode: authMode } = useAuth();

  const { data, ready } = useStore();
  const date = searchParams.get('date') || todayISO();

  const trip = useMemo(
    () => (ready ? getTrip(data, params.scheduleId, date, searchParams.get('from'), searchParams.get('to')) : null),
    [ready, data, params.scheduleId, date, searchParams],
  );
  const taken = useMemo(() => (trip ? takenSeats(data.bookings, trip.scheduleId, date) : new Map<string, Gender>()), [data.bookings, trip, date]);
  const from = trip?.from ?? searchParams.get('from') ?? '';
  const to = trip?.to ?? searchParams.get('to') ?? '';
  const pickup = from;
  const pickupTime = trip ? formatTime12(trip.departure) : '';
  const drop = to;
  const dropTime = trip ? formatTime12(trip.arrival) : '';

  const accountName = isLoggedIn && user ? user.user_metadata?.full_name ?? '' : '';

  const [bookingFor, setBookingFor] = useState<BookingFor>('self');
  const [passengerName, setPassengerName] = useState(accountName);
  const [passengerGender, setPassengerGender] = useState<Gender>('');
  const [passengerPhone, setPassengerPhone] = useState('');

  const switchBookingFor = (next: BookingFor) => {
    setBookingFor(next);
    if (next === 'self') {
      setPassengerName(accountName);
      setPassengerPhone('');
    } else {
      setPassengerName('');
      setPassengerGender('');
      setPassengerPhone('');
    }
  };

  const [email, setEmail] = useState(isLoggedIn && user ? user.email ?? '' : '');
  const [phone, setPhone] = useState(isLoggedIn && user ? user.phone ?? '' : '');
  const [isVerified, setIsVerified] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  // With real accounts, the signed-in account is the verification.
  useEffect(() => {
    if (authMode === 'supabase' && user) setIsVerified(true);
  }, [authMode, user]);
  const [otpValue, setOtpValue] = useState('');
  const [otpCooldown, setOtpCooldown] = useState(0);

  useEffect(() => {
    if (!isLoggedIn || !user) return;
    const nextEmail = user.email ?? '';
    const nextPhone = user.phone ?? '';
    setEmail((prev) => (prev ? prev : nextEmail));
    setPhone((prev) => (prev ? prev : nextPhone));
    setPassengerName((prev) => (bookingFor === 'self' && !prev ? user.user_metadata?.full_name ?? '' : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, user]);

  const [seatMapOpen, setSeatMapOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState(HOLD_SECONDS);
  const [promoApplied, setPromoApplied] = useState(false);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [bikes, setBikes] = useState<BikeItem[]>([]);

  useEffect(() => {
    if (ready && (!trip || trip.closed)) {
      addToast('Booking for that departure has closed. Please pick another bus.', 'error');
      router.push('/search');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, trip]);

  // If someone else books a seat you had selected (e.g. at the counter), drop it.
  useEffect(() => {
    setSelectedSeats((prev) => {
      const lost = prev.filter((s) => taken.has(s));
      if (lost.length) addToast(`Seat ${lost.join(', ')} was just booked by someone else.`, 'error');
      return lost.length ? prev.filter((s) => !taken.has(s)) : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taken]);

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const t = setTimeout(() => setOtpCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [otpCooldown]);

  useEffect(() => {
    if (selectedSeats.length === 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          addToast('Session expired. Please select your seats again.', 'error');
          setSelectedSeats([]);
          return HOLD_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeats.length > 0]);

  const hasMalePassenger = passengerGender === 'Male';

  const backToSearchHref = `/search?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${
    date ? `&date=${encodeURIComponent(date)}` : ''
  }`;

  const sendOtp = () => {
    if ((phone ?? '').trim().length < 6) {
      addToast('Enter a valid phone number first.', 'error');
      return;
    }
    setOtpSent(true);
    setOtpCooldown(30);
    addToast(`Verification code sent to ${phone}`, 'info');
  };

  const confirmOtp = () => {
    if (otpValue.trim().length !== 4) {
      addToast('Enter the 4-digit code sent to your phone.', 'error');
      return;
    }
    setIsVerified(true);
    addToast('Phone number verified.', 'success');
  };

  const passengerValid =
    passengerName.trim().length > 1 &&
    passengerGender !== '' &&
    (bookingFor === 'self' || passengerPhone.trim().length >= 6);
  const contactValid = (phone ?? '').trim().length >= 6 && (email ?? '').trim().includes('@') && isVerified;
  const detailsValid = passengerValid && contactValid;

  const seatPrice = trip ? trip.fare : 0;
  const platformFee = OPERATOR.bookingFee;
  const FEMALE_ONLY_SEATS = trip ? trip.bus.ladiesSeats : [];

  const toggleSeat = (seatId: string) => {
    setSelectedSeats((prev) => {
      const isSelected = prev.includes(seatId);

      if (!isSelected && FEMALE_ONLY_SEATS.includes(seatId) && hasMalePassenger) {
        addToast(`Seat ${seatId} is reserved for female passengers.`, 'error');
        return prev;
      }

      if (isSelected) {
        return prev.filter((id) => id !== seatId);
      }

      if (prev.length >= MAX_SEATS_PER_BOOKING) {
        addToast(`You can select up to ${MAX_SEATS_PER_BOOKING} seats on one booking.`, 'error');
        return prev;
      }

      return [...prev, seatId];
    });
  };

  const basePrice = selectedSeats.length * seatPrice;
  const discount = promoApplied ? Math.round((basePrice * OPERATOR.promo.percentOff) / 100) : 0;
  const bikeTotal = bikes.reduce((n, b) => n + b.fee, 0);
  const bikeError = bikesProblem(bikes);
  const totalPrice = selectedSeats.length > 0 ? basePrice - discount + bikeTotal + platformFee : 0;

  const applyPromo = () => {
    if (promoApplied) {
      setPromoApplied(false);
      addToast('Promo code removed', 'info');
    } else {
      setPromoApplied(true);
      addToast(`${OPERATOR.promo.code} applied: ${OPERATOR.promo.percentOff}% off the fare.`, 'success');
    }
  };

  const canProceedToPayment = detailsValid && selectedSeats.length > 0 && !bikeError;

  const handleProceedToPayment = () => {
    if (!trip || !canProceedToPayment) return;
    const passengersPayload = encodeURIComponent(
      JSON.stringify([
        {
          name: passengerName,
          gender: passengerGender,
          phone: bookingFor === 'self' ? phone : passengerPhone,
        },
      ])
    );
    const qs = new URLSearchParams({
      from,
      to,
      ...(date ? { date } : {}),
      scheduleId: trip.scheduleId,
      seats: selectedSeats.join(','),
      pickup,
      drop,
      contactPhone: phone ?? '',
      contactEmail: email ?? '',
      ...(promoApplied ? { promo: OPERATOR.promo.code } : {}),
    });
    // Bike photos are too big for a URL, so hand them to the payment page via
    // this tab's sessionStorage.
    try {
      window.sessionStorage.setItem(`bikes:${trip.scheduleId}:${date}`, JSON.stringify(bikes));
    } catch {
      /* storage full: payment page will show no bikes */
    }
    const paymentUrl = `/payment?${qs.toString()}&passengers=${passengersPayload}`;
    if (authMode === 'supabase' && !user) {
      router.push(`/auth/login?next=${encodeURIComponent(paymentUrl)}`);
      return;
    }
    router.push(paymentUrl);
  };

  if (!ready) return <StoreLoading />;
  if (!trip) return null;

  return (
    <React.Fragment>
      <main className="max-w-[1440px] mx-auto px-4 md:px-[64px] py-[32px]">
        <nav aria-label="Breadcrumb" className="hidden md:flex flex-wrap items-center space-x-2 text-[12px] font-medium mb-[24px] text-[#46464f]">
          <div className="flex items-center">
            <span className="hover:text-[#000000] cursor-pointer transition-colors" onClick={() => router.push(backToSearchHref)}>
              Search Results
            </span>
            <span className="material-symbols-outlined text-[16px] mx-1">chevron_right</span>
          </div>
          <div className="flex items-center">
            <span className="text-[#000000] font-bold">Passenger Details</span>
            <span className="material-symbols-outlined text-[16px] mx-1 text-[#46464f]">chevron_right</span>
          </div>
          <div className="flex items-center">
            <span className="text-[#6b6d78]">Payment</span>
          </div>
        </nav>

        <div className="mb-[32px] flex items-center justify-between">
          <div>
            <button
              onClick={() => router.push(backToSearchHref)}
              className="hidden md:flex items-center text-[#000000] font-bold mb-[4px] group"
            >
              <span className="material-symbols-outlined mr-[4px] group-hover:-translate-x-1 transition-transform">arrow_back</span>
              <span className="text-[14px]">Modify Search</span>
            </button>
            <div className="flex flex-wrap items-center space-x-[8px] mt-2">
              <h1 className="text-[20px] font-semibold">{from} to {to}</h1>
              <span className="w-1.5 h-1.5 rounded-full bg-[#c7c5d1]"></span>
              <p className="text-[#46464f] font-medium text-[14px]">{trip.bus.name} ({trip.bus.type})</p>
              <span className="w-1.5 h-1.5 rounded-full bg-[#c7c5d1]"></span>
              <p className="text-[#46464f] font-medium text-[14px]">{formatDateLabel(trip.boardingDate)}</p>
            </div>
          </div>
          <div className="hidden lg:flex items-center space-x-[16px]">
            <div className="flex flex-col items-end">
              <span className="text-[12px] font-medium text-[#46464f]">Departure</span>
              <span className="text-[14px] font-bold">{formatTime12(trip.departure)}</span>
            </div>
            <span className="material-symbols-outlined text-[#686873]">chevron_right</span>
            <div className="flex flex-col items-start">
              <span className="text-[12px] font-medium text-[#46464f]">Arrival</span>
              <span className="text-[14px] font-bold">{formatTime12(trip.arrival)}{trip.arrivalDayOffset ? ' (+1 day)' : ''}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-[24px]">
          <div className="lg:col-span-7 space-y-[24px]">
            <div className="bg-[#ffffff] rounded-xl p-[24px] shadow-sm border border-[#c7c5d1]">
              <div className="flex items-center justify-between mb-[16px]">
                <h2 className="text-[16px] font-semibold">Boarding &amp; Drop-off</h2>
                <button onClick={() => router.push(backToSearchHref)} className="text-[12px] font-bold text-[#050a44] hover:underline">
                  Change
                </button>
              </div>
              <div className="flex items-center justify-between bg-[#f2f4f6] rounded-xl p-[16px]">
                <div>
                  <p className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-1">Pickup</p>
                  <p className="text-[14px] font-bold">{pickup}</p>
                  {pickupTime && <p className="text-[12px] text-[#46464f]">{pickupTime}</p>}
                </div>
                <span className="material-symbols-outlined text-[#686873]">arrow_forward</span>
                <div className="text-right">
                  <p className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-1">Drop-off</p>
                  <p className="text-[14px] font-bold">{drop}</p>
                  {dropTime && <p className="text-[12px] text-[#46464f]">{dropTime}</p>}
                </div>
              </div>
            </div>

            <div className="bg-[#ffffff] rounded-xl p-[24px] shadow-sm border border-[#c7c5d1]">
              <h2 className="text-[16px] font-semibold mb-[16px]">Who are you booking for?</h2>

              <div className="flex p-1 bg-[#f2f4f6] rounded-xl mb-[20px] border border-[#e1e2e4]/60 max-w-sm">
                <button
                  onClick={() => switchBookingFor('self')}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                    bookingFor === 'self' ? 'bg-white shadow-sm text-[#050a44] border border-[#e1e2e4]' : 'text-[#46464f]'
                  }`}
                >
                  Myself
                </button>
                <button
                  onClick={() => switchBookingFor('other')}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                    bookingFor === 'other' ? 'bg-white shadow-sm text-[#050a44] border border-[#e1e2e4]' : 'text-[#46464f]'
                  }`}
                >
                  Someone else
                </button>
              </div>

              {bookingFor === 'other' && (
                <p className="text-[11px] text-[#6b6d78] mb-[16px] -mt-[8px]">
                  This ticket is for someone else - your account details won't be used here, just theirs.
                </p>
              )}

              <div className={`grid grid-cols-1 ${bookingFor === 'other' ? 'sm:grid-cols-2' : ''} gap-[12px] mb-[16px]`}>
                <div>
                  <label className="text-[11px] font-bold text-[#46464f] px-1">Full name</label>
                  <input
                    value={passengerName}
                    onChange={(e) => setPassengerName(e.target.value)}
                    placeholder="As per ID"
                    className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44] placeholder:text-[#9a9ba5] placeholder:font-normal"
                    type="text"
                  />
                  {bookingFor === 'self' && isLoggedIn && (
                    <p className="text-[10px] font-bold text-[#006e1c] mt-1 px-1">From your account</p>
                  )}
                </div>

                {bookingFor === 'other' && (
                  <div>
                    <label className="text-[11px] font-bold text-[#46464f] px-1">Their phone number</label>
                    <input
                      value={passengerPhone}
                      onChange={(e) => setPassengerPhone(e.target.value.replace(/[^0-9+]/g, ''))}
                      placeholder="+94 77 123 4567"
                      className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44] placeholder:text-[#9a9ba5] placeholder:font-normal"
                      type="tel"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="text-[11px] font-bold text-[#46464f] px-1 mb-1 block">Gender</label>
                <div className="flex gap-[8px]">
                  {(['Male', 'Female'] as Gender[]).map((g) => (
                    <button
                      key={g}
                      onClick={() => setPassengerGender(g)}
                      className={`px-4 py-2 rounded-lg text-[13px] font-bold border transition-colors ${
                        passengerGender === g
                          ? 'border-[#050a44] bg-[#050a44] text-white'
                          : 'border-[#e1e2e4] bg-white text-[#46464f] hover:bg-[#f2f4f6]'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              <p className="mt-[16px] text-[11px] text-[#6b6d78]">
                Booking more than one seat (e.g. for family)? Pick as many seats as you need in the next step.
              </p>
            </div>

            <BikeAddon trip={trip} bikes={bikes} onChange={setBikes} />

            <div className="bg-[#ffffff] rounded-xl p-[24px] shadow-sm border border-[#c7c5d1]">
              <h2 className="text-[16px] font-semibold mb-[20px]">Contact &amp; Verification</h2>

              <div className="space-y-[16px]">
                <div>
                  <label className="text-[11px] font-bold text-[#46464f] px-1 flex items-center gap-1.5">
                    Your phone number
                    {isLoggedIn && (
                      <span className="text-[10px] font-bold text-[#006e1c] normal-case">from your account</span>
                    )}
                  </label>

                  <div className="flex gap-[8px] mt-1">
                    <input
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value.replace(/[^0-9+]/g, ''));
                        setIsVerified(false);
                        setOtpSent(false);
                      }}
                      placeholder="+94 77 123 4567"
                      className="flex-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44] placeholder:text-[#9a9ba5] placeholder:font-normal"
                      type="tel"
                    />
                    {isVerified ? (
                      <div className="flex items-center gap-1 px-3 rounded-lg bg-[#e8f6ea] text-[#006e1c] font-bold text-[12px] whitespace-nowrap">
                        <span className="material-symbols-outlined text-[18px]">verified</span>
                        Verified
                      </div>
                    ) : (
                      <button
                        onClick={sendOtp}
                        disabled={otpCooldown > 0}
                        className={`px-4 rounded-lg font-bold text-[12px] whitespace-nowrap transition-colors ${
                          otpCooldown > 0
                            ? 'bg-[#e1e2e4] text-[#6b6d78] cursor-not-allowed'
                            : 'bg-[#050a44] text-white hover:opacity-90'
                        }`}
                      >
                        {otpCooldown > 0 ? `Resend (${otpCooldown}s)` : otpSent ? 'Resend code' : 'Send code'}
                      </button>
                    )}
                  </div>

                  {otpSent && !isVerified && (
                    <div className="flex items-end gap-[8px] mt-[12px]">
                      <div className="flex-1">
                        <label className="text-[11px] font-bold text-[#46464f] px-1">Enter 4-digit code</label>
                        <input
                          value={otpValue}
                          onChange={(e) => setOtpValue(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                          placeholder="0000"
                          className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium tracking-[6px] outline-none focus:ring-1 focus:ring-[#050a44] placeholder:text-[#c7c5d1] placeholder:tracking-[6px]"
                          type="text"
                          inputMode="numeric"
                        />
                      </div>
                      <button
                        onClick={confirmOtp}
                        className="h-[42px] px-4 rounded-lg font-bold text-[12px] bg-[#000000] text-white hover:opacity-90 transition-all"
                      >
                        Verify
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-[11px] font-bold text-[#46464f] px-1 flex items-center gap-1.5">
                    Email address
                    {isLoggedIn && (
                      <span className="text-[10px] font-bold text-[#006e1c] normal-case">from your account</span>
                    )}
                  </label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    readOnly={isLoggedIn}
                    placeholder="you@example.com"
                    className={`w-full mt-1 px-3 py-2.5 border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44] placeholder:text-[#9a9ba5] placeholder:font-normal ${
                      isLoggedIn ? 'bg-[#f2f4f6] text-[#46464f] cursor-not-allowed' : 'bg-[#f2f4f6]'
                    }`}
                    type="email"
                  />
                  <p className="mt-1 text-[11px] text-[#6b6d78] px-1">Your e-ticket will be sent here.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 lg:sticky lg:top-24 lg:self-start space-y-[24px]">
            <div className="bg-[#ffffff] rounded-xl p-[32px] shadow-lg border border-[#c7c5d1]">
              <h2 className="text-[20px] font-semibold mb-[24px]">Trip Summary</h2>

              <div className="space-y-[16px] mb-[24px] text-[14px]">
                <div className="flex justify-between">
                  <span className="text-[#46464f]">Bus</span>
                  <span className="font-bold">{trip.bus.name} · {trip.bus.regNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#46464f]">Bus type</span>
                  <span className="font-bold">{trip.bus.type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#46464f]">Fare per seat</span>
                  <span className="font-bold">{formatLKR(trip.fare)}</span>
                </div>
              </div>

              <div className="h-px bg-[#c7c5d1] w-full mb-[24px]"></div>

              <button
                onClick={() => setSeatMapOpen(true)}
                className="w-full flex items-center justify-between p-[16px] rounded-xl border-2 border-dashed border-[#c7c5d1] hover:border-[#050a44] transition-colors mb-[24px] group"
              >
                <div className="text-left">
                  <p className="text-[12px] font-bold text-[#46464f] mb-0.5">Seats</p>
                  <p className="text-[16px] font-bold text-[#050a44]">
                    {selectedSeats.length === 0
                      ? 'Select your seats'
                      : `${selectedSeats.length} seat${selectedSeats.length > 1 ? 's' : ''} selected`}
                  </p>
                  {selectedSeats.length > 0 && (
                    <p className="text-[12px] text-[#46464f] mt-1">{selectedSeats.join(', ')}</p>
                  )}
                </div>
                <span className="material-symbols-outlined text-[#050a44] group-hover:translate-x-1 transition-transform">
                  chevron_right
                </span>
              </button>

              {selectedSeats.length > 0 && (
                <>
                  <div className="space-y-[8px] mb-[24px] text-[14px]">
                    <div className="flex justify-between">
                      <span className="text-[#46464f]">Price per seat</span>
                      <span className="font-bold">{formatLKR(seatPrice)}</span>
                    </div>
                    {promoApplied && (
                      <div className="flex justify-between text-[#006e1c]">
                        <span className="font-medium">Discount ({OPERATOR.promo.percentOff}%)</span>
                        <span className="font-bold">-{formatLKR(discount)}</span>
                      </div>
                    )}
                    {bikes.map((b, i) => (
                      <div key={b.id} className="flex justify-between">
                        <span className="text-[#46464f]">
                          {OPERATOR.bikes.kinds[b.kind].label} space{bikes.length > 1 ? ` ${i + 1}` : ''}
                        </span>
                        <span className="font-bold">{formatLKR(b.fee)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between">
                      <span className="text-[#46464f]">Booking fee</span>
                      <span className="font-bold">{formatLKR(platformFee)}</span>
                    </div>
                  </div>

                  <div className="bg-[#f2f4f6] rounded-xl p-[20px] mb-[24px]">
                    <div className="flex justify-between items-center">
                      <span className="text-[16px] font-semibold">Total</span>
                      <span className="text-[20px] font-semibold text-[#000000]"><AnimatedNumber value={totalPrice} format={formatLKR} duration={0.5} /></span>
                    </div>
                  </div>

                  <div className={`flex items-center p-[12px] border rounded-xl mb-[16px] ${timeLeft < 60 ? 'bg-[#ffdad6]/50 border-[#ba1a1a]/20' : 'bg-[#feb700]/10 border-[#feb700]/20'}`}>
                    <span className={`material-symbols-outlined mr-[8px] text-[18px] ${timeLeft < 60 ? 'text-[#93000a]' : 'text-[#7c5800]'}`}>timer</span>
                    <p className={`text-[11px] font-medium ${timeLeft < 60 ? 'text-[#93000a]' : 'text-[#6b4b00]'}`}>
                      Seats are held for {formatTime(timeLeft)}
                    </p>
                  </div>
                </>
              )}

              <button
                onClick={handleProceedToPayment}
                disabled={!canProceedToPayment}
                className={`w-full h-14 bg-[#000000] text-[#ffffff] rounded-xl font-bold flex items-center justify-center space-x-[16px] transition-all ${
                  !canProceedToPayment ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[0.98]'
                }`}
              >
                <span>Proceed to Payment</span>
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>

              {!canProceedToPayment && (
                <p className="text-center text-[11px] font-medium text-[#ba1a1a] mt-[12px]">
                  {!passengerValid
                    ? bookingFor === 'other'
                      ? "Fill in the passenger's name, gender, and phone number."
                      : 'Fill in the passenger name and gender.'
                    : !contactValid
                    ? 'Verify your phone number to continue.'
                    : selectedSeats.length === 0
                    ? 'Select at least one seat to continue.'
                    : bikeError}
                </p>
              )}

              <p className="text-center text-[12px] font-medium text-[#46464f] mt-[16px]">
                By proceeding, you agree to our <a className="text-[#000000] underline" href="#">Terms of Service</a>
              </p>
            </div>

            <div className="bg-[#e1e2e4] rounded-xl p-[24px] border border-[#c7c5d1] flex items-center justify-between">
              <div className="flex items-center space-x-[16px]">
                <div className="w-10 h-10 bg-[#0f144c] rounded-full flex items-center justify-center">
                  <span className="material-symbols-outlined text-[#7a7fbb]">sell</span>
                </div>
                <div>
                  <p className="font-bold text-[14px]">{OPERATOR.promo.code}</p>
                  <p className="text-[12px] font-medium text-[#46464f]">Get 10% off on your first trip</p>
                </div>
              </div>
              <button onClick={applyPromo} className="text-[#000000] font-bold text-[14px] hover:underline transition-all">
                {promoApplied ? 'Remove' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      </main>

      <SeatSelectionDrawer
        isOpen={seatMapOpen}
        onClose={() => setSeatMapOpen(false)}
        selectedSeats={selectedSeats}
        onToggleSeat={toggleSeat}
        timeLeft={timeLeft}
        seatPrice={seatPrice}
        passengerGender={passengerGender}
        maxSeatsPerBooking={MAX_SEATS_PER_BOOKING}
        layout={trip.bus}
        taken={taken}
      />

      <ToastHost />
    </React.Fragment>
  );
}