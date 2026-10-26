// Local testing only: the texts and WhatsApp messages that would have gone out
// while NEXT_PUBLIC_MOCK_VERIFICATION is on (newest first). Open
// http://localhost:3000/api/dev/outbox in the browser.
import { NextRequest, NextResponse } from 'next/server';
import { mockOutbox, serverMockOn } from '@/lib/mockVerification';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!serverMockOn(req.headers.get('host'))) return NextResponse.json({ error: 'Not available.' }, { status: 404 });
  return NextResponse.json({ messages: mockOutbox() });
}
