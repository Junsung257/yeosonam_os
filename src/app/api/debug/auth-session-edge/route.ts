import { NextRequest, NextResponse } from 'next/server';
import { getAuthSessionDebugReport } from '@/lib/debug-auth-session-report';

export const runtime = 'edge';

/** Edge 런타임 — middleware 와 동일한 런타임에서 env·검증 일치 여부 확인 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const access = req.cookies.get('sb-access-token')?.value;
  const refresh = req.cookies.get('sb-refresh-token')?.value;
  const report = await getAuthSessionDebugReport(access, refresh, 'edge');
  return NextResponse.json(report);
}
