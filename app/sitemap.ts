import type { MetadataRoute } from 'next';
import { OPERATOR } from '@/config/operator';
import { isResaleOn } from '@/lib/resale-server';
import { allRoutePages, loadTimetable } from '@/lib/seo';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tt = await loadTimetable();
  const now = new Date();
  const base = OPERATOR.siteUrl;
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/bus`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/legal`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/search`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    ...((await isResaleOn()) ? [{ url: `${base}/marketplace`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.5 }] : []),
    ...allRoutePages(tt).map((p) => ({
      url: `${base}/bus/${p.slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: p.from === 'Colombo' || p.to === 'Colombo' ? 0.8 : 0.6,
    })),
  ];
}
