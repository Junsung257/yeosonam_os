export type PublicFallbackBlogPost = {
  id: string;
  slug: string;
  seo_title: string;
  seo_description: string;
  og_image_url: string;
  blog_html: string;
  angle_type: string;
  channel: 'naver_blog';
  published_at: string;
  created_at: string;
  updated_at: string | null;
  product_id: string | null;
  tracking_id: string | null;
  destination: string | null;
  content_type: string | null;
  featured: boolean | null;
  featured_order: number | null;
  view_count: number | null;
  landing_enabled: boolean | null;
  landing_headline: string | null;
  landing_subtitle: string | null;
  travel_packages: null;
};

const FALLBACK_IMAGES = [
  'https://images.pexels.com/photos/25000725/pexels-photo-25000725.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
  'https://images.pexels.com/photos/2166559/pexels-photo-2166559.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
  'https://images.pexels.com/photos/338504/pexels-photo-338504.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
  'https://images.pexels.com/photos/3278215/pexels-photo-3278215.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
  'https://images.pexels.com/photos/3601425/pexels-photo-3601425.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
  'https://images.pexels.com/photos/3155666/pexels-photo-3155666.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
  'https://images.pexels.com/photos/1020016/pexels-photo-1020016.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
  'https://images.pexels.com/photos/2034335/pexels-photo-2034335.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
];

const DESTINATION_ALIASES: Record<string, string> = {
  zhangjiajie: '장가계',
  '张家界': '장가계',
  danang: '다낭',
  'da-nang': '다낭',
  nhatrang: '나트랑',
  'nha-trang': '나트랑',
  taipei: '타이베이',
  osaka: '오사카',
  bangkok: '방콕',
  cebu: '세부',
  fukuoka: '후쿠오카',
};

type FallbackSeed = {
  slug: string;
  title: string;
  description: string;
  destination: string;
  angle: string;
  contentType: string;
  imageIndex: number;
  publishedAt: string;
  bullets: string[];
};

function normalizeDestination(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return DESTINATION_ALIASES[trimmed.toLowerCase()] ?? DESTINATION_ALIASES[trimmed] ?? trimmed;
}

function proxyImageUrl(url: string): string {
  return `https://www.yeosonam.com/api/blog/image?src=${encodeURIComponent(url)}&w=960`;
}

function buildBody(seed: FallbackSeed, imageUrl: string): string {
  return `
# ${seed.title}

현재 블로그 데이터베이스 응답이 지연될 때도 독자가 바로 참고할 수 있도록 여소남 운영팀 기준으로 정리한 비상 가이드입니다. 실제 발행 글이 복구되면 최신 원문과 상품 연결 정보가 우선 표시됩니다.

![${seed.destination} 여행 준비 이미지](${imageUrl})

<figcaption>${seed.destination} 여행은 계절, 항공 동선, 현지 이동 시간을 함께 보고 준비하는 것이 좋습니다.</figcaption>

## 먼저 확인할 것

${seed.bullets.map((item) => `- ${item}`).join('\n')}

## 예약 전에 보면 좋은 기준

상품을 고를 때는 가격만 보지 말고 항공 시간, 호텔 위치, 포함 관광, 자유시간, 선택 관광 조건을 함께 비교하세요. 같은 지역이라도 이동 시간이 길면 체감 만족도가 떨어질 수 있고, 부모님 또는 아이와 함께라면 휴식 시간이 충분한 일정이 더 안전합니다.

## 여소남 추천 체크

출발 전에는 여권 만료일, 현지 날씨, 수하물 규정, 여행자보험, 환전 또는 카드 사용 가능 여부를 한 번 더 확인하세요. 일정표에 대체 코스와 비상 연락 경로가 명확한 상품을 고르면 현지 변수에도 훨씬 안정적으로 대응할 수 있습니다.
`.trim();
}

function buildFallbackPost(seed: FallbackSeed, index: number): PublicFallbackBlogPost {
  const imageUrl = FALLBACK_IMAGES[seed.imageIndex % FALLBACK_IMAGES.length];
  return {
    id: `fallback-${seed.slug}`,
    slug: seed.slug,
    seo_title: seed.title,
    seo_description: seed.description,
    og_image_url: proxyImageUrl(imageUrl),
    blog_html: buildBody(seed, imageUrl),
    angle_type: seed.angle,
    channel: 'naver_blog',
    published_at: seed.publishedAt,
    created_at: seed.publishedAt,
    updated_at: '2026-06-25T00:00:00.000Z',
    product_id: null,
    tracking_id: null,
    destination: seed.destination,
    content_type: seed.contentType,
    featured: index < 3,
    featured_order: index + 1,
    view_count: null,
    landing_enabled: false,
    landing_headline: null,
    landing_subtitle: null,
    travel_packages: null,
  };
}

