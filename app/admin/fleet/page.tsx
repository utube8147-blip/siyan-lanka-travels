'use client';
// app/admin/fleet/page.tsx — add, edit and retire buses. Seat layout drives
// the seat maps passengers see, so capacity changes apply everywhere.

import { describeRuns } from '@/lib/trips';
import { busSeatMap, layoutName, seatIdsOf, seatMapProblems, type SeatMap } from '@/lib/seatLayout';
import { SeatLayoutEditor } from '@/components/admin/SeatLayoutEditor';
import { useState } from 'react';
import { Armchair, BedDouble, Bike, CalendarClock, Camera, Fan, GlassWater, ImagePlus, Lamp, Loader2, Pencil, Plus, Snowflake, Sparkles, Star, Trash2, Tv, Usb, Wifi, X, type LucideIcon } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { Bus, Route, Schedule } from '@/lib/types';
import { BusCover, uploadBusPhoto } from '@/components/BusPhoto';
import { busCapacity, formatTime12, genId, routeLabel, seatIds } from '@/lib/trips';
import { Button, Card, Field, Modal, PageHeader, formatDays, inputClass, useToast } from '@/components/admin/ui';
import { tx, N_ } from '@/lib/i18n';

const AMENITIES = [N_('Air conditioning'), N_('Reclining seats'), N_('USB charging'), N_('Reading lights'), N_('Wi-Fi'), N_('Blankets'), N_('Water bottle'), N_('TV')];

const blankBus = (): Bus => ({
  id: genId('bus'),
  name: '',
  regNo: '',
  type: 'AC',
  rows: 10,
  backRowSeats: 5,
  ladiesSeats: ['1A', '1B'],
  amenities: [N_('Air conditioning'), N_('Reclining seats')],
  status: 'active',
  bikeSpaces: 4,
});

const AMENITY_ICON: Record<string, LucideIcon> = {
  'Air conditioning': Snowflake,
  'Reclining seats': Armchair,
  'USB charging': Usb,
  'Reading lights': Lamp,
  'Wi-Fi': Wifi,
  Blankets: BedDouble,
  'Water bottle': GlassWater,
  TV: Tv,
};

