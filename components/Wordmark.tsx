import { OPERATOR } from '@/config/operator';

/**
 * Company logo (/public/logo.png, used exactly as supplied). It's gold and
 * white, made for dark backgrounds, so it always sits on navy: the header,
 * footer and admin sidebar are navy, and on white pages pass `badge` to put
 * it on a small navy plate.
 */
export function Wordmark({ size = 'md', badge = false }: { size?: 'sm' | 'md'; badge?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  const img = (
    <img
      src="/logo.png"
      alt={OPERATOR.name}
      width={900}
      height={211}
      className={`logo-img ${size === 'md' ? 'h-9 md:h-11' : 'h-7'} w-auto select-none`}
      draggable={false}
    />
  );
  if (!badge) return img;
  return (
    <span className="keep-navy inline-flex items-center rounded-2xl bg-[#111216] px-5 py-3 shadow-[0_8px_24px_-8px_rgba(5,10,68,0.45)] ring-1 ring-[#feb700]/30">
      {img}
    </span>
  );
}