const FALLBACK_SEEDS: FallbackSeed[] = [
  {
    slug: 'zhangjiajie-weather',
    title: '장가계 월별 날씨와 옷차림 가이드 2026',
    description: '장가계 여행 전 월별 날씨, 옷차림, 준비물, 우천 시 일정 조정 팁을 정리했습니다.',
    destination: '장가계',
    angle: 'value',
    contentType: 'guide',
    imageIndex: 0,
    publishedAt: '2026-06-01T00:00:00.000Z',
    bullets: ['산 위와 시내의 체감 온도 차이를 고려합니다.', '우천 대체 코스와 미끄럼 방지 신발을 준비합니다.', '전망대 일정은 오전 위주로 잡는 편이 안정적입니다.'],
  },
  {
    slug: 'danang-family-package-checklist',
    title: '다낭 가족여행 패키지 고르는 법',
    description: '부모님, 아이와 함께 가는 다낭 패키지에서 호텔 위치와 일정 강도를 비교하는 기준입니다.',
    destination: '다낭',
    angle: 'filial',
    contentType: 'tip',
    imageIndex: 1,
    publishedAt: '2026-06-02T00:00:00.000Z',
    bullets: ['미케비치와 한시장 이동 시간을 확인합니다.', '바나힐 포함 여부와 대기 시간을 따져봅니다.', '부모님 동반이면 쇼핑 횟수와 자유시간을 같이 봅니다.'],
  },
  {
    slug: 'nha-trang-resort-vacation-guide',
    title: '나트랑 리조트 휴양 일정 추천',
    description: '나트랑에서 리조트 휴식과 시내 관광을 균형 있게 배치하는 방법을 정리했습니다.',
    destination: '나트랑',
    angle: 'luxury',
    contentType: 'guide',
    imageIndex: 2,
    publishedAt: '2026-06-03T00:00:00.000Z',
    bullets: ['빈원더스와 머드온천은 하루에 몰지 않는 편이 좋습니다.', '리조트 체크인 시간을 기준으로 첫날 일정을 가볍게 잡습니다.', '해양 액티비티는 날씨와 파도 상태를 확인합니다.'],
  },
  {
    slug: 'taipei-short-trip-food-route',
    title: '타이베이 3박 4일 미식 동선',
    description: '타이베이 짧은 일정에서 야시장, 예스진지, 시내 맛집을 효율적으로 묶는 방법입니다.',
    destination: '타이베이',
    angle: 'food',
    contentType: 'guide',
    imageIndex: 3,
    publishedAt: '2026-06-04T00:00:00.000Z',
    bullets: ['첫날은 숙소 주변 야시장으로 가볍게 시작합니다.', '예스진지는 이동 시간이 길어 하루 단독 일정이 안정적입니다.', '맛집 예약과 현금 사용 여부를 미리 확인합니다.'],
  },
  {
    slug: 'osaka-first-trip-route',
    title: '오사카 첫 여행 코스와 숙소 위치',
    description: '오사카 초행자가 난바, 우메다, 교토 당일치기를 쉽게 비교할 수 있는 기준입니다.',
    destination: '오사카',
    angle: 'activity',
    contentType: 'tip',
    imageIndex: 4,
    publishedAt: '2026-06-05T00:00:00.000Z',
    bullets: ['쇼핑 중심이면 난바, 교통 중심이면 우메다가 편합니다.', '교토 당일치기는 아침 출발 시간이 중요합니다.', 'USJ 일정은 입장권과 익스프레스 옵션을 먼저 확인합니다.'],
  },
  {
    slug: 'bangkok-parent-friendly-itinerary',
    title: '방콕 부모님 동반 여행 일정 팁',
    description: '더운 날씨와 교통 체증을 고려해 방콕 효도 여행 일정을 설계하는 방법입니다.',
    destination: '방콕',
    angle: 'filial',
    contentType: 'guide',
    imageIndex: 5,
    publishedAt: '2026-06-06T00:00:00.000Z',
    bullets: ['왕궁과 사원 일정은 오전에 배치합니다.', '마사지와 호텔 휴식 시간을 일정 중간에 넣습니다.', '수상시장과 외곽 투어는 이동 시간을 넉넉히 잡습니다.'],
  },
  {
    slug: 'cebu-water-activity-safety',
    title: '세부 호핑투어와 물놀이 안전 체크',
    description: '세부 호핑투어, 리조트 휴양, 가족 물놀이에서 꼭 확인할 안전 기준입니다.',
    destination: '세부',
    angle: 'activity',
    contentType: 'tip',
    imageIndex: 6,
    publishedAt: '2026-06-07T00:00:00.000Z',
    bullets: ['구명조끼와 현지 가이드 동행 여부를 확인합니다.', '아이 동반이면 이동 배 시간과 화장실 조건을 봅니다.', '우천 또는 파도 상황의 대체 일정이 있는지 확인합니다.'],
  },
  {
    slug: 'fukuoka-onsen-short-trip',
    title: '후쿠오카 온천 포함 짧은 여행 가이드',
    description: '후쿠오카, 유후인, 벳푸를 짧은 일정 안에 무리 없이 묶는 방법입니다.',
    destination: '후쿠오카',
    angle: 'emotional',
    contentType: 'guide',
    imageIndex: 7,
    publishedAt: '2026-06-08T00:00:00.000Z',
    bullets: ['온천 료칸 숙박은 체크인 시간을 기준으로 일정을 줄입니다.', '유후인 당일치기는 기차 예약과 이동 시간을 먼저 봅니다.', '시내 쇼핑은 마지막 날 공항 이동 전후로 배치합니다.'],
  },
];

export const FALLBACK_BLOG_POSTS: PublicFallbackBlogPost[] = FALLBACK_SEEDS.map(buildFallbackPost);

export function getFallbackBlogPosts(filter: { destination?: string | null; angle?: string | null } = {}) {
  const destination = normalizeDestination(filter.destination);
  return FALLBACK_BLOG_POSTS.filter((post) => {
    if (destination && normalizeDestination(post.destination) !== destination) return false;
    if (filter.angle && post.angle_type !== filter.angle) return false;
    return true;
  });
}

export function getFallbackBlogPost(slug: string) {
  return FALLBACK_BLOG_POSTS.find((post) => post.slug === slug) ?? null;
}
