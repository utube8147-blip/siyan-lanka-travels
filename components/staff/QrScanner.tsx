'use client';
// Full-screen ticket scanner for phones. Uses the browser's built-in QR
// detector where available (Chrome on Android) and the jsQR library
// everywhere else (iPhone Safari, Firefox). Keeps scanning until closed;
// each ticket gives a green/red result, a vibration and a beep.

import { useEffect, useRef, useState } from 'react';
import { Flashlight, X } from 'lucide-react';

export type ScanResult = { ok: boolean; msg: string; detail?: string; action?: { label: string; run: () => Promise<ScanResult> } };

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

function beep(ok: boolean) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.12 : 0.3));
  } catch {
    /* sound is optional */
  }
}

export function QrScanner({ title = 'Scan tickets', onCode, onClose, footer }: { title?: string; onCode: (text: string) => Promise<ScanResult>; onClose: () => void; footer?: React.ReactNode }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [camera, setCamera] = useState<'starting' | 'on' | 'blocked' | 'none'>('starting');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [manual, setManual] = useState('');
  const [torch, setTorch] = useState(false);
  const track = useRef<MediaStreamTrack | null>(null);
  const busy = useRef(false);
  const last = useRef({ code: '', at: 0 });
  const handler = useRef(onCode);
  handler.current = onCode;

  const show = (r: ScanResult) => {
    setResult(r);
    navigator.vibrate?.(r.ok ? 80 : [70, 50, 70]);
    beep(r.ok);
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let detector: Detector | null = null;
    let jsQR: ((d: Uint8ClampedArray, w: number, h: number, o?: object) => { data: string } | null) | null = null;

    const handle = async (raw: string) => {
      const now = Date.now();
      if (busy.current || (raw === last.current.code && now - last.current.at < 3000)) return;
      last.current = { code: raw, at: now };
      busy.current = true;
      show(await handler.current(raw));
      setTimeout(() => (busy.current = false), 900);
    };

    const tick = async () => {
      if (stopped) return;
      const v = video.current;
      if (v && v.readyState >= 2 && !busy.current) {
        try {
          if (detector) {
            const codes = await detector.detect(v);
            if (codes[0]?.rawValue) await handle(codes[0].rawValue);
          } else if (jsQR) {
            const c = (canvas.current ??= document.createElement('canvas'));
            const w = Math.min(640, v.videoWidth);
            const h = Math.round((v.videoHeight / v.videoWidth) * w);
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
            if (code?.data) await handle(code.data);
          }
        } catch {
          /* keep scanning */
        }
      }
      raf = window.setTimeout(tick, 250) as unknown as number;
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setCamera('none');
      try {
        const W = window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector };
        if (W.BarcodeDetector) detector = new W.BarcodeDetector({ formats: ['qr_code'] });
        else jsQR = (await import('jsqr')).default as unknown as typeof jsQR;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        track.current = stream.getVideoTracks()[0];
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play().catch(() => {});
        }
        setCamera('on');
        tick();
      } catch {
        setCamera('blocked');
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleTorch = async () => {
    try {
      await (track.current as MediaStreamTrack & { applyConstraints: (c: object) => Promise<void> })?.applyConstraints({ advanced: [{ torch: !torch }] });
      setTorch(!torch);
    } catch {
      /* not supported */
    }
  };

  return (
    <div className="keep-navy fixed inset-0 z-[120] bg-black flex flex-col" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3 text-white">
        <p className="font-semibold text-[17px]">{title}</p>
        <div className="flex gap-2">
          {camera === 'on' && (
            <button onClick={toggleTorch} aria-label="Torch" aria-pressed={torch} className={`w-11 h-11 rounded-full flex items-center justify-center ${torch ? 'bg-[#feb700] text-[#14120a]' : 'bg-white/10'}`}>
              <Flashlight className="w-5 h-5" />
            </button>
          )}
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center"><X className="w-5 h-5" /></button>
        </div>
      </div>
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <video ref={video} playsInline muted className={`absolute inset-0 w-full h-full object-cover ${camera === 'on' ? '' : 'hidden'}`} />
        {camera === 'on' && <div className="relative w-[70vw] max-w-72 aspect-square border-4 border-[#feb700] rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" aria-hidden />}
        {camera === 'starting' && <p className="text-white/70 text-[14px]">Starting camera…</p>}
        {(camera === 'blocked' || camera === 'none') && (
          <p className="text-white/80 text-[15px] px-8 text-center">
            {camera === 'blocked' ? 'Camera access is blocked. Allow the camera for this site in your browser settings, or type the booking reference below.' : 'This device has no camera. Type the booking reference below.'}
          </p>
        )}
        {result && (
          <div className={`absolute left-3 right-3 bottom-3 rounded-2xl p-4 shadow-2xl ${result.ok ? 'bg-[#0f7a2a]' : 'bg-[#b3261e]'} text-white`} role="status" aria-live="assertive">
            <p className="text-[17px] font-bold">{result.msg}</p>
            {result.detail && <p className="text-[14px] text-white/90 mt-0.5">{result.detail}</p>}
            {result.action && (
              <button onClick={async () => show(await result.action!.run())} className="mt-3 w-full h-12 rounded-xl bg-white text-[#14120a] font-bold text-[15px]">
                {result.action.label}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="bg-[#111216] px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] space-y-2">
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (manual.trim()) { show(await onCode(manual)); setManual(''); } }}>
          <input value={manual} onChange={(e) => setManual(e.target.value.toUpperCase())} placeholder="SLT-XXXXXX or seat (e.g. 5C)" aria-label="Booking reference or seat" autoCapitalize="characters" className="flex-1 h-12 rounded-xl bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/40" />
          <button className="h-12 px-5 rounded-xl bg-[#feb700] text-[#14120a] font-bold">Board</button>
        </form>
        {footer}
      </div>
    </div>
  );
}
