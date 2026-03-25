/**
 * Mock API 레이어
 * Agoda_Mock (호텔), Klook_Mock (액티비티), Cruise_Mock (크루즈)
 * mock_api_configs 테이블의 mode(success/fail/timeout)를 런타임에 읽어 동작 결정
 */
import { supabase, isSupabaseConfigured } from './supabase';

export interface MockSearchResult {
  product_id:       string;
  product_name:     string;
  api_name:         string;
  product_type:     'HOTEL' | 'ACTIVITY' | 'CRUISE';
  product_category: 'DYNAMIC' | 'FIXED';
  cost:             number;
  price:            number;
  description:      string;
  attrs?:           Record<string, unknown>;
}

export interface MockBookResult {
  success:      boolean;
  external_ref: string;
  api_name:     string;
  product_id:   string;
}

interface MockApiConfig {
  mode:     'success' | 'fail' | 'timeout';
  delay_ms: number;
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

async function getConfig(apiName: string): Promise<MockApiConfig> {
  if (!isSupabaseConfigured) return { mode: 'success', delay_ms: 0 };
  const { data } = await supabase
    .from('mock_api_configs')
    .select('mode, delay_ms')
    .eq('api_name', apiName)
    .single();
  return (data as MockApiConfig | null) ?? { mode: 'success', delay_ms: 0 };
}

async function applyMode(config: MockApiConfig, label: string): Promise<void> {
  if (config.delay_ms > 0) {
    await new Promise(r => setTimeout(r, config.delay_ms));
  }
  if (config.mode === 'fail') {
    throw new Error(`[${label}] API 오류 (fail 모드)`);
  }
  if (config.mode === 'timeout') {
    await new Promise(r => setTimeout(r, 30_000));
    throw new Error(`[${label}] API 타임아웃 (timeout 모드)`);
  }
}

// 판매가 = 원가 × (1 + margin%)
function applyMargin(cost: number, marginPercent: number = 18): number {
  return Math.round(cost * (1 + marginPercent / 100));
}

// ─── Agoda Mock (호텔) ──────────────────────────────────────────────────────

const AGODA_HOTELS = [
  { id: 'AGD-001', name: '방콕 아바니 리버사이드 호텔', cost: 95000, desc: '차오프라야강 전망 5성급 호텔. 무료 조식 포함.', city: '방콕' },
  { id: 'AGD-002', name: '방콕 센타라 그랜드 호텔', cost: 78000, desc: '쇼핑몰 직결, 루프탑 수영장, 편의시설 완비.', city: '방콕' },
  { id: 'AGD-003', name: '파타야 인터컨티넨탈 호텔', cost: 120000, desc: '파타야 비치 전망 럭셔리 리조트.', city: '파타야' },
  { id: 'AGD-004', name: '도쿄 시부야 스트림 엑셀 호텔', cost: 140000, desc: '시부야역 직결, 모던 디자인 호텔.', city: '도쿄' },
  { id: 'AGD-005', name: '오사카 더 리츠칼튼 호텔', cost: 200000, desc: '우메다 스카이 뷰, 미슐랭 레스토랑 보유.', city: '오사카' },
  { id: 'AGD-006', name: '발리 포시즌스 리조트 짐바란', cost: 280000, desc: '프라이빗 풀빌라, 클리프 사이드 다이닝.', city: '발리' },
];

export async function searchHotels(
  destination: string,
  checkIn: string,
  checkOut: string,
  guests: number
): Promise<MockSearchResult[]> {
  const config = await getConfig('agoda_mock');
  await applyMode(config, 'Agoda_Mock');

  const results = AGODA_HOTELS
    .filter(h => destination ? h.city.includes(destination) || destination.includes(h.city) : true)
    .slice(0, 3)
    .map(h => ({
      product_id:       h.id,
      product_name:     h.name,
      api_name:         'agoda_mock',
      product_type:     'HOTEL' as const,
      product_category: 'DYNAMIC' as const,
      cost:             h.cost * Math.max(1, guests),
      price:            applyMargin(h.cost * Math.max(1, guests)),
      description:      h.desc,
      attrs: { check_in: checkIn, check_out: checkOut, guests, city: h.city },
    }));

  return results.length > 0 ? results : AGODA_HOTELS.slice(0, 3).map(h => ({
    product_id:       h.id,
    product_name:     h.name,
    api_name:         'agoda_mock',
    product_type:     'HOTEL' as const,
    product_category: 'DYNAMIC' as const,
    cost:             h.cost * Math.max(1, guests),
    price:            applyMargin(h.cost * Math.max(1, guests)),
    description:      h.desc,
    attrs: { check_in: checkIn, check_out: checkOut, guests, city: h.city },
  }));
}

// ─── Klook Mock (액티비티) ───────────────────────────────────────────────────

const KLOOK_ACTIVITIES = [
  { id: 'KLK-001', name: '방콕 왕궁 & 왓포 투어', cost: 35000, desc: '영어/한국어 가이드 포함, 픽업 서비스 제공.', city: '방콕' },
  { id: 'KLK-002', name: '파타야 스피드보트 섬투어', cost: 55000, desc: '산호섬 3곳 방문, 점심 포함 투어.', city: '파타야' },
  { id: 'KLK-003', name: '도쿄 후지산 + 닌자 체험', cost: 90000, desc: '당일 버스투어, 닌자 공연 관람 포함.', city: '도쿄' },
  { id: 'KLK-004', name: '오사카 유니버설 스튜디오', cost: 80000, desc: '입장권 + 익스프레스 패스 콤보.', city: '오사카' },
  { id: 'KLK-005', name: '발리 화이트워터 래프팅', cost: 45000, desc: '아융강 급류 래프팅 2시간 어드벤처.', city: '발리' },
  { id: 'KLK-006', name: '제주 사려니 숲길 트레킹', cost: 28000, desc: '가이드 포함, 도시락 제공.', city: '제주' },
];

export async function searchActivities(
  destination: string,
  date: string,
  persons: number
): Promise<MockSearchResult[]> {
  const config = await getConfig('klook_mock');
  await applyMode(config, 'Klook_Mock');

  const results = KLOOK_ACTIVITIES
    .filter(a => destination ? a.city.includes(destination) || destination.includes(a.city) : true)
    .slice(0, 3)
    .map(a => ({
      product_id:       a.id,
      product_name:     a.name,
      api_name:         'klook_mock',
      product_type:     'ACTIVITY' as const,
      product_category: 'DYNAMIC' as const,
      cost:             a.cost * Math.max(1, persons),
      price:            applyMargin(a.cost * Math.max(1, persons)),
      description:      a.desc,
      attrs: { date, persons, city: a.city },
    }));

  return results.length > 0 ? results : KLOOK_ACTIVITIES.slice(0, 3).map(a => ({
    product_id:       a.id,
    product_name:     a.name,
    api_name:         'klook_mock',
    product_type:     'ACTIVITY' as const,
    product_category: 'DYNAMIC' as const,
    cost:             a.cost * Math.max(1, persons),
    price:            applyMargin(a.cost * Math.max(1, persons)),
    description:      a.desc,
    attrs: { date, persons, city: a.city },
  }));
}

// ─── Cruise Mock ─────────────────────────────────────────────────────────────

const CRUISE_PRODUCTS = [
  {
    id: 'CRS-001',
    name: '로얄캐리비안 지중해 7박 크루즈',
    cost: 980000,
    desc: '바르셀로나 출항, 로마·산토리니·두브로브니크 기항.',
    ship_name: 'Symphony of the Seas',
    cabin_class: 'Ocean View',
    dining: 'Main Dining Room',
    departure_port: '바르셀로나',
    destination: '지중해',
  },
  {
    id: 'CRS-002',
    name: '코스타 크루즈 동남아 5박',
    cost: 650000,
    desc: '싱가포르 출항, 방콕·코사무이·페낭 기항.',
    ship_name: 'Costa Serena',
    cabin_class: 'Balcony',
    dining: 'Buffet + Specialty Restaurant',
    departure_port: '싱가포르',
    destination: '동남아',
  },
  {
    id: 'CRS-003',
    name: '프린세스 크루즈 알래스카 7박',
    cost: 1200000,
    desc: '시애틀 출항, 빙하만·주노·케치칸 기항.',
    ship_name: 'Sapphire Princess',
    cabin_class: 'Mini Suite',
    dining: 'Anytime Dining',
    departure_port: '시애틀',
    destination: '알래스카',
  },
];

export async function searchCruises(
  destination: string,
  departureDate: string,
  nights: number,
  persons: number
): Promise<MockSearchResult[]> {
  const config = await getConfig('cruise_mock');
  await applyMode(config, 'Cruise_Mock');

  const results = CRUISE_PRODUCTS
    .filter(c => destination
      ? c.destination.includes(destination) || destination.includes(c.destination)
      : true
    )
    .slice(0, 2)
    .map(c => ({
      product_id:       c.id,
      product_name:     c.name,
      api_name:         'cruise_mock',
      product_type:     'CRUISE' as const,
      product_category: 'DYNAMIC' as const,
      cost:             c.cost * Math.max(1, persons),
      price:            applyMargin(c.cost * Math.max(1, persons), 22),
      description:      c.desc,
      attrs: {
        ship_name:      c.ship_name,
        cabin_class:    c.cabin_class,
        dining:         c.dining,
        departure_port: c.departure_port,
        departure_date: departureDate,
        nights,
        persons,
      },
    }));

  return results.length > 0 ? results : CRUISE_PRODUCTS.slice(0, 2).map(c => ({
    product_id:       c.id,
    product_name:     c.name,
    api_name:         'cruise_mock',
    product_type:     'CRUISE' as const,
    product_category: 'DYNAMIC' as const,
    cost:             c.cost * Math.max(1, persons),
    price:            applyMargin(c.cost * Math.max(1, persons), 22),
    description:      c.desc,
    attrs: {
      ship_name:      c.ship_name,
      cabin_class:    c.cabin_class,
      dining:         c.dining,
      departure_port: c.departure_port,
      departure_date: departureDate,
      nights,
      persons,
    },
  }));
}

// ─── Mock 예약 (checkout 시 사용) ────────────────────────────────────────────

export async function bookProduct(
  apiName: string,
  productId: string,
  quantity: number
): Promise<MockBookResult> {
  const config = await getConfig(apiName);
  await applyMode(config, apiName);

  return {
    success:      true,
    external_ref: `${apiName.toUpperCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    api_name:     apiName,
    product_id:   productId,
  };
}

export async function cancelProduct(
  apiName: string,
  externalRef: string
): Promise<{ success: boolean }> {
  // 취소는 항상 성공 (Mock)
  console.log(`[${apiName}] 취소 처리: ${externalRef}`);
  return { success: true };
}
