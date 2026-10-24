// Dates in the language in use. Chrome (desktop and Android) ships no date
// data for Sinhala, so `toLocaleDateString('si-LK')` gives English there;
// for Sinhala we spell the month and weekday names ourselves when the browser
// can't. Tamil and English use the browser's own formatting.
import { dateLocale } from './trips';

const SI_MONTHS = ['ජනවාරි', 'පෙබරවාරි', 'මාර්තු', 'අප්‍රේල්', 'මැයි', 'ජූනි', 'ජූලි', 'අගෝස්තු', 'සැප්තැම්බර්', 'ඔක්තෝබර්', 'නොවැම්බර්', 'දෙසැම්බර්'];
const SI_MONTHS_SHORT = ['ජන', 'පෙබ', 'මාර්තු', 'අප්‍රේල්', 'මැයි', 'ජූනි', 'ජූලි', 'අගෝ', 'සැප්', 'ඔක්', 'නොවැ', 'දෙසැ'];
const SI_DAYS = ['ඉරිදා', 'සඳුදා', 'අඟහරුවාදා', 'බදාදා', 'බ්‍රහස්පතින්දා', 'සිකුරාදා', 'සෙනසුරාදා'];
const SI_DAYS_SHORT = ['ඉරි', 'සඳු', 'අඟ', 'බදා', 'බ්‍රහ', 'සිකු', 'සෙන'];

let siNative: boolean | null = null;
function browserHasSinhala() {
  if (siNative === null) {
    try {
      siNative = Intl.DateTimeFormat.supportedLocalesOf(['si-LK']).length > 0;
    } catch {
      siNative = false;
    }
  }
  return siNative;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Like date.toLocaleString(locale, opts), in the language in use. */
export function fmtDate(date: Date, opts: Intl.DateTimeFormatOptions): string {
  const locale = dateLocale();
  if (!locale.startsWith('si') || browserHasSinhala()) {
    return opts.hour || opts.minute ? date.toLocaleString(locale, opts) : date.toLocaleDateString(locale, opts);
  }
  // Sinhala order: year, month, day, weekday, then the time.
  const parts: string[] = [];
  if (opts.year) parts.push(opts.year === '2-digit' ? `'${String(date.getFullYear()).slice(2)}` : String(date.getFullYear()));
  if (opts.month) parts.push(opts.month === 'long' ? SI_MONTHS[date.getMonth()] : opts.month === 'short' || opts.month === 'narrow' ? SI_MONTHS_SHORT[date.getMonth()] : pad(date.getMonth() + 1));
  if (opts.day) parts.push(opts.day === '2-digit' ? pad(date.getDate()) : String(date.getDate()));
  if (opts.weekday) parts.push(opts.weekday === 'long' ? SI_DAYS[date.getDay()] : SI_DAYS_SHORT[date.getDay()]);
  let out = parts.join(' ');
  if (opts.hour || opts.minute) out += `${out ? ' ' : ''}${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return out;
}
