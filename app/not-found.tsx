import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#f8f9fb] px-6 text-center">
      <h1 className="text-[28px] font-extrabold text-[#050a44]">This page doesn't exist</h1>
      <p className="text-[14px] text-[#46464f]">Check the link, or head back and search for your bus.</p>
      <Link href="/" className="px-6 py-3 bg-[#050a44] text-white rounded-xl text-[14px] font-bold hover:opacity-90">
        Go to home
      </Link>
    </div>
  );
}
