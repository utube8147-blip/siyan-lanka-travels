'use client';
// Phone top bar: logo on Home; back arrow + screen title elsewhere.
// Slim (56px + notch), and slides away while scrolling down.

import Link from 'next/link';
import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { Wordmark } from '../Wordmark';
import { InstallAppButton } from '../InstallAppButton';
import { useHideOnScroll } from '@/lib/useHideOnScroll';
import { TAB_ROOTS, parentOf, screenTitle } from './routes';

function Bar() {
  const pathname = usePathname() || '/';
  const params = useSearchParams();
  const router = useRouter();
  const hidden = useHideOnScroll();
  const isHome = pathname === '/';
  const isRoot = TAB_ROOTS.includes(pathname);
  const title = screenTitle(pathname, params);

  const back = () => {
    // In-app history exists when this tab navigated here itself.
    if (window.history.length > 1 && document.referrer.startsWith(window.location.origin)) router.back();
    else if (window.history.state && window.history.state.idx > 0) router.back();
    else router.push(parentOf(pathname));
  };

  return (
    <header
      className={`keep-navy md:hidden sticky top-0 z-40 bg-[#111216]/95 backdrop-blur-md text-white border-b border-[#feb700]/15 pt-[env(safe-area-inset-top)] transition-transform duration-300 ease-out motion-reduce:transition-none ${
        hidden ? '-translate-y-full' : 'translate-y-0'
      }`}
    >
      <div className="h-14 px-2 flex items-center gap-1">
        {isHome ? (
          <Link href="/" aria-label="Home" className="pl-2">
            <Wordmark size="sm" />
          </Link>
        ) : (
          <>
            {!isRoot && (
              <button onClick={back} aria-label="Back" className="w-10 h-10 -ml-0.5 rounded-full flex items-center justify-center hover:bg-white/10 active:bg-white/15">
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}
            <h1 className={`text-[17px] font-semibold truncate ${isRoot ? 'pl-3' : ''}`}>{title}</h1>
          </>
        )}
        <div className="ml-auto flex items-center">{isHome && <InstallAppButton variant="icon" />}</div>
      </div>
    </header>
  );
}

export function MobileTopBar() {
  return (
    <Suspense fallback={<div className="md:hidden h-14 bg-[#111216]" />}>
      <Bar />
    </Suspense>
  );
}
