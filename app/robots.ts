import type { MetadataRoute } from 'next';
import { OPERATOR } from '@/config/operator';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Private or per-person pages: nothing useful for search results.
        disallow: ['/admin', '/auth/', '/dashboard', '/my-bookings', '/payment', '/refund', '/seats/', '/marketplace/buy/', '/offline.html'],
      },
    ],
    sitemap: `${OPERATOR.siteUrl}/sitemap.xml`,
    host: OPERATOR.siteUrl,
  };
}
