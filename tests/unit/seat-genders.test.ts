// Who sits where: a woman's seat counts as "travelling alone" when no seat of
// her own booking is beside it, however many seats the booking has.
import { describe, expect, it } from 'vitest';
import { seatsBesideLoneWoman, takenSeats } from '@/lib/trips';
import type { Booking } from '@/lib/types';

const bus = { rows: 10, backRowSeats: 0, seatMap: null };
const bk = (id: string, seats: string[], x: Partial<Booking> = {}) =>
  ({ id, scheduleId: 's', date: 'd', seats, status: 'confirmed', userId: `u-${id}`, passenger: { name: '', gender: '', phone: '' }, ...x }) as Booking;

describe('seat genders', () => {
  it('a woman on a two-seat booking, seats apart, still protects the seat beside her', () => {
    const b = bk('a', ['6A', '9C'], { seatGenders: { '6A': 'Female', '9C': 'Male' } });
    const kept = seatsBesideLoneWoman([b], bus, 's', 'd');
    expect(kept.has('6B')).toBe(true);
    expect(kept.has('9D')).toBe(false);
  });
  it('two seats side by side in one booking: neither is alone', () => {
    const b = bk('a', ['5A', '5B'], { seatGenders: { '5A': 'Female', '5B': '' } });
    expect(seatsBesideLoneWoman([b], bus, 's', 'd').size).toBe(0);
  });
  it('the seat map shows each seat\'s own gender, falling back to the passenger\'s', () => {
    const m = takenSeats([bk('a', ['1A', '1B'], { seatGenders: { '1A': 'Female' }, passenger: { name: '', gender: 'Male', phone: '' } })], 's', 'd');
    expect(m.get('1A')).toBe('Female');
    expect(m.get('1B')).toBe('Male');
  });
});
