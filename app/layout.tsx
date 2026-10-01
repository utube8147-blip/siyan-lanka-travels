import type { Metadata, Viewport } from 'next';
import './globals.css';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/noto-sans-tamil';
import '@fontsource-variable/noto-sans-sinhala';
import 'material-symbols/outlined.css';
import { Providers } from '../components/Providers';
import { ServiceWorker } from '../components/ServiceWorker';
import { themeInitScript } from '../components/ThemeToggle';
import { OPERATOR } from '@/config/operator';

const title = `${OPERATOR.name} | Colombo to Batticaloa, Kalmunai & Akkaraipattu night bus`;
const description =
  'Book luxury AC night bus seats online between Colombo and the East: Kurunegala, Dambulla, Polonnaruwa, Batticaloa, Kalmunai and Akkaraipattu. Pick your seat, bring your bike, pay online.';

export const metadata: Metadata = {
  metadataBase: new URL(OPERATOR.siteUrl),
  title: { default: title, template: `%s | ${OPERATOR.name}` },
  description,
  applicationName: OPERATOR.name,
  keywords: [...OPERATOR.seoKeywords],
  authors: [{ name: OPERATOR.name }],
  creator: OPERATOR.name,
  publisher: OPERATOR.name,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'en_LK',
    url: '/',
    siteName: OPERATOR.name,
    title,
    description,
    images: [{ url: '/og.jpg', width: 1200, height: 630, alt: `${OPERATOR.name} luxury coach` }],
  },
  twitter: { card: 'summary_large_image', title, description, images: ['/og.jpg'] },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } },
  icons: {
    // /favicon.ico is served automatically from app/favicon.ico
    icon: [
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: { capable: true, title: 'Siyan Lanka', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: true, email: true, address: false },
  category: 'travel',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#131418' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// Company + website details for Google (shows name, logo and contact in results).
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': ['Organization', 'TravelAgency'],
      '@id': `${OPERATOR.siteUrl}/#organization`,
      name: OPERATOR.name,
      url: OPERATOR.siteUrl,
      logo: `${OPERATOR.siteUrl}/icons/icon-512.png`,
      image: `${OPERATOR.siteUrl}/og.jpg`,
      description,
      email: OPERATOR.contact.email,
      ...(OPERATOR.contact.phone ? { telephone: OPERATOR.contact.phone } : {}),
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Bastian Mawatha, Pettah',
        addressLocality: 'Colombo',
        postalCode: '01100',
        addressCountry: 'LK',
      },
      areaServed: ['Colombo', 'Kurunegala', 'Dambulla', 'Polonnaruwa', 'Batticaloa', 'Kalmunai', 'Akkaraipattu'],
    },
    {
      '@type': 'WebSite',
      '@id': `${OPERATOR.siteUrl}/#website`,
      url: OPERATOR.siteUrl,
      name: OPERATOR.name,
      publisher: { '@id': `${OPERATOR.siteUrl}/#organization` },
      inLanguage: 'en-LK',
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme script adds the `dark` class before React loads.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body>
        <div className="min-h-screen bg-[#f8f9fb] font-sans text-[#191c1e] selection:bg-[#bdc2ff] selection:text-[#0f144c] flex flex-col">
          <Providers>{children}</Providers>
        </div>
        <ServiceWorker />
      </body>
    </html>
  );
}
