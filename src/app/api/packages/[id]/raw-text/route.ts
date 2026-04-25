/**
 * @file src/app/api/packages/[id]/raw-text/route.ts
 *
 * 상품 ID 로 원문 텍스트를 끌어옴.
 *
 * 핵심 로직은 src/lib/packages/raw-text.ts 의 getPackageRawText() 에 있음.
 * 이 라우트는 외부(브라우저/타 서비스) 호출 진입점일 뿐, cron/내부 호출은 lib 함수 직접 사용.
 *
 * 카드뉴스 HTML 생성기에 그대로 input 으로 들어감 → Faithfulness Rule (A0) 적용.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getPackageRawText } from '@/lib/packages/raw-text';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const result = await getPackageRawText(params.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}