const STATUS_PILL: Record<Bus['status'], { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-[#16a34a] text-white' },
  maintenance: { label: 'In maintenance', cls: 'bg-[#feb700] text-[#14120a]' },
  retired: { label: 'Retired', cls: 'bg-[#46464f] text-white' },
};

export default function FleetPage() {
  const { data, saveBus, deleteBus } = useStore();
  const { toast, Toast } = useToast();
  const [editing, setEditing] = useState<Bus | null>(null);
  const [isNew, setIsNew] = useState(false);
  const addBus = () => {
    setEditing(blankBus());
    setIsNew(true);
  };

  return (
    <>
      <PageHeader
        title={tx('Buses')}
        description={tx('Your fleet. A bus only takes bookings while it\'s active and has departures in the timetable.')}
        actions={
          <Button variant="gold" onClick={addBus}>
            <Plus className="w-4 h-4" />{' '}{tx('Add a bus')}</Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-5">
        {data.buses.map((bus) => (
          <BusCard
            key={bus.id}
            bus={bus}
            runs={data.schedules.filter((s) => s.busId === bus.id && !s.archived)}
            routes={data.routes}
            onEdit={() => {
              setEditing(structuredClone(bus));
              setIsNew(false);
            }}
            onDelete={async () => {
              const res = await deleteBus(bus.id);
              toast(res.ok ? tx('{name} removed', { name: bus.name }) : res.reason ?? tx('Could not delete'), res.ok ? 'ok' : 'error');
            }}
          />
        ))}
        <button
          type="button"
          onClick={addBus}
          className="min-h-[260px] rounded-2xl border-2 border-dashed border-[#c7c5d1] text-[#46464f] hover:border-[#050a44] hover:text-[#050a44] flex flex-col items-center justify-center gap-3 transition-colors"
        >
          <span className="w-14 h-14 rounded-full bg-[#f2f4f6] flex items-center justify-center">
            <Plus className="w-6 h-6" />
          </span>
          <span className="text-[15px] font-bold">{tx('Add a bus')}</span>
          <span className="text-[12px] max-w-[220px] text-center">{tx('Name, seats, photos and what\'s on board')}</span>
        </button>
      </div>

      {editing && (
        <BusForm
          bus={editing}
          isNew={isNew}
          onClose={() => setEditing(null)}
          onSave={async (b) => {
            const res = await saveBus(b);
            if (!res.ok) return toast(res.reason ?? tx('Could not save'), 'error');
            setEditing(null);
            toast(isNew ? tx('{name} added. Now give it a departure in Routes & timetable.', { name: b.name }) : tx('{name} saved', { name: b.name }));
          }}
        />
      )}
      <Toast />
    </>
  );
}

function BusCard({ bus, runs, routes, onEdit, onDelete }: { bus: Bus; runs: Schedule[]; routes: Route[]; onEdit: () => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const map = busSeatMap(bus);
  const status = STATUS_PILL[bus.status];
  const stats = [
    { Icon: Armchair, value: String(busCapacity(bus)), label: tx('Seats') },
    { Icon: bus.type === 'AC' ? Snowflake : Fan, value: bus.type === 'AC' ? 'AC' : tx('Non-AC'), label: tx('Type') },
    { Icon: Bike, value: String(bus.bikeSpaces ?? 0), label: tx('Bike spaces') },
    { Icon: CalendarClock, value: String(runs.filter((r) => r.active).length), label: tx('Departures') },
  ];

  return (
    <Card className="overflow-hidden flex flex-col">
      <BusCover photos={bus.photos} name={bus.name} className="aspect-[16/9]">
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/35 to-transparent pointer-events-none" />
        <span className={`absolute top-3 left-3 z-10 px-2.5 py-1 rounded-full text-[11px] font-bold shadow-sm ${status.cls}`}>{tx(status.label)}</span>
        <button
          type="button"
          onClick={onEdit}
          className="absolute top-3 right-3 z-10 h-8 px-3 rounded-full bg-black/45 hover:bg-black/65 text-white text-[12px] font-bold flex items-center gap-1.5 backdrop-blur-sm"
        >
          <Camera className="w-3.5 h-3.5" />
          {!bus.photos?.length ? tx('Add photos') : bus.photos.length === 1 ? tx('1 photo') : tx('{n} photos', { n: bus.photos.length })}
        </button>
        <div className="absolute left-4 right-4 bottom-3.5 z-10 flex items-end justify-between gap-3 pointer-events-none">
          <div className="min-w-0">
            <p className="text-white text-[22px] leading-tight font-extrabold truncate drop-shadow">{bus.name}</p>
            <p className="text-white/80 text-[12px] font-medium mt-0.5">{tx('{layout} layout · {rows} rows', { layout: layoutName(map), rows: map.cells.length })}</p>
          </div>
          <span className="shrink-0 font-mono text-[13px] font-bold tracking-wider bg-white text-[#0e0f12] rounded-md px-2 py-1 border-2 border-[#0e0f12] shadow">{bus.regNo}</span>
        </div>
      </BusCover>

      <div className="p-4 sm:p-5 flex flex-col gap-4 flex-1">
        <dl className="grid grid-cols-4 gap-2">
          {stats.map(({ Icon, value, label }) => (
            <div key={label} className="rounded-xl bg-[#f8f9fb] border border-[#edeef0] px-2 py-2.5 text-center">
              <Icon className="w-4 h-4 mx-auto text-[#7c5800]" />
              <dd className="text-[17px] font-extrabold text-[#050a44] leading-tight mt-1">{value}</dd>
              <dt className="text-[11px] text-[#686873] font-medium leading-tight">{label}</dt>
            </div>
          ))}
        </dl>

        {bus.amenities.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {bus.amenities.map((a) => {
              const Icon = AMENITY_ICON[a] ?? Sparkles;
              return (
                <li key={a} className="flex items-center gap-1.5 text-[12px] font-semibold text-[#050a44] bg-white border border-[#e1e2e4] rounded-full pl-2 pr-2.5 py-1">
                  <Icon className="w-3.5 h-3.5 text-[#46464f]" />
                  {tx(a)}
                </li>
              );
            })}
          </ul>
        )}

        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#686873] mb-2">{tx('Timetabled departures')}</p>
          {runs.length === 0 ? (
            <p className="text-[13px] text-[#686873] rounded-xl border border-dashed border-[#c7c5d1] px-3 py-3">{tx('None yet. Add one in Routes & timetable.')}</p>
          ) : (
            <ul className="space-y-2">
              {runs.map((s) => (
                <li key={s.id} className={`flex items-center gap-3 rounded-xl border border-[#edeef0] px-3 py-2.5 ${s.active ? '' : 'opacity-60'}`}>
                  <span className="shrink-0 w-[74px] text-center rounded-lg bg-[#050a44] text-white text-[13px] font-bold py-1.5">{formatTime12(s.departure)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold text-[#050a44] truncate">{routeLabel(routes.find((r) => r.id === s.routeId))}</p>
                    <p className="text-[12px] text-[#686873] truncate">{describeRuns(s)}</p>
                  </div>
                  {!s.active && <span className="shrink-0 text-[11px] font-bold rounded-full px-2 py-0.5 bg-[#e1e2e4] text-[#46464f]">{tx('Paused')}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-2 mt-auto pt-1">
          <Button className="flex-1" onClick={onEdit}>
            <Pencil className="w-4 h-4" />
            {tx('Edit bus')}
          </Button>
          {confirming ? (
            <>
              <Button variant="danger" onClick={() => { setConfirming(false); onDelete(); }}>{tx('Yes, delete')}</Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>{tx('Keep')}</Button>
            </>
          ) : (
            <Button variant="danger" aria-label={tx('Delete {name}', { name: bus.name })} onClick={() => setConfirming(true)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </Card>
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
      title={isNew ? tx('Add a bus') : tx('Edit {name}', { name: bus.name })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{tx('Cancel')}</Button>
          <Button disabled={!valid} onClick={() => onSave({ ...b, name: b.name.trim(), regNo: b.regNo.trim().toUpperCase(), ladiesSeats: ladiesList, reservedSeats: reservedList, seatMap: layoutChanged || bus.seatMap || isNew ? map : null })}>
            {isNew ? tx('Add bus') : tx('Save changes')}
          </Button>
        </>
      }
    >
      <PhotoManager photos={b.photos ?? []} onChange={(p) => set('photos', p)} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={tx('Name passengers see')}>
          <input className={inputClass} value={b.name} onChange={(e) => set('name', e.target.value)} placeholder={tx('Siyan Gold')} />
        </Field>
        <Field label={tx('Registration no.')}>
          <input className={inputClass} value={b.regNo} onChange={(e) => set('regNo', e.target.value)} placeholder={tx('ND-2323')} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label={tx('Type')}>
          <select className={inputClass} value={b.type} onChange={(e) => set('type', e.target.value as Bus['type'])}>
            <option value="AC">AC</option>
            <option value="Non-AC">{tx('Non-AC')}</option>
          </select>
        </Field>
      </div>
      <div>
        <p className="text-[14px] font-bold text-[#050a44] mb-2">{tx('Seat layout')}</p>
        <SeatLayoutEditor
          value={map}
          onChange={(m) => {
            setMap(m);
            setLayoutChanged(true);
          }}
        />
        {!isNew && layoutChanged && (
          <p className="text-[12px] text-[#7c5800] font-semibold mt-2">{tx('Tickets already sold keep the seat numbers they were sold with. If you change numbers on a bus with upcoming bookings, check those departures afterwards.')}</p>
        )}
      </div>
      <Field label={tx('Bike spaces in the luggage compartment')} hint={tx('A bicycle uses 1 space; a scooter or motorbike uses 2. Set 0 if this bus can\'t carry bikes.')}>
        <input className={inputClass} type="number" min={0} max={12} value={b.bikeSpaces ?? 0} onChange={(e) => set('bikeSpaces', Math.max(0, Number(e.target.value)))} />
      </Field>
      <Field label={tx('Ladies-only seats')} hint={tx('Seat numbers separated by commas, e.g. 1A, 1B')}>
        <input className={inputClass} value={ladies} onChange={(e) => setLadies(e.target.value)} />
      </Field>
      {badLadies.length > 0 && <p className="text-[12px] font-semibold text-[#ba1a1a]">{tx('Not on this layout: {badLadies}', { badLadies: badLadies.join(', ') })}</p>}
      <p className="text-[12px] text-[#6b6d78] -mt-1">{tx('Office staff can sell a ladies-only seat to a male passenger from Departures by ticking “Override ladies-only” on that sale.')}</p>
      <Field label={tx('Reserved seats (owner\'s approval)')} hint={tx('Seat numbers separated by commas, e.g. 1C, 1D. Passengers can\'t book these online. Staff can sell one only with a code that is texted to the owner.')}>
        <input className={inputClass} value={reserved} onChange={(e) => setReserved(e.target.value)} placeholder={tx('None')} />
      </Field>
      {badReserved.length > 0 && <p className="text-[12px] font-semibold text-[#ba1a1a]">{tx('Not on this layout: {badReserved}', { badReserved: badReserved.join(', ') })}</p>}
      <Field label={tx('Amenities')}>
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
                {tx(a)}
              </button>
            );
          })}
        </div>
      </Field>
      <Field label={tx('Status')} hint={tx('Buses in maintenance or retired don\'t show in search.')}>
        <select className={inputClass} value={b.status} onChange={(e) => set('status', e.target.value as Bus['status'])}>
          <option value="active">{tx('Active')}</option>
          <option value="maintenance">{tx('In maintenance')}</option>
          <option value="retired">{tx('Retired')}</option>
        </select>
      </Field>
    </Modal>
  );
}

const MAX_PHOTOS = 6;

function PhotoManager({ photos, onChange }: { photos: string[]; onChange: (p: string[]) => void }) {
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState('');
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    const list = Array.from(files).slice(0, MAX_PHOTOS - photos.length);
    setBusy(list.length);
    let next = photos;
    for (const f of list) {
      try {
        next = [...next, await uploadBusPhoto(f)];
        onChange(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : tx('Could not add that photo'));
      }
      setBusy((n) => n - 1);
    }
  };
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[14px] font-bold text-[#050a44]">{tx('Photos')}</p>
        <p className="text-[12px] text-[#686873]">{tx('The first one is the cover. Up to {n}.', { n: MAX_PHOTOS })}</p>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {photos.map((src, i) => (
          <div key={src.slice(-40) + i} className="relative aspect-[4/3] rounded-xl overflow-hidden bg-[#f2f4f6] group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={tx('Photo {n}', { n: i + 1 })} className="w-full h-full object-cover" />
            {i === 0 ? (
              <span className="absolute left-1.5 bottom-1.5 text-[10px] font-bold bg-[#feb700] text-[#14120a] rounded-full px-2 py-0.5">{tx('Cover')}</span>
            ) : (
              <button type="button" title={tx('Make cover')} aria-label={tx('Make photo {n} the cover', { n: i + 1 })} onClick={() => onChange([src, ...photos.filter((_, k) => k !== i)])} className="absolute left-1.5 bottom-1.5 w-7 h-7 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/75">
                <Star className="w-3.5 h-3.5" />
              </button>
            )}
            <button type="button" aria-label={tx('Remove photo {n}', { n: i + 1 })} onClick={() => onChange(photos.filter((_, k) => k !== i))} className="absolute right-1.5 top-1.5 w-7 h-7 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-[#ba1a1a]">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {Array.from({ length: busy }, (_, i) => (
          <div key={'busy' + i} className="aspect-[4/3] rounded-xl bg-[#f2f4f6] flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-[#686873]" />
          </div>
        ))}
        {photos.length + busy < MAX_PHOTOS && (
          <label className="aspect-[4/3] rounded-xl border-2 border-dashed border-[#c7c5d1] hover:border-[#050a44] text-[#46464f] hover:text-[#050a44] flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors">
            <ImagePlus className="w-5 h-5" />
            <span className="text-[12px] font-bold">{tx('Add photo')}</span>
            <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </div>
      {error && <p className="text-[12px] font-semibold text-[#ba1a1a] mt-2">{error}</p>}
    </div>
  );
}
