// /components/SeatSelectionDrawer.tsx
'use client';
import React, { useEffect, useState } from 'react';
import { motion, useDragControls } from 'motion/react';

import { formatLKR } from '@/lib/trips';

// Seat layout and taken seats come from the bus + bookings in the store
// (see lib/trips.ts takenSeats). Seat ids: rows 1..N with A B | C D, plus a
// back bench (row N+1, A..E).

export type Gender = 'Male' | 'Female' | '';

export function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

interface SeatSelectionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedSeats: string[];
  onToggleSeat: (seatId: string) => void;
  timeLeft: number;
  seatPrice: number;
  passengerGender: Gender;
  maxSeatsPerBooking: number;
  /**
   * Only set by the "manage an existing booking" flow (changing seats after
   * purchase). When provided, the footer shows a fare adjustment (extra to
   * pay / refund due) against this original seat count instead of a flat
   * total. Leave unset for the normal new-booking flow — behavior there is
   * unchanged.
   */
  originalSeatCount?: number;
  /** Label for the footer button. Defaults to "Done". */
  confirmLabel?: string;
  /** Bus layout. */
  layout: { rows: number; backRowSeats: number; ladiesSeats: string[] };
  /** Seats already sold on this departure → gender of the passenger holding it. */
  taken: Map<string, Gender>;
}

