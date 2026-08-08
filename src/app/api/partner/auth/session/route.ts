import { NextRequest, NextResponse } from 'next/server';
import { authAffiliate, revokeAffiliateSession } from '@/lib/affiliate/auth-service';
import { clearPartnerSessionCookie } from '@/lib/affiliate/invitation-service';
import { isAllowedPartnerWriteOrigin } from '@/lib/affiliate/write-origin';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok) {
    const response = NextResponse.json({
      authenticated: false,
      error: auth.error,
      code: auth.code,
    }, { status: auth.status === 503 ? 503 : 401 });
    if (auth.status !== 503) clearPartnerSessionCookie(response);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }

  const affiliate = auth.affiliate;
  const response = NextResponse.json({
    authenticated: true,
    affiliate: {
      id: affiliate.id,
      name: affiliate.name,
      referral_code: affiliate.referral_code,
      grade: affiliate.grade,
      grade_label: affiliate.grade_label,
      grade_rate: affiliate.grade_rate,
      logo_url: affiliate.logo_url,
      branding_level: affiliate.branding_level,
      content_quota: affiliate.content_quota,
      content_used: affiliate.content_used,
      payout_profile_status: affiliate.payout_profile_status,
      tax_profile_status: affiliate.tax_profile_status,
    },
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!isAllowedPartnerWriteOrigin(request)) {
    return NextResponse.json({ error: '허용되지 않은 요청입니다.', code: 'ORIGIN_REJECTED' }, { status: 403 });
  }
  await revokeAffiliateSession(request);
  const response = NextResponse.json({ ok: true });
  clearPartnerSessionCookie(response);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
