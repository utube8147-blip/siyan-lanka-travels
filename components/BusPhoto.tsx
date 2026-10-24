'use client';
// A bus's cover: its photo, or a drawn coach in the company colours until
// someone adds one. Optional arrows flip through the other photos.

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { compressPhoto } from '@/lib/trips';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { uuid } from '@/lib/uuid';

/** Bus photos: public storage with Supabase, an embedded image in demo mode. */
export async function uploadBusPhoto(file: File) {
  const dataUrl = await compressPhoto(file, isSupabaseConfigured ? 1600 : 1000);
  if (!isSupabaseConfigured) return dataUrl;
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${uuid()}.jpg`;
  const { error } = await supabase().storage.from('bus-photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw new Error('Could not upload the photo. Check your connection and try again.');
  return supabase().storage.from('bus-photos').getPublicUrl(path).data.publicUrl;
}

/** The drawn coach shown when a bus has no photo yet. */
export function BusIllustration({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 225" className={className} role="img" aria-label="Bus" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="bp-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1360" />
          <stop offset="1" stopColor="#050a44" />
        </linearGradient>
        <linearGradient id="bp-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dfe3ee" />
        </linearGradient>
        <linearGradient id="bp-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d2a7a" />
          <stop offset="1" stopColor="#0a1150" />
        </linearGradient>
      </defs>
      <rect width="400" height="225" fill="url(#bp-sky)" />
      <circle cx="330" cy="52" r="70" fill="#feb700" opacity="0.08" />
      <circle cx="330" cy="52" r="38" fill="#feb700" opacity="0.10" />
      {/* road */}
      <rect y="176" width="400" height="49" fill="#03072e" />
      <g fill="#feb700" opacity="0.5">
        <rect x="10" y="199" width="38" height="4" rx="2" />
        <rect x="90" y="199" width="38" height="4" rx="2" />
        <rect x="170" y="199" width="38" height="4" rx="2" />
        <rect x="250" y="199" width="38" height="4" rx="2" />
        <rect x="330" y="199" width="38" height="4" rx="2" />
      </g>
      {/* coach */}
      <g transform="translate(58 72)">
        <ellipse cx="142" cy="108" rx="150" ry="6" fill="#000" opacity="0.35" />
        <path d="M8 18 Q8 4 22 4 H262 Q282 4 288 22 L294 52 V92 Q294 100 286 100 H14 Q6 100 6 92 V30 Z" fill="url(#bp-body)" />
        {/* windows */}
        <path d="M18 14 H232 V50 H18 Q14 50 14 46 V18 Q14 14 18 14 Z" fill="url(#bp-glass)" />
        <g stroke="#dfe3ee" strokeWidth="3">
          <line x1="58" y1="14" x2="58" y2="50" />
          <line x1="100" y1="14" x2="100" y2="50" />
          <line x1="142" y1="14" x2="142" y2="50" />
          <line x1="184" y1="14" x2="184" y2="50" />
        </g>
        {/* windscreen and door */}
        <path d="M242 14 H270 Q278 14 281 22 L288 50 H242 Z" fill="url(#bp-glass)" />
        <rect x="244" y="56" width="22" height="40" rx="2" fill="#0a1150" opacity="0.85" />
        <line x1="255" y1="56" x2="255" y2="96" stroke="#dfe3ee" strokeWidth="1.5" />
        {/* gold band */}
        <path d="M6 62 H240 V72 H6 Z" fill="#feb700" />
        <path d="M6 76 H240 V79 H6 Z" fill="#feb700" opacity="0.55" />
        {/* lights */}
        <rect x="284" y="78" width="9" height="7" rx="2" fill="#fff6d6" />
        <rect x="7" y="80" width="6" height="8" rx="2" fill="#ff5a4e" />
        {/* wheels */}
        <g>
          <circle cx="62" cy="100" r="17" fill="#0e0f12" />
          <circle cx="62" cy="100" r="8" fill="#9aa0b4" />
          <circle cx="224" cy="100" r="17" fill="#0e0f12" />
          <circle cx="224" cy="100" r="8" fill="#9aa0b4" />
        </g>
      </g>
    </svg>
  );
}

/** Cover image box. Give it a size (e.g. aspect-[16/9]) through className. */
export function BusCover({ photos = [], name, className = '', children }: { photos?: string[]; name: string; className?: string; children?: React.ReactNode }) {
  const [i, setI] = useState(0);
  const n = photos.length;
  const at = n ? ((i % n) + n) % n : 0;
  return (
    <div className={`keep-navy relative overflow-hidden bg-[#050a44] ${className}`}>
      {n ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photos[at]} alt={`${name}, photo ${at + 1} of ${n}`} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
      ) : (
        <BusIllustration className="absolute inset-0 w-full h-full" />
      )}
      {n > 1 && (
        <>
          <button type="button" aria-label="Previous photo" onClick={() => setI(at - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center backdrop-blur-sm z-10">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" aria-label="Next photo" onClick={() => setI(at + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center backdrop-blur-sm z-10">
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-1 z-10">
            {photos.map((_, k) => (
              <span key={k} className={`h-1.5 rounded-full transition-all ${k === at ? 'w-4 bg-white' : 'w-1.5 bg-white/55'}`} />
            ))}
          </div>
        </>
      )}
      {children}
    </div>
  );
}
