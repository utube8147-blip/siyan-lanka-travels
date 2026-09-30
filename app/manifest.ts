import type { MetadataRoute } from 'next';
import { OPERATOR } from '@/config/operator';

// Makes the site installable ("Add to Home screen") as an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: OPERATOR.name,
    short_name: 'Siyan Lanka',
    description: OPERATOR.tagline,
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    lang: 'en-LK',
    categories: ['travel', 'navigation'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Book a seat', url: '/search', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'My trips', url: '/my-bookings', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
