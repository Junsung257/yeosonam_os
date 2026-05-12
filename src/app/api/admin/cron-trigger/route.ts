import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';
import { logError } from '@/lib/sentry-logger';

/**
 * POST /api/admin/cron-trigger
 *
 * 어드민에서 수동 크론 실행 프록시.
 * NEXT_PUBLIC_CRON_SECRET 노출을 피하기 위해 서버 사이드에서 CRON_SECRET 주입.
 *
 * Request body:
 *   { "path": "/api/cron/review-sentiment" }
 *
 * Response:
 *   cron 엔드포인트의 응답 그대로 반환
 */

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 어드민 인증 확인
  const isAdmin = await isAdminRequest(request);
  if (!isAdmin) {
    return NextResponse.json(
      { error: '관리자 권한이 필요합니다' },
      { status: 401 }
    );
  }

  try {
    const { path } = await request.json() as { path?: string };

    if (!path || typeof path !== 'string') {
      return NextResponse.json(
        { error: 'path 필수 (예: /api/cron/review-sentiment)' },
        { status: 400 }
      );
    }

    if (!path.startsWith('/api/cron/')) {
      return NextResponse.json(
        { error: 'cron 경로만 허용됨' },
        { status: 400 }
      );
    }

    const secret = getSecret('CRON_SECRET');
    const baseUrl = request.headers.get('x-forwarded-proto') === 'https'
      ? `https://${request.headers.get('x-forwarded-host') || 'localhost'}`
      : `http://${request.headers.get('host') || 'localhost'}`;

    const url = `${baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${secret}`,
      },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    logError('[admin/cron-trigger] cron request failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '요청 실패' },
      { status: 500 }
    );
  }
}
