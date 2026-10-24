/** @type {import('next').NextConfig} */

// Sent with every page and API response.
const securityHeaders = [
  // Only this site may show its pages in a frame (stops "clickjacking" tricks on the payment and staff pages).
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Always HTTPS once a browser has seen the site over HTTPS (ignored on http://localhost).
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // Camera: the conductor's ticket scanner. Location: sharing the bus position and "near me".
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()' },
];

const nextConfig = {
  images: {
    unoptimized: true,
  },
  // The staff area was 17 pages; now 7, with tabs. Old addresses still work.
  async redirects() {
    const to = (source, hub, tab) => ({ source, destination: `/admin/${hub}?tab=${tab}`, permanent: false });
    return [
      to('/admin/departures', 'trips', 'seats'),
      to('/admin/bookings', 'trips', 'bookings'),
      to('/admin/gps-log', 'trips', 'gps'),
      to('/admin/road-reports', 'trips', 'road'),
      to('/admin/cash', 'money', 'cash'),
      to('/admin/expenses', 'money', 'spent'),
      to('/admin/payouts', 'money', 'payback'),
      to('/admin/fleet', 'buses', 'buses'),
      to('/admin/routes', 'buses', 'routes'), // the route editor (/admin/routes/<id>) stays where it is
      to('/admin/fleet-health', 'buses', 'health'),
      to('/admin/odometer', 'buses', 'odometer'),
      to('/admin/finance', 'reports', 'money'),
      to('/admin/analytics', 'reports', 'charts'),
      to('/admin/crew', 'people', 'crew'),
      to('/admin/accounts', 'people', 'signins'),
      to('/admin/branches', 'people', 'branches'),
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
