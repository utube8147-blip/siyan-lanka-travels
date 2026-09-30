// app/auth/login/page.tsx
'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Wordmark } from '@/components/Wordmark';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [role, setRole] = useState<'passenger' | 'operator'>('passenger');
  // Accepts an email OR a phone number. AuthContext.login() figures out
  // which one it is.
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Simulate a network round-trip, then actually set the mock user so
    // isLoggedIn flips to true everywhere useAuth() is consulted (header,
    // booking flow, etc). Swap this whole handler for a real Supabase
    // sign-in call later — the redirect logic below can stay as-is.
    setTimeout(() => {
      setIsLoading(false);
      const namePart = identifier ? identifier.split('@')[0] : 'Alex Ham';
      login({ identifier, role, fullName: namePart });

      if (role === 'operator') {
        router.push('/admin');
      } else {
        router.push('/dashboard');
      }
    }, 1500);
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row font-sans">
      {/* Left side: Form */}
      <div className="flex-1 flex items-center justify-center bg-[#f8f9fb] p-8">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-12 flex justify-center"><Wordmark badge /></Link>

          <h2 className="text-3xl font-bold text-primary mb-2 text-center">Welcome back</h2>
          <p className="text-[#46464f] text-center mb-8">
            {role === 'operator' ? 'Staff sign-in for the operator dashboard.' : 'Sign in to see and manage your trips.'}
          </p>

          <div className="flex p-1 bg-surface-variant/30 rounded-xl mb-8 border border-outline-variant/30 flex-wrap">
            <button
              onClick={() => setRole('passenger')}
              className={`flex-1 min-w-20 py-2 text-sm font-bold rounded-lg transition-all ${role === 'passenger' ? 'bg-white shadow-sm text-primary border border-outline/10' : 'text-on-surface-variant'}`}
            >
              Passenger
            </button>
            <button
              onClick={() => setRole('operator')}
              className={`flex-1 min-w-20 py-2 text-sm font-bold rounded-lg transition-all ${role === 'operator' ? 'bg-white shadow-sm text-primary border border-outline/10' : 'text-on-surface-variant'}`}
            >
              Staff
            </button>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-primary mb-2">Email or Phone Number</label>
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                type="text"
                placeholder="hello@example.com or +94 77 123 4567"
                className="w-full px-4 py-3 bg-white border border-outline/30 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                required
              />
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <label className="block text-sm font-bold text-primary">Password</label>
                <a href="#" className="text-sm font-bold text-primary opacity-80 hover:opacity-100">Forgot password?</a>
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
            src="/brand/interior.jpg"
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
            {role === 'passenger'
              ? 'Sign in to see your tickets, change seats or dates, and book your next trip.'
              : 'Departures, passenger lists, counter sales and bike loading in one place.'}
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