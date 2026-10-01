'use client';
// components/admin/ui.tsx — small UI kit for the operator dashboard, using
// the same navy/gold tokens and radii as the passenger site.

import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-[24px] md:text-[28px] font-extrabold tracking-tight text-[#050a44]">{title}</h1>
        {description && <p className="text-[14px] text-[#46464f] mt-1 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl border border-[#e1e2e4] shadow-sm ${className}`}>{children}</div>;
}

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'gold';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-[#050a44] text-white hover:opacity-90',
  gold: 'bg-[#feb700] text-[#050a44] hover:brightness-105',
  secondary: 'bg-white border border-[#c7c5d1] text-[#050a44] hover:bg-[#f2f4f6]',
  danger: 'bg-white border border-[#ba1a1a]/30 text-[#ba1a1a] hover:bg-[#ba1a1a]/5',
  ghost: 'text-[#050a44] hover:bg-[#f2f4f6]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#050a44] ${
        size === 'sm' ? 'h-8 px-3 text-[12px]' : 'h-10 px-4 text-[13px]'
      } ${BTN[variant]} ${className}`}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] font-bold text-[#46464f] px-1">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="block text-[11px] text-[#686873] px-1 mt-1">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full px-3 py-2.5 bg-[#f2f4f6] border border-transparent rounded-lg text-[14px] font-medium text-[#191c1e] outline-none focus:border-[#050a44] focus:bg-white placeholder:text-[#9a9ba5] placeholder:font-normal';

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={`relative bg-white w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#edeef0]">
          <h2 className="text-[17px] font-bold text-[#050a44]">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#f2f4f6]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto space-y-4">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-[#edeef0] flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

const BADGE: Record<string, string> = {
  confirmed: 'bg-[#006e1c]/10 text-[#006e1c]',
  held: 'bg-[#feb700]/15 text-[#7c5800]',
  new: 'bg-[#dfe0ff] text-[#050a44]',
  quoted: 'bg-[#feb700]/15 text-[#7c5800]',
  done: 'bg-[#006e1c]/10 text-[#006e1c]',
  boarded: 'bg-[#050a44]/10 text-[#050a44]',
  cancelled: 'bg-[#ba1a1a]/10 text-[#ba1a1a]',
  'no-show': 'bg-[#feb700]/15 text-[#7c5800]',
  active: 'bg-[#006e1c]/10 text-[#006e1c]',
  maintenance: 'bg-[#feb700]/15 text-[#7c5800]',
  retired: 'bg-[#e1e2e4] text-[#46464f]',
  paused: 'bg-[#e1e2e4] text-[#46464f]',
  online: 'bg-[#dfe0ff] text-[#050a44]',
  counter: 'bg-[#feb700]/15 text-[#7c5800]',
  phone: 'bg-[#f2f4f6] text-[#46464f]',
};

export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold capitalize whitespace-nowrap ${BADGE[value] ?? 'bg-[#f2f4f6] text-[#46464f]'}`}>
      {label ?? value.replace('-', ' ')}
    </span>
  );
}

export function useToast() {
  const [msg, setMsg] = React.useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  const Toast = () =>
    msg ? (
      <div
        role="status"
        className={`fixed bottom-6 right-6 z-[120] px-4 py-3 rounded-xl shadow-lg text-[13px] font-semibold text-white max-w-sm ${
          msg.tone === 'error' ? 'bg-[#ba1a1a]' : 'bg-[#050a44]'
        }`}
      >
        {msg.text}
      </div>
    ) : null;
  return { toast: (text: string, tone: 'ok' | 'error' = 'ok') => setMsg({ text, tone }), Toast };
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatDays(days: number[]) {
  if (days.length === 7) return 'Daily';
  return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAYS[d]).join(', ');
}
