import { supabaseAdmin } from './supabase';

export interface BlogOriginalitySignals {
  destination: string | null;
  packageCount: number;
  activePackageCount: number;
  minPrice: number | null;
  maxPrice: number | null;
  samplePackages: Array<{ title: string; price: number | null; duration: string | null }>;
  bookingCount: number;
  latestPackageUpdatedAt: string | null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function fetchBlogOriginalitySignals(opts: {
  destination?: string | null;
  productId?: string | null;
}): Promise<BlogOriginalitySignals> {
  const destination = opts.destination?.trim() || null;
  const empty: BlogOriginalitySignals = {
    destination,
    packageCount: 0,
    activePackageCount: 0,
    minPrice: null,
    maxPrice: null,
    samplePackages: [],
    bookingCount: 0,
    latestPackageUpdatedAt: null,
  };

  try {
    let packageQuery = supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, duration, price, status, updated_at, created_at')
      .order('updated_at', { ascending: false })
      .limit(12);

    if (opts.productId) {
      packageQuery = packageQuery.eq('id', opts.productId);
    } else if (destination) {
      packageQuery = packageQuery.ilike('destination', `%${destination}%`);
    } else {
      return empty;
    }

    const { data: packages, error } = await packageQuery;
    if (error || !packages?.length) return empty;

    const packageIds = packages.map((pkg: any) => pkg.id).filter(Boolean);
    const prices = packages.map((pkg: any) => asNumber(pkg.price)).filter((price): price is number => price !== null);
    const activePackages = packages.filter((pkg: any) => String(pkg.status || '').toLowerCase() === 'active');
    let bookingCount = 0;

    if (packageIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .in('package_id', packageIds);
      bookingCount = count || 0;
    }

    return {
      destination,
      packageCount: packages.length,
      activePackageCount: activePackages.length,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      samplePackages: packages.slice(0, 3).map((pkg: any) => ({
        title: String(pkg.title || '').slice(0, 80),
        price: asNumber(pkg.price),
        duration: pkg.duration ? String(pkg.duration) : null,
      })),
      bookingCount,
      latestPackageUpdatedAt: packages[0]?.updated_at || packages[0]?.created_at || null,
    };
  } catch {
    return empty;
  }
}

export function buildOriginalityPromptBlock(signals: BlogOriginalitySignals): string {
  if (signals.packageCount === 0 && signals.bookingCount === 0) return '';

  const priceLine = signals.minPrice && signals.maxPrice
    ? `- 여소남 상품 가격대: ${signals.minPrice.toLocaleString('ko-KR')}원~${signals.maxPrice.toLocaleString('ko-KR')}원`
    : '';
  const packageLines = signals.samplePackages
    .map((pkg) => `- 참고 상품: ${pkg.title}${pkg.duration ? ` / ${pkg.duration}` : ''}${pkg.price ? ` / ${pkg.price.toLocaleString('ko-KR')}원` : ''}`)
    .join('\n');

  return `
## 여소남 원천 데이터 신호
- 대상 목적지: ${signals.destination || '미지정'}
- 조회된 관련 상품: ${signals.packageCount}개, 활성 상품: ${signals.activePackageCount}개
${priceLine}
- 관련 예약 신호: ${signals.bookingCount}건
${signals.latestPackageUpdatedAt ? `- 상품 데이터 확인 기준: ${signals.latestPackageUpdatedAt}` : ''}
${packageLines}

작성 지침:
- 위 데이터는 "여소남 내부 상품/예약 데이터 기준"으로만 표현하고, 전체 시장 평균처럼 과장하지 마세요.
- 가격/상품 수/예약 신호는 본문 중간의 실전 체크 문단에 자연스럽게 넣으세요.
- 데이터가 부족한 항목은 단정하지 말고 상담/확인 CTA로 연결하세요.
`;
}
