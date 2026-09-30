import { PageSkeleton } from '@/lib/store';

// Shown instantly while a new screen loads (app-style, no blank page).
export default function Loading() {
  return <PageSkeleton />;
}
