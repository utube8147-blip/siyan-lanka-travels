// app/auth/signup/page.tsx
'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Wordmark } from '@/components/Wordmark';

export default function SignupPage() {
  const router = useRouter();
  const { login } = useAuth();
  const role = 'passenger' as const;
  const [isLoading, setIsLoading] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const handleSignup = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Simulate signup, then actually set the mock user via login() so
    // AuthContext reflects the new account (matches login page's pattern).
    // Swap this whole handler for a real Supabase sign-up call later.
    setTimeout(() => {
      setIsLoading(false);
      const fullName = `${firstName} ${lastName}`.trim() || 'Alex Ham';
      login({ email, phone, role, fullName });

      router.push('/dashboard');
    }, 1500);
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row font-sans">
      {/* Right side: Abstract Imagery (Swapped for Signup to provide variety) */}
      <div className="hidden md:flex flex-1 bg-primary relative overflow-hidden items-center justify-center order-2 md:order-1">
        <div className="absolute inset-0 z-0">
          <img 
            src="/brand/bus.jpg" 
            alt="Travel abstract" 
            className="w-full h-full object-cover opacity-40"
          />
        </div>
        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-[#3280f9] rounded-full blur-[120px] opacity-20"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-[#feb700] rounded-full blur-[120px] opacity-20"></div>
        
        <div className="z-10 text-white max-w-md p-8">
          <div className="w-16 h-16 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl flex items-center justify-center mb-8">
            <span className="material-symbols-outlined text-3xl">rocket_launch</span>
          </div>
          <h1 className="text-4xl font-bold mb-4 leading-tight">Travel east with Siyan Lanka.</h1>
          <p className="text-lg opacity-80 leading-relaxed">
            Create a free account to keep your tickets in one place and manage your trips.
          </p>
          
          <div className="mt-12 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-[#feb700] text-[#6b4b00] flex items-center justify-center">
                <span className="material-symbols-outlined text-[14px]">check</span>
              </div>
              <span className="text-sm font-medium">All your tickets on your phone</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-[#feb700] text-[#6b4b00] flex items-center justify-center">
                <span className="material-symbols-outlined text-[14px]">check</span>
              </div>
              <span className="text-sm font-medium">Change seats or dates yourself</span>
            </div>
          </div>
        </div>
      </div>

      {/* Left side: Form */}
      <div className="flex-1 flex items-center justify-center bg-[#f8f9fb] p-8 order-1 md:order-2 overflow-y-auto">
        <div className="w-full max-w-md my-auto py-8">
          <div className="flex justify-end mb-8 md:hidden">
            <Link href="/"><Wordmark badge /></Link>
          </div>
          
          <h2 className="text-3xl font-bold text-primary mb-2">Create an account</h2>
          <p className="text-[#46464f] mb-8">Book faster next time.</p>

          <form onSubmit={handleSignup} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-primary mb-1">First Name</label>
                <input 
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Alexander" 
                  className="w-full px-4 py-3 bg-white border border-outline/30 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                  required 
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-primary mb-1">Last Name</label>
                <input 
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Hamilton" 
                  className="w-full px-4 py-3 bg-white border border-outline/30 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                  required 
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-bold text-primary mb-1">Email Address</label>
              <input 
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="hello@example.com" 
                className="w-full px-4 py-3 bg-white border border-outline/30 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                required 
              />
            </div>

            {/* Phone number — required at signup. This becomes the number used
                to auto-verify contact info later in the booking flow, so we
                collect and (in a real build) verify it once, up front, instead
                of asking again on every booking. */}
            <div>
              <label className="block text-sm font-bold text-primary mb-1">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+94 77 123 4567"
                className="w-full px-4 py-3 bg-white border border-outline/30 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                required
              />
              <p className="text-xs text-[#686873] mt-1.5">We'll use this to verify your bookings — no need to re-enter it each time.</p>
            </div>
            
            <div>
              <label className="block text-sm font-bold text-primary mb-1">Password</label>
              <input 
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" 
                className="w-full px-4 py-3 bg-white border border-outline/30 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                required 
              />
              <p className="text-xs text-[#686873] mt-1.5">Must be at least 8 characters.</p>
            </div>

            <div className="pt-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  required
                  className="mt-1 w-4 h-4 rounded border-outline/50 text-primary focus:ring-primary"
                />
                <span className="text-xs text-[#46464f] leading-relaxed">
                  I agree to the <a href="#" className="font-bold text-primary hover:underline">Terms of Service</a> and <a href="#" className="font-bold text-primary hover:underline">Privacy Policy</a>.
                </span>
              </label>
            </div>

            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full bg-primary text-white font-bold py-4 rounded-xl flex items-center justify-center hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-70 disabled:active:scale-100 mt-4"
            >
              {isLoading ? (
                <span className="material-symbols-outlined animate-spin">refresh</span>
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          <p className="text-center mt-8 text-sm text-[#46464f]">
            Already have an account? <Link href="/auth/login" className="text-primary font-bold hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}