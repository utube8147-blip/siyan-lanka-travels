'use client';
// QR codes generated on the device (no third-party service sees ticket data).
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export function useQrDataUrl(text: string, size = 240) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!text) return setUrl('');
    QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#050a44', light: '#ffffff' } })
      .then(setUrl)
      .catch(() => setUrl(''));
  }, [text, size]);
  return url;
}
