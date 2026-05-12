import { NextRequest, NextResponse } from 'next/server';
import { getAuthSessionDebugReport } from '@/lib/debug-auth-session-report';

/** Node 런타임 — Route Handler 기본 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const access = req.cookies.get('sb-access-token')?.value;
  const refresh = req.cookies.get('sb-refresh-token')?.value;
  const report = await getAuthSessionDebugReport(access, refresh, 'nodejs');
  return NextResponse.json({
    ...report,
    hint:
      '미들웨어는 Edge 에서 실행됩니다. /api/debug/auth-session-edge 와 verify·jwt_secret_length 가 다르면 Edge 에서 SUPABASE_JWT_SECRET 이 비어 있는 경우가 많습니다.',
  });
}
