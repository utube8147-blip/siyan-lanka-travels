'use client';
// Conductors close the day from their phone (same page as Staff area → Close the day).
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import CashPage from '@/app/admin/cash/page';

export default function ConductorCash() {
  return (
    <div className="min-h-screen bg-[#f2f4f7] px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-10">
      <div className="max-w-2xl mx-auto">
        <Link href="/conductor" className="inline-flex items-center gap-1 text-[14px] font-semibold text-[#050a44] mb-3"><ChevronLeft className="w-4 h-4" /> Back to boarding</Link>
        <CashPage />
      </div>
    </div>
  );
}
