/**
 * N5 박제 (2026-05-16 Lemax 표준 — 35% 수익↑): 패키지 Template 재사용 (clone).
 *
 * 사장님 솔루션: 자주 쓰는 패키지 (계림 3박5일 → 4박6일 변형) 복제 + inline 수정.
 * Lemax: "users report producing itineraries 3x faster".
 *
 * 동작:
 *   1. source package 의 핵심 필드 복제 (itinerary_data, optional_tours, price_tiers 등)
 *   2. title 에 "(복제)" 접미사 추가
 *   3. status='pending_review' + internal_code 신규 발급
 *   4. raw_text 는 source 그대로 (Rule Zero 회피용 — 사장님이 inline 편집)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';

export const POST = withAdminGuard(async (req: NextRequest, ctx?: { params?: Promise<{ id: string }> }) => {
  const params = await ctx?.params;
  const sourceId = params?.id;
  if (!sourceId) return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  return NextResponse.json({
    ok: false,
    code: 'PACKAGE_CLONE_RETIRED',
    error: '기존 상품 사실을 복제하는 기능은 종료되었습니다. 변경된 랜드사 원문을 새로 업로드해 주세요.',
    sourcePackageId: sourceId,
    next: '/api/upload',
  }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } });
});
