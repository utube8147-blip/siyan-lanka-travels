'use client';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from './ui';
import { daysUntil } from '@/lib/erp';
import { formatDateLabel } from '@/lib/trips';

/** Business pages: super admins only. (The server and database also enforce this.) */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role === 'admin') return <>{children}</>;
  return (
    <Card className="p-8 text-center max-w-md mx-auto mt-10">
      <ShieldAlert className="w-8 h-8 mx-auto text-[#7c5800]" />
      <h1 className="text-[18px] font-semibold text-[#050a44] mt-3">Super admin only</h1>
      <p className="text-[14px] text-[#46464f] mt-1">Ask the owner if you need access to this page.</p>
    </Card>
  );
}

/** Tiny horizontal bar list (no chart library needed). */
/**
 * A list of labelled bars. By default each bar is measured against the
 * largest row (the biggest is full width). Pass `max` when the values have a
 * natural ceiling, e.g. 100 for percentages, so 10% draws as a tenth of the
 * width and not as a full bar.
 */
export function BarList({ rows, format, max: ceiling }: { rows: { label: string; value: number; hint?: string }[]; format: (n: number) => string; max?: number }) {
  const max = ceiling ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between text-[13px]">
            <span className="font-semibold text-[#050a44]">{r.label}</span>
            <span className="tabular-nums text-[#46464f]">
              {format(r.value)}
              {r.hint && <span className="text-[#6b6d78]"> · {r.hint}</span>}
            </span>
          </div>
          <div className="h-2 mt-1 rounded-full bg-[#f2f4f6] overflow-hidden">
            <div className="h-full rounded-full bg-[#feb700]" style={{ width: `${Math.min(100, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Green / amber (≤30 days) / red (expired) date pill. */
export function ExpiryBadge({ date }: { date?: string | null }) {
  if (!date) return <span className="text-[12px] text-[#6b6d78]">—</span>;
  const d = daysUntil(date);
  const cls = d < 0 ? 'bg-[#ba1a1a]/10 text-[#ba1a1a]' : d <= 30 ? 'bg-[#feb700]/15 text-[#7c5800]' : 'bg-[#006e1c]/10 text-[#006e1c]';
  const text = d < 0 ? `Expired ${-d}d ago` : d === 0 ? 'Expires today' : d <= 30 ? `${d} days left` : formatDateLabel(date, true);
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${cls}`}>{text}</span>;
}

