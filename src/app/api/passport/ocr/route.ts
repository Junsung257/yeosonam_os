import { NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * Public passport OCR is disabled until processor terms, explicit consent,
 * retention/deletion, encrypted persistence, and client-response minimization
 * have all been approved and verified.
 */
export async function POST(): Promise<NextResponse> {
  return apiResponse(
    {
      ok: false,
      error: {
        code: 'PASSPORT_OCR_UNAVAILABLE',
        message: '현재 온라인 여권 인식 기능을 이용할 수 없습니다. 예약 담당자에게 문의해 주세요.',
      },
    },
    {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
