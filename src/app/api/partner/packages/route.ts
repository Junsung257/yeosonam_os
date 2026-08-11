/**
 * GET /api/partner/packages
 *
 * 랜드사 파트너 포털 — 자사 상품 목록 조회
 * Authorization: Bearer {portal_access_token}
 *
 * 응답:
 *   { operator: { id, name }, packages: [{ id, title, destination, status, price_dates }] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { fetchAndMergeCurrentPublicPackageCardSnapshots } from '@/lib/package-publication/snapshot-projection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
  }

  const token = extractBearerToken(request);
  if (!token) {
    return NextResponse.json(
      { error: '인증 토큰이 없습니다. Authorization: Bearer {token} 헤더를 포함해주세요.' },
      { status: 401 },
    );
  }

  try {
    // 토큰으로 랜드사 인증
    const { data: operators, error: opError } = await supabaseAdmin
      .from('land_operators')
      .select('id, name')
      .eq('portal_access_token', token)
      .eq('portal_enabled', true)
      .limit(1);

    if (opError) throw opError;

    const operator = operators?.[0] ?? null;
    if (!operator) {
      return NextResponse.json(
        { error: '유효하지 않은 토큰이거나 포털 접근이 비활성화되어 있습니다.' },
        { status: 401 },
      );
    }

    // Partner-visible facts come only from exact immutable snapshots. The
    // operator relationship is evaluated from that same snapshot payload.
    const { data: pointers, error: pkgError } = await supabaseAdmin
      .from('product_registration_v5_publication_pointers')
      .select('package_id,catalog_product_id,updated_at')
      .eq('channel', 'partner')
      .eq('locale', 'ko-KR')
      .eq('state', 'published')
      .order('updated_at', { ascending: false })
      .limit(1000);

    if (pkgError) throw pkgError;
    const currentPackages = await fetchAndMergeCurrentPublicPackageCardSnapshots(
      supabaseAdmin,
      (pointers ?? []).map(pointer => ({
        id: pointer.package_id,
        catalog_product_id: pointer.catalog_product_id,
        status: 'active',
        publication_state: 'published',
        updated_at: pointer.updated_at,
      })),
      { channel: 'partner', locale: 'ko-KR' },
    );
    const packages = currentPackages.filter((pkg) => {
      const snapshotPackage = pkg as Record<string, unknown>;
      return snapshotPackage.land_operator_id === operator.id
        || snapshotPackage.land_operator === operator.name;
    });

    return NextResponse.json({
      operator: { id: operator.id, name: operator.name },
      packages: packages ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
