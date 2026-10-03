// /components/SeatSelectionDrawer.tsx
'use client';
import { busSeatMap, layoutSegments, normalWidth, seatPosition, type SeatMap } from '@/lib/seatLayout';
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
  layout: { rows: number; backRowSeats: number; ladiesSeats: string[]; reservedSeats?: string[]; seatMap?: SeatMap | null };
  /** Free seats kept for women because the seat beside them is booked by a woman travelling alone. */
  womenOnly?: string[];
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
  womenOnly,
}: SeatSelectionDrawerProps) {
  const isEditingExisting = originalSeatCount !== undefined;
  const deltaCount = isEditingExisting ? selectedSeats.length - (originalSeatCount as number) : 0;
  const deltaAmount = deltaCount * seatPrice;

  const seatBaseClass =
    'aspect-square w-full min-w-0 rounded-lg text-[11px] font-bold flex items-center justify-center border-[1.5px] transition-all duration-150 select-none';

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

  // Phones only: false = normal bottom sheet (88dvh), true = full screen.
  const [expanded, setExpanded] = useState(false);
  // Leave full-screen mode when switching to the desktop side panel.
  useEffect(() => {
    if (!isPhone) setExpanded(false);
  }, [isPhone]);
  // Always reopen at normal height.
  useEffect(() => {
    if (!isOpen) setExpanded(false);
  }, [isOpen]);

  // Ladies-only seats set on the bus, plus seats kept for women on this trip (beside a woman travelling alone).
  const BESIDE_WOMAN = womenOnly ?? [];
  const FEMALE_ONLY_SEATS = [...layout.ladiesSeats, ...BESIDE_WOMAN];
  const isBookedByMale = (id: string) => taken.has(id) && taken.get(id) !== 'Female';
  const isBookedByFemale = (id: string) => taken.get(id) === 'Female';
  // The bus's seat grid and its drawn size: seats are 44px wide when they fit, smaller on wide layouts / narrow phones.
  const seatMap = busSeatMap(layout);
  const widest = normalWidth(seatMap);
  const GAP = widest > 5 ? 8 : 10;
  const GRID_WIDTH = widest * 44 + (widest - 1) * GAP;

  // Seats the owner keeps back: shown as not available (only staff can sell them, with the owner's code).
  const RESERVED_SEATS = layout.reservedSeats ?? [];
  const PENDING_SEATS: string[] = [];

  // No colour legend: each seat explains itself. Hovering (or focusing, or
  // tapping on a phone) shows what the seat's colour means, in a small bubble
  // on the seat and in a line under the map.
  const [hint, setHint] = useState<string | null>(null);

  // (All hooks are above this line, so returning early here is safe.)
  if (!isOpen) return null;

  // "window" / "aisle", worked out from where each seat sits in its row.
  const positions = new Map<string, string>();
  seatMap.cells.forEach((row, r) => row.forEach((cell, c) => cell && positions.set(cell, seatPosition(seatMap, r, c))));
  const seatMeaning = (seatId: string) =>
    (positions.get(seatId) && positions.get(seatId) !== 'middle' ? `${positions.get(seatId)} seat, ` : '') + seatState(seatId);
  const seatState = (seatId: string) =>
    isBookedByFemale(seatId)
      ? 'booked by a female passenger'
      : isBookedByMale(seatId)
        ? 'booked by a male passenger'
        : RESERVED_SEATS.includes(seatId)
          ? 'reserved, not available online'
        : PENDING_SEATS.includes(seatId)
          ? 'held by another passenger'
          : selectedSeats.includes(seatId)
            ? 'selected by you (tap to remove)'
            : BESIDE_WOMAN.includes(seatId)
              ? passengerGender === 'Female'
                ? 'beside a woman travelling alone, available to you'
                : 'beside a woman travelling alone, kept for women'
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
      // Seat colours: booked = red, booked by a lady = rose, ladies-only = rose outline, free = plain, your pick = navy.
      return `${seatBaseClass} bg-[#dc2626] border-transparent text-white cursor-not-allowed`;
    }
    if (isBookedByFemale(seatId)) {
      return `${seatBaseClass} bg-[#fb7185] border-transparent text-white cursor-not-allowed`;
    }
    if (RESERVED_SEATS.includes(seatId)) {
      return `${seatBaseClass} bg-[repeating-linear-gradient(135deg,#e1e2e4_0,#e1e2e4_4px,#f2f4f6_4px,#f2f4f6_8px)] border-[#c7c5d1] text-[#686873] opacity-70 cursor-not-allowed`;
    }
    if (PENDING_SEATS.includes(seatId)) {
      return `${seatBaseClass} bg-[#feb700]/15 border-[#feb700] text-[#6b4b00] cursor-not-allowed`;
    }
    if (selectedSeats.includes(seatId)) {
      return `${seatBaseClass} bg-[#050a44] border-[#050a44] text-white shadow-[0_4px_12px_rgba(5,10,68,0.35)] cursor-pointer`;
    }
    if (FEMALE_ONLY_SEATS.includes(seatId)) {
      return `${seatBaseClass} bg-rose-50 border-rose-400 text-rose-600 cursor-pointer hover:border-rose-500 hover:bg-rose-100`;
    }
    return `${seatBaseClass} bg-transparent border-[#c7c5d1] text-[#46464f] cursor-pointer hover:border-[#050a44] hover:bg-[#050a44]/5`;
  };

  /** `narrow`: a 6-seat back bench shares the row width, so its seats are slimmer. */
  /** One seat. It fills its grid cell (square), so layouts with more seats across simply get smaller seats. */
  const renderSeat = (seatId: string) => {
    const seatClass = (id: string) => getSeatClass(id);
    const isBookedMale = isBookedByMale(seatId);
    const isBookedFemale = isBookedByFemale(seatId);
    const isPending = PENDING_SEATS.includes(seatId) || RESERVED_SEATS.includes(seatId);

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

  // Phone height is animated by motion (88dvh <-> 100dvh), so no max-h here.
  const drawerPositionClass = `absolute inset-x-0 bottom-0 w-full bg-white shadow-2xl flex flex-col overflow-hidden ${
    expanded ? 'rounded-t-none' : 'rounded-t-3xl'
  } sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-auto sm:h-full sm:max-h-none sm:rounded-none sm:w-[420px]`;

  return (
    <div className="fixed inset-0 z-[90]">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
      />

      {/* Drawer: bottom sheet on mobile (pull up for full screen), right-side
          panel from sm: up. No fixed pixel width, sizes itself to content,
          never forces horizontal scrolling. */}
      <motion.div
        className={drawerPositionClass}
        initial={isPhone ? { y: '100%', height: '88dvh' } : { x: '100%' }}
        animate={isPhone ? { x: 0, y: 0, height: expanded ? '100dvh' : '88dvh' } : { x: 0, y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 38 }}
        drag={isPhone ? 'y' : false}
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.25, bottom: 0.7 }}
        onDragEnd={(_, info) => {
          const pulledUp = info.offset.y < -60 || info.velocity.y < -500;
          const pulledDown = info.offset.y > 110 || info.velocity.y > 600;

          if (pulledUp) {
            setExpanded(true);
          } else if (pulledDown) {
            if (expanded) setExpanded(false); // full screen -> normal
            else onClose(); // normal -> close
          }
        }}
      >
        {/* Drag handle (phones): pull up for full screen, pull down to shrink/close */}
        <div
          className="sm:hidden pt-2.5 pb-1 flex justify-center touch-none cursor-grab active:cursor-grabbing"
          style={{ paddingTop: expanded ? 'max(env(safe-area-inset-top), 10px)' : undefined }}
          onPointerDown={(e) => dragControls.start(e)}
          onClick={() => setExpanded((v) => !v)}
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
                {isEditingExisting ? 'Change Your Seats' : 'Select Your Seat'}
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

            {/* The seats, drawn from the bus's own layout (Staff area → Buses → Edit): any number of
                seats either side of the aisle, gaps where there is no seat, and a back bench of any
                width. Every row spans the same width, so the outer edges line up. */}
            <div className="space-y-[14px] mx-auto" style={{ width: GRID_WIDTH, maxWidth: '100%' }}>
              {layoutSegments(seatMap).map((seg, i) =>
                seg.kind === 'row' ? (
                  <div key={i} className="grid items-center" style={{ gridTemplateColumns: `repeat(${seg.cells.length}, minmax(0, 1fr))`, columnGap: seg.cells.length > widest ? 6 : GAP }}>
                    {seg.cells.map((cell, c) => (cell ? renderSeat(cell) : <div key={`gap-${c}`} aria-hidden />))}
                  </div>
                ) : (
                  // The two sides as separate stacks sharing the same length of bus (e.g. 11 rows on
                  // the left, 12 on the right): the rows are not level with each other.
                  <div key={i} className="flex items-stretch">
                    {([seg.left, seg.right] as const).map((side, k) => (
                      <React.Fragment key={k}>
                        {k === 1 && <div aria-hidden style={{ flex: `${44 + 2 * GAP} 0 0` }} />}
                        {/* The side with fewer rows keeps the normal spacing and sets the length; the side
                            with more rows fits the same length with its rows a little closer together. */}
                        <div
                          className="flex flex-col justify-between min-w-0"
                          style={{ flex: `${(k === 0 ? seatMap.left : seatMap.right) * (44 + GAP) - GAP} 0 0`, rowGap: side.length > Math.min(seg.left.length, seg.right.length) ? 4 : 14 }}
                        >
                          {side.map((cells, r) => (
                            <div key={r} className="grid items-center" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`, columnGap: GAP }}>
                              {cells.map((cell, c) => (cell ? renderSeat(cell) : <div key={`gap-${c}`} aria-hidden />))}
                            </div>
                          ))}
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                ),
              )}
            </div>
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
          <div className="flex items-center justify-between gap-3 mb-4 min-h-[34px]">
          <div className="flex flex-wrap gap-2 min-w-0 flex-1">
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
          <p aria-live="polite" className={`shrink-0 max-w-[48%] text-right text-[12px] font-semibold leading-snug text-[#050a44] ${hint ? '' : 'invisible'}`}>{hint ?? '.'}</p>
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