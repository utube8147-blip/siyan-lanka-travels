// app/(public)/(passenger)/marketplace/buy/[ticketId]/page.tsx
'use client';

import React, { useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { OPERATOR } from '@/config/operator';
import { formatLKR } from '@/lib/trips';
import { useAuth } from '@/contexts/AuthContext';
import { findResaleTicket, genResaleRef } from '@/data/resale-tickets';

// ---------------------------------------------------------------------------
// Resale checkout — the buying half of the Marketplace. A resale ticket
// already has a fixed seat and route (someone else booked it), so this skips
// the seat-map step from /seats/[scheduleId] entirely and goes straight to
// buyer details + payment, then lands on the same kind of e-ticket/QR
// confirmation used on /payment. Reuses the exact card/wallet payment UI
// from /payment/page.tsx and the contact-field styling from
// /seats/[scheduleId]/page.tsx so the flow feels native to the app, not
// bolted on.
// ---------------------------------------------------------------------------

type PaymentMethod = 'card' | 'wallet';
type PurchaseState = 'idle' | 'processing' | 'success';

function formatCardNumber(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

// Flat marketplace service fee — separate line from the operator's fare,
// same idea as the platformFee shown on /payment.
const SERVICE_FEE = 50;

export default function MarketplaceBuyPage() {
  const router = useRouter();
  const params = useParams<{ ticketId: string }>();
  const { user, isLoggedIn } = useAuth();

  const ticket = useMemo(() => findResaleTicket(params.ticketId), [params.ticketId]);

  const savings = ticket ? ticket.originalPrice - ticket.listedPrice : 0;
  const totalPrice = ticket ? ticket.listedPrice + SERVICE_FEE : 0;

  const [buyerName, setBuyerName] = useState(isLoggedIn && user ? user.user_metadata?.full_name ?? '' : '');
  const [buyerEmail, setBuyerEmail] = useState(isLoggedIn && user ? user.email ?? '' : '');
  const [buyerPhone, setBuyerPhone] = useState(isLoggedIn && user ? user.phone ?? '' : '');

  const [method, setMethod] = useState<PaymentMethod>('card');
  const [cardNumber, setCardNumber] = useState('');
  const [cardName, setCardName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [wallet, setWallet] = useState<'ezcash' | 'mcash' | 'frimi' | ''>('');

  const [purchaseState, setPurchaseState] = useState<PurchaseState>('idle');
  const [purchaseRef, setPurchaseRef] = useState('');
  const [error, setError] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  const buyerValid = buyerName.trim().length > 1 && buyerPhone.trim().length >= 6 && buyerEmail.trim().includes('@');
  const cardValid =
    cardNumber.replace(/\s/g, '').length === 16 &&
    cardName.trim().length > 1 &&
    /^\d{2}\/\d{2}$/.test(expiry) &&
    cvv.length === 3;
  const walletValid = wallet !== '';
  const canPay = !!ticket && buyerValid && (method === 'card' ? cardValid : walletValid);

  const handlePay = () => {
    setError('');
    if (!ticket) return;
    if (!buyerValid) {
      setError('Fill in your name, phone, and email to receive the ticket.');
      return;
    }
    if (!canPay) {
      setError(method === 'card' ? 'Fill in all card details correctly.' : 'Select a wallet provider to continue.');
      return;
    }
    setPurchaseState('processing');
    setTimeout(() => {
      setPurchaseRef(genResaleRef());
      setPurchaseState('success');
    }, 1600);
  };

  const qrPayload = useMemo(() => {
    if (!ticket || !purchaseRef) return '';
    return JSON.stringify({
      ref: purchaseRef,
      route: `${ticket.from}-${ticket.to}`,
      seats: ticket.seats,
      operator: ticket.operator,
      transferredFrom: ticket.sellerHandle,
    });
  }, [ticket, purchaseRef]);

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
      a.download = `${purchaseRef || 'ticket'}-qr.png`;
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

  if (!ticket) {
    return (
      <main className="max-w-[600px] mx-auto px-4 py-[64px] text-center">
        <p className="text-[16px] font-semibold text-[#46464f]">
          This listing is no longer available — it may have already sold.
        </p>
        <Link
          href="/marketplace"
          className="mt-[16px] inline-block px-6 py-3 bg-black text-white rounded-xl font-bold text-sm"
        >
          Back to Marketplace
        </Link>
      </main>
    );
  }

  // -------------------------------------------------------------------------
  // Success — same e-ticket + QR pattern as /payment's success state, with a
  // banner making clear this seat has been transferred from the seller.
  // -------------------------------------------------------------------------
  if (purchaseState === 'success') {
    return (
      <main className="max-w-[1200px] mx-auto px-4 md:px-[64px] py-[40px]">
        <div className="flex flex-col items-center justify-center text-center mb-[32px]">
          <div className="w-16 h-16 bg-[#e8f6ea] rounded-full flex items-center justify-center mb-[12px]">
            <span className="material-symbols-outlined text-[#006e1c] text-[32px]">check</span>
          </div>
          <h1 className="text-[24px] font-bold mb-[4px]">Ticket Transferred!</h1>
          <p className="text-[14px] text-[#46464f]">
            Seat {ticket.seats} is now yours. Your e-ticket has been sent to{' '}
            <span className="font-bold">{buyerEmail || 'your email'}</span>.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-[24px] items-stretch">
          <div className="lg:col-span-8 flex flex-col gap-[24px] lg:h-full">
            <div className="bg-white rounded-xl shadow-sm border border-[#c7c5d1] overflow-hidden">
              <div className="px-[24px] py-[16px] bg-[#f2f4f6] flex justify-between items-center border-b border-[#c7c5d1]">
                <div>
                  <h3 className="text-[16px] font-semibold">{ticket.operator}</h3>
                  <p className="text-[11px] text-[#46464f]">Transferred from {ticket.sellerHandle}</p>
                </div>
                <div className="text-right">
                  <span className="bg-[#feb700]/20 text-[#6b4b00] px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide">
                    {ticket.busType}
                  </span>
                  <p className="mt-[6px] text-[11px] text-[#46464f]">PNR: {purchaseRef}</p>
                </div>
              </div>

              <div className="p-[24px] grid grid-cols-1 md:grid-cols-3 gap-[24px]">
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-1">Departure</span>
                  <span className="text-[18px] font-semibold">{ticket.from}</span>
                  <span className="text-[13px] text-[#46464f]">{ticket.date} • {ticket.departureTime}</span>
                </div>

                <div className="flex flex-col items-center justify-center py-2 md:py-0">
                  <div className="w-full flex items-center gap-2">
                    <div className="h-px flex-1 border-b-2 border-dashed border-[#c7c5d1]"></div>
                    <span className="material-symbols-outlined text-[#46464f]">directions_bus</span>
                    <div className="h-px flex-1 border-b-2 border-dashed border-[#c7c5d1]"></div>
                  </div>
                  <span className="text-[11px] text-[#46464f] mt-[8px]">{ticket.from} → {ticket.to}</span>
                </div>

                <div className="flex flex-col md:text-right">
                  <span className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-1">Arrival</span>
                  <span className="text-[18px] font-semibold">{ticket.to}</span>
                  <span className="text-[13px] text-[#46464f]">{ticket.arrivalTime}</span>
                </div>
              </div>

              <div className="px-[24px] py-[16px] border-t border-[#c7c5d1] bg-white grid grid-cols-2 md:grid-cols-4 gap-[16px]">
                <div>
                  <span className="text-[11px] text-[#46464f] block">Passenger</span>
                  <span className="text-[13px] font-bold">{buyerName}</span>
                </div>
                <div>
                  <span className="text-[11px] text-[#46464f] block">Seat Number</span>
                  <span className="text-[13px] font-bold">{ticket.seats}</span>
                </div>
                <div>
                  <span className="text-[11px] text-[#46464f] block">Class</span>
                  <span className="text-[13px] font-bold">{ticket.busType}</span>
                </div>
                <div>
                  <span className="text-[11px] text-[#46464f] block">Amount Paid</span>
                  <span className="text-[13px] font-bold">{formatLKR(totalPrice)}</span>
                </div>
              </div>
            </div>

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
                    Carry a valid photo ID — resale tickets are checked against the buyer's name.
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
                  Questions about a marketplace transfer? Get in touch and we'll help.
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

          <div className="lg:col-span-4 flex flex-col gap-[24px] lg:h-full">
            <div className="bg-white rounded-xl shadow-sm border border-[#c7c5d1] overflow-hidden p-[24px] flex flex-col items-center">
              <span className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-[16px]">
                Boarding QR Code
              </span>

              <div className="p-3 bg-white border border-[#c7c5d1] rounded-xl mb-[16px]">
                {qrImageUrl ? (
                  <img src={qrImageUrl} alt={`QR code for purchase ${purchaseRef}`} className="w-[160px] h-[160px]" />
                ) : (
                  <div className="w-[160px] h-[160px] flex items-center justify-center text-[11px] font-medium text-[#46464f]">
                    Generating QR…
                  </div>
                )}
              </div>

              <p className="text-center text-[12px] text-[#46464f] mb-[20px]">
                Scan this QR code at the counter or during boarding to verify your e-ticket.
              </p>

              {error && <p className="text-[11px] font-medium text-[#ba1a1a] mb-[12px] text-center">{error}</p>}

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
                      <span className="material-symbols-outlined text-[16px]">download</span>
                      Download Ticket
                    </>
                  )}
                </button>

                <Link
                  href="/my-bookings"
                  className="block w-full text-center py-3 px-4 rounded-xl font-bold text-[13px] bg-white text-black border border-[#c7c5d1] hover:bg-[#f2f4f6] active:scale-95 transition-all"
                >
                  View My Bookings
                </Link>
              </div>
            </div>

            <div className="bg-[#f2f4f6] rounded-xl p-[20px] border border-[#c7c5d1] flex-1 flex flex-col justify-center">
              <div className="flex items-center gap-2 mb-[8px]">
                <span className="material-symbols-outlined text-[18px] text-[#46464f]">notifications_active</span>
                <span className="text-[13px] font-bold">Trip Reminder</span>
              </div>
              <p className="text-[12px] text-[#46464f]">
                We'll send a reminder to {buyerPhone || 'your registered number'} a few hours before departure.
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // -------------------------------------------------------------------------
  // Checkout form
  // -------------------------------------------------------------------------
  return (
    <main className="max-w-[1200px] mx-auto px-4 md:px-[64px] py-[32px]">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center space-x-2 text-[12px] font-medium mb-[24px] text-[#46464f]">
        <div className="flex items-center">
          <Link href="/marketplace" className="hover:text-[#000000] transition-colors">
            Marketplace
          </Link>
          <span className="material-symbols-outlined text-[16px] mx-1">chevron_right</span>
        </div>
        <div className="flex items-center">
          <span className="cursor-default">Buyer Details</span>
          <span className="material-symbols-outlined text-[16px] mx-1 text-[#46464f]">chevron_right</span>
        </div>
        <div className="flex items-center">
          <span className="text-[#000000] font-bold">Payment</span>
        </div>
      </nav>

      <h1 className="text-[20px] font-semibold mb-[24px]">Complete your purchase</h1>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-[24px]">
        <div className="lg:col-span-7 space-y-[24px]">
          {/* Ticket being purchased — ticket-stub styling consistent with my-bookings */}
          <div className="bg-white rounded-xl shadow-sm border border-[#c7c5d1] overflow-hidden">
            <div className="p-[24px] pb-[16px] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-lg bg-[#050a44] text-white flex items-center justify-center text-[13px] font-bold flex-shrink-0">
                  {ticket.operatorInitials}
                </div>
                <div>
                  <h4 className="text-[15px] font-bold text-[#050a44]">{ticket.operator}</h4>
                  <span className="inline-block mt-[2px] bg-[#feb700]/15 text-[#7c5800] text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                    {ticket.busType}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 bg-[#006e1c]/10 text-[#006e1c] px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide">
                <span className="material-symbols-outlined text-[13px]">verified</span>
                Verified
              </div>
            </div>

            <div className="px-[24px] pb-[24px]">
              <div className="flex items-center justify-between bg-[#f2f4f6] rounded-xl p-[16px]">
                <div>
                  <p className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-1">{ticket.from}</p>
                  <p className="text-[14px] font-bold text-[#050a44]">{ticket.departureTime}</p>
                </div>
                <span className="material-symbols-outlined text-[#050a44]">arrow_forward</span>
                <div className="text-right">
                  <p className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-1">{ticket.to}</p>
                  <p className="text-[14px] font-bold text-[#050a44]">{ticket.arrivalTime}</p>
                </div>
              </div>
              <p className="text-[12px] text-[#46464f] mt-[12px]">
                {ticket.date} · Seat {ticket.seats} · Listed by {ticket.sellerHandle}
              </p>
            </div>

            {/* Perforation — reinforces this is a ticket stub, same treatment as my-bookings */}
            <div className="relative">
              <div className="absolute -left-[9px] top-0 -translate-y-1/2 w-[18px] h-[18px] rounded-full bg-[#f7f8fa] border border-[#c7c5d1]" />
              <div className="absolute -right-[9px] top-0 -translate-y-1/2 w-[18px] h-[18px] rounded-full bg-[#f7f8fa] border border-[#c7c5d1]" />
              <div className="mx-[18px] border-t border-dashed border-[#c7c5d1]" />
            </div>

            <div className="px-[24px] py-[16px] flex items-center justify-between">
              <span className="text-[12px] text-[#6b6d78] line-through">{formatLKR(ticket.originalPrice)} original fare</span>
              <span className="text-[12px] font-bold text-[#006e1c]">You save {formatLKR(savings)}</span>
            </div>
          </div>

          <div className="bg-white rounded-xl p-[24px] shadow-sm border border-[#c7c5d1]">
            <h2 className="text-[16px] font-semibold mb-[4px]">Your details</h2>
            <p className="text-[12px] text-[#6b6d78] mb-[16px]">
              This ticket transfers to your name — carry a matching photo ID when boarding.
            </p>
            <div className="space-y-[12px]">
              <div>
                <label className="text-[11px] font-bold text-[#46464f] px-1">Full name</label>
                <input
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="As per ID"
                  className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44] placeholder:text-[#9a9ba5] placeholder:font-normal"
                  type="text"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
                <div>
                  <label className="text-[11px] font-bold text-[#46464f] px-1">Phone number</label>
                  <input
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value.replace(/[^0-9+]/g, ''))}
                    placeholder="+94 77 123 4567"
                    className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44] placeholder:text-[#9a9ba5] placeholder:font-normal"
                    type="tel"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-[#46464f] px-1">Email address</label>
                  <input
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44] placeholder:text-[#9a9ba5] placeholder:font-normal"
                    type="email"
                  />
                </div>
              </div>
              <p className="text-[11px] text-[#6b6d78] px-1">Your e-ticket will be sent here.</p>
            </div>
          </div>

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
                    You'll receive a payment prompt on {buyerPhone || 'your registered number'} to confirm.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="bg-white rounded-xl p-[32px] shadow-lg border border-[#c7c5d1] lg:sticky lg:top-24 lg:self-start">
            <h2 className="text-[20px] font-semibold mb-[24px]">Order Summary</h2>

            <div className="space-y-[12px] mb-[20px] text-[14px]">
              <div className="flex justify-between">
                <span className="text-[#46464f]">Route</span>
                <span className="font-bold">{ticket.from} → {ticket.to}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#46464f]">Operator</span>
                <span className="font-bold">{ticket.operator}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#46464f]">Seat</span>
                <span className="font-bold">{ticket.seats}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#46464f]">Travel date</span>
                <span className="font-bold">{ticket.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#46464f]">Seller</span>
                <span className="font-bold">{ticket.sellerHandle}</span>
              </div>
            </div>

            <div className="h-px bg-[#c7c5d1] w-full mb-[20px]"></div>

            <div className="space-y-[8px] mb-[20px] text-[14px]">
              <div className="flex justify-between">
                <span className="text-[#46464f]">Listed fare</span>
                <span className="font-bold">{formatLKR(ticket.listedPrice)}</span>
              </div>
              <div className="flex justify-between text-[#006e1c]">
                <span className="font-medium">Savings vs. original fare</span>
                <span className="font-bold">-{formatLKR(savings)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#46464f]">Marketplace service fee</span>
                <span className="font-bold">{formatLKR(SERVICE_FEE)}</span>
              </div>
            </div>

            <div className="bg-[#f2f4f6] rounded-xl p-[20px] mb-[20px]">
              <div className="flex justify-between items-center">
                <span className="text-[16px] font-semibold">Total</span>
                <span className="text-[20px] font-semibold">{formatLKR(totalPrice)}</span>
              </div>
            </div>

            {error && <p className="text-[12px] font-medium text-[#ba1a1a] mb-[12px] text-center">{error}</p>}

            <button
              onClick={handlePay}
              disabled={purchaseState === 'processing'}
              className={`w-full h-14 bg-black text-white rounded-xl font-bold flex items-center justify-center gap-3 transition-all ${
                purchaseState === 'processing' ? 'opacity-70 cursor-wait' : 'hover:scale-[0.98]'
              }`}
            >
              {purchaseState === 'processing' ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                  Processing…
                </>
              ) : (
                <>Pay {formatLKR(totalPrice)}</>
              )}
            </button>

            <p className="text-center text-[11px] font-medium text-[#46464f] mt-[16px]">
              Payments are securely processed. By paying you agree to our{' '}
              <a className="text-[#000000] underline" href="#">Terms of Service</a>.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}