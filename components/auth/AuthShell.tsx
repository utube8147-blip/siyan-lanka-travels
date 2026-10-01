'use client';
// Shared frame for the passenger sign-in / sign-up pages.
import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="min-h-screen flex bg-[#f8f9fb]">
      <div className="flex-1 flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[420px]">
          <Link href="/" className="mb-10 flex justify-center"><Wordmark badge /></Link>
          <h1 className="text-[26px] font-semibold text-[#050a44] text-center">{title}</h1>
          <p className="text-[14px] text-[#46464f] text-center mt-1 mb-7">{subtitle}</p>
          {children}
          <div className="text-center mt-8 text-[14px] text-[#46464f]">{footer}</div>
        </div>
      </div>
      <div className="keep-navy hidden md:flex flex-1 relative overflow-hidden items-center justify-center bg-[#111216]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/interior.png" alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
        <div className="relative z-10 text-white max-w-md p-8">
          <h2 className="text-[34px] font-semibold leading-tight">Your journey starts here.</h2>
          <p className="text-[17px] text-white/80 mt-3 leading-relaxed">Tickets on your phone, seat changes in a tap, and texts when your bus is on its way.</p>
        </div>
      </div>
    </div>
  );
}

export const authInput =
  'w-full h-12 px-4 rounded-xl bg-white border border-[#c7c5d1] text-[15px] font-medium text-[#050a44] outline-none focus:border-[#050a44] focus:ring-2 focus:ring-[#050a44]/10 placeholder:text-[#6b6d78] placeholder:font-normal';
export const authButton = 'w-full h-12 rounded-xl bg-[#050a44] text-white text-[15px] font-semibold hover:opacity-95 disabled:opacity-50 transition-opacity';
