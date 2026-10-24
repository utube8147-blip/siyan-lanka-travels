'use client';
// "Share" in the route editor: make a private link to a read-only snapshot of
// the route as it is now, copy it, and turn old links off.

import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, Loader2 } from 'lucide-react';
import type { RouteStop } from '@/lib/types';
import { createShare, listShares, revokeShare, shareUrl, type RouteShare } from '@/lib/routeShare';
import { formatTime12, dateLocale } from '@/lib/trips';
import { Button, Modal, inputClass } from '@/components/admin/ui';
import { tx, txr, txn } from '@/lib/i18n';

import { fmtDate } from '@/lib/dates';
export function ShareRouteDialog({
  routeId,
  defaultTitle,
  stops,
  path,
  distanceKm,
  departures,
  defaultDeparture,
  onClose,
  toast,
}: {
  routeId: string;
  defaultTitle: string;
  stops: RouteStop[];
  /** The road line now (if the routing server has it). */
  path: [number, number][] | null;
  distanceKm: number | null;
  departures: string[];
  defaultDeparture: string;
  onClose: () => void;
  toast: (msg: string, kind?: 'ok' | 'error') => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [note, setNote] = useState('');
  const [departure, setDeparture] = useState(defaultDeparture);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<RouteShare | null>(null);
  const [links, setLinks] = useState<RouteShare[] | null>(null);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    listShares(routeId).then((r) => {
      setLinks(r.shares);
      if (r.error) toast(r.error, 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  const pinned = stops.filter((s) => s.lat != null && s.lng != null);
  const missing = stops.length - pinned.length;

  const create = async () => {
    setBusy(true);
    const r = await createShare({
      routeId,
      title: title.trim() || defaultTitle,
      note: note.trim(),
      stops: pinned.map((s) => ({ name: s.name.trim(), lat: s.lat!, lng: s.lng!, offsetMin: s.offsetMin, ...(s.landmark ? { landmark: s.landmark } : {}) })),
      path: missing ? null : path, // with stops left out, the page works out the road itself
      distanceKm: missing ? null : distanceKm,
      departure: departure || null,
    });
    setBusy(false);
    if (!r.ok || !r.share) return toast(r.reason ?? tx('Could not make the link'), 'error');
    setMade(r.share);
    setLinks((l) => [r.share!, ...(l ?? [])]);
    copy(r.share.token);
  };

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? '' : c)), 2000);
    } catch {
      toast(tx('Copy the link from the box'), 'error');
    }
  };

  const turnOff = async (s: RouteShare) => {
    if (!window.confirm(tx('Turn off the link "{title}"? Anyone opening it will see "This link has been turned off".', { title: s.title }))) return;
    const r = await revokeShare(s.token);
    if (!r.ok) return toast(r.reason ?? tx('Could not turn it off'), 'error');
    setLinks((l) => (l ?? []).filter((x) => x.token !== s.token));
    if (made?.token === s.token) setMade(null);
    toast(tx('Link turned off'), 'ok');
  };

  return (
    <Modal title={tx('Share this route')} onClose={onClose}>
      <p className="text-[13px] text-[#46464f]">{txr("Makes a private link to a read-only page with the map, the road and the stop times, <b>as they are now</b>. Anyone with the link can open it without signing in; nobody else can find it. Later changes here don't change it: share again for a new version.", { b: (c) => <b className="text-[#050a44]">{c}</b> })}</p>
      {missing > 0 && (
        <p className="rounded-lg bg-[#feb700]/15 px-3 py-2 text-[12px] font-semibold text-[#7c5800]">{txn(missing, "{n} stop has no map pin and won't be on the shared map.", "{n} stops have no map pin and won't be on the shared map.")}</p>
      )}

      {!made ? (
        <div className="space-y-3">
          <label className="block">
            <span className="block text-[12px] font-bold text-[#46464f] mb-1">{tx('Title')}</span>
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </label>
          <label className="block">
            <span className="block text-[12px] font-bold text-[#46464f] mb-1">{tx('Note for the viewer (optional)')}</span>
            <textarea className={`${inputClass} min-h-[70px]`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={tx('e.g. Proposed route via Kandy from December. Times are estimates.')} />
          </label>
          {departures.length > 0 && (
            <label className="block">
              <span className="block text-[12px] font-bold text-[#46464f] mb-1">{tx('Show clock times for')}</span>
              <select className={inputClass} value={departure} onChange={(e) => setDeparture(e.target.value)}>
                {departures.filter((d, i, a) => a.indexOf(d) === i).map((d) => (
                  <option key={d} value={d}>{tx('The {time} departure', { time: formatTime12(d) })}</option>
                ))}
                <option value="">{tx('No clock times (only “h:mm after leaving”)')}</option>
              </select>
            </label>
          )}
          <Button variant="gold" disabled={busy || pinned.length < 2} onClick={create}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}{' '}{tx('Create link')}</Button>
        </div>
      ) : (
        <div className="rounded-xl border-2 border-[#1f7a3a]/40 bg-[#1f7a3a]/5 p-3 space-y-2">
          <p className="text-[13px] font-bold text-[#1f7a3a]">{copied === made.token ? tx('Link ready and copied') : tx('Link ready')}</p>
          <div className="flex gap-1.5">
            <input className={`${inputClass} !text-[12px]`} readOnly value={shareUrl(made.token)} onFocus={(e) => e.target.select()} aria-label={tx('Share link')} />
            <Button variant="secondary" onClick={() => copy(made.token)} aria-label={tx('Copy link')}>
              {copied === made.token ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
            <a className="inline-flex items-center justify-center rounded-xl h-10 px-3 bg-white border border-[#c7c5d1] text-[#050a44] hover:bg-[#f2f4f6]" href={shareUrl(made.token)} target="_blank" rel="noreferrer" aria-label={tx('Open the shared page')}>
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
          <button type="button" className="text-[12px] font-bold underline text-[#050a44]" onClick={() => setMade(null)}>{tx('Make another link')}</button>
        </div>
      )}

      <div className="border-t border-[#edeef0] pt-3">
        <p className="text-[13px] font-bold text-[#050a44] mb-1.5">{tx('Links that are on for this route')}</p>
        {links == null ? (
          <p className="text-[12px] text-[#6b6d78]">{tx('Loading…')}</p>
        ) : links.length === 0 ? (
          <p className="text-[12px] text-[#6b6d78]">{tx('None.')}</p>
        ) : (
          <ul className="divide-y divide-[#edeef0]">
            {links.map((s) => (
              <li key={s.token} className="py-2 flex items-center gap-2 text-[12px]">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[#050a44] truncate">{s.title}</p>
                  <p className="text-[#6b6d78]">
                    {fmtDate(new Date(s.createdAt), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{' '}{tx('· {length} stops', { length: s.stops.length })}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => copy(s.token)} aria-label={tx('Copy link {title}', { title: s.title })}>
                  {copied === s.token ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{' '}{tx('Copy')}</Button>
                <a className="text-[#050a44]" href={shareUrl(s.token)} target="_blank" rel="noreferrer" aria-label={tx('Open {title}', { title: s.title })}>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <Button size="sm" variant="danger" onClick={() => turnOff(s)}>{tx('Turn off')}</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
