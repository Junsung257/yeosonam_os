import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',                                // 홈
          '/packages',                        // 상품 리스트/상세
          '/blog',                            // 블로그 매거진
          '/destinations',                    // 여행지 허브 (Pillar)
          '/api/rss',                         // 전체 RSS
          '/api/sitemap',
        ],
        disallow: [
          '/api/',                            // 나머지 API 전부
          '/admin/',                          // 어드민
          '/login',
          '/review/',                         // 리뷰 수집 폼 (booking_id 기반 개인 링크)
          '/share/',                          // 개인 공유 링크
        ],
      },
      // 네이버/구글 봇에 명시적 허용 (속도 향상)
      {
        userAgent: ['Googlebot', 'Yeti', 'NaverBot', 'Bingbot'],
        allow: [
          '/',
          '/packages',
          '/blog',
          '/destinations',
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
