'use client';
// lib/i18n.tsx — English, Tamil (தமிழ்) and Sinhala (සිංහල) for the passenger
// app. t('English text') returns the translation, or the English if there
// isn't one yet, so untranslated text still works. Use {name} placeholders:
//   t('Buses from {from} to {to}', { from, to })
// ⚠️ Translations were written for launch; have a native speaker review tone.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { setDateLocale } from './trips';

export type Lang = 'en' | 'ta' | 'si';
export const LANGS: { id: Lang; label: string; short: string; locale: string }[] = [
  { id: 'en', label: 'English', short: 'EN', locale: 'en-GB' },
  { id: 'ta', label: 'தமிழ்', short: 'த', locale: 'ta-LK' },
  { id: 'si', label: 'සිංහල', short: 'සි', locale: 'si-LK' },
];

type Dict = Record<string, [ta: string, si: string]>;
const D: Dict = {
  // navigation
  Book: ['முன்பதிவு', 'වෙන්කරන්න'],
  'My trips': ['என் பயணங்கள்', 'මගේ ගමන්'],
  Resale: ['மறுவிற்பனை', 'නැවත විකිණීම'],
  Home: ['முகப்பு', 'මුල් පිටුව'],
  Trips: ['பயணங்கள்', 'ගමන්'],
  Profile: ['சுயவிவரம்', 'පැතිකඩ'],
  Account: ['கணக்கு', 'ගිණුම'],
  Settings: ['அமைப்புகள்', 'සැකසුම්'],
  'Sign out': ['வெளியேறு', 'ඉවත් වන්න'],
  'Sign in': ['உள்நுழைக', 'පුරනය වන්න'],
  Language: ['மொழி', 'භාෂාව'],
  'Install the app': ['செயலியை நிறுவு', 'යෙදුම ස්ථාපනය කරන්න'],
  // screen titles
  'Book a seat': ['இருக்கை முன்பதிவு', 'ආසනයක් වෙන්කරන්න'],
  'Passenger & seats': ['பயணி & இருக்கைகள்', 'මගී සහ ආසන'],
  Payment: ['கட்டணம்', 'ගෙවීම'],
  'Resale tickets': ['மறுவிற்பனை டிக்கெட்டுகள்', 'නැවත විකුණන ටිකට්පත්'],
  Refund: ['பணத்திருப்பம்', 'මුදල් ආපසු'],
  'Routes & timetables': ['வழிகள் & நேர அட்டவணைகள்', 'මාර්ග සහ කාලසටහන්'],
  'Terms & policies': ['விதிமுறைகள் & கொள்கைகள்', 'කොන්දේසි සහ ප්‍රතිපත්ති'],
  'Parcels & bus hire': ['பார்சல் & பேருந்து வாடகை', 'පාර්සල් සහ බස් කුලියට'],
  // landing
  '{n} overnight departures a week': ['வாரத்திற்கு {n} இரவுப் பயணங்கள்', 'සතියකට රාත්‍රී ගමන් {n}'],
  "{from} to {to}, with a seat that's yours.": ['{from} முதல் {to} வரை, உங்களுக்கான இருக்கையுடன்.', '{from} සිට {to} දක්වා, ඔබටම වූ ආසනයක් සමඟ.'],
  'Board in Colombo at night, wake up in the East. Pick your seat, pay online and show the ticket on your phone.': [
    'இரவில் கொழும்பில் ஏறுங்கள், கிழக்கில் கண் விழியுங்கள். உங்கள் இருக்கையைத் தேர்ந்தெடுத்து, இணையத்தில் பணம் செலுத்தி, டிக்கெட்டை உங்கள் தொலைபேசியில் காட்டுங்கள்.',
    'රාත්‍රියේ කොළඹින් නැගී, නැගෙනහිරින් අවදි වන්න. ඔබේ ආසනය තෝරා, මාර්ගගතව ගෙවා, ටිකට්පත ඔබේ දුරකථනයෙන් පෙන්වන්න.',
  ],
  'Boarding point': ['ஏறும் இடம்', 'නගින ස්ථානය'],
  'Drop-off point': ['இறங்கும் இடம்', 'බසින ස්ථානය'],
  'Travel date': ['பயணத் தேதி', 'ගමන් දිනය'],
  'Find buses': ['பேருந்துகளைத் தேடு', 'බස් සොයන්න'],
  'Where from?': ['எங்கிருந்து?', 'කොහෙන්ද?'],
  'Where to?': ['எங்கு?', 'කොහාටද?'],
  'Next departures': ['அடுத்த புறப்பாடுகள்', 'ඊළඟ පිටත්වීම්'],
  'Seats left update as people book. Tap a departure to choose your seat.': [
    'முன்பதிவுகளுக்கு ஏற்ப மீதமுள்ள இருக்கைகள் மாறும். இருக்கையைத் தேர்ந்தெடுக்க ஒரு பயணத்தைத் தட்டவும்.',
    'වෙන්කිරීම් අනුව ඉතිරි ආසන යාවත්කාලීන වේ. ආසනයක් තෝරා ගැනීමට ගමනක් තට්ටු කරන්න.',
  ],
  'Search a date': ['தேதியைத் தேடு', 'දිනයක් සොයන්න'],
  'seats left': ['இருக்கைகள் மீதம்', 'ආසන ඉතිරියි'],
  Full: ['நிரம்பியது', 'පිරී ඇත'],
  Arrives: ['வருகை', 'පැමිණීම'],
  'next morning': ['மறுநாள் காலை', 'පසුදා උදෑසන'],
  'Where we stop': ['நாங்கள் நிற்கும் இடங்கள்', 'අප නවතින ස්ථාන'],
  'Get on or off at any of these. Fares shown from {from}; you only pay for the part you ride.': [
    'இவற்றில் எங்கு வேண்டுமானாலும் ஏறலாம் அல்லது இறங்கலாம். கட்டணம் {from} இலிருந்து காட்டப்படுகிறது; நீங்கள் பயணிக்கும் பகுதிக்கு மட்டுமே செலுத்துவீர்கள்.',
    'මේ ඕනෑම තැනකින් නැගීමට හෝ බැසීමට හැක. ගාස්තු {from} සිට පෙන්වා ඇත; ඔබ යන කොටසට පමණක් ගෙවන්න.',
  ],
  Start: ['தொடக்கம்', 'ආරම්භය'],
  'Bring your bike with you': ['உங்கள் பைக்கையும் கொண்டு வாருங்கள்', 'ඔබේ බයිසිකලය හෝ යතුරුපැදිය රැගෙන එන්න'],
  'Book a space in the luggage compartment when you book your seat. Upload a photo of the bike, and the crew will load it at your stop and have it ready when you get off.': [
    'இருக்கையை முன்பதிவு செய்யும்போதே லக்கேஜ் பகுதியில் இடம் பதிவு செய்யுங்கள். பைக்கின் புகைப்படத்தைப் பதிவேற்றுங்கள்; ஊழியர்கள் உங்கள் நிறுத்தத்தில் ஏற்றி, நீங்கள் இறங்கும்போது தயாராக வைப்பார்கள்.',
    'ආසනය වෙන්කරන විටම ගමන් මලු කුටියේ ඉඩක් වෙන්කරන්න. බයිසිකලයේ ඡායාරූපයක් උඩුගත කරන්න; කාර්ය මණ්ඩලය ඔබේ නැවතුමේදී එය පටවා, ඔබ බසින විට සූදානම් කර තබයි.',
  ],
  'Book a seat and a bike space': ['இருக்கையும் பைக் இடமும் முன்பதிவு செய்', 'ආසනයක් සහ බයිසිකල් ඉඩක් වෙන්කරන්න'],
  'Our coach': ['எங்கள் பேருந்து', 'අපගේ බස් රථය'],
  'Booking takes about two minutes': ['முன்பதிவு சுமார் இரண்டு நிமிடங்கள் ஆகும்', 'වෙන්කිරීමට විනාඩි දෙකක් පමණ ගතවේ'],
  'Choose a departure': ['ஒரு பயணத்தைத் தேர்ந்தெடுக்கவும்', 'ගමනක් තෝරන්න'],
  'Pick where you get on and off and the time that suits you.': ['நீங்கள் ஏறும், இறங்கும் இடங்களையும் உங்களுக்கு ஏற்ற நேரத்தையும் தேர்ந்தெடுக்கவும்.', 'ඔබ නගින සහ බසින තැන් සහ ඔබට ගැළපෙන වේලාව තෝරන්න.'],
  'Pick your seat': ['உங்கள் இருக்கையைத் தேர்ந்தெடுக்கவும்', 'ඔබේ ආසනය තෝරන්න'],
  'See exactly which seats are free. Ladies-only seats are marked at the front.': [
    'எந்த இருக்கைகள் காலியாக உள்ளன என்பதைச் சரியாகப் பாருங்கள். பெண்களுக்கான இருக்கைகள் முன்புறம் குறிக்கப்பட்டுள்ளன.',
    'හිස් ආසන හරියටම බලන්න. කාන්තාවන් සඳහා පමණක් වූ ආසන ඉදිරියෙන් සලකුණු කර ඇත.',
  ],
  'Show your ticket': ['உங்கள் டிக்கெட்டைக் காட்டுங்கள்', 'ඔබේ ටිකට්පත පෙන්වන්න'],
  'Pay online and show the QR ticket to the conductor at Bastian Mawatha or your stop.': [
    'இணையத்தில் பணம் செலுத்தி, பஸ்டியன் மாவத்தையிலோ உங்கள் நிறுத்தத்திலோ நடத்துநரிடம் QR டிக்கெட்டைக் காட்டுங்கள்.',
    'මාර්ගගතව ගෙවා, බස්තියන් මාවතේ හෝ ඔබේ නැවතුමේදී කොන්දොස්තරට QR ටිකට්පත පෙන්වන්න.',
  ],
  'Questions, or booking for a group?': ['கேள்விகளா, அல்லது குழுவாக முன்பதிவா?', 'ප්‍රශ්නද, නැත්නම් කණ්ඩායමක් සඳහා වෙන්කිරීමක්ද?'],
  'Send a parcel or hire a bus': ['பார்சல் அனுப்ப அல்லது பேருந்து வாடகைக்கு', 'පාර්සලයක් යවන්න හෝ බසයක් කුලියට ගන්න'],
  'Parcels go on our night bus; coaches for weddings, school trips and pilgrimages.': [
    'பார்சல்கள் எங்கள் இரவுப் பேருந்தில் செல்லும்; திருமணம், பள்ளிச் சுற்றுலா, யாத்திரைக்கு பேருந்துகள்.',
    'පාර්සල් අපගේ රාත්‍රී බසයෙන් යයි; විවාහ, පාසල් චාරිකා සහ වන්දනා ගමන් සඳහා බස් රථ.',
  ],
  'Get a quote': ['விலை கேளுங்கள்', 'මිල ගණන් ලබා ගන්න'],
  // search
  'Buses from {from} to {to}': ['{from} முதல் {to} வரை பேருந்துகள்', '{from} සිට {to} දක්වා බස්'],
  'Search bus': ['பேருந்தைத் தேடு', 'බස් සොයන්න'],
  'Departure date': ['புறப்படும் தேதி', 'පිටත්වන දිනය'],
  'Select seats': ['இருக்கைகளைத் தேர்ந்தெடு', 'ආසන තෝරන්න'],
  'Booking closed': ['முன்பதிவு முடிந்தது', 'වෙන්කිරීම් අවසන්'],
  'Full · join waitlist': ['நிரம்பியது · காத்திருப்பில் சேர்', 'පිරී ඇත · පොරොත්තු ලැයිස්තුවට'],
  'On waitlist': ['காத்திருப்பில் உள்ளீர்கள்', 'පොරොත්තු ලැයිස්තුවේ'],
  'Bike space': ['பைக் இடம்', 'බයිසිකල් ඉඩ'],
  // seat & payment
  'Who are you booking for?': ['யாருக்காக முன்பதிவு செய்கிறீர்கள்?', 'ඔබ වෙන්කරන්නේ කා සඳහාද?'],
  Myself: ['எனக்கு', 'මට'],
  'Someone else': ['வேறொருவருக்கு', 'වෙනත් අයෙකුට'],
  'Full name': ['முழுப் பெயர்', 'සම්පූර්ණ නම'],
  Gender: ['பாலினம்', 'ස්ත්‍රී/පුරුෂ'],
  Male: ['ஆண்', 'පුරුෂ'],
  Female: ['பெண்', 'ස්ත්‍රී'],
  'Travelled with us before? Tap to fill in': ['முன்பு எங்களுடன் பயணித்தீர்களா? நிரப்பத் தட்டவும்', 'කලින් අප සමඟ ගමන් කළාද? පිරවීමට තට්ටු කරන්න'],
  'Bringing a bike?': ['பைக் கொண்டு வருகிறீர்களா?', 'බයිසිකලයක් රැගෙන එනවාද?'],
  'Trip Summary': ['பயணச் சுருக்கம்', 'ගමන් සාරාංශය'],
  'Proceed to Payment': ['பணம் செலுத்தத் தொடரவும்', 'ගෙවීමට ඉදිරියට'],
  'Payment Method': ['பணம் செலுத்தும் முறை', 'ගෙවීමේ ක්‍රමය'],
  Card: ['அட்டை', 'කාඩ්පත'],
  'Mobile Wallet': ['மொபைல் வாலட்', 'ජංගම පසුම්බිය'],
  'Bank transfer': ['வங்கிப் பரிமாற்றம்', 'බැංකු මාරුව'],
  'Pay at counter': ['கவுண்டரில் செலுத்து', 'කවුන්ටරයේ ගෙවන්න'],
  'Use my free trip': ['எனது இலவசப் பயணத்தைப் பயன்படுத்து', 'මගේ නොමිලේ ගමන භාවිතා කරන්න'],
  'Share on WhatsApp': ['WhatsApp-இல் பகிர்', 'WhatsApp හි බෙදාගන්න'],
  'Book your return trip': ['திரும்பும் பயணத்தை முன்பதிவு செய்', 'ආපසු ගමන වෙන්කරන්න'],
  'Seat held': ['இருக்கை ஒதுக்கப்பட்டது', 'ආසනය රඳවා ඇත'],
  'Booking Confirmed!': ['முன்பதிவு உறுதி!', 'වෙන්කිරීම තහවුරුයි!'],
  // my trips
  'Your next trip': ['உங்கள் அடுத்த பயணம்', 'ඔබේ ඊළඟ ගමන'],
  'Your trip is coming up': ['உங்கள் பயணம் நெருங்குகிறது', 'ඔබේ ගමන ළඟ එයි'],
  'Seat held · not paid yet': ['இருக்கை ஒதுக்கப்பட்டது · இன்னும் செலுத்தவில்லை', 'ආසනය රඳවා ඇත · තවම ගෙවා නැත'],
  'Where to wait': ['எங்கே காத்திருப்பது', 'රැඳී සිටිය යුතු තැන'],
  "Where's my bus": ['என் பேருந்து எங்கே', 'මගේ බස් කොහේද'],
  'Open in Maps': ['வரைபடத்தில் திற', 'සිතියමේ විවෘත කරන්න'],
  'Live tracking starts a few hours before departure.': ['நேரடி கண்காணிப்பு புறப்படுவதற்கு சில மணி நேரத்திற்கு முன் தொடங்கும்.', 'සජීවී ලුහුබැඳීම පිටත්වීමට පැය කිහිපයකට පෙර ආරම්භ වේ.'],
  Waitlist: ['காத்திருப்புப் பட்டியல்', 'පොරොත්තු ලැයිස්තුව'],
  'Travel again': ['மீண்டும் பயணம்', 'නැවත ගමන් කරන්න'],
  'Book again': ['மீண்டும் முன்பதிவு', 'නැවත වෙන්කරන්න'],
  Return: ['திரும்ப', 'ආපසු'],
  'A seat is free: book now': ['ஒரு இருக்கை காலி: இப்போதே முன்பதிவு செய்', 'ආසනයක් හිස්: දැන් වෙන්කරන්න'],
  'Upcoming Journeys': ['வரவிருக்கும் பயணங்கள்', 'ඉදිරි ගමන්'],
  // profile / footer
  Travel: ['பயணம்', 'ගමන'],
  App: ['செயலி', 'යෙදුම'],
  Help: ['உதவி', 'උදව්'],
  Legal: ['சட்டம்', 'නීතිමය'],
  Appearance: ['தோற்றம்', 'පෙනුම'],
  'Wallet & rewards': ['பணப்பை & வெகுமதிகள்', 'පසුම්බිය සහ ත්‍යාග'],
  'Email us': ['மின்னஞ்சல் அனுப்புங்கள்', 'අපට ඊමේල් කරන්න'],
  'Call us': ['எங்களை அழைக்கவும்', 'අපට අමතන්න'],
  'Where the bus leaves from': ['பேருந்து புறப்படும் இடம்', 'බස් පිටත්වන ස්ථානය'],
  'Terms of travel': ['பயண விதிமுறைகள்', 'ගමන් කොන්දේසි'],
  'Privacy policy': ['தனியுரிமைக் கொள்கை', 'පෞද්ගලිකත්ව ප්‍රතිපත්තිය'],
  'Cancellation & refund policy': ['ரத்து & பணத்திருப்பக் கொள்கை', 'අවලංගු කිරීම් සහ මුදල් ආපසු ප්‍රතිපත්තිය'],
  'Tickets, seat changes, cancellations': ['டிக்கெட்டுகள், இருக்கை மாற்றம், ரத்து', 'ටිකට්පත්, ආසන වෙනස් කිරීම්, අවලංගු කිරීම්'],
  'Not signed in': ['உள்நுழையவில்லை', 'පුරනය වී නැත'],
  'Popular routes': ['பிரபலமான வழிகள்', 'ජනප්‍රිය මාර්ග'],
  Contact: ['தொடர்பு', 'සම්බන්ධ වන්න'],
  'Manage my trip': ['என் பயணத்தை நிர்வகி', 'මගේ ගමන කළමනාකරණය'],
  'All routes': ['அனைத்து வழிகள்', 'සියලු මාර්ග'],
  'Book a seat ': ['இருக்கை முன்பதிவு', 'ආසනයක් වෙන්කරන්න'],
};

