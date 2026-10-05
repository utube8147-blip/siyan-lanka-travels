// app/(public)/(passenger)/my-bookings/page.tsx
'use client';

import { usePublicSettings } from '@/lib/extras';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SeatSelectionDrawer, { type Gender } from '@/components/SeatSelectionDrawer';
import { OPERATOR } from '@/config/operator';
import { NotificationOptIn } from '@/components/NotificationOptIn';
import { useQrDataUrl } from '@/lib/qr';
import { useStaggerIn } from '@/components/motion/useStaggerIn';
import { NextTripPanel } from '@/components/trip/NextTripPanel';
import { TripBell } from '@/components/trip/TripBell';
import { LoyaltyCard, PastTripsCard, WaitlistCard } from '@/components/trip/SidebarCards';
import { PaymentSlipCard } from '@/components/trip/PaymentSlipCard';
import { PayoutsCard } from '@/components/trip/PayoutsCard';
import { PaymentReturnNotice } from '@/components/trip/PaymentReturnNotice';
import { REWARDS_ENABLED } from '@/lib/features';
import { useAuth } from '@/contexts/AuthContext';
import { useStore, StoreLoading } from '@/lib/store';
import { toBookingView, type BookingView, type ViewStatus } from '@/lib/bookingView';
import { addDays, cityCode, formatDateLabel, formatLKR, formatTime12, getTrip, refundQuote, runsOn, takenSeats, seatsBesideLoneWoman, BESIDE_WOMAN_MESSAGE } from '@/lib/trips';
import { useT } from '@/lib/i18n';

type BookingStatus = ViewStatus;
type Booking = BookingView;

