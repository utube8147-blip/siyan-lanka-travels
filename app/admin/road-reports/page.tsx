'use client';
// Staff area → Road reports: what conductors have marked on the road in the
// last two days (traffic police, checkpoints, accidents, roadworks…). Live ones
// are on every conductor's map; office staff can clear one that is gone.

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button, Card, PageHeader, useToast } from '@/components/admin/ui';
import { isLive, kindOf, useRoadReports, voteReport, type RoadReport } from '@/lib/conductor';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function RoadReportsPage() {
  const { reports, error, reload } = useRoadReports({ all: true });
  const { toast, Toast } = useToast();
  const [show, setShow] = useState<'live' | 'all'>('live');
  const list = show === 'live' ? reports.filter((r) => isLive(r)) : reports;
  const status = (r: RoadReport) => (r.clearedAt ? 'Cleared' : isLive(r) ? 'On the map' : 'Expired');

  return (
    <div>
      <PageHeader
        title="Road reports"
        description="What conductors have marked on the road: traffic police, checkpoints, accidents, roadworks and more. Live reports are on every conductor's map and warn them as their bus gets close. A report goes after 2 hours unless someone says it is still there."
      />
      <div className="flex gap-2 mb-4">
        {(['live', 'all'] as const).map((k) => (
          <button key={k} onClick={() => setShow(k)} aria-pressed={show === k}
            className={`px-3 h-9 rounded-lg text-[13px] font-bold border ${show === k ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white text-[#050a44] border-[#c7c5d1]'}`}>
            {k === 'live' ? `On the map now (${reports.filter((r) => isLive(r)).length})` : `Last 2 days (${reports.length})`}
          </button>
        ))}
      </div>
      {error && <p className="mb-4 text-[13px] font-semibold text-[#ba1a1a]">{error}</p>}
      <Card>
        {list.length === 0 ? (
          <p className="p-6 text-[14px] text-[#46464f]">{show === 'live' ? 'Nothing reported on the roads right now.' : 'No reports in the last 2 days.'}</p>
        ) : (
          <ul className="divide-y divide-[#edeef0]">
            {list.map((r) => {
              const k = kindOf(r.kind);
              const live = isLive(r);
              return (
                <li key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${live ? '' : 'opacity-60'}`}>
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center text-[20px] shrink-0" style={{ background: k.color }} aria-hidden>{k.icon}</span>
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-[15px] font-bold text-[#050a44]">{k.label} <span className="ml-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#f2f4f6] text-[#46464f] align-middle">{status(r)}</span></p>
                    <p className="text-[13px] text-[#46464f]">
                      {[when(r.createdAt), r.reporterName ? `by ${r.reporterName}` : '', r.confirmations ? `${r.confirmations} confirmed` : '', live ? `until ${when(r.expiresAt)}` : ''].filter(Boolean).join(' · ')}
                    </p>
                    {r.note && <p className="text-[14px] text-[#191c1e] mt-0.5">{r.note}</p>}
                  </div>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#050a44] underline">
                    Map <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  {live && (
                    <Button size="sm" variant="secondary" onClick={async () => {
                      const res = await voteReport(r.id, false);
                      toast(res.ok ? 'Cleared from the conductors’ maps' : res.reason ?? 'Could not clear', res.ok ? 'ok' : 'error');
                      reload();
                    }}>Clear</Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Toast />
    </div>
  );
}
