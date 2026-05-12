/**
 * 지역(Region) 분류 SSOT
 *
 * 3-tier 정보 위계의 중간 계층 (지역). 도시는 travel_packages.destination 의 값을 그대로 쓴다.
 * URL slug 는 영문 (SEO·인코딩 안전), 라벨/태그라인은 한글.
 *
 * 사용 패턴:
 *   - GlobalNav: REGIONS 순회로 메뉴 렌더
 *   - /destinations/region/[slug]: getRegionBySlug(slug) 로 메타 조회
 *   - /packages 필터: matchesRegion(pkg, slug) 로 분류
 *
 * 도시 키워드 추가 시 REGIONS[].cityKeywords 에 한 곳에서만 추가하면 전체 시스템에 반영된다.
 */

export interface RegionDef {
  slug: string;
  label: string;
  emoji: string;
  tagline: string;
  countries: string[];
  cityKeywords: string[];
  /** 메뉴 노출용 대표 도시 (megamenu / region 페이지 hero 카드). DB 에 실제 패키지가 있어야 표시됨 */
  featuredCities: string[];
}

export const REGIONS: RegionDef[] = [
  {
    slug: 'japan',
    label: '일본',
    emoji: '🏯',
    tagline: '가까운 이국, 가성비 좋은 4계절 여행지',
    countries: ['일본'],
    cityKeywords: [
      '오사카', '교토', '나라', '고베', '도쿄', '요코하마',
      '후쿠오카', '큐슈', '나가사키', '벳푸', '유후인',
      '시즈오카', '이즈', '후지노미야', '토야마',
      '북해도', '삿포로', '오키나와', '나하',
    ],
    featuredCities: ['오사카', '도쿄', '교토', '후쿠오카', '시즈오카', '오키나와'],
  },
  {
    slug: 'china',
    label: '중국',
    emoji: '🏮',
    tagline: '대륙의 절경 — 산수와 도시의 양대 매력',
    countries: ['중국'],
    cityKeywords: [
      '장가계', '서안', '상해', '북경', '여강', '연길', '백두산',
      '청도', '칭다오', '심천', '구채구', '칠채산',
      '석가장', '호화호특', '황산', '계림',
    ],
    featuredCities: ['장가계', '서안', '칭다오', '연길/백두산'],
  },
  {
    slug: 'southeast-asia',
    label: '동남아',
    emoji: '🌴',
    tagline: '휴양과 모험이 공존하는 따뜻한 남쪽',
    countries: ['베트남', '필리핀', '태국', '인도네시아', '말레이시아', '라오스', '캄보디아', '싱가포르', '미얀마', '브루나이'],
    cityKeywords: [
      '나트랑', '달랏', '판랑', '다낭', '호이안', '푸꾸옥', '호치민', '하노이', '사파', '하롱베이',
      '보홀', '세부', '마닐라', '팔라완',
      '방콕', '치앙마이', '치앙라이', '푸켓', '파타야',
      '발리', '마나도', '족자카르타',
      '코타키나발루', '쿠알라룸푸르', '말라카', '랑카위',
      '비엔티안', '비엔티엔', '루앙프라방', '방비엥',
      '시엠립', '앙코르와트', '프놈펜',
      '싱가포르',
    ],
    featuredCities: ['나트랑', '다낭', '보홀', '세부', '코타키나발루', '방콕'],
  },
  {
    slug: 'macau-hk',
    label: '마카오·홍콩',
    emoji: '🌃',
    tagline: '도시·미식·쇼핑이 한자리에',
    countries: ['마카오', '홍콩', '중화인민공화국 마카오 특별행정구', '중화인민공화국 홍콩 특별행정구'],
    cityKeywords: ['마카오', '홍콩'],
    featuredCities: ['마카오', '홍콩'],
  },
  {
    slug: 'taiwan',
    label: '대만',
    emoji: '🧋',
    tagline: '야시장과 차문화, 짧고 진한 4일',
    countries: ['대만'],
    cityKeywords: ['타이베이', '타이중', '가오슝', '타이난', '지우펀', '화롄'],
    featuredCities: ['타이베이'],
  },
  {
    slug: 'mongolia',
    label: '몽골',
    emoji: '🐎',
    tagline: '광활한 초원과 별이 쏟아지는 밤',
    countries: ['몽골'],
    cityKeywords: ['울란바토르', '테를지', '엘승타사르하이', '고비'],
    featuredCities: ['울란바토르'],
  },
  {
    slug: 'europe',
    label: '유럽',
    emoji: '🏛️',
    tagline: '클래식한 여정, 한 번쯤은 꼭',
    countries: [
      '프랑스', '이탈리아', '스페인', '독일', '영국', '스위스',
      '오스트리아', '체코', '네덜란드', '그리스', '튀르키예', '터키',
      '포르투갈', '헝가리', '폴란드', '아이슬란드', '핀란드',
    ],
    cityKeywords: ['파리', '로마', '바르셀로나', '마드리드', '베를린', '런던', '이스탄불', '프라하', '비엔나', '암스테르담', '아테네'],
    featuredCities: [],
  },
  {
    slug: 'oceania',
    label: '대양주',
    emoji: '🦘',
    tagline: '광활한 자연과 청정한 휴양',
    countries: ['호주', '뉴질랜드', '피지', '괌', '사이판'],
    cityKeywords: ['시드니', '멜버른', '오클랜드', '퀸스타운', '괌', '사이판'],
    featuredCities: [],
  },
  {
    slug: 'americas',
    label: '미주',
    emoji: '🗽',
    tagline: '광대한 대륙의 상징적 풍경',
    countries: ['미국', '캐나다', '멕시코', '쿠바', '페루', '브라질', '아르헨티나', '칠레'],
    cityKeywords: ['뉴욕', 'LA', '라스베가스', '밴쿠버', '토론토', '칸쿤', '쿠스코'],
    featuredCities: [],
  },
];