// Refund reference generator — mirrors genBookingRef() on /payment, but with
// a distinct RF- prefix so refund IDs are never confused with booking refs.
function genRefundId() {
  return 'RF-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

const STATUS_BADGE: Record<BookingStatus, { label: string; className: string }> = {
  confirmed: { label: 'Confirmed', className: 'bg-[#006e1c]/10 text-[#006e1c]' },
  pending: { label: 'Pending Approval', className: 'bg-[#feb700]/15 text-[#7c5800]' },
  completed: { label: 'Completed', className: 'bg-[#006e1c]/10 text-[#006e1c]' },
  cancelled: { label: 'Cancelled', className: 'bg-[#ba1a1a]/10 text-[#ba1a1a]' },
};

interface RescheduleOption {
  date: string; // label
  isoDate: string;
  departureTime: string;
  priceDelta: number;
}

function OperatorBadge({ operator }: { operator: string }) {
  return (
    <div
      className="w-7 h-7 rounded-md bg-[#050a44] text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0"
      title={operator}
    >
      {OPERATOR.initials}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action bar — cancel/reschedule/change-seats sit in the open, right on the
// ticket stub. Nothing to discover, nothing to click twice to reveal.
// ---------------------------------------------------------------------------
function TicketActionBar({
  booking,
  onChangeSeats,
  onReschedule,
  onCancel,
}: {
  booking: Booking;
  onChangeSeats: () => void;
  onReschedule: () => void;
  onCancel: () => void;
}) {
  if (booking.status !== 'confirmed') return null;

  const actionClass =
    'flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-bold uppercase tracking-wide transition-colors disabled:opacity-30 disabled:cursor-not-allowed';

  return (
    <div className="flex divide-x divide-[#e1e2e4] border-t border-[#e1e2e4] rounded-b-2xl overflow-hidden">
      <button
        onClick={onChangeSeats}
        disabled={!booking.seatsChangeable}
        className={`${actionClass} text-[#050a44] hover:bg-[#f2f4f6]`}
      >
        <span className="material-symbols-outlined text-[18px]">event_seat</span>
        Seats
      </button>
      <button
        onClick={onReschedule}
        disabled={!booking.reschedulable}
        className={`${actionClass} text-[#050a44] hover:bg-[#f2f4f6]`}
      >
        <span className="material-symbols-outlined text-[18px]">edit_calendar</span>
        Reschedule
      </button>
      <button onClick={onCancel} className={`${actionClass} text-[#ba1a1a] hover:bg-[#ba1a1a]/5`}>
        <span className="material-symbols-outlined text-[18px]">cancel</span>
        Cancel
      </button>
    </div>
  );
}

function CancelModal({
  booking,
  refund,
  isCancelling,
  onConfirm,
  onClose,
}: {
  booking: Booking;
  refund: { percent: number; amount: number };
  isCancelling: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-[24px] space-y-[16px]">
        <div className="w-11 h-11 rounded-full bg-[#ba1a1a]/10 flex items-center justify-center text-[#ba1a1a]">
          <span className="material-symbols-outlined text-[22px]">cancel</span>
        </div>
        <div>
          <h3 className="text-[16px] font-bold text-[#050a44]">Cancel this trip?</h3>
          <p className="text-[13px] text-[#46464f] mt-1.5 leading-relaxed">
            {booking.from} → {booking.to} on {booking.date}, seat{booking.seats.length > 1 ? 's' : ''}{' '}
            {booking.seats.join(', ')}. This can&apos;t be undone.
          </p>
          <p className="text-[13px] mt-2 font-semibold text-[#050a44]">
            {refund.amount > 0
              ? `You'll get ${formatLKR(refund.amount)} back (${refund.percent}% of the fare; the booking fee isn't refundable).`
              : 'This trip is too close to departure for a refund.'}
          </p>
        </div>
        <div className="flex gap-[10px] pt-[4px]">
          <button
            onClick={onClose}
            className="flex-1 h-11 rounded-xl border border-[#c7c5d1] font-bold text-[13px] text-[#46464f] hover:bg-[#f2f4f6] transition-colors"
          >
            Keep Booking
          </button>
          <button
            onClick={onConfirm}
            disabled={isCancelling}
            className="flex-1 h-11 rounded-xl bg-[#ba1a1a] text-white font-bold text-[13px] hover:opacity-90 disabled:opacity-60 transition-opacity"
          >
            {isCancelling ? 'Cancelling…' : 'Cancel Trip'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RescheduleModal({
  booking,
  options,
  onConfirm,
  onClose,
}: {
  booking: Booking;
  options: RescheduleOption[];
  onConfirm: (option: RescheduleOption) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const selectedOption = selected !== null ? options[selected] : null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-[24px] space-y-[16px]">
        <div>
          <h3 className="text-[16px] font-bold text-[#050a44]">Reschedule your trip</h3>
          <p className="text-[13px] text-[#46464f] mt-1">
            {booking.from} → {booking.to} · {booking.operator}
          </p>
        </div>

        <div className="space-y-[8px]">
          {options.length === 0 && (
            <p className="text-[13px] text-[#46464f]">Your seats aren&apos;t free on the next few departures. Contact us and we&apos;ll sort it out.</p>
          )}
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => setSelected(i)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-colors ${
                selected === i
                  ? 'border-[#050a44] bg-[#050a44]/5'
                  : 'border-[#e1e2e4] hover:bg-[#f2f4f6]'
              }`}
            >
              <div>
                <p className="text-[13px] font-bold text-[#050a44]">{opt.date}</p>
                <p className="text-[12px] font-semibold text-[#46464f]">{opt.departureTime}</p>
              </div>
              <span
                className={`text-[12px] font-extrabold px-2 py-1 rounded-md ${
                  opt.priceDelta > 0
                    ? 'bg-[#ba1a1a]/10 text-[#ba1a1a]'
                    : opt.priceDelta < 0
                    ? 'bg-[#006e1c]/10 text-[#006e1c]'
                    : 'bg-[#e1e2e4] text-[#46464f]'
                }`}
              >
                {opt.priceDelta === 0 ? 'No change' : `${opt.priceDelta > 0 ? '+' : '-'}${formatLKR(Math.abs(opt.priceDelta))}`}
              </span>
            </button>
          ))}
        </div>

        {selectedOption && selectedOption.priceDelta !== 0 && (
          <div
            className={`rounded-xl px-4 py-3 text-[12px] font-semibold ${
              selectedOption.priceDelta > 0
                ? 'bg-[#ba1a1a]/5 text-[#93000a]'
                : 'bg-[#006e1c]/5 text-[#005313]'
            }`}
          >
            {selectedOption.priceDelta > 0
              ? `This slot costs ${formatLKR(selectedOption.priceDelta)} more — you'll be charged the difference.`
              : `This slot is cheaper — a ${formatLKR(Math.abs(selectedOption.priceDelta))} refund will be issued.`}
          </div>
        )}

        <div className="flex gap-[10px] pt-[4px]">
          <button
            onClick={onClose}
            className="flex-1 h-11 rounded-xl border border-[#c7c5d1] font-bold text-[13px] text-[#46464f] hover:bg-[#f2f4f6] transition-colors"
          >
            Back
          </button>
          <button
            onClick={() => selectedOption && onConfirm(selectedOption)}
            disabled={!selectedOption}
            className="flex-1 h-11 rounded-xl bg-[#050a44] text-white font-bold text-[13px] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {selectedOption && selectedOption.priceDelta > 0
              ? `Pay ${formatLKR(selectedOption.priceDelta)} & Confirm`
              : 'Confirm New Date'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TicketModal({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const qr = useQrDataUrl(JSON.stringify({ ref: booking.bookingRef, op: 'SLT' }), 360);
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 print:relative print:inset-auto print:p-0 print:block">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] print:hidden"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden print:shadow-none print:rounded-none print:max-w-none">
        <div className="keep-navy bg-gradient-to-br from-[#1c1d22] to-[#111216] p-[24px] text-white flex items-center justify-between print:hidden">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[#ffd54a] font-bold">E-Ticket</p>
            <h3 className="text-[18px] font-bold">{booking.bookingRef}</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:bg-white/10"
            aria-label="Close ticket"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-[24px] space-y-[20px]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-[#6b6d78] uppercase">{booking.from}</p>
              <p className="text-[24px] font-extrabold text-[#050a44]">{cityCode(booking.from)}</p>
              <p className="text-[12px] font-medium text-[#46464f]">{booking.departureTime}</p>
            </div>
            <span className="material-symbols-outlined text-[#050a44] text-[22px]">arrow_forward</span>
            <div className="text-right">
              <p className="text-[10px] font-bold text-[#6b6d78] uppercase">{booking.to}</p>
              <p className="text-[24px] font-extrabold text-[#050a44]">{cityCode(booking.to)}</p>
              <p className="text-[12px] font-medium text-[#46464f]">{booking.arrivalTime}</p>
            </div>
          </div>

          <div className="border-t border-dashed border-[#c7c5d1]" />

          <div className="grid grid-cols-2 gap-[16px] text-[13px]">
            <div>
              <p className="text-[10px] font-bold text-[#6b6d78] uppercase mb-0.5">Date</p>
              <p className="font-bold text-[#050a44]">{booking.date}</p>
            </div>
            {booking.bikes.length > 0 ? (
              <div>
                <p className="text-[10px] font-bold text-[#6b6d78] uppercase mb-0.5">Luggage compartment</p>
                <p className="font-bold text-[#050a44] flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px] text-[#7c5800]">two_wheeler</span>
                  {booking.bikes.join(', ')}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-[10px] font-bold text-[#6b6d78] uppercase mb-0.5">Operator</p>
                <p className="font-bold text-[#050a44]">{booking.operator}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] font-bold text-[#6b6d78] uppercase mb-0.5">Seat{booking.seats.length > 1 ? 's' : ''}</p>
              <p className="font-bold text-[#050a44]">{booking.seats.join(', ')}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-[#6b6d78] uppercase mb-0.5">Class</p>
              <p className="font-bold text-[#050a44]">{booking.travelClass}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-[#6b6d78] uppercase mb-0.5">Bus</p>
              <p className="font-bold text-[#050a44]">{booking.busNumber}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-[#6b6d78] uppercase mb-0.5">Fare Paid</p>
              <p className="font-bold text-[#050a44]">{formatLKR(booking.totalPrice)}</p>
            </div>
          </div>

          <div className="border-t border-dashed border-[#c7c5d1]" />

          <div className="flex flex-col items-center py-[8px]">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt={`Ticket QR code ${booking.bookingRef}`} width={180} height={180} className="w-[180px] h-[180px] rounded-lg" />
            ) : (
              <div className="w-[180px] h-[180px] rounded-lg skeleton" />
            )}
            <p className="text-[11px] text-[#46464f] mt-1">Show this to the conductor when you board</p>
          </div>
          <p className="text-center text-[11px] font-bold text-[#46464f] tracking-widest">{booking.bookingRef}</p>
        </div>

        <div className="px-[24px] pb-[24px] print:hidden">
          <button
            onClick={() => window.print()}
            className="w-full h-12 bg-[#050a44] text-white rounded-xl font-bold text-[13px] hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">print</span>
            Print / Save Ticket
          </button>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:relative,
          .print\\:relative * {
            visibility: visible;
          }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card/wallet helpers — same formatting rules as /payment/page.tsx, so the
// settlement modal below feels identical to the original checkout.
// ---------------------------------------------------------------------------
function formatCardNumber(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

type PaySettleMethod = 'card' | 'wallet';

// ---------------------------------------------------------------------------
// Settlement modal — any time managing a booking creates money owed (a
// pricier reschedule slot, extra seats), it gets collected here before the
// change takes effect. Refunds don't need this; only charges do — those are
// routed to /refund instead (see confirmCancel / confirmReschedule / confirmSeatChange).
// ---------------------------------------------------------------------------
function PaymentSettleModal({
  amount,
  reason,
  contactPhone,
  onSuccess,
  onClose,
}: {
  amount: number;
  reason: string;
  contactPhone?: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PaySettleMethod>('card');
  const [cardNumber, setCardNumber] = useState('');
  const [cardName, setCardName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [wallet, setWallet] = useState<'ezcash' | 'mcash' | 'frimi' | ''>('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const cardValid =
    cardNumber.replace(/\s/g, '').length === 16 &&
    cardName.trim().length > 1 &&
    /^\d{2}\/\d{2}$/.test(expiry) &&
    cvv.length === 3;
  const walletValid = wallet !== '';
  const canPay = method === 'card' ? cardValid : walletValid;

  const handlePay = () => {
    setError('');
    if (!canPay) {
      setError(method === 'card' ? 'Fill in all card details correctly.' : 'Select a wallet provider to continue.');
      return;
    }
    setProcessing(true);
    setTimeout(() => {
      setProcessing(false);
      onSuccess();
    }, 1400);
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => !processing && onClose()} />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
        <div className="px-[24px] pt-[24px] pb-[16px] border-b border-[#e1e2e4]">
          <p className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide">{reason}</p>
          <div className="flex items-baseline justify-between mt-1">
            <h3 className="text-[16px] font-bold text-[#050a44]">Additional fare due</h3>
            <span className="text-[22px] font-extrabold text-[#050a44]">{formatLKR(amount)}</span>
          </div>
        </div>

        <div className="px-[24px] py-[20px] space-y-[16px]">
          <div className="flex p-1 bg-[#f2f4f6] rounded-xl border border-[#e1e2e4]/60">
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
                    wallet === w.id ? 'border-[#050a44] bg-[#050a44]/5' : 'border-[#e1e2e4] hover:bg-[#f2f4f6]'
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
                <p className="text-[11px] text-[#6b6d78] mt-[8px] px-1">
                  You'll receive a payment prompt on {contactPhone || 'your registered number'} to confirm.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-[11px] font-medium text-[#ba1a1a] text-center">{error}</p>}
        </div>

        <div className="px-[24px] pb-[24px] flex gap-[10px]">
          <button
            onClick={onClose}
            disabled={processing}
            className="flex-1 h-11 rounded-xl border border-[#c7c5d1] font-bold text-[13px] text-[#46464f] hover:bg-[#f2f4f6] disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePay}
            disabled={processing}
            className={`flex-1 h-11 rounded-xl bg-black text-white font-bold text-[13px] flex items-center justify-center gap-2 transition-all ${
              processing ? 'opacity-70 cursor-wait' : 'hover:opacity-90'
            }`}
          >
            {processing ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                Processing…
              </>
            ) : (
              `Pay ${formatLKR(amount)}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MyBookingsPage() {
  const { t } = useT();
  const router = useRouter();
  const { user, mode: authMode } = useAuth();
  const { data, ready, updateBooking } = useStore();
  const bookings = useMemo<Booking[]>(
    () =>
      data.bookings
        .filter((b) => user && b.userId === user.id)
        .map((b) => toBookingView(b, data))
        .sort((a, b) => a.sortKey - b.sortKey),
    [data, user],
  );
  const rawOf = (id: string) => data.bookings.find((b) => b.id === id);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Booking | null>(null);
  const [seatChangeTarget, setSeatChangeTarget] = useState<Booking | null>(null);
  const [ticketTarget, setTicketTarget] = useState<Booking | null>(null);
  // Links in the booking text, email and notifications are
  // /my-bookings?ref=SLT-XXXXXX: open that ticket straight away (once).
  const [linkedRef, setLinkedRef] = useState<string | null>(null);
  useEffect(() => {
    setLinkedRef((new URLSearchParams(window.location.search).get('ref') ?? '').toUpperCase() || null);
  }, []);
  useEffect(() => {
    if (!linkedRef || !ready) return;
    const hit = bookings.find((b) => b.bookingRef.toUpperCase() === linkedRef);
    if (hit) setTicketTarget(hit);
    setLinkedRef(null);
  }, [linkedRef, ready, bookings]);
  const [draftSeats, setDraftSeats] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const pub = usePublicSettings();

  // Any change that costs the passenger more money is held here until it's
  // actually paid — nothing gets applied to the booking until settlement
  // succeeds. Refunds (cancellation, a cheaper reschedule, dropping a seat)
  // skip this and instead hand off to /refund once applied, so the passenger
  // gets the same confirmation surface every time money comes back to them.
  const [settlement, setSettlement] = useState<{
    amount: number;
    reason: string;
    commit: () => void;
  } | null>(null);

  const upcoming = bookings.filter((b) => b.status === 'confirmed' || b.status === 'pending');
  const tripsRef = useStaggerIn<HTMLDivElement>(ready && upcoming.length > 0);
  const cancelRefund = useMemo(() => {
    const raw = cancelTarget ? rawOf(cancelTarget.id) : undefined;
    if (!raw) return { percent: 0, amount: 0 };
    return refundQuote(raw, getTrip(data, raw.scheduleId, raw.date, raw.from, raw.to));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelTarget, data]);
  const rescheduleOptions = useMemo<RescheduleOption[]>(() => {
    const raw = rescheduleTarget ? rawOf(rescheduleTarget.id) : undefined;
    if (!raw) return [];
    const out: RescheduleOption[] = [];
    for (let i = 1; i <= 14 && out.length < 3; i++) {
      const iso = addDays(raw.date, i);
      const trip = getTrip(data, raw.scheduleId, iso, raw.from, raw.to);
      if (!trip || trip.closed) continue;
      const sch = data.schedules.find((s) => s.id === raw.scheduleId);
      if (!sch || !sch.active || !runsOn(sch, iso)) continue;
      const taken = takenSeats(data.bookings, raw.scheduleId, iso, raw.id);
      if (raw.seats.some((s) => taken.has(s))) continue;
      out.push({ date: formatDateLabel(iso), isoDate: iso, departureTime: formatTime12(trip.departure), priceDelta: (trip.fare - raw.fare) * raw.seats.length });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rescheduleTarget, data]);
  const past = bookings.filter((b) => b.status === 'completed' || b.status === 'cancelled');
  const rewardsPoints = 4200;
  const pointsToNextReward = 300;
  const rewardsProgress = 85;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Sends the passenger to the shared refund confirmation page. Every refund
  // path (cancel, cheaper reschedule, fewer seats) funnels through here so
  // the amount, reference, and status tracker always look the same.
  const goToRefund = (
    booking: Booking,
    amount: number,
    reason: 'cancelled' | 'rescheduled' | 'seats-changed',
    extra?: { newDate?: string; newSeats?: string }
  ) => {
    const qs = new URLSearchParams({
      ref: booking.bookingRef,
      from: booking.from,
      to: booking.to,
      date: booking.date,
      operator: booking.operator,
      amount: amount.toFixed(2),
      reason,
      refundId: genRefundId(),
      ...(extra?.newDate ? { newDate: extra.newDate } : {}),
      ...(extra?.newSeats ? { newSeats: extra.newSeats } : {}),
    });
    router.push(`/refund?${qs.toString()}`);
  };

  const confirmCancel = () => {
    if (!cancelTarget) return;
    const booking = cancelTarget;
    const id = booking.id;
    setCancellingId(id);
    const refund = cancelRefund;
    setTimeout(async () => {
      const res = await updateBooking(id, { status: 'cancelled', refund: { amount: refund.amount, at: new Date().toISOString() } });
      setCancellingId(null);
      setCancelTarget(null);
      if (!res.ok) {
        setToast(res.reason ?? 'Could not cancel.');
        return;
      }
      goToRefund(booking, refund.amount, 'cancelled');
    }, 900);
  };

  const confirmReschedule = (option: RescheduleOption) => {
    if (!rescheduleTarget) return;
    const booking = rescheduleTarget;
    const id = booking.id;
    const newDate = option.date;
    const newDeparture = option.departureTime;
    const delta = option.priceDelta;

    void newDeparture;
    const applyChange = async () => {
      const res = await updateBooking(id, { date: option.isoDate, total: booking.totalPrice + delta });
      if (!res.ok) setToast(res.reason ?? 'Could not reschedule.');
    };

    setRescheduleTarget(null);

    if (delta > 0) {
      setSettlement({
        amount: delta,
        reason: `Reschedule to ${newDate}`,
        commit: () => {
          applyChange();
          setToast(`Rescheduled to ${newDate} — ${formatLKR(delta)} charged.`);
        },
      });
    } else if (delta < 0) {
      applyChange();
      goToRefund(booking, Math.abs(delta), 'rescheduled', { newDate });
    } else {
      applyChange();
      setToast(`Rescheduled to ${newDate}.`);
    }
  };

  const openSeatChange = (booking: Booking) => {
    setSeatChangeTarget(booking);
    setDraftSeats(booking.seats);
  };

  const confirmSeatChange = () => {
    if (!seatChangeTarget) return;
    if (draftSeats.length === 0) return; // never leave a booking with no seats

    const booking = seatChangeTarget;
    const id = booking.id;
    const newSeats = draftSeats;
    const delta = (draftSeats.length - booking.seats.length) * booking.seatPrice;

    const applyChange = async () => {
      const res = await updateBooking(id, { seats: newSeats, total: booking.totalPrice + delta });
      if (!res.ok) setToast(res.reason ?? 'Could not change seats.');
    };

    setSeatChangeTarget(null);

    if (delta > 0) {
      setSettlement({
        amount: delta,
        reason: `Seat change (${newSeats.join(', ')})`,
        commit: () => {
          applyChange();
          setToast(`Seats updated — ${formatLKR(delta)} charged.`);
        },
      });
    } else if (delta < 0) {
      applyChange();
      goToRefund(booking, Math.abs(delta), 'seats-changed', { newSeats: newSeats.join(',') });
    } else {
      applyChange();
      setToast('Seats updated.');
    }
  };

  // The booking whose seats are being changed, and the seats kept for women on its trip.
  const seatChangeRaw = seatChangeTarget ? rawOf(seatChangeTarget.id) : undefined;
  const seatChangeGender = seatChangeRaw?.passenger.gender ?? '';
  const seatChangeBus = seatChangeRaw ? data.buses.find((b) => b.id === data.schedules.find((x) => x.id === seatChangeRaw.scheduleId)?.busId) : undefined;
  const seatChangeWomenOnly =
    seatChangeRaw && seatChangeBus && pub.ladiesAdjacent ? seatsBesideLoneWoman(data.bookings, seatChangeBus, seatChangeRaw.scheduleId, seatChangeRaw.date, user?.id, seatChangeRaw.id) : new Set<string>();
  const toggleDraftSeat = (seatId: string) => {
    // A seat beside a woman travelling alone is kept for women (the database checks the same when the change is saved).
    if (!draftSeats.includes(seatId) && seatChangeWomenOnly.has(seatId) && seatChangeGender !== 'Female') {
      setToast(BESIDE_WOMAN_MESSAGE(seatId));
      setTimeout(() => setToast(null), 5000);
      return;
    }
    setDraftSeats((prev) => (prev.includes(seatId) ? prev.filter((s) => s !== seatId) : [...prev, seatId]));
  };

  if (!ready) return <StoreLoading />;

  const seatChangeTrip = seatChangeRaw ? getTrip(data, seatChangeRaw.scheduleId, seatChangeRaw.date, seatChangeRaw.from, seatChangeRaw.to) : null;

  return (
    <main className="max-w-[1440px] mx-auto px-4 md:px-[64px] py-[32px]">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] bg-[#050a44] text-white px-4 py-3 rounded-xl shadow-lg text-sm font-semibold animate-[fadeIn_0.2s_ease-out]">
          {toast}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-[32px]">
        {/* Main content */}
        <div className="flex-1 space-y-[40px] min-w-0">
          {/* Hero */}
          <section className="keep-navy relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1c1d22] to-[#111216] p-[32px] md:p-[40px] text-white shadow-lg">
            <div
              className="absolute inset-0 opacity-[0.07] pointer-events-none"
              style={{
                backgroundImage: 'radial-gradient(circle, #ffffff 1.5px, transparent 1.5px)',
                backgroundSize: '18px 18px',
              }}
            />
            <div className="relative flex flex-col md:flex-row justify-between items-center gap-[24px]">
              <div className="space-y-[12px] max-w-md text-center md:text-left">
                <span className="inline-block text-[10px] font-bold uppercase tracking-[0.2em] text-[#ffd54a]">
                  {OPERATOR.name}
                </span>
                <h1 className="hidden md:block text-[28px] md:text-[32px] font-extrabold tracking-tight leading-tight">Your Journeys</h1>
                <p className="text-white/70 text-[14px] md:text-[15px]">
                  Change seats, move to another day or cancel. Show the ticket to the conductor when you board.
                </p>
                <div className="flex gap-[12px] pt-[8px] justify-center md:justify-start">
                  <div className="bg-white/10 px-4 py-2 rounded-lg backdrop-blur-sm border border-white/15">
                    <span className="block text-[10px] uppercase tracking-widest text-[#ffd54a] font-bold">Upcoming</span>
                    <span className="text-[18px] font-bold">{upcoming.length} Trips</span>
                  </div>
                  {REWARDS_ENABLED && authMode === 'demo' && (
<div className="bg-white/10 px-4 py-2 rounded-lg backdrop-blur-sm border border-white/15">
                    <span className="block text-[10px] uppercase tracking-widest text-[#ffd54a] font-bold">Rewards</span>
                    <span className="text-[18px] font-bold">{(rewardsPoints / 1000).toFixed(1)}k pts</span>
                  </div>
)}
                </div>
              </div>
              <div className="relative hidden md:block w-full md:w-80 h-40 md:h-48 rounded-xl overflow-hidden shadow-xl border-4 border-white/10 flex-shrink-0">
                <img
                  alt="Siyan Lanka coach interior"
                  className="w-full h-full object-cover"
                  src="/brand/interior.png"
                />
              </div>
            </div>
          </section>

          {/* Upcoming journeys */}
          <PaymentReturnNotice />
          <NextTripPanel />
          <PaymentSlipCard />
          <PayoutsCard />
          <section>
            <div className="flex items-center justify-between mb-[16px]">
              <h2 className="text-[18px] font-bold text-[#050a44] flex items-center gap-2">
                <span className="material-symbols-outlined text-[#feb700]">event_upcoming</span>
                {t('Upcoming Journeys')}
              </h2>
              {upcoming.length > 0 && (
                <button className="text-[#050a44] font-bold text-[12px] hover:underline">View All</button>
              )}
            </div>

            {upcoming.length === 0 ? (
              <div className="bg-white rounded-2xl border border-[#c7c5d1] shadow-sm p-[32px] text-center">
                <p className="text-[13px] text-[#46464f]">
                  {user ? 'No upcoming trips on this account.' : 'Sign in to see trips booked with your account.'}
                </p>
                <Link href="/search" className="inline-block mt-4 px-5 py-2.5 bg-[#050a44] text-white rounded-xl text-[13px] font-bold">
                  Book a seat
                </Link>
              </div>
            ) : (
              <div ref={tripsRef} className="grid grid-cols-1 md:grid-cols-2 gap-x-[16px] gap-y-[28px]">
                {upcoming.map((booking) => {
                  const isPending = booking.status === 'pending';
                  const isCancelling = cancellingId === booking.id;

                  return (
                    <div
                      key={booking.id}
                      className="relative bg-white rounded-2xl shadow-sm hover:shadow-md border border-[#c7c5d1] transition-shadow"
                    >
                      <div className="p-[20px] pb-[16px]">
                        <div className="flex justify-between items-start mb-[16px]">
                          <span
                            className={`px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider ${STATUS_BADGE[booking.status].className}`}
                          >
                            {STATUS_BADGE[booking.status].label}
                          </span>
                          <span className="text-[#6b6d78] text-[11px] font-mono tracking-wide">{booking.bookingRef}</span>
                        </div>

                        <div className="flex justify-between items-center relative py-[8px]">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-[#6b6d78] font-bold uppercase">{booking.from}</span>
                            <span className="text-[22px] font-extrabold text-[#050a44]">{cityCode(booking.from)}</span>
                            <span className="text-[12px] font-medium text-[#46464f]">{booking.departureTime}</span>
                          </div>

                          <div className="flex-1 flex items-center justify-center px-4 relative">
                            <div className="w-full h-px border-t border-dashed border-[#c7c5d1] absolute" />
                            <span
                              className={`material-symbols-outlined bg-white z-10 scale-125 ${
                                isPending ? 'text-[#7c5800]' : 'text-[#050a44]'
                              }`}
                            >
                              {isPending ? 'hourglass_empty' : 'directions_bus'}
                            </span>
                          </div>

                          <div className="flex flex-col items-end">
                            <span className="text-[10px] text-[#6b6d78] font-bold uppercase">{booking.to}</span>
                            <span className="text-[22px] font-extrabold text-[#050a44]">{cityCode(booking.to)}</span>
                            <span className="text-[12px] font-medium text-[#46464f]">{booking.arrivalTime}</span>
                          </div>
                        </div>

                        {/* The trip details keep a readable width; when the buttons don't fit beside them they drop to their own row. */}
                        <div className="mt-[16px] flex flex-wrap justify-between items-center gap-x-[12px] gap-y-[12px]">
                          <div className="flex items-center gap-2 min-w-[200px] flex-1">
                            <OperatorBadge operator={booking.operator} />
                            <div className="min-w-0">
                              <p className="text-[12px] text-[#46464f] font-medium whitespace-nowrap">
                                {booking.date} · Seat{booking.seats.length > 1 ? 's' : ''} {booking.seats.join(', ')}
                              </p>
                              <p className="text-[12px] text-[#050a44] font-bold truncate">{booking.travelClass}</p>
                            </div>
                          </div>

                          {/* Phones: the three buttons share one row, equal widths. Wider: their natural size, on the right. */}
                          <div className="flex items-start gap-2 w-full sm:w-auto">
                          {isPending ? (
                            <button
                              disabled
                              className="bg-[#f2f4f6] text-[#6b6d78] px-4 py-2.5 rounded-xl font-bold text-[12px] cursor-not-allowed whitespace-nowrap"
                            >
                              Ticket Pending
                            </button>
                          ) : isCancelling ? (
                            <button
                              disabled
                              className="bg-[#e1e2e4] text-[#6b6d78] px-4 py-2.5 rounded-xl font-bold text-[12px] cursor-not-allowed whitespace-nowrap"
                            >
                              Cancelling…
                            </button>
                          ) : (
                            <>
                            <TripBell bookingId={booking.id} size="sm" className="flex-1 sm:flex-none" />
                            <a
                              href={`/track?ref=${booking.bookingRef}`}
                              className="flex-1 sm:flex-none h-[38px] justify-center bg-[#feb700] text-[#14120a] px-2 sm:px-3 rounded-xl font-bold text-[12px] hover:brightness-105 transition-all flex items-center gap-1 whitespace-nowrap"
                            >
                              <span className="material-symbols-outlined text-[14px]">my_location</span>
                              Track
                            </a>
                            <button
                              onClick={() => setTicketTarget(booking)}
                              className="flex-1 sm:flex-none h-[38px] justify-center bg-[#050a44] text-white px-2 sm:px-4 rounded-xl font-bold text-[12px] hover:opacity-90 transition-all flex items-center gap-1.5 whitespace-nowrap"
                            >
                              View Ticket
                              <span className="material-symbols-outlined text-[14px]">confirmation_number</span>
                            </button>
                            </>
                          )}
                          </div>
                        </div>
                      </div>

                      {booking.status === 'confirmed' && (
                        <>
                          {/* Perforation: this is a ticket stub, not a generic card */}
                          <div className="relative">
                            <div className="absolute -left-[9px] top-0 -translate-y-1/2 w-[18px] h-[18px] rounded-full bg-[#f7f8fa] border border-[#c7c5d1]" />
                            <div className="absolute -right-[9px] top-0 -translate-y-1/2 w-[18px] h-[18px] rounded-full bg-[#f7f8fa] border border-[#c7c5d1]" />
                            <div className="mx-[18px] border-t border-dashed border-[#c7c5d1]" />
                          </div>
                          <TicketActionBar
                            booking={booking}
                            onChangeSeats={() => openSeatChange(booking)}
                            onReschedule={() => setRescheduleTarget(booking)}
                            onCancel={() => setCancelTarget(booking)}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Sidebar — informational only now; actions live on the booking they affect */}
        <aside className="w-full lg:w-[300px] flex-shrink-0 space-y-[20px]">
          <NotificationOptIn />
          <WaitlistCard />
          <PastTripsCard />
          {/* Rewards are parked (lib/features.ts → REWARDS_ENABLED). */}
          {REWARDS_ENABLED && <LoyaltyCard />}
          {REWARDS_ENABLED && authMode === 'demo' && (
          <div className="bg-white rounded-2xl p-[20px] shadow-sm border border-[#c7c5d1] space-y-[12px] relative overflow-hidden">
            <h4 className="font-bold text-[#050a44] text-[14px]">{OPERATOR.shortName} Rewards</h4>
            <p className="text-[12px] text-[#46464f]">
              You're only <span className="font-bold text-[#050a44]">{pointsToNextReward} pts</span> away from a free Gold-class upgrade!
            </p>
            <div className="w-full bg-[#f2f4f6] h-2 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#feb700] to-[#ffe08a]"
                style={{ width: `${rewardsProgress}%` }}
              />
            </div>
            <button className="text-[#7c5800] text-[11px] font-extrabold uppercase tracking-widest hover:underline">
              Explore Perks →
            </button>
          </div>
          )}


          <div className="bg-[#f2f4f6] rounded-2xl p-[20px] border border-[#e1e2e4] space-y-[8px]">
            <h4 className="font-bold text-[#050a44] text-[14px] flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">support_agent</span>
              Need Help?
            </h4>
            <p className="text-[11px] text-[#46464f] leading-relaxed">
              Contact us about changes, lost items or group bookings.
            </p>
            <div className="pt-[4px] space-y-1">
              {OPERATOR.contact.phone ? (
                <a className="text-[#050a44] font-bold text-[13px] block" href={OPERATOR.contact.phoneHref}>{OPERATOR.contact.phone}</a>
              ) : null}
              <a className="text-[#46464f] text-[11px] underline block" href={`mailto:${OPERATOR.contact.email}`}>
                {OPERATOR.contact.email}
              </a>
            </div>
          </div>
        </aside>
      </div>

      {cancelTarget && (
        <CancelModal
          booking={cancelTarget}
          refund={cancelRefund}
          isCancelling={cancellingId === cancelTarget.id}
          onConfirm={confirmCancel}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {rescheduleTarget && (
        <RescheduleModal
          booking={rescheduleTarget}
          options={rescheduleOptions}
          onConfirm={confirmReschedule}
          onClose={() => setRescheduleTarget(null)}
        />
      )}

      {seatChangeTarget && seatChangeRaw && seatChangeTrip && (
        <SeatSelectionDrawer
          layout={seatChangeTrip.bus}
          taken={takenSeats(data.bookings, seatChangeRaw.scheduleId, seatChangeRaw.date, seatChangeRaw.id)}
          isOpen={true}
          onClose={confirmSeatChange}
          selectedSeats={draftSeats}
          onToggleSeat={toggleDraftSeat}
          womenOnly={[...seatChangeWomenOnly]}
          timeLeft={600}
          seatPrice={seatChangeTarget.seatPrice}
          passengerGender={seatChangeGender as Gender}
          maxSeatsPerBooking={OPERATOR.maxSeatsPerBooking}
          originalSeatCount={seatChangeTarget.seats.length}
        />
      )}

      {ticketTarget && <TicketModal booking={ticketTarget} onClose={() => setTicketTarget(null)} />}

      {settlement && (
        <PaymentSettleModal
          amount={settlement.amount}
          reason={settlement.reason}
          onSuccess={() => {
            settlement.commit();
            setSettlement(null);
          }}
          onClose={() => setSettlement(null)}
        />
      )}

      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </main>
  );
}