export default function SeatSelectionDrawer({
  isOpen,
  onClose,
  selectedSeats,
  onToggleSeat,
  timeLeft,
  seatPrice,
  passengerGender,
  maxSeatsPerBooking,
  originalSeatCount,
  confirmLabel,
  layout,
  taken,
}: SeatSelectionDrawerProps) {
  if (!isOpen) return null;

  const isEditingExisting = originalSeatCount !== undefined;
  const deltaCount = isEditingExisting ? selectedSeats.length - (originalSeatCount as number) : 0;
  const deltaAmount = deltaCount * seatPrice;

  const seatBaseClass =
    'h-11 w-11 rounded-lg text-[11px] font-bold flex items-center justify-center border-[1.5px] transition-all duration-150 select-none shrink-0';

  const dragControls = useDragControls();
  // Decide before the first frame (the sheet only opens after a tap, so
  // window exists): phones get a bottom sheet, wider screens a side panel.
  const [isPhone, setIsPhone] = useState(() => typeof window === 'undefined' || !window.matchMedia('(min-width: 640px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const on = () => setIsPhone(!mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const FEMALE_ONLY_SEATS = layout.ladiesSeats;
  const isBookedByMale = (id: string) => taken.has(id) && taken.get(id) !== 'Female';
  const isBookedByFemale = (id: string) => taken.get(id) === 'Female';
  const PENDING_SEATS: string[] = [];

  // No colour legend: each seat explains itself. Hovering (or focusing, or
  // tapping on a phone) shows what the seat's colour means, in a small bubble
  // on the seat and in a line under the map.
  const [hint, setHint] = useState<string | null>(null);
  const seatMeaning = (seatId: string) =>
    isBookedByFemale(seatId)
      ? 'booked by a female passenger'
      : isBookedByMale(seatId)
        ? 'booked by a male passenger'
        : PENDING_SEATS.includes(seatId)
          ? 'held by another passenger'
          : selectedSeats.includes(seatId)
            ? 'selected by you (tap to remove)'
            : FEMALE_ONLY_SEATS.includes(seatId)
              ? passengerGender === 'Female'
                ? 'ladies-only seat, available to you'
                : 'reserved for female passengers'
              : 'available';
  const explain = (seatId: string) => ({
    onMouseEnter: () => setHint(`Seat ${seatId}: ${seatMeaning(seatId)}`),
    onMouseLeave: () => setHint(null),
    onFocus: () => setHint(`Seat ${seatId}: ${seatMeaning(seatId)}`),
    onBlur: () => setHint(null),
  });
  const bubble = (seatId: string) => (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+6px)] z-10 hidden group-hover:block group-focus-visible:block whitespace-nowrap rounded-md bg-[#050a44] px-2 py-1 text-[10px] font-semibold normal-case text-white shadow-lg"
    >
      {seatMeaning(seatId).replace(' (tap to remove)', '')}
    </span>
  );

  const getSeatClass = (seatId: string) => {
    if (isBookedByMale(seatId)) {
      return `${seatBaseClass} bg-[#e1e2e4] border-transparent text-[#686873] opacity-60 cursor-not-allowed`;
    }
    if (isBookedByFemale(seatId)) {
      return `${seatBaseClass} bg-[#f4a6c6] border-transparent text-[#7a1d47] opacity-80 cursor-not-allowed`;
    }
    if (PENDING_SEATS.includes(seatId)) {
      return `${seatBaseClass} bg-[#feb700]/15 border-[#feb700] text-[#6b4b00] cursor-not-allowed`;
    }
    if (selectedSeats.includes(seatId)) {
      return `${seatBaseClass} bg-[#ff5263] border-[#ff5263] text-white shadow-[0_4px_12px_rgba(255,82,99,0.3)] cursor-pointer`;
    }
    if (FEMALE_ONLY_SEATS.includes(seatId)) {
      return `${seatBaseClass} bg-pink-50 border-pink-300 text-pink-600 cursor-pointer hover:border-pink-500 hover:bg-pink-100`;
    }
    return `${seatBaseClass} bg-transparent border-[#c7c5d1] text-[#46464f] cursor-pointer hover:border-[#ff5263] hover:bg-[#ff5263]/10`;
  };

  /** `narrow`: a 6-seat back bench shares the row width, so its seats are slimmer. */
  const renderSeat = (row: number, col: string, narrow = false) => {
    const seatId = `${row}${col}`;
    const seatClass = (id: string) => (narrow ? getSeatClass(id).replace('w-11', 'w-[35px]') : getSeatClass(id));
    const isBookedMale = isBookedByMale(seatId);
    const isBookedFemale = isBookedByFemale(seatId);
    const isPending = PENDING_SEATS.includes(seatId);

    if (isBookedMale || isBookedFemale || isPending) {
      return (
        <div
          key={seatId}
          tabIndex={0}
          className={`${seatClass(seatId)} group relative`}
          aria-label={`Seat ${seatId}, ${seatMeaning(seatId)}`}
          onClick={() => setHint(`Seat ${seatId}: ${seatMeaning(seatId)}`)}
          {...explain(seatId)}
        >
          {seatId}
          {bubble(seatId)}
        </div>
      );
    }

    return (
      <motion.button
        key={seatId}
        type="button"
        className={`${seatClass(seatId)} group relative`}
        aria-label={`Seat ${seatId}, ${seatMeaning(seatId)}`}
        {...explain(seatId)}
        whileTap={{ scale: 0.86 }}
        animate={selectedSeats.includes(seatId) ? 'on' : 'off'}
        variants={{ on: { scale: [1, 1.16, 1], transition: { duration: 0.3 } }, off: { scale: 1 } }}
        onClick={() => onToggleSeat(seatId)}
      >
        {seatId}
        {bubble(seatId)}
      </motion.button>
    );
  };

  const drawerPositionClass =
    'absolute inset-x-0 bottom-0 w-full rounded-t-3xl max-h-[88vh] sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-auto sm:h-full sm:max-h-none sm:rounded-none sm:w-[420px] bg-white shadow-2xl flex flex-col overflow-hidden';

  return (
    <div className="fixed inset-0 z-[90]">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
      />

      {/* Drawer: bottom sheet on mobile, right-side panel from sm: up.
          No fixed pixel width, sizes itself to content, never forces
          horizontal scrolling. */}
      <motion.div
        className={drawerPositionClass}
        initial={isPhone ? { y: '100%' } : { x: '100%' }}
        animate={{ x: 0, y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 38 }}
        drag={isPhone ? 'y' : false}
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.7 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 110 || info.velocity.y > 600) onClose();
        }}
      >
        {/* Drag handle (phones): pull down to close */}
        <div
          className="sm:hidden pt-2.5 pb-1 flex justify-center touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={(e) => dragControls.start(e)}
          aria-hidden
        >
          <span className="w-10 h-1.5 rounded-full bg-[#c7c5d1]" />
        </div>
        {/* Drawer header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#c7c5d1]/30 shrink-0 touch-none sm:touch-auto" onPointerDown={(e) => isPhone && dragControls.start(e)}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 shrink-0 rounded-full bg-[#0f144c]/10 flex items-center justify-center text-[#050a44]">
              <span className="material-symbols-outlined text-[20px]">event_seat</span>
            </div>
            <div>
              <h2 className="text-[20px] font-bold leading-tight">
                {isEditingExisting ? 'Change Your Seats' : 'Select Your Seats'}
              </h2>
              <p className="text-[12px] text-[#46464f] mt-0.5">Up to {maxSeatsPerBooking} seats per booking</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-[#46464f] hover:bg-[#f2f4f6] transition-colors"
            aria-label="Close seat selection"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Live hold countdown */}
        {selectedSeats.length > 0 && !isEditingExisting && (
          <div
            className={`flex items-center gap-2 mx-6 mt-4 px-4 py-3 rounded-xl border text-[12px] font-bold shrink-0 ${
              timeLeft < 60
                ? 'bg-[#ffdad6]/50 border-[#ba1a1a]/20 text-[#93000a]'
                : 'bg-[#feb700]/10 border-[#feb700]/20 text-[#6b4b00]'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">timer</span>
            Held for {formatTime(timeLeft)}
          </div>
        )}

        {/* Seat map: vertical scroll only, never horizontal */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-5 py-6">
          <div className="w-fit max-w-full mx-auto py-6 px-3 sm:px-6 border-4 border-[#050a44]/10 rounded-[40px] bg-[#f2f4f6]/40">
            {/* Column headers */}
            <div
              className="grid mb-7"
              style={{ gridTemplateColumns: '20px 44px 44px 44px 44px 44px', gap: '10px', alignItems: 'center' }}
            >
              <div></div>
              <div className="text-center text-[#46464f] text-[10px] font-bold">A</div>
              <div className="text-center text-[#46464f] text-[10px] font-bold">B</div>
              <div></div>
              <div className="text-center text-[#46464f] text-[10px] font-bold">C</div>
              <div className="text-center text-[#46464f] text-[10px] font-bold">D</div>
            </div>

            {/* Entrance & driver */}
            <div className="flex justify-between items-center mb-8 px-2">
              <div className="flex flex-col items-center">
                <div className="w-11 h-11 rounded-xl bg-[#e7e8ea] flex flex-col items-center justify-center text-[#050a44]/40 border border-[#c7c5d1]/20">
                  <span className="material-symbols-outlined text-[18px]">sensor_door</span>
                </div>
                <span className="text-[8px] font-bold uppercase tracking-wider mt-1 text-[#46464f]/60">Entrance</span>
              </div>
              <div className="flex-1 mx-6 h-px bg-[#c7c5d1]/20 rounded-full"></div>
              <span className="sr-only">Front of the bus</span>
              <div className="w-11 h-11 shrink-0 rounded-full border-2 border-[#050a44]/30 flex items-center justify-center text-[#050a44] shadow-sm bg-white">
                {/* Drawn here: the icon font has no "steering" symbol, so the word itself was showing. */}
                <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" role="img" aria-label="Driver">
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="2.2" />
                  <path d="M3.4 10.5h6.6M14 10.5h6.6M12 14.2V21" />
                </svg>
              </div>
            </div>

            {/* Rows 1-9 */}
            <div
              className="grid"
              style={{ gridTemplateColumns: '20px 44px 44px 44px 44px 44px', columnGap: '10px', rowGap: '18px', alignItems: 'center' }}
            >
              {Array.from({ length: layout.rows }, (_, i) => i + 1).map((row) => (
                <React.Fragment key={row}>
                  <div className="text-[10px] font-bold text-[#46464f] text-center opacity-40">{row}</div>
                  {renderSeat(row, 'A')}
                  {renderSeat(row, 'B')}
                  <div />
                  {renderSeat(row, 'C')}
                  {renderSeat(row, 'D')}
                </React.Fragment>
              ))}
            </div>

            {/* Back bench. The aisle above is exactly one seat wide, so the bench
                spans the same width as a normal row and its outer edges line up:
                5 seats fill A, B, aisle, C, D; 4 sit under A B and C D; 6 share the width. */}
            {layout.backRowSeats > 0 && (
              <div className="flex items-center mt-[18px]">
                <div className="text-[10px] font-bold text-[#46464f] text-center opacity-40 shrink-0" style={{ width: 20 }}>
                  {layout.rows + 1}
                </div>
                <div
                  className="grid ml-[10px]"
                  style={{ width: 260, columnGap: 10, gridTemplateColumns: layout.backRowSeats === 6 ? 'repeat(6, 35px)' : 'repeat(5, 44px)' }}
                >
                  {['A', 'B', 'C', 'D', 'E', 'F'].slice(0, layout.backRowSeats).map((c, i) => (
                    <React.Fragment key={c}>
                      {layout.backRowSeats === 4 && i === 2 && <div />}
                      {renderSeat(layout.rows + 1, c, layout.backRowSeats === 6)}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>

          {passengerGender === 'Female' && (
            <p className="text-center text-[11px] font-medium text-pink-600 mt-4 px-2">
              Reserved seats are available to you.
            </p>
          )}
        </div>

        {/* Drawer footer */}
        <div className="px-6 py-5 border-t border-[#c7c5d1]/30 bg-white shrink-0">
          {/* What the seat under the pointer (or the last one tapped) means. */}
          <p aria-live="polite" className={`text-[12px] font-semibold text-[#050a44] mb-2 min-h-[18px] ${hint ? '' : 'invisible'}`}>{hint ?? '.'}</p>
          <div className="flex flex-wrap gap-2 min-h-[34px] mb-4">
            {selectedSeats.length === 0 ? (
              <p className="text-[#6b6d78] italic text-sm self-center">No seats selected yet.</p>
            ) : (
              selectedSeats.map((seat) => (
                <div
                  key={seat}
                  className="pl-3 pr-2 py-1.5 bg-black text-white rounded-lg font-bold text-xs flex items-center gap-1 shadow-sm"
                >
                  {seat}
                  <span
                    onClick={() => onToggleSeat(seat)}
                    className="material-symbols-outlined cursor-pointer rounded-full hover:opacity-70 transition-opacity"
                    style={{ fontSize: '14px' }}
                  >
                    close
                  </span>
                </div>
              ))
            )}
          </div>

          {isEditingExisting ? (
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-[#46464f]">
                {deltaCount === 0 ? 'No fare change' : deltaCount > 0 ? 'Additional fare' : 'Refund due'}
              </span>
              <span className={`text-base font-bold ${deltaCount > 0 ? 'text-[#ba1a1a]' : deltaCount < 0 ? 'text-[#006e1c]' : 'text-black'}`}>
                {deltaCount === 0 ? formatLKR(0) : `${deltaCount > 0 ? '+' : '-'}${formatLKR(Math.abs(deltaAmount))}`}
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-[#46464f]">
                {selectedSeats.length} seat{selectedSeats.length !== 1 ? 's' : ''}
              </span>
              <span className="text-base font-bold text-black">
                {formatLKR(selectedSeats.length * seatPrice)}
              </span>
            </div>
          )}

          <button
            onClick={onClose}
            disabled={selectedSeats.length === 0}
            className={`w-full h-12 bg-black text-white rounded-xl font-bold text-sm transition-all ${
              selectedSeats.length === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[0.98]'
            }`}
          >
            {confirmLabel ?? (isEditingExisting ? (deltaCount > 0 ? `Pay ${formatLKR(deltaAmount)} & confirm` : 'Confirm Change') : 'Done')}
          </button>
        </div>
      </motion.div>

      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}