const IDX: Record<Lang, number> = { en: -1, ta: 0, si: 1 };
const KEY = 'lang';

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (s: string, vars?: Record<string, string | number>) => string };
const LangContext = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: (s) => s });

function fill(s: string, vars?: Record<string, string | number>) {
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : s;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  const apply = useCallback((l: Lang) => {
    setLangState(l);
    const meta = LANGS.find((x) => x.id === l)!;
    document.documentElement.lang = l === 'en' ? 'en' : l;
    document.documentElement.dataset.lang = l;
    setDateLocale(meta.locale);
  }, []);
  useEffect(() => {
    let l: Lang = 'en';
    try {
      const saved = localStorage.getItem(KEY) as Lang | null;
      if (saved && saved in IDX) l = saved;
    } catch {
      /* ignore */
    }
    if (l !== 'en') apply(l);
  }, [apply]);
  const setLang = (l: Lang) => {
    try {
      localStorage.setItem(KEY, l);
      document.cookie = `${KEY}=${l}; path=/; max-age=${60 * 60 * 24 * 400}; samesite=lax`;
    } catch {
      /* ignore */
    }
    apply(l);
  };
  const t = useCallback((s: string, vars?: Record<string, string | number>) => {
    const i = IDX[lang];
    const hit = i >= 0 ? D[s]?.[i] : undefined;
    return fill(hit ?? s, vars);
  }, [lang]);
  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export const useT = () => useContext(LangContext);

/** Compact EN / த / සි switcher. */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { lang, setLang, t } = useT();
  return (
    <div role="radiogroup" aria-label={t('Language')} className={`inline-flex rounded-full bg-[#f2f4f6] p-0.5 ${className}`}>
      {LANGS.map((l) => (
        <button
          key={l.id}
          role="radio"
          aria-checked={lang === l.id}
          title={l.label}
          onClick={() => setLang(l.id)}
          className={`min-w-8 h-8 px-2 rounded-full text-[13px] font-semibold transition-colors ${lang === l.id ? 'bg-[#050a44] text-white' : 'text-[#46464f] hover:text-[#050a44]'}`}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}
