/**
 * GET /api/og/affiliate?code={code}&pkg={packageId}
 *
 * 어필리에이터 + 여소남 Co-brand OG 이미지 동적 생성.
 * 카톡/페북/네이버 공유 시 미리보기로 노출되어 클릭률 향상.
 *
 * 사용:
 *   <meta property="og:image" content="/api/og/affiliate?code=ABC&pkg=xxx" />
 *   /r/{code}/{slug} 단축링크의 메타에서 자동 사용.
 *
 * 사양:
 *   - 1200×630 (Open Graph 표준)
 *   - 어필리에이터 이름 + 여소남 로고 + 상품 타이틀·가격
 *   - 공정위 "광고" 워터마크 우측 상단
 *   - Edge 런타임 — 빠른 응답
 */
import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { PLATFORM_PRODUCT_REGISTRATION_TENANT_ID } from '@/lib/product-registration-authority/types';
import { getSecret } from '@/lib/secret-registry';

export const runtime = 'edge';
// OG 이미지는 publication pointer가 바뀌면 즉시 새 snapshot을 반영해야 한다.
// 장기 immutable 캐시는 이전 상품 가격·문구를 공유 미리보기에 남길 수 있으므로
// 데이터와 응답 모두 no-store로 두고, 필요할 때 Vercel CDN 태그/경로를 별도로
// 무효화한다. 고객 상세·LP와 달리 OG는 매 요청 비용보다 최신성 우선이다.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RestPublicCatalogRow = {
  id?: string | null;
  slug?: string | null;
  title?: string | null;
  destination?: string | null;
  price?: number | string | null;
  snapshot_hash?: string | null;
};

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function getPublicCatalogProductViaRest(
  supabaseUrl: string,
  headers: Record<string, string>,
  packageRef: string,
): Promise<RestPublicCatalogRow | null> {
  const baseQuery = `tenant_id=eq.${encodeURIComponent(PLATFORM_PRODUCT_REGISTRATION_TENANT_ID)}&select=id,slug,title,destination,price,snapshot_hash&limit=1`;
  for (const field of ['id', 'slug'] as const) {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/public_catalog_view?${field}=eq.${encodeURIComponent(packageRef)}&${baseQuery}`,
      { headers, cache: 'no-store' },
    );
    if (!response.ok) return null;
    const rows = (await response.json()) as RestPublicCatalogRow[];
    if (rows[0]) return rows[0];
  }
  return null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = normalizeAffiliateReferralCode(searchParams.get('code') || 'PARTNER') || 'PARTNER';
  const pkgId = searchParams.get('pkg');

  // 상품 / 어필리에이터 메타 페치 (서버측 supabase rest)
  let productTitle = '여소남 추천 여행';
  let productDestination = '';
  let productPrice: number | null = null;
  let observedSnapshotHash: string | null = null;
  let affiliateName = '여소남 파트너';

  try {
    const supabaseUrl = getSecret('NEXT_PUBLIC_SUPABASE_URL');
    const restKey =
      getSecret('SUPABASE_SERVICE_ROLE_KEY') || getSecret('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    if (supabaseUrl && restKey) {
      const headers = { apikey: restKey, Authorization: `Bearer ${restKey}` };
      // 어필리에이터
      const affRes = await fetch(
        `${supabaseUrl}/rest/v1/affiliates?referral_code=eq.${encodeURIComponent(code)}&select=name&limit=1`,
        { headers, cache: 'no-store' },
      );
      const affs = (await affRes.json()) as Array<{ name: string }>;
      if (affs?.[0]?.name) affiliateName = affs[0].name;

      // 상품: 공개·판매·마케팅 조건을 모두 통과한 단일 고객 카탈로그에서만 읽는다.
      if (pkgId) {
        const publicProduct = await getPublicCatalogProductViaRest(supabaseUrl, headers, pkgId);
        const publicTitle = asNonEmptyString(publicProduct?.title);
        if (publicTitle) {
          productTitle = publicTitle;
          productDestination = asNonEmptyString(publicProduct?.destination) || '';
          productPrice = asNumber(publicProduct?.price);
          observedSnapshotHash = typeof publicProduct?.snapshot_hash === 'string'
            && /^[0-9a-f]{64}$/i.test(publicProduct.snapshot_hash)
            ? publicProduct.snapshot_hash.toLowerCase()
            : null;
        }
      }
    }
  } catch { /* fallback to defaults */ }

  const response = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #001f3f 0%, #003366 60%, #0066cc 100%)',
          color: 'white',
          padding: '60px 70px',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* 광고 표시 (공정위) */}
        <div
          style={{
            position: 'absolute',
            top: 30,
            right: 30,
            background: 'rgba(255, 215, 0, 0.95)',
            color: '#1a1a1a',
            padding: '8px 18px',
            borderRadius: 999,
            fontSize: 18,
            fontWeight: 700,
            display: 'flex',
          }}
        >
          광고 · 제휴 콘텐츠
        </div>

        {/* 발행자 라인 (Co-brand) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 22, opacity: 0.85 }}>
          <span>{affiliateName}</span>
          <span style={{ opacity: 0.5 }}>×</span>
          <span style={{ fontWeight: 800, color: '#FFD700' }}>여소남</span>
        </div>

        {/* 상품 타이틀 */}
        <div
          style={{
            marginTop: 32,
            fontSize: 56,
            fontWeight: 900,
            lineHeight: 1.15,
            display: 'flex',
            flexWrap: 'wrap',
            maxWidth: 1000,
          }}
        >
          {productTitle.length > 60 ? productTitle.slice(0, 58) + '…' : productTitle}
        </div>

        {/* 메타 */}
        <div style={{ marginTop: 24, display: 'flex', gap: 24, fontSize: 28, opacity: 0.95 }}>
          {productDestination && (
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ opacity: 0.6 }}>📍</span>
              <span>{productDestination}</span>
            </div>
          )}
          {productPrice && (
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ opacity: 0.6 }}>💰</span>
              <span>₩{productPrice.toLocaleString()}부터</span>
            </div>
          )}
        </div>

        {/* CTA */}
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
          }}
        >
          <div
            style={{
              fontSize: 24,
              background: 'white',
              color: '#001f3f',
              padding: '14px 32px',
              borderRadius: 999,
              fontWeight: 800,
              display: 'flex',
            }}
          >
            👉 자세히 보기 / 상담하기
          </div>
          <div style={{ fontSize: 16, opacity: 0.6, display: 'flex' }}>
            yeosonam.com/r/{code}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
  if (observedSnapshotHash) {
    response.headers.set('x-product-registration-v5-snapshot-hash', observedSnapshotHash);
  }
  response.headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
  return response;
}
