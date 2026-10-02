'use client';
// app/admin/fleet/page.tsx — add, edit and retire buses. Seat layout drives
// the seat maps passengers see, so capacity changes apply everywhere.

import { describeRuns } from '@/lib/trips';
import { busSeatMap, layoutName, seatIdsOf, seatMapProblems, type SeatMap } from '@/lib/seatLayout';
import { SeatLayoutEditor } from '@/components/admin/SeatLayoutEditor';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { Bus } from '@/lib/types';
import { busCapacity, formatTime12, genId, routeLabel, seatIds } from '@/lib/trips';
import { Badge, Button, Card, Field, Modal, PageHeader, formatDays, inputClass, useToast } from '@/components/admin/ui';

const AMENITIES = ['Air conditioning', 'Reclining seats', 'USB charging', 'Reading lights', 'Wi-Fi', 'Blankets', 'Water bottle', 'TV'];

const blankBus = (): Bus => ({
  id: genId('bus'),
  name: '',
  regNo: '',
  type: 'AC',
  rows: 10,
  backRowSeats: 5,
  ladiesSeats: ['1A', '1B'],
  amenities: ['Air conditioning', 'Reclining seats'],
  status: 'active',
  bikeSpaces: 4,
});

export default function FleetPage() {
  const { data, saveBus, deleteBus } = useStore();
  const { toast, Toast } = useToast();
  const [editing, setEditing] = useState<Bus | null>(null);
  const [isNew, setIsNew] = useState(false);

  return (
    <>
      <PageHeader
        title="Buses"
        description="Your fleet. A bus only takes bookings while it's active and has departures in the timetable."
        actions={
          <Button
            variant="gold"
            onClick={() => {
              setEditing(blankBus());
              setIsNew(true);
            }}
          >
            <Plus className="w-4 h-4" /> Add a bus
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data.buses.map((bus) => {
          const runs = data.schedules.filter((s) => s.busId === bus.id);
          return (
            <Card key={bus.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[18px] font-bold text-[#050a44]">{bus.name}</p>
                  <p className="text-[13px] text-[#46464f]">
                    {bus.regNo} · {bus.type} · {busCapacity(bus)} seats ({layoutName(busSeatMap(bus))}, {busSeatMap(bus).cells.length} rows)
                  </p>
                  <p className="text-[13px] text-[#46464f] flex items-center gap-1 mt-0.5">
                    <span className="material-symbols-outlined text-[16px]">two_wheeler</span>
                    {bus.bikeSpaces ? `${bus.bikeSpaces} bike spaces in the luggage compartment` : 'No bike space'}
                  </p>
                </div>
                <Badge value={bus.status} />
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {bus.amenities.map((a) => (
                  <span key={a} className="text-[12px] font-medium bg-[#f2f4f6] text-[#050a44] rounded-full px-2.5 py-1">
                    {a}
                  </span>
                ))}
              </div>
              <div className="mt-4 border-t border-[#edeef0] pt-3">
                <p className="text-[12px] font-bold text-[#46464f] mb-1">Timetabled departures</p>
                {runs.length === 0 ? (
                  <p className="text-[13px] text-[#686873]">None yet. Add one in Routes &amp; timetable.</p>
                ) : (
                  <ul className="text-[13px] text-[#050a44] space-y-0.5">
                    {runs.map((s) => (
                      <li key={s.id}>
                        {formatTime12(s.departure)} {routeLabel(data.routes.find((r) => r.id === s.routeId))} · {describeRuns(s)}
                        {!s.active && ' (paused)'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex gap-2 mt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setEditing(structuredClone(bus));
                    setIsNew(false);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={async () => {
                    const res = await deleteBus(bus.id);
                    toast(res.ok ? `${bus.name} removed` : res.reason ?? 'Could not delete', res.ok ? 'ok' : 'error');
                  }}
                >
                  Delete
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {editing && (
        <BusForm
          bus={editing}
          isNew={isNew}
          onClose={() => setEditing(null)}
          onSave={async (b) => {
            const res = await saveBus(b);
            if (!res.ok) return toast(res.reason ?? 'Could not save', 'error');
            setEditing(null);
            toast(isNew ? `${b.name} added. Now give it a departure in Routes & timetable.` : `${b.name} saved`);
          }}
        />
      )}
      <Toast />
    </>
  );
}

function BusForm({ bus, isNew, onClose, onSave }: { bus: Bus; isNew: boolean; onClose: () => void; onSave: (b: Bus) => void }) {
  const [b, setB] = useState<Bus>(bus);
  const [ladies, setLadies] = useState(bus.ladiesSeats.join(', '));
  const [reserved, setReserved] = useState((bus.reservedSeats ?? []).join(', '));
  const set = <K extends keyof Bus>(k: K, v: Bus[K]) => setB((p) => ({ ...p, [k]: v }));
  // The seat grid: the bus's own, or the classic 2+2 one for buses saved before layouts could be edited.
  const [map, setMap] = useState<SeatMap>(() => busSeatMap(bus));
  const [layoutChanged, setLayoutChanged] = useState(false);
  const validSeats = new Set(seatIdsOf(map));
  const ladiesList = ladies
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const badLadies = ladiesList.filter((s) => !validSeats.has(s));
  const reservedList = reserved
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const badReserved = reservedList.filter((s) => !validSeats.has(s));
  const valid = b.name.trim() && b.regNo.trim() && seatMapProblems(map).length === 0 && badLadies.length === 0 && badReserved.length === 0;

  return (
    <Modal
      title={isNew ? 'Add a bus' : `Edit ${bus.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={() => onSave({ ...b, name: b.name.trim(), regNo: b.regNo.trim().toUpperCase(), ladiesSeats: ladiesList, reservedSeats: reservedList, seatMap: layoutChanged || bus.seatMap || isNew ? map : null })}>
            {isNew ? 'Add bus' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name passengers see">
          <input className={inputClass} value={b.name} onChange={(e) => set('name', e.target.value)} placeholder="Siyan Gold" />
        </Field>
        <Field label="Registration no.">
          <input className={inputClass} value={b.regNo} onChange={(e) => set('regNo', e.target.value)} placeholder="ND-2323" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Type">
          <select className={inputClass} value={b.type} onChange={(e) => set('type', e.target.value as Bus['type'])}>
            <option value="AC">AC</option>
            <option value="Non-AC">Non-AC</option>
          </select>
        </Field>
      </div>
      <div>
        <p className="text-[14px] font-bold text-[#050a44] mb-2">Seat layout</p>
        <SeatLayoutEditor
          value={map}
          onChange={(m) => {
            setMap(m);
            setLayoutChanged(true);
          }}
        />
        {!isNew && layoutChanged && (
          <p className="text-[12px] text-[#7c5800] font-semibold mt-2">
            Tickets already sold keep the seat numbers they were sold with. If you change numbers on a bus with upcoming bookings, check those departures afterwards.
          </p>
        )}
      </div>
      <Field label="Bike spaces in the luggage compartment" hint="A bicycle uses 1 space; a scooter or motorbike uses 2. Set 0 if this bus can't carry bikes.">
        <input className={inputClass} type="number" min={0} max={12} value={b.bikeSpaces ?? 0} onChange={(e) => set('bikeSpaces', Math.max(0, Number(e.target.value)))} />
      </Field>
      <Field label="Ladies-only seats" hint="Seat numbers separated by commas, e.g. 1A, 1B">
        <input className={inputClass} value={ladies} onChange={(e) => setLadies(e.target.value)} />
      </Field>
      {badLadies.length > 0 && <p className="text-[12px] font-semibold text-[#ba1a1a]">Not on this layout: {badLadies.join(', ')}</p>}
      <p className="text-[12px] text-[#6b6d78] -mt-1">Office staff can sell a ladies-only seat to a male passenger from Departures by ticking &ldquo;Override ladies-only&rdquo; on that sale.</p>
      <Field label="Reserved seats (owner's approval)" hint="Seat numbers separated by commas, e.g. 1C, 1D. Passengers can't book these online. Staff can sell one only with a code that is texted to the owner.">
        <input className={inputClass} value={reserved} onChange={(e) => setReserved(e.target.value)} placeholder="None" />
      </Field>
      {badReserved.length > 0 && <p className="text-[12px] font-semibold text-[#ba1a1a]">Not on this layout: {badReserved.join(', ')}</p>}
      <Field label="Amenities">
        <div className="flex flex-wrap gap-2">
          {AMENITIES.map((a) => {
            const on = b.amenities.includes(a);
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                onClick={() => set('amenities', on ? b.amenities.filter((x) => x !== a) : [...b.amenities, a])}
                className={`px-3 py-1.5 rounded-full text-[12px] font-bold border ${on ? 'bg-[#050a44] text-white border-[#050a44]' : 'border-[#c7c5d1] text-[#46464f]'}`}
              >
                {a}
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Status" hint="Buses in maintenance or retired don't show in search.">
        <select className={inputClass} value={b.status} onChange={(e) => set('status', e.target.value as Bus['status'])}>
          <option value="active">Active</option>
          <option value="maintenance">In maintenance</option>
          <option value="retired">Retired</option>
        </select>
      </Field>
    </Modal>
  );
}
