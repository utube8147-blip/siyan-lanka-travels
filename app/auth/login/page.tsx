// app/auth/login/page.tsx
'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Wordmark } from '@/components/Wordmark';


/** Where to go after signing in: ?next=/some/path (same-site paths only). */
function nextPath(fallback: string) {
  const n = new URLSearchParams(window.location.search).get('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : fallback;
}

export default function LoginPage() {
  const router = useRouter();
  const { login, signIn, resetPassword, mode } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const role = 'passenger' as const;
  // Accepts an email OR a phone number. AuthContext.login() figures out
  // which one it is.
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const dest = nextPath('/my-bookings');
    if (mode === 'demo') {
      // Demo mode: no real accounts; any details sign you in.
      const namePart = identifier ? identifier.split('@')[0] : 'Alex Ham';
      login({ identifier, role, fullName: namePart });
      router.push(dest);
      return;
    }
    setIsLoading(true);
    const r = await signIn(identifier, password);
    setIsLoading(false);
    if (!r.ok) return setError(r.reason);
    router.push(dest);
  };

  const handleForgot = async (e: React.MouseEvent) => {
    e.preventDefault();
    setError(null);
    if (!identifier.includes('@')) return setError('Type your email above first, then tap "Forgot password?".');
    const r = await resetPassword(identifier);
    if (!r.ok) return setError(r.reason);
    setInfo(`We've emailed a password reset link to ${identifier}.`);
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row font-sans">
      {/* Left side: Form */}
      <div className="flex-1 flex items-center justify-center bg-[#f8f9fb] p-8">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-12 flex justify-center"><Wordmark badge /></Link>

          <h2 className="text-3xl font-bold text-primary mb-2 text-center">Welcome back</h2>
          <p className="text-[#46464f] text-center mb-8">
            Sign in to see and manage your trips.
          </p>

          

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-primary mb-2">{mode === 'demo' ? 'Email or Phone Number' : 'Email'}</label>
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                type="text"
                placeholder={mode === 'demo' ? 'hello@example.com or +94 77 123 4567' : 'hello@example.com'}
                autoComplete="email"
                className="w-full px-4 py-3 bg-white border border-outline/30 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                required
              />
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <label className="block text-sm font-bold text-primary">Password</label>
                <a href="#" onClick={handleForgot} className="text-sm font-bold text-primary opacity-80 hover:opacity-100">Forgot password?</a>
              </div>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-white border border-outline/30 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-primary text-white font-bold py-4 rounded-xl flex items-center justify-center hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-70 disabled:active:scale-100"
            >
              {isLoading ? (
                <span className="material-symbols-outlined animate-spin">refresh</span>
              ) : (
                "Sign In"
              )}
            </button>
            {error && <p role="alert" className="text-sm font-semibold text-red-600">{error}</p>}
            {info && <p role="status" className="text-sm font-semibold text-[#006e1c]">{info}</p>}
            {mode === 'demo' && <p className="text-xs text-on-surface-variant">Demo mode: any details sign you in. Connect Supabase for real accounts.</p>}
          </form>

          <p className="text-center mt-8 text-sm text-[#46464f]">
            Don't have an account? <Link href="/auth/signup" className="text-primary font-bold hover:underline">Sign up for free</Link>
          </p>
        </div>
      </div>

      {/* Right side: Abstract Imagery */}
      <div className="hidden md:flex flex-1 bg-primary relative overflow-hidden items-center justify-center">
        <div className="absolute inset-0 z-0">
          <img
            src="/brand/interior.png"
            alt="Travel abstract"
            className="w-full h-full object-cover opacity-40"
          />
        </div>
        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-[#feb700] rounded-full blur-[120px] opacity-20"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-[#7a7fbb] rounded-full blur-[120px] opacity-20"></div>

        <div className="z-10 text-white max-w-md p-8">
          <div className="w-16 h-16 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl flex items-center justify-center mb-8">
            <span className="material-symbols-outlined text-3xl">directions_bus</span>
          </div>
          <h1 className="text-4xl font-bold mb-4 leading-tight">Your journey starts here.</h1>
          <p className="text-lg opacity-80 leading-relaxed">
            Sign in to see your tickets, change seats or dates, and book your next trip.
          </p>

          {/* Testimonial preview */}
          <div className="mt-12 p-6 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl space-y-2">
            <p className="text-sm font-bold">Route 48 · Colombo ⇄ Akkaraipattu</p>
            <p className="text-sm opacity-80">Overnight AC coach via Kurunegala, Dambulla, Polonnaruwa, Batticaloa and Kalmunai. Bikes welcome in the luggage compartment.</p>
          </div>
        </div>
      </div>
    </div>
  );
}