export const REGION_SLUGS = REGIONS.map(r => r.slug);

export function getRegionBySlug(slug: string): RegionDef | null {
  return REGIONS.find(r => r.slug === slug) ?? null;
}

export function getRegionByLabel(label: string): RegionDef | null {
  return REGIONS.find(r => r.label === label) ?? null;
}

/**
 * 도시명을 분할해서 토큰 배열로 변환. "북경/홍콩" → ["북경","홍콩"].
 * 멀티시티 destination 의 부분 문자열 매칭이 다른 region 으로 false-positive 되는 것을 방지.
 */
function tokenizeDestination(dest: string): string[] {
  return dest.split(/[\/,]+|\s+|·/).map(s => s.trim()).filter(Boolean);
}

/**
 * 도시명으로 region 찾기. destination 이 "오사카/교토" 처럼 멀티시티여도 첫 매칭 region 반환.
 *
 * 매칭 규칙: destination 을 토큰으로 분할 → 각 토큰이 region.cityKeywords 의 어느 키워드를 포함(부분 매칭)하면 hit.
 * (예: "북경" 토큰은 china 의 "북경" 키워드와 매칭, 홍콩은 macau-hk 와 매칭. 멀티시티 "북경/홍콩" 은 첫 매칭 토큰의 region 반환.)
 */
export function getRegionForCity(city: string | null | undefined): RegionDef | null {
  if (!city) return null;
  const tokens = tokenizeDestination(city);
  for (const region of REGIONS) {
    if (tokens.some(tok => region.cityKeywords.some(kw => tok.includes(kw) || kw.includes(tok)))) {
      return region;
    }
  }
  return null;
}

/**
 * 패키지(country + destination) 로 region 찾기. country 매칭 우선, 도시 키워드 보조.
 */
export function getRegionForPackage(pkg: { country?: string | null; destination?: string | null }): RegionDef | null {
  if (pkg.country) {
    const byCountry = REGIONS.find(r => r.countries.includes(pkg.country!));
    if (byCountry) return byCountry;
  }
  return getRegionForCity(pkg.destination);
}

/**
 * 패키지가 특정 region 에 속하는지. PackagesClient REGION_MAP 의 SSOT 대체.
 * destination 의 토큰 매칭으로 멀티시티 false-positive 방지 (getRegionForCity 와 동일한 토큰화).
 */
export function matchesRegion(pkg: { country?: string | null; destination?: string | null }, regionSlug: string): boolean {
  const region = getRegionBySlug(regionSlug);
  if (!region) return false;
  if (pkg.country && region.countries.includes(pkg.country)) return true;
  if (pkg.destination) {
    const tokens = tokenizeDestination(pkg.destination);
    if (tokens.some(tok => region.cityKeywords.some(kw => tok.includes(kw) || kw.includes(tok)))) return true;
  }
  return false;
}

/**
 * 도시명(active_destinations.destination) 이 특정 region 에 속하는지.
 * `getRegionForCity()` 의 결과 region 을 비교 → 멀티시티 destination ("북경/홍콩") 의 첫 매칭 region 만 인정.
 *
 * 이 헬퍼가 필요한 이유: `region.cityKeywords.some(kw => dest.includes(kw))` 같은 단순 substring 매칭은
 * "북경/홍콩" 이 china(북경)/macau-hk(홍콩) 양쪽에 false-positive. getRegionForCity 의 첫 매칭 결과로 단일 region 확정.
 */
export function cityInRegion(destination: string | null | undefined, regionSlug: string): boolean {
  if (!destination) return false;
  return getRegionForCity(destination)?.slug === regionSlug;
}

/**
 * 레거시 필터 라벨 → REGION 슬러그 매핑.
 * 이전 home page 의 region 칩이 "마카오/홍콩" 같은 슬래시 라벨을 사용했음. 새 라벨은 "마카오·홍콩" (middot).
 * 북마크/유입링크 호환을 위해 legacy 라벨도 받아준다.
 */
export const LEGACY_FILTER_ALIASES: Record<string, string> = {
  '마카오/홍콩': '마카오·홍콩',
  '홍콩/마카오': '마카오·홍콩',
};

export function resolveLegacyFilterLabel(filter: string): string {
  return LEGACY_FILTER_ALIASES[filter] ?? filter;
}

/**
 * 도시 라벨 → region 페이지로 가는 URL.
 * 도시가 어떤 region 에도 속하지 않으면 /destinations/[city] 로 폴백.
 */
export function getDestinationUrl(city: string): string {
  return `/destinations/${encodeURIComponent(city)}`;
}

export function getRegionUrl(slug: string): string {
  return `/destinations/region/${slug}`;
}
