'use client';
// A staff-area page made of tabs (icon + word). The open tab is in the
// address (?tab=…), so links, the back button and bookmarks land on it.

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { StoreLoading } from '@/lib/store';

export interface HubTab {
  id: string;
  label: string;
  Icon: LucideIcon;
  /** Kept for callers; tabs are no longer coloured. */
  tone?: string;
  adminOnly?: boolean;
  badge?: number;
  render: () => React.ReactNode;
}

function HubInner({ tabs }: { tabs: HubTab[] }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const shown = tabs.filter((t) => !t.adminOnly || isAdmin);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current = shown.find((t) => t.id === params.get('tab')) ?? shown[0];
  const open = (id: string) => router.push(`${pathname}?tab=${id}`, { scroll: false });

  return (
    <div>
      {shown.length > 1 && (
        <nav aria-label="Sections" className="-mx-4 md:mx-0 px-4 md:px-0 mb-6 overflow-x-auto no-scrollbar">
          <ul className="flex gap-2 min-w-max">
            {shown.map((t) => {
              const on = t.id === current.id;
              return (
                <li key={t.id}>
                  <button
                    onClick={() => open(t.id)}
                    aria-current={on ? 'page' : undefined}
                    className={`flex items-center gap-2 h-10 px-4 rounded-xl border text-[14px] font-semibold transition-colors ${
                      on ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white text-[#050a44] border-[#c7c5d1] hover:border-[#050a44]'
                    }`}
                  >
                    <t.Icon className="w-4 h-4" />
                    {t.label}
                    {!!t.badge && (
                      <span className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center ${on ? 'bg-[#feb700] text-[#14120a]' : 'bg-[#feb700] text-[#14120a]'}`}>{t.badge > 99 ? '99+' : t.badge}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      <div key={current.id}>{current.render()}</div>
    </div>
  );
}

export function Hub({ tabs }: { tabs: HubTab[] }) {
  return (
    <Suspense fallback={<StoreLoading />}>
      <HubInner tabs={tabs} />
    </Suspense>
  );
}
