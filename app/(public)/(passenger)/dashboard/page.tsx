// app/(public)/(passenger)/dashboard/page.tsx
'use client';

import { useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { OPERATOR } from '@/config/operator';
import { useAuth } from '@/contexts/AuthContext';
import { useStore, StoreLoading } from '@/lib/store';
import { toBookingView, type BookingView, type ViewStatus } from '@/lib/bookingView';
import { cityCode, formatLKR } from '@/lib/trips';
import AnimatedNumber from '@/components/motion/AnimatedNumber';
import { listForResale, useMyListings, useResaleEnabled, withdrawListing } from '@/lib/resale';
import { supabase } from '@/lib/supabase/client';

type BookingStatus = ViewStatus;
type Booking = BookingView;

const STATUS_BADGE: Record<BookingStatus, { label: string; className: string }> = {
  confirmed: { label: 'Confirmed', className: 'bg-[#006e1c]/10 text-[#006e1c]' },
  pending: { label: 'Pending Approval', className: 'bg-[#feb700]/15 text-[#7c5800]' },
  completed: { label: 'Completed', className: 'text-[#006e1c] font-bold' },
  cancelled: { label: 'Cancelled', className: 'text-[#ba1a1a] font-bold' },
};

function OperatorBadge({ operator }: { operator: string }) {
  return (
    <div className="w-9 h-9 rounded-md bg-[#050a44] text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0" title={operator}>
      {OPERATOR.initials}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resale listings
// ---------------------------------------------------------------------------
type ResaleStatus = 'active' | 'sold' | 'expired';

const RESALE_STATUS_BADGE: Record<ResaleStatus, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-[#006e1c]/10 text-[#006e1c]' },
  sold: { label: 'Sold', className: 'bg-[#050a44]/10 text-[#050a44]' },
  expired: { label: 'Expired', className: 'bg-[#f1f3f9] text-[#6b6d78]' },
};

interface ResaleListing {
  id: string;
  bookingId: string;
  route: string;
  date: string;
  seat: string;
  originalPrice: number;
  listedPrice: number;
  status: ResaleStatus;
}

const INITIAL_RESALE_LISTINGS: ResaleListing[] = [
  { id: 'RL-1038', bookingId: 'old-1', route: 'CMB → BTC', date: 'Aug 7, 2026', seat: '7D', originalPrice: 2400, listedPrice: 2200, status: 'sold' },
  { id: 'RL-1021', bookingId: 'old-2', route: 'AKP → CMB', date: 'May 25, 2026', seat: '1C', originalPrice: 2800, listedPrice: 2600, status: 'expired' },
];

// ---------------------------------------------------------------------------
// Small shared modal shell — every modal on this page uses the same
// backdrop + card treatment already established by CancelModal /
// RescheduleModal in my-bookings/page.tsx.
// ---------------------------------------------------------------------------
function ModalShell({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full p-[24px] space-y-[16px] ${wide ? 'max-w-md' : 'max-w-sm'}`}>
        {children}
      </div>
    </div>
  );
}

function EditPersonalDetailsModal({
  details,
  onSave,
  onClose,
}: {
  details: { name: string; email: string; phone: string };
  onSave: (d: { name: string; email: string; phone: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(details.name);
  const [email, setEmail] = useState(details.email);
  const [phone, setPhone] = useState(details.phone);
  const valid = name.trim().length > 1 && /\S+@\S+\.\S+/.test(email) && phone.trim().length > 3;

  return (
    <ModalShell onClose={onClose}>
      <div>
        <h3 className="text-[16px] font-bold text-[#050a44]">Edit personal details</h3>
        <p className="text-[13px] text-[#46464f] mt-1">These appear on every ticket you book.</p>
      </div>
      <div className="space-y-[10px]">
        <div>
          <label className="text-[11px] font-bold text-[#46464f] px-1">Full name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44]" />
        </div>
        <div>
          <label className="text-[11px] font-bold text-[#46464f] px-1">Email address</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44]" />
        </div>
        <div>
          <label className="text-[11px] font-bold text-[#46464f] px-1">Phone number</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44]" />
        </div>
      </div>
      <div className="flex gap-[10px] pt-[4px]">
        <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#c7c5d1] font-bold text-[13px] text-[#46464f] hover:bg-[#f2f4f6] transition-colors">
          Cancel
        </button>
        <button
          onClick={() => valid && onSave({ name, email, phone })}
          disabled={!valid}
          className="flex-1 h-11 rounded-xl bg-[#050a44] text-white font-bold text-[13px] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          Save Changes
        </button>
      </div>
    </ModalShell>
  );
}

function AddFundsModal({ onConfirm, onClose }: { onConfirm: (amount: number) => void; onClose: () => void }) {
  const [amount, setAmount] = useState<number | ''>('');
  const presets = [1000, 2500, 5000, 10000];
  const [processing, setProcessing] = useState(false);
  const valid = typeof amount === 'number' && amount > 0;

  return (
    <ModalShell onClose={onClose}>
      <div>
        <h3 className="text-[16px] font-bold text-[#050a44]">Add funds</h3>
        <p className="text-[13px] text-[#46464f] mt-1">Top up your travel credit from your saved card.</p>
      </div>
      <div className="grid grid-cols-4 gap-[8px]">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => setAmount(p)}
            className={`h-10 rounded-lg text-[13px] font-bold border transition-colors ${
              amount === p ? 'border-[#050a44] bg-[#050a44]/5 text-[#050a44]' : 'border-[#e1e2e4] text-[#46464f] hover:bg-[#f2f4f6]'
            }`}
          >
            {p.toLocaleString('en-LK')}
          </button>
        ))}
      </div>
      <div>
        <label className="text-[11px] font-bold text-[#46464f] px-1">Custom amount</label>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value ? Number(e.target.value.replace(/\D/g, '')) : '')}
          inputMode="numeric"
          placeholder="Enter amount"
          className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44] placeholder:text-[#9a9ba5] placeholder:font-normal"
        />
      </div>
      <div className="flex gap-[10px] pt-[4px]">
        <button onClick={onClose} disabled={processing} className="flex-1 h-11 rounded-xl border border-[#c7c5d1] font-bold text-[13px] text-[#46464f] hover:bg-[#f2f4f6] disabled:opacity-50 transition-colors">
          Cancel
        </button>
        <button
          onClick={() => {
            if (!valid) return;
            setProcessing(true);
            setTimeout(() => {
              setProcessing(false);
              onConfirm(amount as number);
            }, 1000);
          }}
          disabled={!valid || processing}
          className="flex-1 h-11 rounded-xl bg-black text-white font-bold text-[13px] flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {processing ? (
            <>
              <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
              Processing…
            </>
          ) : (
            `Add ${valid ? formatLKR(amount as number) : 'funds'}`
          )}
        </button>
      </div>
    </ModalShell>
  );
}

interface Transaction {
  id: string;
  label: string;
  date: string;
  amount: number;
}

function WalletHistoryModal({ transactions, onClose }: { transactions: Transaction[]; onClose: () => void }) {
  return (
    <ModalShell onClose={onClose} wide>
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-bold text-[#050a44]">Wallet history</h3>
        <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[#46464f] hover:bg-[#f2f4f6]" aria-label="Close">
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
      <div className="divide-y divide-[#e1e2e4] max-h-[320px] overflow-y-auto -mx-[24px] px-[24px]">
        {transactions.map((t) => (
          <div key={t.id} className="flex items-center justify-between py-[12px]">
            <div>
              <p className="text-[13px] font-bold text-[#050a44]">{t.label}</p>
              <p className="text-[11px] text-[#46464f]">{t.date}</p>
            </div>
            <span className={`text-[13px] font-extrabold ${t.amount >= 0 ? 'text-[#006e1c]' : 'text-[#ba1a1a]'}`}>
              {t.amount >= 0 ? '+' : '-'}{formatLKR(Math.abs(t.amount))}
            </span>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

function ListNewListingModal({
  eligibleBookings,
  onSubmit,
  onClose,
}: {
  eligibleBookings: Booking[];
  onSubmit: (booking: Booking, price: number) => void;
  onClose: () => void;
}) {
  const [bookingId, setBookingId] = useState(eligibleBookings[0]?.id ?? '');
  const [price, setPrice] = useState<number | ''>('');
  const booking = eligibleBookings.find((b) => b.id === bookingId);
  const valid = booking && typeof price === 'number' && price > 0;

  if (eligibleBookings.length === 0) {
    return (
      <ModalShell onClose={onClose}>
        <h3 className="text-[16px] font-bold text-[#050a44]">Nothing to list yet</h3>
        <p className="text-[13px] text-[#46464f]">
          Only confirmed, unlisted upcoming trips can be resold. Book a trip first, then come back here.
        </p>
        <button onClick={onClose} className="w-full h-11 rounded-xl bg-[#050a44] text-white font-bold text-[13px] hover:opacity-90 transition-opacity">
          Got it
        </button>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose}>
      <div>
        <h3 className="text-[16px] font-bold text-[#050a44]">Sell your unused ticket</h3>
        <p className="text-[13px] text-[#46464f] mt-1">Pick a trip and set your price. Buyers pay us directly and we pass the money on to you.</p>
      </div>
      <div>
        <label className="text-[11px] font-bold text-[#46464f] px-1">Trip</label>
        <select
          value={bookingId}
          onChange={(e) => setBookingId(e.target.value)}
          className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44]"
        >
          {eligibleBookings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.from} → {b.to} · {b.date} · Seat {b.seats.join(', ')}
            </option>
          ))}
        </select>
      </div>
      {booking && (
        <p className="text-[12px] text-[#46464f] px-1">
          Original fare: <span className="font-bold text-[#050a44]">{formatLKR(booking.totalPrice)}</span>
        </p>
      )}
      <div>
        <label className="text-[11px] font-bold text-[#46464f] px-1">Your asking price</label>
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value ? Number(e.target.value.replace(/\D/g, '')) : '')}
          inputMode="numeric"
          placeholder="Enter price"
          className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44] placeholder:text-[#9a9ba5] placeholder:font-normal"
        />
      </div>
      <div className="flex gap-[10px] pt-[4px]">
        <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#c7c5d1] font-bold text-[13px] text-[#46464f] hover:bg-[#f2f4f6] transition-colors">
          Cancel
        </button>
        <button
          onClick={() => valid && booking && onSubmit(booking, price as number)}
          disabled={!valid}
          className="flex-1 h-11 rounded-xl bg-[#050a44] text-white font-bold text-[13px] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          List Ticket
        </button>
      </div>
    </ModalShell>
  );
}

function EditListingPriceModal({ listing, onSave, onClose }: { listing: ResaleListing; onSave: (price: number) => void; onClose: () => void }) {
  const [price, setPrice] = useState<number>(listing.listedPrice);
  return (
    <ModalShell onClose={onClose}>
      <h3 className="text-[16px] font-bold text-[#050a44]">Edit asking price</h3>
      <p className="text-[13px] text-[#46464f]">
        {listing.route} · {listing.date} · Seat {listing.seat}
      </p>
      <input
        value={price}
        onChange={(e) => setPrice(Number(e.target.value.replace(/\D/g, '')) || 0)}
        inputMode="numeric"
        className="w-full px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44]"
      />
      <div className="flex gap-[10px] pt-[4px]">
        <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#c7c5d1] font-bold text-[13px] text-[#46464f] hover:bg-[#f2f4f6] transition-colors">
          Cancel
        </button>
        <button
          onClick={() => price > 0 && onSave(price)}
          disabled={price <= 0}
          className="flex-1 h-11 rounded-xl bg-[#050a44] text-white font-bold text-[13px] hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          Save
        </button>
      </div>
    </ModalShell>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  destructive,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ModalShell onClose={onClose}>
      <h3 className="text-[16px] font-bold text-[#050a44]">{title}</h3>
      <p className="text-[13px] text-[#46464f] leading-relaxed">{body}</p>
      <div className="flex gap-[10px] pt-[4px]">
        <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#c7c5d1] font-bold text-[13px] text-[#46464f] hover:bg-[#f2f4f6] transition-colors">
          Go Back
        </button>
        <button
          onClick={onConfirm}
          className={`flex-1 h-11 rounded-xl text-white font-bold text-[13px] hover:opacity-90 transition-opacity ${
            destructive ? 'bg-[#ba1a1a]' : 'bg-[#050a44]'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

function ReceiptModal({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-bold text-[#050a44]">Receipt</h3>
        <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[#46464f] hover:bg-[#f2f4f6]" aria-label="Close">
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
      <div className="space-y-[8px] text-[13px]">
        <div className="flex justify-between"><span className="text-[#46464f]">Route</span><span className="font-bold text-[#050a44]">{booking.from} → {booking.to}</span></div>
        <div className="flex justify-between"><span className="text-[#46464f]">Date</span><span className="font-bold text-[#050a44]">{booking.date}</span></div>
        <div className="flex justify-between"><span className="text-[#46464f]">Operator</span><span className="font-bold text-[#050a44]">{booking.operator}</span></div>
        <div className="flex justify-between"><span className="text-[#46464f]">Booking ref</span><span className="font-bold text-[#050a44] font-mono">{booking.bookingRef}</span></div>
        <div className="flex justify-between"><span className="text-[#46464f]">Status</span><span className={STATUS_BADGE[booking.status].className.includes('bg-') ? `px-2 py-0.5 rounded-full text-[11px] font-bold uppercase ${STATUS_BADGE[booking.status].className}` : STATUS_BADGE[booking.status].className}>{STATUS_BADGE[booking.status].label}</span></div>
      </div>
      <div className="h-px bg-[#e1e2e4]" />
      <div className="flex justify-between items-center">
        <span className="text-[14px] font-semibold text-[#050a44]">
          {booking.status === 'cancelled' ? 'Refunded' : 'Total Paid'}
        </span>
        <span className="text-[18px] font-extrabold text-[#050a44]">{formatLKR(booking.totalPrice)}</span>
      </div>
      {booking.status === 'cancelled' && (
        <p className="text-[11px] text-[#46464f]">
          This trip was cancelled. The full fare was refunded to your original payment method.
        </p>
      )}
    </ModalShell>
  );
}

export default function Dashboard() {
  const router = useRouter();

  const { user, mode: authMode } = useAuth();
  const { data, ready } = useStore();
  const bookings = useMemo<Booking[]>(
    () =>
      data.bookings
        .filter((b) => user && b.userId === user.id)
        .map((b) => toBookingView(b, data))
        .sort((a, b) => a.sortKey - b.sortKey),
    [data, user],
  );
  const resaleOn = useResaleEnabled();
  const [listings, setListings] = useState<ResaleListing[]>(authMode === 'demo' ? INITIAL_RESALE_LISTINGS : []);
  const my = useMyListings(authMode === 'supabase' ? user?.id : null);
  useEffect(() => {
    if (authMode === 'supabase') setListings(my.listings);
  }, [authMode, my.listings]);
  const db = authMode === 'supabase';
  const [walletBalance, setWalletBalance] = useState(12500);
  const [transactions, setTransactions] = useState<Transaction[]>([
    { id: 't1', label: 'Trip: Colombo → Akkaraipattu', date: 'Sep 12, 2026', amount: -2850 },
    { id: 't2', label: 'Wallet top-up', date: 'Sep 2, 2026', amount: 5000 },
    { id: 't3', label: 'Resale payout: RL-1038', date: 'Aug 7, 2026', amount: 2200 },
    { id: 't4', label: 'Refund: trip cancelled', date: 'Aug 1, 2026', amount: 2520 },
  ]);

  const [details, setDetails] = useState({
    name: user?.user_metadata.full_name ?? 'Guest',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
  });

  const [toast, setToast] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'all' | BookingStatus>('all');
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  // Modal targets
  const [editingDetails, setEditingDetails] = useState(false);
  const [addingFunds, setAddingFunds] = useState(false);
  const [viewingHistory, setViewingHistory] = useState(false);
  const [addingListing, setAddingListing] = useState(false);
  const [editingListing, setEditingListing] = useState<ResaleListing | null>(null);
  const [cancellingListing, setCancellingListing] = useState<ResaleListing | null>(null);
  const [receiptListing, setReceiptListing] = useState<ResaleListing | null>(null);
  const [receiptBooking, setReceiptBooking] = useState<Booking | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const upcoming = useMemo(() => bookings.filter((b) => b.status === 'confirmed' || b.status === 'pending'), [bookings]);
  const past = useMemo(() => bookings.filter((b) => b.status === 'completed' || b.status === 'cancelled'), [bookings]);
  const filteredPast = useMemo(() => (historyFilter === 'all' ? past : past.filter((b) => b.status === historyFilter)), [past, historyFilter]);

  const totalResaleEarned = listings.filter((l) => l.status === 'sold').reduce((sum, l) => sum + l.listedPrice, 0);
  const listedBookingIds = new Set(listings.filter((l) => l.status !== 'expired').map((l) => l.bookingId));
  const eligibleForListing = upcoming.filter((b) => b.status === 'confirmed' && !listedBookingIds.has(b.id));

  const rewardsPoints = 12450;
  const pointsToNextTier = 2550;
  const rewardsProgress = 75;

  const handleExportHistory = () => {
    const rows = [
      ['Route', 'Date', 'Status', 'Amount'],
      ...filteredPast.map((b) => [`${b.from} -> ${b.to}`, b.date, STATUS_BADGE[b.status].label, b.totalPrice.toFixed(2)]),
    ];
    const csv = rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'siyan-lanka-booking-history.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setToast('Booking history exported.');
  };

  if (!ready) return <StoreLoading />;

  return (
    <main className="max-w-[1440px] mx-auto px-4 md:px-[64px] py-[32px]">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] bg-[#050a44] text-white px-4 py-3 rounded-xl shadow-lg text-sm font-semibold animate-[fadeIn_0.2s_ease-out]">
          {toast}
        </div>
      )}

      {/* Header */}
      <section className="mb-[32px] flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-[28px] md:text-[32px] font-extrabold tracking-tight text-[#050a44] mb-2">
            Welcome back, {details.name.split(' ')[0]}
          </h1>
          <p className="text-[14px] text-[#46464f]">Manage your journeys, tickets, and rewards in one place.</p>
        </div>
        <button
          onClick={() => router.push('/search')}
          className="px-5 py-3 bg-black text-white rounded-xl font-bold text-[13px] hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Book a Trip
        </button>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-[24px]">
        {/* Personal Details */}
        <div className="md:col-span-4 bg-white border border-[#c7c5d1] p-[24px] rounded-2xl shadow-sm flex flex-col gap-[24px]">
          <div className="flex justify-between items-center">
            <h2 className="text-[16px] font-semibold text-[#050a44]">Personal Details</h2>
            <button
              onClick={() => setEditingDetails(true)}
              aria-label="Edit personal details"
              className="text-[#46464f] hover:text-[#050a44] transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">edit</span>
            </button>
          </div>
          <div className="flex flex-col gap-[16px]">
            <div className="flex items-center gap-[16px]">
              <div className="w-10 h-10 rounded-full bg-[#050a44]/10 flex items-center justify-center text-[#050a44]">
                <span className="material-symbols-outlined text-[20px]">person</span>
              </div>
              <div>
                <p className="text-[11px] font-bold text-[#6b6d78] uppercase tracking-wide">Full Name</p>
                <p className="text-[14px] font-bold text-[#050a44]">{details.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-[16px]">
              <div className="w-10 h-10 rounded-full bg-[#f2f4f6] flex items-center justify-center text-[#46464f]">
                <span className="material-symbols-outlined text-[20px]">mail</span>
              </div>
              <div>
                <p className="text-[11px] font-bold text-[#6b6d78] uppercase tracking-wide">Email Address</p>
                <p className="text-[14px] font-bold text-[#050a44]">{details.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-[16px]">
              <div className="w-10 h-10 rounded-full bg-[#f2f4f6] flex items-center justify-center text-[#46464f]">
                <span className="material-symbols-outlined text-[20px]">phone</span>
              </div>
              <div>
                <p className="text-[11px] font-bold text-[#6b6d78] uppercase tracking-wide">Phone Number</p>
                <p className="text-[14px] font-bold text-[#050a44]">{details.phone}</p>
              </div>
            </div>
            <div className="flex items-center gap-[16px]">
              <div className="w-10 h-10 rounded-full bg-[#f2f4f6] flex items-center justify-center text-[#46464f]">
                <span className="material-symbols-outlined text-[20px]">badge</span>
              </div>
              {authMode === 'demo' && (
<div>
                <p className="text-[11px] font-bold text-[#6b6d78] uppercase tracking-wide">National ID</p>
                <p className="text-[14px] font-bold text-[#050a44]">ID-8849-2024-X</p>
              </div>
)}
            </div>
          </div>

          {/* Support & Help — every other passenger-facing page (refund, my-bookings)
              carries this touchpoint; the dashboard, as the hub, shouldn't skip it. */}
          <div className="bg-[#f2f4f6] rounded-xl p-[16px] border border-[#e1e2e4] mt-auto">
            <h4 className="font-bold text-[#050a44] text-[13px] flex items-center gap-2 mb-[8px]">
              <span className="material-symbols-outlined text-[16px]">support_agent</span>
              Need Help?
            </h4>
            <div className="space-y-1">
              {OPERATOR.contact.phone ? (
                <a className="text-[#050a44] font-bold text-[13px] block hover:underline" href={OPERATOR.contact.phoneHref}>{OPERATOR.contact.phone}</a>
              ) : null}
              <a className="text-[#46464f] text-[11px] underline block" href={`mailto:${OPERATOR.contact.email}`}>{OPERATOR.contact.email}</a>
            </div>
          </div>
        </div>

        {/* Wallet & Rewards */}
        <div className="md:col-span-8 flex flex-col gap-[24px]">
          {authMode === 'demo' ? (
<div className="grid grid-cols-1 md:grid-cols-2 gap-[24px]">
            {/* Wallet */}
            <div className="keep-navy relative h-[200px] rounded-2xl p-[24px] text-white shadow-[0_10px_28px_-8px_rgba(0,0,0,0.55)] overflow-hidden bg-[#111216] ring-1 ring-[#feb700]/25">
              <div className="absolute inset-0 bg-gradient-to-br from-[#2a2b31] via-[#17181c] to-[#0b0c0e]" />
              <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_35%,rgba(255,255,255,0.08)_50%,transparent_65%)]" />
              <div
                className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
                style={{ backgroundImage: 'repeating-linear-gradient(115deg, #ffffff 0px, #ffffff 1px, transparent 1px, transparent 5px)' }}
              />
              <div className="absolute -right-16 -bottom-16 w-56 h-56 bg-[#feb700] opacity-[0.14] rounded-full blur-3xl" />

              <div className="relative z-10 h-full flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-[#ffd54a] uppercase tracking-[0.15em] opacity-90">Available Credits</p>
                    <h3 className="text-[34px] font-extrabold tracking-tight mt-1 tabular-nums">{formatLKR(walletBalance)}</h3>
                  </div>
                  <div className="w-9 h-7 rounded-[5px] bg-gradient-to-br from-[#ffd54a] to-[#b47c00] shadow-inner mt-1" />
                </div>

                <div className="flex items-end justify-between">
                  <p className="text-[11px] font-medium text-white/70 tracking-[0.1em] tabular-nums">•••• •••• •••• 4821</p>
                  <div className="flex gap-[10px]">
                    <button
                      onClick={() => setAddingFunds(true)}
                      className="bg-[#ffd54a] text-[#050a44] text-[12px] font-bold px-4 py-2 rounded-lg hover:bg-[#ffe27a] transition-colors"
                    >
                      Add Funds
                    </button>
                    <button
                      onClick={() => setViewingHistory(true)}
                      className="bg-white/10 text-white border border-white/25 text-[12px] font-bold px-4 py-2 rounded-lg hover:bg-white/20 transition-colors"
                    >
                      History
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Rewards */}
            <div className="on-gold relative h-[200px] rounded-2xl p-[24px] overflow-hidden shadow-[0_8px_24px_-6px_rgba(180,124,0,0.35)] bg-gradient-to-br from-[#feb700] to-[#e6a300]">
              <div
                className="absolute inset-0 opacity-[0.08]"
                style={{ backgroundImage: 'radial-gradient(circle, #6b4b00 1px, transparent 1px)', backgroundSize: '14px 14px' }}
              />
              <div className="relative z-10 h-full flex flex-col justify-between text-[#3d2b00]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[#3d2b00] text-[18px]">workspace_premium</span>
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#3d2b00]">Gold Tier</p>
                  </div>
                  <div className="w-9 h-9 rounded-full bg-white/40 border border-[#7c5800]/20 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[#3d2b00] text-[18px]">stars</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-[28px] font-extrabold tabular-nums leading-none">{rewardsPoints.toLocaleString()} pts</h3>
                  <div className="mt-4">
                    <div className="w-full bg-black/10 h-1.5 rounded-full">
                      <div className="bg-[#3d2b00] h-full rounded-full" style={{ width: `${rewardsProgress}%` }} />
                    </div>
                    <div className="flex justify-between mt-[6px]">
                      <p className="text-[10px] font-bold text-[#3d2b00] uppercase tracking-wide">Gold</p>
                      <p className="text-[11px] font-semibold text-[#3d2b00]">{pointsToNextTier.toLocaleString()} pts to Platinum</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-[16px]">
              {[
                { label: 'Upcoming trips', value: upcoming.length, icon: 'event_upcoming' },
                { label: 'Trips taken', value: bookings.filter((b) => b.status === 'completed').length, icon: 'directions_bus' },
                { label: 'Spent with us', value: bookings.filter((b) => b.status !== 'cancelled').reduce((n, b) => n + b.totalPrice, 0), icon: 'payments', money: true },
              ].map((c) => (
                <div key={c.label} className="bg-white border border-[#c7c5d1] rounded-2xl p-[20px] shadow-sm">
                  <span className="material-symbols-outlined text-[22px] text-[#7c5800]">{c.icon}</span>
                  <p className="text-[12px] font-bold text-[#6b6d78] uppercase tracking-wide mt-2">{c.label}</p>
                  <p className="text-[26px] font-semibold text-[#050a44] mt-1">
                    <AnimatedNumber value={c.value} format={c.money ? formatLKR : undefined} />
                  </p>
                </div>
              ))}
            </div>
)}

          {/* Upcoming Journeys — now sourced from the real bookings list */}
          <div className="bg-white border border-[#c7c5d1] p-[24px] rounded-2xl shadow-sm">
            <div className="flex justify-between items-center mb-[20px]">
              <h2 className="text-[16px] font-semibold text-[#050a44]">Upcoming Journeys</h2>
              <Link className="text-[#050a44] text-[12px] font-bold hover:underline" href="/my-bookings">
                View All
              </Link>
            </div>

            {upcoming.length === 0 ? (
              <div className="bg-[#f2f4f6] rounded-xl p-[24px] text-center">
                <p className="text-[13px] text-[#46464f]">No upcoming journeys. Time to plan your next trip!</p>
              </div>
            ) : (
              <div className="flex gap-[16px] overflow-x-auto pb-2 no-scrollbar">
                {upcoming.map((b) => (
                  <div key={b.id} className="min-w-[300px] bg-[#f2f4f6] p-[16px] rounded-xl border border-[#c7c5d1] flex flex-col gap-[16px]">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <OperatorBadge operator={b.operator} />
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[b.status].className}`}>
                          {STATUS_BADGE[b.status].label}
                        </span>
                      </div>
                      <p className="text-[16px] font-extrabold text-[#050a44]">{formatLKR(b.totalPrice)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-[16px] py-[8px]">
                      <div className="text-center">
                        <p className="text-[18px] font-extrabold text-[#050a44]">{cityCode(b.from)}</p>
                        <p className="text-[11px] font-medium text-[#46464f]">{b.departureTime}</p>
                      </div>
                      <div className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full border-t-2 border-dashed border-[#c7c5d1] relative">
                          <span className="material-symbols-outlined absolute -top-3 left-1/2 -translate-x-1/2 bg-[#f2f4f6] px-1 text-[#050a44] text-[18px]">
                            directions_bus
                          </span>
                        </div>
                      </div>
                      <div className="text-center">
                        <p className="text-[18px] font-extrabold text-[#050a44]">{cityCode(b.to)}</p>
                        <p className="text-[11px] font-medium text-[#46464f]">{b.arrivalTime}</p>
                      </div>
                    </div>
                    <div className="flex justify-between items-center text-[#46464f] text-[11px] font-medium">
                      <div className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">calendar_month</span>
                        {b.date}
                      </div>
                      <button onClick={() => router.push('/my-bookings')} className="text-[#050a44] font-bold text-[12px] hover:underline">
                        Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Resale Listings & Booking History */}
        <div className="md:col-span-12 grid grid-cols-1 md:grid-cols-3 gap-[24px]">
          {/* My Resale Listings */}
          {resaleOn && (
<div className="md:col-span-1 bg-white border border-[#c7c5d1] p-[24px] rounded-2xl shadow-sm h-full flex flex-col">
            <div className="flex justify-between items-start mb-[20px]">
              <h2 className="text-[16px] font-semibold text-[#050a44]">My Resale Listings</h2>
              {totalResaleEarned > 0 && (
                <p className="text-[11px] font-bold text-[#006e1c] bg-[#006e1c]/10 px-2.5 py-1 rounded-full">
                  {formatLKR(totalResaleEarned)} earned
                </p>
              )}
            </div>

            <div className="flex flex-col gap-[12px] flex-1">
              {listings.length === 0 && (
                <p className="text-[12px] text-[#46464f] text-center py-[8px]">No listings yet.</p>
              )}
              {listings.map((listing) => (
                <div key={listing.id} className="p-[14px] bg-[#f2f4f6] rounded-xl border border-[#c7c5d1] flex flex-col gap-[10px]">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[13px] font-bold text-[#050a44]">{listing.route}</p>
                      <p className="text-[11px] font-medium text-[#46464f]">{listing.date} · Seat {listing.seat}</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide shrink-0 ${RESALE_STATUS_BADGE[listing.status].className}`}>
                      {RESALE_STATUS_BADGE[listing.status].label}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-baseline gap-[6px]">
                      <p className="text-[15px] font-extrabold text-[#050a44]">{formatLKR(listing.listedPrice)}</p>
                      {listing.listedPrice < listing.originalPrice && (
                        <p className="text-[11px] font-medium text-[#6b6d78] line-through">{formatLKR(listing.originalPrice)}</p>
                      )}
                    </div>

                    {listing.status === 'active' && (
                      <div className="flex items-center gap-[12px]">
                        <button onClick={() => setEditingListing(listing)} className="text-[#050a44] font-bold text-[11px] hover:underline">
                          Edit
                        </button>
                        <button onClick={() => setCancellingListing(listing)} className="text-[#ba1a1a] font-bold text-[11px] hover:underline">
                          Cancel
                        </button>
                      </div>
                    )}
                    {listing.status === 'sold' && (
                      <button onClick={() => setReceiptListing(listing)} className="text-[#050a44] font-bold text-[11px] hover:underline">
                        Receipt
                      </button>
                    )}
                    {listing.status === 'expired' && (
                      <button
                        onClick={async () => {
                          if (db) {
                            const r = await listForResale(listing.bookingId, listing.listedPrice);
                            if (!r.ok) return setToast(r.reason);
                            return my.reload();
                          }
                          setListings((prev) => prev.map((l) => (l.id === listing.id ? { ...l, status: 'active' } : l)));
                        }}
                        className="text-[#050a44] font-bold text-[11px] hover:underline"
                      >
                        Relist
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <button
                onClick={() => setAddingListing(true)}
                className="border-2 border-dashed border-[#c7c5d1] rounded-xl p-[20px] flex flex-col items-center justify-center text-center text-[#46464f] hover:border-[#050a44] hover:text-[#050a44] hover:bg-[#f2f4f6]/60 transition-colors"
              >
                <span className="material-symbols-outlined text-[28px] mb-1.5">add_circle</span>
                <p className="text-[12px] font-medium">Sell your unused ticket</p>
                <span className="mt-1.5 text-[#050a44] font-bold text-[12px] underline">List Now</span>
              </button>
            </div>
          </div>
)}

          {/* Full Booking History — sourced from the real bookings list */}
          <div className={`${resaleOn ? 'md:col-span-2' : 'md:col-span-3'} bg-white border border-[#c7c5d1] rounded-2xl shadow-sm overflow-hidden`}>
            <div className="flex justify-between items-center px-[24px] pt-[24px] pb-[16px]">
              <h2 className="text-[16px] font-semibold text-[#050a44]">Booking History</h2>
              <div className="flex gap-[8px] relative">
                <button
                  onClick={() => setShowFilterMenu((v) => !v)}
                  className="px-3 py-1.5 rounded-full bg-[#f2f4f6] text-[#46464f] text-[11px] font-bold hover:bg-[#e1e2e4] transition-colors flex items-center gap-1"
                >
                  Filter{historyFilter !== 'all' ? `: ${STATUS_BADGE[historyFilter].label}` : ''}
                  <span className="material-symbols-outlined text-[14px]">expand_more</span>
                </button>
                {showFilterMenu && (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-10 bg-white border border-[#c7c5d1] rounded-xl shadow-lg py-1 w-[160px]">
                    {(['all', 'completed', 'cancelled'] as const).map((opt) => (
                      <button
                        key={opt}
                        onClick={() => {
                          setHistoryFilter(opt);
                          setShowFilterMenu(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-[12px] font-semibold hover:bg-[#f2f4f6] ${
                          historyFilter === opt ? 'text-[#050a44]' : 'text-[#46464f]'
                        }`}
                      >
                        {opt === 'all' ? 'All statuses' : STATUS_BADGE[opt].label}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={handleExportHistory}
                  className="px-3 py-1.5 rounded-full bg-[#f2f4f6] text-[#46464f] text-[11px] font-bold hover:bg-[#e1e2e4] transition-colors"
                >
                  Export
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#f2f4f6] border-y border-[#e1e2e4]">
                    <th className="px-[24px] py-3 font-bold text-[11px] text-[#050a44] uppercase tracking-wider">Route</th>
                    <th className="px-[24px] py-3 font-bold text-[11px] text-[#050a44] uppercase tracking-wider">Date</th>
                    <th className="px-[24px] py-3 font-bold text-[11px] text-[#050a44] uppercase tracking-wider">Status</th>
                    <th className="px-[24px] py-3 font-bold text-[11px] text-[#050a44] uppercase tracking-wider">Amount</th>
                    <th className="px-[24px] py-3 font-bold text-[11px] text-[#050a44] uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="text-[13px] divide-y divide-[#e1e2e4]">
                  {filteredPast.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-[24px] py-8 text-center text-[#46464f]">
                        No bookings match this filter.
                      </td>
                    </tr>
                  )}
                  {filteredPast.map((b) => (
                    <tr key={b.id} className="hover:bg-[#f2f4f6] transition-colors">
                      <td className="px-[24px] py-4">
                        <div className="flex items-center gap-2.5">
                          <OperatorBadge operator={b.operator} />
                          <div className="flex flex-col">
                            <span className="font-bold text-[#050a44] text-[13px]">{b.from} → {b.to}</span>
                            <span className="text-[11px] text-[#46464f]">{b.busNumber}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-[24px] py-4 text-[#46464f] text-[13px] font-medium">{b.date}</td>
                      <td className="px-[24px] py-4">
                        <span className={b.status === 'completed' || b.status === 'cancelled' ? STATUS_BADGE[b.status].className : ''}>
                          {STATUS_BADGE[b.status].label}
                        </span>
                      </td>
                      <td className={`px-[24px] py-4 font-bold text-[13px] ${b.status === 'cancelled' ? 'text-[#6b6d78] line-through' : 'text-[#050a44]'}`}>
                        {formatLKR(b.totalPrice)}
                      </td>
                      <td className="px-[24px] py-4">
                        <button
                          onClick={() => setReceiptBooking(b)}
                          aria-label={b.status === 'cancelled' ? 'Cancellation & refund details' : 'View receipt'}
                          className="text-[#46464f] hover:text-[#050a44] transition-colors"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {b.status === 'cancelled' ? 'info' : 'receipt_long'}
                          </span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Promo banner */}
      <section className="mt-[24px] relative rounded-2xl overflow-hidden h-64 group">
        <img
          alt="Travel Banner"
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          src="/brand/interior.jpg"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/75 to-transparent flex flex-col justify-center px-[32px] md:px-[48px]">
          <h2 className="text-white text-[32px] md:text-[34px] font-extrabold max-w-lg mb-4 leading-tight tracking-tight">
            Travel more, earn more.
          </h2>
          <button
            onClick={() => router.push('/search')}
            className="bg-[#feb700] text-[#6b4b00] text-[14px] font-bold px-6 py-3 rounded-xl w-fit hover:opacity-90 transition-opacity"
          >
            Book your next trip
          </button>
        </div>
      </section>

      {/* Modals */}
      {editingDetails && (
        <EditPersonalDetailsModal
          details={details}
          onClose={() => setEditingDetails(false)}
          onSave={async (d) => {
            if (authMode === 'supabase' && user) {
              const { error } = await supabase().from('profiles').update({ full_name: d.name, phone: d.phone }).eq('id', user.id);
              if (error) return setToast("Couldn't save your details. Please try again.");
            }
            setDetails(d);
            setEditingDetails(false);
            setToast('Personal details updated.');
          }}
        />
      )}

      {addingFunds && (
        <AddFundsModal
          onClose={() => setAddingFunds(false)}
          onConfirm={(amount) => {
            setWalletBalance((b) => b + amount);
            setTransactions((prev) => [{ id: `t-${Date.now()}`, label: 'Wallet top-up', date: 'Today', amount }, ...prev]);
            setAddingFunds(false);
            setToast(`${formatLKR(amount)} added to your wallet.`);
          }}
        />
      )}

      {viewingHistory && <WalletHistoryModal transactions={transactions} onClose={() => setViewingHistory(false)} />}

      {addingListing && (
        <ListNewListingModal
          eligibleBookings={eligibleForListing}
          onClose={() => setAddingListing(false)}
          onSubmit={async (booking, price) => {
            if (db) {
              const r = await listForResale(booking.id, price);
              if (!r.ok) return setToast(r.reason);
              await my.reload();
              setAddingListing(false);
              return setToast('Ticket listed for resale.');
            }
            setListings((prev) => [
              {
                id: `RL-${Math.floor(Math.random() * 9000 + 1000)}`,
                bookingId: booking.id,
                route: `${cityCode(booking.from)} → ${cityCode(booking.to)}`,
                date: booking.date,
                seat: booking.seats.join(', '),
                originalPrice: booking.totalPrice,
                listedPrice: price,
                status: 'active',
              },
              ...prev,
            ]);
            setAddingListing(false);
            setToast('Ticket listed for resale.');
          }}
        />
      )}

      {editingListing && (
        <EditListingPriceModal
          listing={editingListing}
          onClose={() => setEditingListing(null)}
          onSave={async (price) => {
            if (db) {
              const w = await withdrawListing(editingListing.id);
              const r = w.ok ? await listForResale(editingListing.bookingId, price) : w;
              if (!r.ok) return setToast(r.reason);
              await my.reload();
              setEditingListing(null);
              return setToast('Asking price updated.');
            }
            setListings((prev) => prev.map((l) => (l.id === editingListing.id ? { ...l, listedPrice: price } : l)));
            setEditingListing(null);
            setToast('Asking price updated.');
          }}
        />
      )}

      {cancellingListing && (
        <ConfirmModal
          title="Cancel this listing?"
          body={`${cancellingListing.route} · ${cancellingListing.date} will be taken off the resale market. You can list it again later.`}
          confirmLabel="Cancel Listing"
          destructive
          onClose={() => setCancellingListing(null)}
          onConfirm={async () => {
            if (db) {
              const r = await withdrawListing(cancellingListing.id);
              if (!r.ok) return setToast(r.reason);
              await my.reload();
              setCancellingListing(null);
              return setToast('Listing cancelled.');
            }
            setListings((prev) => prev.filter((l) => l.id !== cancellingListing.id));
            setCancellingListing(null);
            setToast('Listing cancelled.');
          }}
        />
      )}

      {receiptListing && (
        <ModalShell onClose={() => setReceiptListing(null)}>
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-bold text-[#050a44]">Resale receipt</h3>
            <button onClick={() => setReceiptListing(null)} className="w-8 h-8 rounded-full flex items-center justify-center text-[#46464f] hover:bg-[#f2f4f6]" aria-label="Close">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          <div className="space-y-[8px] text-[13px]">
            <div className="flex justify-between"><span className="text-[#46464f]">Route</span><span className="font-bold text-[#050a44]">{receiptListing.route}</span></div>
            <div className="flex justify-between"><span className="text-[#46464f]">Date</span><span className="font-bold text-[#050a44]">{receiptListing.date}</span></div>
            <div className="flex justify-between"><span className="text-[#46464f]">Seat</span><span className="font-bold text-[#050a44]">{receiptListing.seat}</span></div>
            <div className="flex justify-between"><span className="text-[#46464f]">Listing ref</span><span className="font-bold text-[#050a44] font-mono">{receiptListing.id}</span></div>
          </div>
          <div className="h-px bg-[#e1e2e4]" />
          <div className="flex justify-between items-center">
            <span className="text-[14px] font-semibold text-[#050a44]">Payout</span>
            <span className="text-[18px] font-extrabold text-[#006e1c]">{formatLKR(receiptListing.listedPrice)}</span>
          </div>
        </ModalShell>
      )}

      {receiptBooking && <ReceiptModal booking={receiptBooking} onClose={() => setReceiptBooking(null)} />}

      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </main>
  );
}