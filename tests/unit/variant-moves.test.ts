// The message dispatcher: who moves when tonight's variant leaves a stop out.
import { describe, expect, it } from 'vitest';
import { variantMoves } from '@/lib/server/variantStops';
import { R, S } from './helpers';

const route = R([S('A'), S('K'), S('M', { optional: true }), S('Maradana'), S('TJ')], {
  variants: [{ id: 'v', name: 'Without M', edited: true, removed: ['TJ'], stops: [S('A'), S('K'), S('Maradana')] }],
});
const bk = (id: string, from: string, to: string) => ({ id, from_stop: from, to_stop: to });

describe('variantMoves', () => {
  it('moves drop-offs at a left-out stop to the stop before it, keeping the booked stop', () => {
    const { variant, moves } = variantMoves(route, new Set(), [bk('1', 'A', 'TJ'), bk('2', 'A', 'K')]);
    expect(variant).toBe('Without M');
    expect(moves).toEqual([{ id: '1', from_stop: 'A', to_stop: 'Maradana', booked_from: null, booked_to: 'TJ', gone: 'TJ', off: true }]);
  });
  it('nothing when every on-request stop runs (main route)', () => {
    expect(variantMoves(route, new Set(['m']), [bk('1', 'A', 'TJ')]).moves).toEqual([]);
  });
});
