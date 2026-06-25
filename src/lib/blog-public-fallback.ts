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

const FALLBACK_IMAGE_1 = 'https://images.pexels.com/photos/25000725/pexels-photo-25000725.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940';
const FALLBACK_IMAGE_2 = 'https://images.pexels.com/photos/2166559/pexels-photo-2166559.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940';
const FALLBACK_IMAGE_3 = 'https://images.pexels.com/photos/338504/pexels-photo-338504.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940';

const DESTINATION_ALIASES: Record<string, string> = {
  zhangjiajie: '장가계',
  '张家界': '장가계',
};

function normalizeDestination(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return DESTINATION_ALIASES[trimmed.toLowerCase()] ?? DESTINATION_ALIASES[trimmed] ?? trimmed;
}

export const FALLBACK_BLOG_POSTS: PublicFallbackBlogPost[] = [
  {
    id: 'fallback-zhangjiajie-weather',
    slug: 'zhangjiajie-weather',
    seo_title: '장가계 월별 날씨와 옷차림 가이드 2026',
    seo_description:
      '2026년 장가계 여행을 준비하는 분들을 위한 월별 날씨, 옷차림, 준비물, 우천 시 일정 조정 팁을 정리했습니다.',
    og_image_url:
      'https://www.yeosonam.com/api/blog/image?src=https%3A%2F%2Fimages.pexels.com%2Fphotos%2F25000725%2Fpexels-photo-25000725.jpeg%3Fauto%3Dcompress%26cs%3Dtinysrgb%26dpr%3D2%26h%3D650%26w%3D940&w=960',
    blog_html: `
# 장가계 월별 날씨와 옷차림 가이드 2026

장가계는 시내와 산 위의 체감 온도 차이가 크고, 안개와 비가 빠르게 바뀌는 산악 여행지입니다. 아침에는 맑아도 오후에는 전망대가 구름에 가려질 수 있고, 계곡길은 짧게 걸어도 습도가 높게 느껴질 수 있습니다. 이 글은 항공, 호텔, 케이블카, 셔틀 동선까지 함께 고려해야 하는 여행자를 기준으로 월별 옷차림과 준비물을 정리했습니다.

핵심은 단순합니다. 얇은 겹옷, 비 대비, 미끄럼 방지 신발을 기본으로 잡아야 합니다. 따뜻한 계절에도 산 위 전망대는 시내보다 서늘하고, 봄·가을에는 아침과 낮의 옷차림이 달라집니다. 겨울 장가계는 풍경이 극적이지만 길이 젖거나 얼 수 있어 일정을 여유 있게 잡는 편이 안전합니다.

![장가계 산악 전망과 안개 풍경](${FALLBACK_IMAGE_1})

<figcaption>장가계는 전망대 주변 날씨가 빠르게 바뀌므로 얇은 겹옷이 가장 안전한 기본값입니다.</figcaption>

## 장가계 날씨 준비 핵심 요약

처음 장가계를 간다면 옷차림은 세 가지 상황을 기준으로 준비하세요. 걷는 시간, 대기하는 시간, 비가 오는 시간입니다. 셔틀 정류장과 케이블카, 유리다리, 전망대를 오가며 걸을 때는 금방 덥지만, 산 위에서 대기할 때는 바람 때문에 춥게 느껴질 수 있습니다. 좁은 계단과 전망대에서는 큰 우산보다 가벼운 우비나 방수 재킷이 더 실용적입니다.

기본 준비물은 통풍되는 이너, 가벼운 겉옷, 접지력 있는 운동화나 트레킹화, 얇은 우비, 여분 양말, 작은 수건, 휴대폰과 여권을 넣을 방수 파우치입니다. 가족 여행이라면 간식과 멀미약, 대기 시간을 고려한 여유 일정을 추가하세요. 부모님 동반 여행은 날씨가 좋아도 계단과 셔틀 환승, 대기 시간이 체력 부담이 될 수 있으므로 하루 코스를 과하게 압축하지 않는 것이 좋습니다.

출발 직전에는 공식 예보와 해외 안전 정보를 다시 확인하세요. 중국 여행 안전 정보와 서류 준비는 [외교부 해외안전여행](https://www.0404.go.kr/)에서 확인할 수 있습니다.

## 월별 옷차림 가이드

| 시기 | 날씨 경향 | 추천 옷차림 | 일정 팁 |
| --- | --- | --- | --- |
| 3-5월 | 온화하지만 안개와 비가 잦음 | 긴팔, 얇은 재킷, 우비 | 전망대 1곳은 유동 일정으로 남기기 |
| 6-8월 | 덥고 습하며 소나기 가능 | 통풍 옷, 모자, 빠르게 마르는 옷 | 오전 일찍 시작하고 한낮 휴식 |
| 9-11월 | 시야가 비교적 좋고 아침은 선선함 | 얇은 니트, 바람막이, 편한 바지 | 걷기와 전망의 균형이 좋은 시기 |
| 12-2월 | 춥고 길이 젖거나 얼 수 있음 | 두꺼운 겉옷, 장갑, 접지력 좋은 신발 | 케이블카와 보행로 운행 여부 확인 |

봄은 안개 낀 풍경과 온화한 기온이 장점이지만 날씨가 자주 바뀝니다. 전망대가 한 시간 이상 가려졌다가 갑자기 열리는 경우도 있어 아침 하늘만 보고 하루를 판단하지 않는 편이 좋습니다. 여름은 낮 시간이 길고 풍경이 선명하지만 습도와 소나기 대비가 중요합니다. 가을은 시야와 보행 편의가 균형 잡혀 초행자에게 가장 무난합니다. 겨울은 설경이 매력적이지만 보행로와 케이블카 상황을 보수적으로 확인해야 합니다.

## 날씨가 애매할 때 코스 잡는 법

흐리거나 비가 오는 날은 낮은 고도의 코스와 실내 이동 거점을 먼저 배치하고, 높은 전망대는 시야가 열릴 가능성이 있는 시간대로 남겨두는 편이 좋습니다. 가이드나 호텔 직원이 시야가 좋아지고 있다고 말하면 이동 판단을 빠르게 해야 합니다. 산악 날씨는 셔틀을 타고 다음 정류장에 도착하는 사이에도 다시 바뀔 수 있습니다.

하루 일정은 대표 전망대 1곳, 유동적으로 조정 가능한 풍경 코스 1곳, 쉬운 대체 코스 1곳으로 잡으면 안정적입니다. 가장 유명한 전망대가 안개에 가려져도 여행 전체가 망가지는 느낌을 줄일 수 있고, 가족이나 부모님 동반 여행에서도 셔틀 이동을 무리하게 몰지 않을 수 있습니다.

![장가계 숲길과 보행로 여행 준비](${FALLBACK_IMAGE_2})

<figcaption>장가계 보행 코스에서는 격식 있는 옷보다 편한 신발과 비 대비가 더 중요합니다.</figcaption>

## 실제 여행일 준비물 체크리스트

큰 숄더백보다 작은 데이팩 하나를 추천합니다. 물, 얇은 겉옷, 우비, 휴지, 보조배터리, 여권 사본, 간단한 간식을 넣어두면 이동 중 대응이 쉽습니다. 휴대폰과 여권은 갑작스러운 비에 젖지 않도록 방수 파우치에 넣어두세요. 아이와 함께 간다면 젖은 옷 때문에 귀가 이동이 불편해질 수 있으니 여분 상의와 양말을 추가하는 것이 좋습니다.

신발은 특히 중요합니다. 장가계는 새 신발을 시험하기 좋은 여행지가 아닙니다. 계단을 걸어본 적 있는 편한 신발을 고르고, 숲길과 유리다리 주변, 셔틀 탑승 지점의 젖은 바닥에 대비하세요. 사진을 많이 찍는다면 손목 스트랩이나 휴대폰 그립도 도움이 됩니다. 전망대는 사람이 많아 휴대폰을 떨어뜨리면 회수가 어렵습니다.

## 예약 전 확인하면 좋은 기준

장가계 일정은 유명 포토스팟만 보고 짜면 피로도가 높아질 수 있습니다. 만족도가 높은 일정은 대표 전망대, 천천히 걷는 숲길, 고성이나 문화 코스, 충분한 휴식 시간을 함께 배치합니다. 식사와 셔틀 이동, 대기열까지 고려해야 실제 현장에서 무리 없이 움직일 수 있습니다.

패키지 상품을 비교할 때는 케이블카 포함 여부, 셔틀 환승, 선택 관광, 우천 시 대체 코스가 명확한지 확인하세요. 가격이 낮아도 일정이 지나치게 빡빡하거나 이동 설명이 불명확하면 체감 만족도가 떨어질 수 있습니다. “시야가 좋지 않을 때 코스가 어떻게 바뀌나요?”라는 질문 하나만 해도 일정이 여행자 중심으로 설계되었는지 확인할 수 있습니다.

![장가계 여행 준비 체크리스트와 풍경](${FALLBACK_IMAGE_3})

<figcaption>좋은 장가계 일정은 모든 전망대를 하루에 밀어 넣기보다 대체 코스를 함께 준비합니다.</figcaption>

## 자주 하는 실수

첫 번째 실수는 시내 기온만 보고 짐을 싸는 것입니다. 산 위 전망대는 더 서늘하고 바람이 강할 수 있습니다. 두 번째 실수는 우산만 준비하는 것입니다. 사람이 많은 계단과 좁은 길에서는 우산보다 우비가 편합니다. 세 번째 실수는 체력 소모가 큰 코스를 하루에 너무 많이 넣는 것입니다. 장가계는 빠르게 도는 여행지라기보다 날씨를 보며 여유 있게 움직일 때 만족도가 높습니다.

식사 시간도 중요합니다. 관광지가 붐비면 점심이 늦어질 수 있고, 가족 여행은 이때 체력이 급격히 떨어집니다. 식사가 포함되어 있어도 간단한 간식은 챙기세요. 마지막으로 모든 포토스팟이 계획한 시간에 정확히 보일 것이라고 기대하지 않는 편이 좋습니다. 장가계에서는 유연성이 곧 여행 품질입니다.

## FAQ

### 장마철에도 장가계 여행이 가능한가요?

가능합니다. 다만 일정은 유연해야 합니다. 비가 오면 안개와 운해가 멋질 수 있지만 시야가 제한될 수도 있습니다. 우비와 대체 코스를 함께 준비하세요.

### 옷은 몇 겹 정도 준비하면 좋나요?

겨울을 제외하면 통풍되는 이너와 얇은 겉옷 한 벌이면 대부분 대응할 수 있습니다. 겨울에는 두꺼운 외투, 장갑, 접지력 좋은 신발을 추가하세요.

### 운동화만으로도 괜찮나요?

접지력이 있고 이미 길들인 운동화라면 대부분 괜찮습니다. 미끄러운 밑창이나 새 신발은 피하는 편이 좋습니다.

## 최종 추천

2026년 장가계 여행에서 가장 중요한 준비는 무거운 캐리어가 아닙니다. 유연한 일정, 겹쳐 입기 쉬운 옷, 비 대비, 현실적인 보행 계획입니다. 상품을 비교한다면 이동 설명, 우천 시 대체 코스, 충분한 휴식 시간이 있는지를 먼저 보세요. 그 차이가 유명 관광지를 “찍고 오는 여행”과 산악 풍경을 제대로 즐기는 여행을 가릅니다.

관련 여행 준비는 [여소남 여행 매거진](/blog)과 [현재 패키지 상품](/packages)에서 함께 확인할 수 있습니다.
`.trim(),
    angle_type: 'value',
    channel: 'naver_blog',
    published_at: '2026-06-01T00:00:00.000Z',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-24T00:00:00.000Z',
    product_id: null,
    tracking_id: null,
    destination: '장가계',
    content_type: 'guide',
    featured: true,
    featured_order: 1,
    view_count: null,
    landing_enabled: false,
    landing_headline: null,
    landing_subtitle: null,
    travel_packages: null,
  },
];

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
