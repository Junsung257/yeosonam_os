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
import { getSecret } from '@/lib/secret-registry';

export const runtime = 'edge';

// 캐시: 동일 code+pkg 조합은 1시간 동안 같은 이미지 (CDN edge 캐시).
export const revalidate = 3600;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = normalizeAffiliateReferralCode(searchParams.get('code') || 'PARTNER') || 'PARTNER';
  const pkgId = searchParams.get('pkg');

  // 상품 / 어필리에이터 메타 페치 (서버측 supabase rest)
  let productTitle = '여소남 추천 여행';
  let productDestination = '';
  let productPrice: number | null = null;
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
        { headers, next: { revalidate: 600 } },
      );
      const affs = (await affRes.json()) as Array<{ name: string }>;
      if (affs?.[0]?.name) affiliateName = affs[0].name;

      // 상품
      if (pkgId) {
        const pkgRes = await fetch(
          `${supabaseUrl}/rest/v1/travel_packages?id=eq.${encodeURIComponent(pkgId)}&select=title,destination,price&limit=1`,
          { headers, next: { revalidate: 600 } },
        );
        const pkgs = (await pkgRes.json()) as Array<{ title: string; destination: string; price: number }>;
        if (pkgs?.[0]) {
          productTitle = pkgs[0].title || productTitle;
          productDestination = pkgs[0].destination || '';
          productPrice = pkgs[0].price ?? null;
        }
      }
    }
  } catch { /* fallback to defaults */ }

  return new ImageResponse(
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
            👉 자세히 보기 / 예약하기
          </div>
          <div style={{ fontSize: 16, opacity: 0.6, display: 'flex' }}>
            yeosonam.co.kr/r/{code}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
