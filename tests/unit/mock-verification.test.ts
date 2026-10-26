// Test mode for codes: only on your own computer.
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('serverMockOn', () => {
  it('off unless the flag is set', async () => {
    const m = await import('@/lib/mockVerification');
    expect(m.serverMockOn('localhost:3000')).toBe(false);
  });
  it('on for localhost and the local network when set', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOCK_VERIFICATION', 'true');
    const m = await import('@/lib/mockVerification');
    expect(m.serverMockOn('localhost:3000')).toBe(true);
    expect(m.serverMockOn('192.168.1.20:3000')).toBe(true);
    expect(m.serverMockOn('www.siyanlanka.lk')).toBe(false);
  });
  it('never on Vercel', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOCK_VERIFICATION', 'true');
    vi.stubEnv('VERCEL', '1');
    const m = await import('@/lib/mockVerification');
    expect(m.serverMockOn('localhost:3000')).toBe(false);
  });
  it('the test code defaults to 123456', async () => {
    const m = await import('@/lib/mockVerification');
    expect(m.MOCK_CODE).toBe('123456');
  });
});
