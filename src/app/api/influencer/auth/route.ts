import { NextRequest, NextResponse } from 'next/server';
import {
  GET as getPartnerSession,
  DELETE as deletePartnerSession,
} from '@/app/api/partner/auth/session/route';

export const runtime = 'nodejs';

export async function POST(_request: NextRequest) {
  return NextResponse.json({
    error: 'PIN 로그인이 종료되었습니다. 새 파트너 활성화 링크를 요청해 주세요.',
    code: 'PIN_LOGIN_RETIRED',
    activation_path: '/partner/login',
  }, { status: 410 });
}

export const GET = getPartnerSession;
export const DELETE = deletePartnerSession;
