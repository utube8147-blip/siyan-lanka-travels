'use client';
// components/BikeAddon.tsx — "Bringing a bike?" card on the passenger details
// page. Passengers pick the kind of bike, describe it and upload a photo; the
// crew uses the photo to check the bike at loading. Space in the luggage
// compartment is limited per departure (see OPERATOR.bikes + bus.bikeSpaces).

import { useId, useState } from 'react';
import { OPERATOR } from '@/config/operator';
import type { BikeItem, BikeKind, Trip } from '@/lib/types';
import { bikeFee, bikeSpacesFor, compressPhoto, formatLKR, genId } from '@/lib/trips';
import { useT } from '@/lib/i18n';

const KINDS = Object.keys(OPERATOR.bikes.kinds) as BikeKind[];
const needsPlate = (k: BikeKind) => k !== 'bicycle';

/** Human-readable reason the bikes can't be booked yet, or null when all good. */
export function bikesProblem(bikes: BikeItem[]): string | null {
  for (const [i, b] of bikes.entries()) {
    const n = bikes.length > 1 ? ` for bike ${i + 1}` : '';
    if (!b.photo) return `Upload a photo${n}.`;
    if (b.description.trim().length < 3) return `Add the make and colour${n}.`;
    if (needsPlate(b.kind) && b.regNo.trim().length < 4) return `Add the number plate${n}.`;
  }
  return null;
}

