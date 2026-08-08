import { NextRequest, NextResponse } from 'next/server';
import { requestAffiliateOtp } from '@/lib/affiliate/invitation-service';
import { isAllowedPartnerWriteOrigin } from '@/lib/affiliate/write-origin';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isAllowedPartnerWriteOrigin(request)) {
    return NextResponse.json({ error: '허용되지 않은 요청입니다.', code: 'ORIGIN_REJECTED' }, { status: 403 });
  }
  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.', code: 'INVALID_JSON' }, { status: 400 });
  }
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const result = await requestAffiliateOtp(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json({ accepted: true, expires_in: result.expiresInSeconds }, { status: 202 });
}

