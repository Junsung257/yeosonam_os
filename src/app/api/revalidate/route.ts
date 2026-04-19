/**
 * POST /api/revalidate
 *
 * DB 수정 스크립트나 외부 툴에서 ISR 캐시를 즉시 무효화할 때 사용.
 * Body: { paths: string[], secret: string }
 *
 * 예시:
 *   curl -X POST http://localhost:3000/api/revalidate \
 *     -H "Content-Type: application/json" \
 *     -d '{"paths":["/packages/abc-123","/packages"],"secret":"..."}'
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { paths, secret } = body;

    // 시크릿 검증 (환경변수 REVALIDATE_SECRET 필수)
    const expectedSecret = process.env.REVALIDATE_SECRET;
    if (!expectedSecret) {
      return NextResponse.json({ error: 'REVALIDATE_SECRET 미설정' }, { status: 500 });
    }
    if (secret !== expectedSecret) {
      return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
    }

    if (!Array.isArray(paths) || paths.length === 0) {
      return NextResponse.json({ error: 'paths 배열 필수' }, { status: 400 });
    }

    const revalidated: string[] = [];
    for (const p of paths) {
      if (typeof p !== 'string') continue;
      // 경로 검증 — 임의 재검증 방지
      if (!p.startsWith('/')) continue;
      revalidatePath(p);
      revalidated.push(p);
    }

    return NextResponse.json({ success: true, revalidated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'revalidate failed' },
      { status: 500 },
    );
  }
}