export function BikeAddon({
  trip,
  bikes,
  onChange,
}: {
  trip: Pick<Trip, 'bikeSpaces' | 'bikeSpacesLeft' | 'routeShare'>;
  bikes: BikeItem[];
  onChange: (bikes: BikeItem[]) => void;
}) {
  const { t } = useT();
  const [showRules, setShowRules] = useState(false);
  if (!trip.bikeSpaces) return null;

  const usedHere = bikes.reduce((n, b) => n + bikeSpacesFor(b.kind), 0);
  const leftAfter = trip.bikeSpacesLeft - usedHere;
  const on = bikes.length > 0;
  const full = trip.bikeSpacesLeft === 0;
  const cheapest = KINDS.reduce((min, k) => Math.min(min, bikeFee(k, trip.routeShare)), Infinity);

  const newBike = (): BikeItem | null => {
    const kind = KINDS.find((k) => bikeSpacesFor(k) <= leftAfter);
    return kind ? { id: genId('bike'), kind, description: '', regNo: '', photo: '', fee: bikeFee(kind, trip.routeShare) } : null;
  };

  const toggle = () => {
    if (on) return onChange([]);
    const b = newBike();
    if (b) onChange([b]);
  };

  const update = (id: string, patch: Partial<BikeItem>) =>
    onChange(bikes.map((b) => (b.id === id ? { ...b, ...patch, fee: bikeFee(patch.kind ?? b.kind, trip.routeShare) } : b)));

  return (
    <div className="bg-[#ffffff] rounded-xl p-[24px] shadow-sm border border-[#c7c5d1]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <span className="w-10 h-10 rounded-xl bg-[#feb700]/15 text-[#7c5800] flex items-center justify-center shrink-0" aria-hidden>
            <span className="material-symbols-outlined">two_wheeler</span>
          </span>
          <div>
            <h2 className="text-[16px] font-semibold">{t('Bringing a bike?')}</h2>
            <p className="text-[13px] text-[#46464f] mt-0.5">
              {full
                ? 'The luggage compartment is full on this departure. Try another date.'
                : `It rides in the luggage compartment under the bus, from ${formatLKR(cheapest)}. ${trip.bikeSpacesLeft} of ${trip.bikeSpaces} spaces left.`}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Add a bike to this booking"
          disabled={full && !on}
          onClick={toggle}
          className={`relative w-12 h-7 rounded-full shrink-0 transition-colors disabled:opacity-40 ${on ? 'bg-[#050a44]' : 'bg-[#c7c5d1]'}`}
        >
          <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
        </button>
      </div>

      {on && (
        <div className="mt-[20px] space-y-[16px]">
          {bikes.map((bike, i) => (
            <BikeCard
              key={bike.id}
              index={i}
              total={bikes.length}
              bike={bike}
              trip={trip}
              spacesForSwitch={leftAfter + bikeSpacesFor(bike.kind)}
              onChange={(p) => update(bike.id, p)}
              onRemove={() => onChange(bikes.filter((b) => b.id !== bike.id))}
            />
          ))}

          {bikes.length < OPERATOR.bikes.maxPerBooking && newBike() && (
            <button
              type="button"
              onClick={() => {
                const b = newBike();
                if (b) onChange([...bikes, b]);
              }}
              className="w-full h-11 rounded-xl border border-dashed border-[#c7c5d1] text-[13px] font-bold text-[#050a44] hover:bg-[#f2f4f6] flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Add another bike
            </button>
          )}

          <div className="rounded-xl bg-[#f2f4f6] px-4 py-3">
            <button
              type="button"
              onClick={() => setShowRules((v) => !v)}
              aria-expanded={showRules}
              className="w-full flex items-center justify-between text-[13px] font-bold text-[#050a44]"
            >
              Before you travel with a bike
              <span className={`material-symbols-outlined text-[18px] transition-transform ${showRules ? 'rotate-180' : ''}`}>expand_more</span>
            </button>
            {showRules && (
              <ul className="mt-2 space-y-1.5 text-[12px] text-[#46464f] list-disc pl-4">
                {OPERATOR.bikes.rules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BikeCard({
  index,
  total,
  bike,
  trip,
  spacesForSwitch,
  onChange,
  onRemove,
}: {
  index: number;
  total: number;
  bike: BikeItem;
  trip: Pick<Trip, 'routeShare'>;
  spacesForSwitch: number;
  onChange: (p: Partial<BikeItem>) => void;
  onRemove: () => void;
}) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onChange({ photo: await compressPhoto(file) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t use that photo.');
    } finally {
      setBusy(false);
    }
  };

  const fieldClass =
    'w-full mt-1 px-3 py-2.5 bg-[#f2f4f6] border-none rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44] placeholder:text-[#9a9ba5] placeholder:font-normal';

  return (
    <div className="rounded-xl border border-[#e1e2e4] p-[16px]">
      <div className="flex items-center justify-between mb-[12px]">
        <p className="text-[13px] font-bold text-[#050a44]">{total > 1 ? `Bike ${index + 1}` : 'Your bike'}</p>
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-bold text-[#050a44]">{formatLKR(bike.fee)}</span>
          <button type="button" onClick={onRemove} className="text-[12px] font-bold text-[#ba1a1a] hover:underline">
            Remove
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-[8px]" role="radiogroup" aria-label="Kind of bike">
        {(Object.keys(OPERATOR.bikes.kinds) as BikeKind[]).map((k) => {
          const meta = OPERATOR.bikes.kinds[k];
          const selected = bike.kind === k;
          const fits = meta.spaces <= spacesForSwitch;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!fits}
              onClick={() => onChange({ kind: k })}
              className={`rounded-xl border p-[10px] text-center transition-all disabled:opacity-35 disabled:cursor-not-allowed ${
                selected ? 'border-[#050a44] bg-[#050a44] text-white' : 'border-[#c7c5d1] bg-white text-[#050a44] hover:border-[#050a44]'
              }`}
            >
              <span className="material-symbols-outlined text-[24px] block">{meta.icon}</span>
              <span className="block text-[12px] font-bold mt-1 leading-tight">{meta.label}</span>
              <span className={`block text-[11px] mt-0.5 ${selected ? 'text-white/70' : 'text-[#46464f]'}`}>{formatLKR(bikeFee(k, trip.routeShare))}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-[16px] mt-[16px]">
        {bike.photo ? (
          <div className="relative rounded-xl overflow-hidden border border-[#e1e2e4] aspect-[4/3] sm:aspect-auto sm:h-full min-h-[132px] bg-[#f2f4f6]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={bike.photo} alt="Your bike" className="absolute inset-0 w-full h-full object-cover" />
            <label
              htmlFor={inputId}
              className="absolute bottom-2 left-2 right-2 text-center bg-black/55 backdrop-blur-sm text-white text-[12px] font-bold rounded-lg py-1.5 cursor-pointer hover:bg-black/70"
            >
              Replace photo
            </label>
          </div>
        ) : (
          <label
            htmlFor={inputId}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFile(e.dataTransfer.files?.[0]);
            }}
            className={`flex flex-col items-center justify-center text-center rounded-xl border-2 border-dashed min-h-[132px] px-3 py-4 cursor-pointer transition-colors ${
              dragging ? 'border-[#050a44] bg-[#dfe0ff]/40' : 'border-[#c7c5d1] bg-[#f8f9fb] hover:border-[#050a44]'
            }`}
          >
            <span className="material-symbols-outlined text-[28px] text-[#050a44]">{busy ? 'hourglass_top' : 'add_a_photo'}</span>
            <span className="text-[12px] font-bold text-[#050a44] mt-1">{busy ? 'Preparing photo…' : 'Upload a photo'}</span>
            <span className="text-[11px] text-[#46464f] mt-0.5">Whole bike, side view</span>
          </label>
        )}
        <input
          id={inputId}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        <div className="space-y-[12px]">
          <div>
            <label className="text-[11px] font-bold text-[#46464f] px-1" htmlFor={`${inputId}-desc`}>
              Make, model and colour
            </label>
            <input
              id={`${inputId}-desc`}
              value={bike.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder={bike.kind === 'bicycle' ? 'e.g. Mountain bike, green' : 'e.g. Honda Dio, red'}
              className={fieldClass}
            />
          </div>
          {needsPlate(bike.kind) && (
            <div>
              <label className="text-[11px] font-bold text-[#46464f] px-1" htmlFor={`${inputId}-reg`}>
                Number plate
              </label>
              <input
                id={`${inputId}-reg`}
                value={bike.regNo}
                onChange={(e) => onChange({ regNo: e.target.value.toUpperCase() })}
                placeholder="e.g. EP BGK-1234"
                className={fieldClass}
              />
            </div>
          )}
          <p className="text-[11px] text-[#46464f]">
            Uses {OPERATOR.bikes.kinds[bike.kind].spaces} space{OPERATOR.bikes.kinds[bike.kind].spaces > 1 ? 's' : ''} in the compartment. The crew checks it against your photo at loading.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-[12px] font-semibold text-[#ba1a1a] mt-[10px]">
          {error}
        </p>
      )}
    </div>
  );
}
