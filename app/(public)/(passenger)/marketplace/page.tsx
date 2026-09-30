// app/(public)/(passenger)/marketplace/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { formatLKR } from '@/lib/trips';
import { FLEET_PARTNERS, RESALE_TICKETS } from '@/data/resale-tickets';
import { ArrowUpDown, ChevronDown, SlidersHorizontal, Shield } from 'lucide-react';

// ---------------------------------------------------------------------------
// Filter bar now matches the search page's pattern exactly: pill toggles +
// a portal-based dropdown, all in one row, instead of a separate sidebar.
// Operators stays multi-select (checkboxes) since that's existing behavior;
// Price becomes a plain ascending/descending toggle like the search page's
// Departure time / Price pills.
// ---------------------------------------------------------------------------

function OperatorBadge({ initials }: { initials: string }) {
  return (
    <div className="w-11 h-11 rounded-lg bg-[#050a44] text-white flex items-center justify-center text-[13px] font-bold flex-shrink-0">
      {initials}
    </div>
  );
}

type DropdownKey = 'operators' | null;

export default function TicketResaleMarketplace() {
  const [fromQuery, setFromQuery] = useState('');
  const [toQuery, setToQuery] = useState('');
  const [dateQuery, setDateQuery] = useState('');
  const [operatorFilter, setOperatorFilter] = useState<string[]>([]);

  // --- Price sort — plain toggle, same pattern as search page's Price pill ---
  const [sortByPrice, setSortByPrice] = useState(false);
  const [sortAsc, setSortAsc] = useState(true);

  // --- Dropdown state (Operators only) ---
  const [openDropdown, setOpenDropdown] = useState<DropdownKey>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const operatorsBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const toggleOperator = (id: string) => {
    setOperatorFilter((prev) => (prev.includes(id) ? prev.filter((o) => o !== id) : [...prev, id]));
  };

  const toggleDropdown = (key: Exclude<DropdownKey, null>, btnRef: React.RefObject<HTMLButtonElement | null>) => {
    setOpenDropdown((prev) => {
      if (prev === key) return null;
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) {
        setMenuPos({ top: rect.bottom + 8, left: rect.left });
      }
      return key;
    });
  };

  const handlePriceSort = () => {
    if (sortByPrice) {
      setSortAsc((prev) => !prev);
    } else {
      setSortByPrice(true);
      setSortAsc(true);
    }
  };

  const resetFilters = () => {
    setOperatorFilter([]);
    setSortByPrice(false);
    setSortAsc(true);
    setOpenDropdown(null);
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const insideBar = filterBarRef.current?.contains(target);
      const insideMenu = menuPanelRef.current?.contains(target);
      if (!insideBar && !insideMenu) {
        setOpenDropdown(null);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenDropdown(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    if (!openDropdown) return;
    const closeOnMove = () => setOpenDropdown(null);
    window.addEventListener('scroll', closeOnMove, true);
    window.addEventListener('resize', closeOnMove);
    return () => {
      window.removeEventListener('scroll', closeOnMove, true);
      window.removeEventListener('resize', closeOnMove);
    };
  }, [openDropdown]);

  const filteredTickets = useMemo(() => {
    let result = RESALE_TICKETS;
    if (operatorFilter.length > 0) {
      result = result.filter((t) => operatorFilter.includes(t.direction));
    }
    if (sortByPrice) {
      result = [...result].sort((a, b) =>
        sortAsc ? a.listedPrice - b.listedPrice : b.listedPrice - a.listedPrice
      );
    }
    return result;
  }, [operatorFilter, sortByPrice, sortAsc]);

  const operatorsLabel =
    operatorFilter.length === 0
      ? 'Direction'
      : operatorFilter.length === 1
      ? FLEET_PARTNERS.find((f) => f.id === operatorFilter[0])?.name ?? 'Direction'
      : 'Both directions';

  const activeFilterCount = operatorFilter.length + (sortByPrice ? 1 : 0);

  return (
    <main className="max-w-[1440px] mx-auto px-4 md:px-[64px] py-[32px]">
      {/* Hero / Sell CTA — same gradient-navy hero treatment as my-bookings */}
      <section className="keep-navy relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1c1d22] to-[#111216] p-[32px] md:p-[40px] text-white shadow-lg mb-[32px]">
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, #ffffff 1.5px, transparent 1.5px)',
            backgroundSize: '18px 18px',
          }}
        />
        <div className="relative flex flex-col md:flex-row justify-between items-center gap-[24px]">
          <div className="space-y-[12px] max-w-lg text-center md:text-left">
            <span className="inline-block text-[10px] font-bold uppercase tracking-[0.2em] text-[#ffd54a]">
              Seat resale
            </span>
            <h1 className="text-[28px] md:text-[32px] font-extrabold tracking-tight leading-tight">
              Turn Your Unused Tickets Into Cash
            </h1>
            <p className="text-white/70 text-[14px] md:text-[15px]">
              Change of plans? List your seat here and another passenger can take it.
            </p>
            <button className="mt-[8px] inline-flex items-center gap-[8px] bg-[#feb700] text-[#6b4b00] px-6 py-3 rounded-xl font-bold text-[13px] hover:opacity-90 active:scale-95 transition-all">
              <span className="material-symbols-outlined text-[18px]">sell</span>
              Sell Your Ticket
            </button>
          </div>
          <div className="relative w-full md:w-80 h-40 md:h-48 rounded-xl overflow-hidden shadow-xl border-4 border-white/10 flex-shrink-0">
            <img
              alt="Siyan Lanka coach interior"
              className="w-full h-full object-cover"
              src="/brand/interior.jpg"
            />
          </div>
        </div>
      </section>

      {/* Search Bar — same input treatment as seats/payment pages */}
      <div className="bg-white rounded-xl p-[24px] shadow-sm border border-[#c7c5d1] mb-[24px]">
        <div className="flex flex-col md:flex-row gap-[16px] md:items-end">
          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-[16px] w-full">
            <div>
              <label className="text-[11px] font-bold text-[#46464f] px-1">From</label>
              <div className="flex items-center gap-[8px] mt-1 bg-[#f2f4f6] rounded-lg px-3 py-2.5">
                <span className="material-symbols-outlined text-[18px] text-[#6b6d78]">location_on</span>
                <input
                  value={fromQuery}
                  onChange={(e) => setFromQuery(e.target.value)}
                  placeholder="Departure city"
                  className="w-full bg-transparent border-none outline-none text-sm font-medium placeholder:text-[#9a9ba5] placeholder:font-normal"
                  type="text"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-[#46464f] px-1">To</label>
              <div className="flex items-center gap-[8px] mt-1 bg-[#f2f4f6] rounded-lg px-3 py-2.5">
                <span className="material-symbols-outlined text-[18px] text-[#6b6d78]">directions_bus</span>
                <input
                  value={toQuery}
                  onChange={(e) => setToQuery(e.target.value)}
                  placeholder="Arrival city"
                  className="w-full bg-transparent border-none outline-none text-sm font-medium placeholder:text-[#9a9ba5] placeholder:font-normal"
                  type="text"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-[#46464f] px-1">Travel date</label>
              <div className="flex items-center gap-[8px] mt-1 bg-[#f2f4f6] rounded-lg px-3 py-2.5">
                <span className="material-symbols-outlined text-[18px] text-[#6b6d78]">calendar_today</span>
                <input
                  value={dateQuery}
                  onChange={(e) => setDateQuery(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-sm font-medium"
                  type="date"
                />
              </div>
            </div>
          </div>
          <button className="h-[46px] px-8 bg-[#050a44] text-white rounded-xl font-bold text-[13px] hover:opacity-90 transition-all flex items-center justify-center gap-2 whitespace-nowrap">
            <span className="material-symbols-outlined text-[18px]">search</span>
            Search Resale
          </button>
        </div>
      </div>

      {/* Filter bar — pill row matching the search page's filter section pattern:
          plain-toggle Price pill, Operators dropdown (portal, multi-select), Reset pill. */}
      <div ref={filterBarRef} className="flex items-center gap-2.5 overflow-x-auto no-scrollbar mb-[16px]">
        {/* Price sort — plain toggle, same pattern as search page's Price pill */}
        <button
          onClick={handlePriceSort}
          className={`flex items-center gap-2 pl-4 pr-4 py-2.5 rounded-full text-sm font-bold border transition-colors whitespace-nowrap shrink-0 ${
            sortByPrice
              ? 'border-[#050a44] bg-[#050a44] text-white'
              : 'border-[#e1e2e4] bg-white text-[#050a44] hover:bg-[#f1f3f9]'
          }`}
        >
          <ArrowUpDown
            className={`w-4 h-4 transition-transform ${sortByPrice && !sortAsc ? 'rotate-180' : ''} ${
              sortByPrice ? 'text-white/70' : 'text-[#c7c5d1]'
            }`}
          />
          Price
        </button>

        {/* Operators dropdown — multi-select checkboxes, sourced from FLEET_PARTNERS */}
        <div className="relative shrink-0">
          <button
            ref={operatorsBtnRef}
            onClick={() => toggleDropdown('operators', operatorsBtnRef)}
            className={`flex items-center gap-2 pl-4 pr-3.5 py-2.5 rounded-full text-sm font-bold transition-colors whitespace-nowrap border ${
              openDropdown === 'operators' || operatorFilter.length > 0
                ? 'border-[#050a44] bg-[#050a44] text-white'
                : 'border-[#e1e2e4] bg-white text-[#050a44] hover:bg-[#f1f3f9]'
            }`}
          >
            <span className="truncate max-w-[130px]">{operatorsLabel}</span>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${openDropdown === 'operators' ? 'rotate-180' : ''} ${
                openDropdown === 'operators' || operatorFilter.length > 0 ? 'text-white/70' : 'text-[#c7c5d1]'
              }`}
            />
          </button>
          {openDropdown === 'operators' && menuPos && createPortal(
            <div
              ref={menuPanelRef}
              style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
              className="z-50 w-60 max-h-72 overflow-y-auto bg-white rounded-xl shadow-[0px_8px_32px_rgba(0,0,0,0.16)] border border-[#e1e2e4]/60 p-2"
            >
              {FLEET_PARTNERS.map((partner) => (
                <label
                  key={partner.id}
                  className="flex items-center gap-2.5 py-2 px-2.5 rounded-lg hover:bg-[#f1f3f9] cursor-pointer"
                >
                  <input
                    checked={operatorFilter.includes(partner.id)}
                    onChange={() => toggleOperator(partner.id)}
                    className="w-4 h-4 rounded text-[#050a44] focus:ring-[#050a44] border-[#c7c5d1]"
                    type="checkbox"
                  />
                  <span className="text-sm font-medium text-[#46464f]">{partner.name}</span>
                </label>
              ))}
            </div>,
            document.body
          )}
        </div>

        {/* Reset — same icon-first treatment as search page's Reset pill */}
        <button
          onClick={resetFilters}
          disabled={activeFilterCount === 0}
          aria-label="Reset filters"
          className={`flex items-center gap-1.5 pl-3 pr-3 py-2.5 rounded-full text-xs font-bold whitespace-nowrap shrink-0 transition-colors ${
            activeFilterCount > 0
              ? 'text-[#E74C3C] border border-[#E74C3C]/30 bg-[#E74C3C]/5 hover:bg-[#E74C3C]/10'
              : 'text-[#c7c5d1] border border-[#e1e2e4] cursor-not-allowed'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Reset{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>

        {/* Safety tip — compact inline note, takes the sidebar's place in the row */}
        <div className="hidden md:flex items-center gap-1.5 ml-auto pl-3 pr-4 py-2 rounded-full bg-[#f2f4f6] border border-[#e1e2e4] shrink-0">
          <Shield className="w-3.5 h-3.5 text-[#050a44]" />
          <span className="text-[11px] font-medium text-[#46464f] whitespace-nowrap">
            All resale tickets verified &amp; transferred instantly
          </span>
        </div>
      </div>

      {/* Results list — full width now that the sidebar is gone */}
      <div className="space-y-[16px]">
        {filteredTickets.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#c7c5d1] shadow-sm p-[32px] text-center">
            <p className="text-[13px] text-[#46464f]">No resale tickets match your filters.</p>
            <button
              onClick={resetFilters}
              className="mt-[12px] text-[#050a44] font-bold text-[13px] hover:underline"
            >
              Reset filters
            </button>
          </div>
        ) : (
          filteredTickets.map((ticket) =>
            ticket.featured ? (
              <div
                key={ticket.id}
                className="keep-navy relative overflow-hidden rounded-xl bg-gradient-to-br from-[#1c1d22] to-[#111216] text-white p-[24px] flex flex-col md:flex-row items-center gap-[24px] shadow-sm"
              >
                <img
                  className="absolute inset-0 w-full h-full object-cover opacity-10"
                  src="/brand/interior.jpg"
                  alt="Coach interior"
                />
                <div className="relative z-10 flex-1">
                  {ticket.tag && (
                    <span className="inline-block bg-[#feb700] text-[#6b4b00] px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide mb-[12px]">
                      {ticket.tag}
                    </span>
                  )}
                  <h3 className="text-[22px] font-bold mb-[4px]">Exclusive {ticket.busType}</h3>
                  <p className="text-[13px] text-white/70 max-w-md">
                    Single seat available on {ticket.operator}&apos;s {ticket.from} → {ticket.to} route. Priced well
                    below counter rate.
                  </p>
                </div>
                <div className="relative z-10 text-center md:text-right">
                  <p className="text-[32px] font-extrabold mb-[12px]">{formatLKR(ticket.listedPrice)}</p>
                  <Link
                    href={`/marketplace/buy/${ticket.id}`}
                    className="inline-block bg-white text-[#050a44] rounded-xl px-6 py-3 text-[13px] font-bold hover:opacity-90 transition-all"
                  >
                    Grab Now
                  </Link>
                </div>
              </div>
            ) : (
              <div
                key={ticket.id}
                className="bg-white rounded-xl border border-[#c7c5d1] shadow-sm p-[24px] hover:shadow-md transition-shadow"
              >
                <div className="flex flex-col md:flex-row justify-between gap-[24px]">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-[16px]">
                      <div className="flex items-center gap-[12px]">
                        <OperatorBadge initials={ticket.operatorInitials} />
                        <div>
                          <h4 className="text-[15px] font-bold text-[#050a44]">{ticket.operator}</h4>
                          <span className="inline-block mt-[2px] bg-[#feb700]/15 text-[#7c5800] text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                            {ticket.busType}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-0.5">Seat</p>
                        <p className="text-[14px] font-bold text-[#050a44]">{ticket.seats}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-[#f2f4f6] rounded-xl p-[16px]">
                      <div>
                        <p className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-1">{ticket.from}</p>
                        <p className="text-[14px] font-bold text-[#050a44]">{ticket.departureTime}</p>
                      </div>
                      <div className="flex flex-col items-center px-[16px]">
                        <span className="material-symbols-outlined text-[#050a44] mb-1">directions_bus</span>
                        <span className="flex items-center gap-1 bg-[#006e1c]/10 text-[#006e1c] px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide">
                          <span className="material-symbols-outlined text-[13px]">verified</span>
                          Verified
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-1">{ticket.to}</p>
                        <p className="text-[14px] font-bold text-[#050a44]">{ticket.arrivalTime}</p>
                      </div>
                    </div>
                  </div>

                  <div className="md:w-56 flex flex-row md:flex-col justify-between items-center md:items-end md:pl-[24px] md:border-l border-[#e1e2e4] gap-[12px]">
                    <div className="text-center md:text-right">
                      <p className="text-[11px] font-medium text-[#6b6d78] line-through mb-0.5">
                        {formatLKR(ticket.originalPrice)}
                      </p>
                      <div className="flex items-baseline gap-[6px] justify-center md:justify-end">
                        <span className="text-[24px] font-extrabold text-[#050a44]">{formatLKR(ticket.listedPrice)}</span>
                        {ticket.tag && (
                          <span className="bg-[#006e1c]/10 text-[#006e1c] text-[10px] px-2 py-0.5 rounded-full font-bold">
                            {ticket.tag}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-medium text-[#46464f] mt-1">Listed by {ticket.sellerHandle}</p>
                    </div>
                    <Link
                      href={`/marketplace/buy/${ticket.id}`}
                      className="w-full md:w-auto text-center bg-[#050a44] text-white rounded-xl px-6 py-2.5 text-[13px] font-bold hover:opacity-90 active:scale-95 transition-all whitespace-nowrap"
                    >
                      Buy Now
                    </Link>
                  </div>
                </div>
              </div>
            )
          )
        )}
      </div>
    </main>
  );
}