/**
 * 어필리에이터 임베드 위젯: /embed/pkg/[id]?ref={code}
 *
 * 외부 사이트(티스토리·네이버 블로그·개인 사이트)에 iframe 으로 임베드.
 *
 * 사용:
 *   <iframe
 *     src="https://yeosonam.com/embed/pkg/abc123?ref=PARTNER"
 *     width="100%" height="280" frameborder="0"
 *     allow="clipboard-write" loading="lazy">
 *   </iframe>
 *
 * 사양:
 *   - 280px 높이 (가로 자유)
 *   - X-Frame-Options 우회 위해 별도 layout 필요 (next.config 또는 헤더)
 *   - 어필리에이터 ref 자동 부착
 *   - "예약" 버튼 → 새 창 /packages/{id}?ref=X
 */
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { getPublicCatalogDetail } from '@/lib/public-catalog';

interface Params {
  params: Promise<{ id?: string | string[] }>;
  searchParams: Promise<{ ref?: string | string[] }>;
}

export const dynamic = 'force-dynamic';

interface PackageRow {
  id: string;
  slug: string;
  title: string;
  destination: string | null;
  duration: number | null;
  price: number | null;
  priceDisplay: string | null;
  departureAirport: string | null;
  lastVerifiedAt: string;
}

interface AffiliateRow {
  name: string;
  logo_url: string | null;
}

function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
    .replace(/\/+$/, '');
}

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

export default async function EmbedWidget(props: Params) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const id = getRouteParam(params.id);
  const encodedId = encodeURIComponent(id);
  const rawRef = getRouteParam(searchParams.ref);
  const ref = rawRef ? normalizeAffiliateReferralCode(rawRef) : '';

  let pkg: PackageRow | null = null;
  let aff: AffiliateRow | null = null;

  if (id && isSupabaseConfigured) {
    try {
      const [current, { data: a }] = await Promise.all([
        getPublicCatalogDetail(supabaseAdmin, id),
        ref
          ? supabaseAdmin.from('affiliates').select('name, logo_url').eq('referral_code', ref).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      pkg = current ? {
        id: current.item.id,
        slug: current.item.slug,
        title: current.item.title,
        destination: current.item.destination,
        duration: current.item.duration,
        price: current.item.price,
        priceDisplay: current.item.priceDisplay,
        departureAirport: current.item.departureAirport,
        lastVerifiedAt: current.item.lastVerifiedAt,
      } : null;
      aff = (a as AffiliateRow) || null;
    } catch { /* */ }
  }

  const baseUrl = siteBaseUrl();
  const targetUrl = ref
    ? `${baseUrl}/packages/${encodedId}?ref=${encodeURIComponent(ref)}&utm_source=embed`
    : `${baseUrl}/packages/${encodedId}?utm_source=embed`;

  if (!pkg) {
    return (
      <div style={{ padding: 16, fontFamily: 'sans-serif', fontSize: 13, color: '#666' }}>
        상품을 찾을 수 없습니다.
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 14,
        fontFamily: '"Pretendard","Apple SD Gothic Neo",sans-serif',
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        margin: 0,
      }}
    >
      {/* 광고 배너 (공정위) */}
      <div
        style={{
          fontSize: 11,
          background: '#FFF8E1',
          color: '#a16207',
          padding: '4px 10px',
          borderRadius: 6,
          alignSelf: 'flex-start',
          fontWeight: 600,
        }}
      >
        ⓘ 여소남 제휴 콘텐츠 · 추천 보상 포함 (광고)
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: '#1a1a1a', margin: 0, lineHeight: 1.3 }}>
            {pkg.title}
          </h3>
          <div style={{ marginTop: 6, fontSize: 12, color: '#666', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pkg.destination && <span>📍 {pkg.destination}</span>}
            {pkg.duration && <span>🕒 {pkg.duration}일</span>}
            {pkg.departureAirport && <span>✈️ {pkg.departureAirport} 출발</span>}
          </div>
          <p style={{ marginTop: 8, fontSize: 11, color: '#777' }}>
            최근 조건 확인 {pkg.lastVerifiedAt.slice(0, 10)} · 예약 전 가능 여부 재확인
          </p>
        </div>
        {(pkg.priceDisplay || pkg.price != null) && (
          <div
            style={{
              flexShrink: 0,
              textAlign: 'right',
              fontSize: 18,
              fontWeight: 800,
              color: '#2563EB',
            }}
          >
            {pkg.priceDisplay || `₩${pkg.price?.toLocaleString()}`}
            <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>최근 확인 가격</div>
          </div>
        )}
      </div>

      <a
        href={targetUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          background: '#2563EB',
          color: 'white',
          textAlign: 'center',
          padding: '10px 16px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 700,
          textDecoration: 'none',
          marginTop: 4,
        }}
      >
        현재 조건 확인 / 자세히 보기 →
      </a>

      {/* Co-brand footer */}
      <div
        style={{
          fontSize: 10,
          color: '#999',
          textAlign: 'right',
          borderTop: '1px solid #f3f4f6',
          paddingTop: 6,
          marginTop: 2,
        }}
      >
        {aff?.name ? `${aff.name} × ` : ''}<span style={{ color: '#2563EB', fontWeight: 700 }}>여소남</span>
      </div>
    </div>
  );
}
