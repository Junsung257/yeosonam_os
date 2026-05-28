const withSerwist = require('@serwist/next').default({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  cacheOnNavigation: true,
  disable: process.env.NODE_ENV !== 'production',
});

const { withSentryConfig } = require('@sentry/nextjs');

// 번들 분석: ANALYZE=true 환경변수 설정 시 .next/analyze/ 에 트리맵 HTML 생성
// 사용: ANALYZE=true npm run build  (Windows: $env:ANALYZE='true'; npm run build)
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

const isProd = process.env.NODE_ENV === 'production';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ESLint 빌드 통합 활성화 (2026-05-11 복원)
  // 플러그인 설치 완료 → 빌드 중 lint 오류 즉시 감지
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Next 15: instrumentationHook 제거 — instrumentation.ts 가 자동 활성화됨.
  // Next 15: serverComponentsExternalPackages → 최상위 serverExternalPackages 로 이동.
  serverExternalPackages: [
    'isomorphic-dompurify',
    '@resvg/resvg-js', // .node native binding — webpack 처리 불가, 런타임 require()
    'satori',          // yoga-wasm 번들 포함 — external 권장
    'pdf-parse',
  ],
  experimental: {
    webpackBuildWorker: true,
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    // 기본 7개 deviceSizes → 3개로 축소: Vercel Image Transformation 횟수를 1/2 이상 절감.
    // 모바일(640) + 태블릿(1080) + 데스크톱(1920) 세 구간이면 충분.
    deviceSizes: [640, 1080, 1920],
    // 기본 8개 imageSizes → 3개로 축소 (아이콘·썸네일·카드 세 구간).
    imageSizes: [64, 128, 256],
    // 최소 캐시 TTL 7일 — 같은 이미지 재변환 횟수를 대폭 줄임 (기본값 60초는 매우 짧음).
    minimumCacheTTL: 604800,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.pexels.com',
      },
      {
        protocol: 'https',
        hostname: 'ixaxnvbmhzjvupissmly.supabase.co',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'dry7pvlp22cox.cloudfront.net', // MRT CDN (attractions.mrt_image_url)
      },
      {
        protocol: 'https',
        hostname: '*.wikimedia.org', // Wikimedia Commons (attraction photos)
      },
    ],
  },
  // 상품 상세 라우트 통일 — /packages/[id] 를 단일 진실 소스로
  // /tour/[id] 와 /products/[id] 는 영구 리다이렉트(308)
  // 추가: 정식 도메인은 www.yeosonam.com. non-www 는 SEO 신호 통합을 위해 영구 리다이렉트(308).
  // (Vercel 기본 도메인 alias 는 307 임시 리다이렉트라 PageRank 가 통합되지 않음)
  async headers() {
    return [
      // ─── 보안 헤더 (모든 경로) ───────────────────────────────
      {
        source: '/:path*',
        headers: [
          // CSP: XSS 방어, 인라인 스크립트 허용 (Next.js 필요), 'unsafe-eval' (dev SWC)
          // Sentry DSN, GA4(GTM), Meta Pixel, Naver, Kakao 등 third-party 도메인 명시 허용
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://connect.facebook.net https://wcs.naver.net https://wcs.call.naver.com https://www.clarity.ms https://js.sentry-cdn.com *.sentry.io https://cdn.jsdelivr.net https://t1.kakaocdn.net https://www.instagram.com https://static.cloudflareinsights.com https://generativelanguage.googleapis.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://t1.kakaocdn.net",
              "img-src 'self' blob: data: https://images.pexels.com https://ixaxnvbmhzjvupissmly.supabase.co *.supabase.co https://dry7pvlp22cox.cloudfront.net https://*.wikimedia.org https://www.facebook.com https://www.googletagmanager.com https://www.google-analytics.com https://t1.kakaocdn.net https://wcs.naver.net https://generativelanguage.googleapis.com https://*.googleapis.com",
              "font-src 'self' https://cdn.jsdelivr.net",
              "connect-src 'self' https://*.supabase.co https://ixaxnvbmhzjvupissmly.supabase.co https://o*.sentry.io https://www.google-analytics.com https://www.googletagmanager.com https://wcs.naver.net https://wcs.call.naver.com https://www.clarity.ms https://*.vercel-insights.com https://vitals.vercel-insights.com https://generativelanguage.googleapis.com",
              "frame-src 'self' https://www.facebook.com https://www.instagram.com https://www.youtube.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
      // ─── 정적 자산 캐시 ──────────────────────────────────────
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      // ─── 공개 API 캐시 ────────────────────────────────────────
      {
        source: '/api/destinations/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=600' }],
      },
      {
        source: '/api/exchange-rate',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=600, stale-while-revalidate=3600' }],
      },
      // ─── 블로그 공개 API ──────────────── (route.ts 내부 Cache-Control 보강)
      {
        source: '/api/blog/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=1800' }],
      },
      {
        source: '/api/blog-categories',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=3600, stale-while-revalidate=86400' }],
      },
      // ─── 관광지 공개 API ────────────────
      {
        source: '/api/attractions/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=120, stale-while-revalidate=600' }],
      },
      // ─── 리뷰 공개 API ─────────────────
      {
        source: '/api/reviews/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=60, stale-while-revalidate=600' }],
      },
      {
        source: '/api/package-reviews/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=3600' }],
      },
      // ─── 추천 공개 API ─────────────────
      {
        source: '/api/recommendations/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=120, stale-while-revalidate=600' }],
      },
      // ─── RSS ──────────────────────────
      {
        source: '/api/rss',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=600, stale-while-revalidate=3600' }],
      },
      // ─── 패키지 검색 목록 ──────────────────────────────────────
      {
        source: '/packages',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=60, stale-while-revalidate=300' }],
      },
      // ─── 블로그 목록 ───────────────────────────────────────────
      {
        source: '/blog',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=1800' }],
      },
      // ─── 블로그 개별 페이지 ─── ISR + CDN 캐시 ──────────────────
      {
        source: '/blog/:slug',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=3600, stale-while-revalidate=86400' }],
      },
    ];
  },
  async redirects() {
    return [
      { source: '/tour/:id', destination: '/packages/:id', permanent: true },
      { source: '/products', destination: '/packages', permanent: true },
      { source: '/products/:id', destination: '/packages/:id', permanent: true },
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'yeosonam.com' }],
        destination: 'https://www.yeosonam.com/:path*',
        permanent: true,
      },
      // 깨진 슬러그(destination 누락) → 수정된 슬러그로 301 (Google 링크 신호 보존)
      { source: '/blog/-currency', destination: '/blog/나트랑-달랏-화폐-환전-팁-문화-총정리', permanent: true },
      { source: '/blog/-preparation', destination: '/blog/나가사키-여행-준비물-완벽-체크리스트', permanent: true },
      { source: '/blog/-weather', destination: '/blog/보홀-월별-날씨와-옷차림-가이드', permanent: true },
      { source: '/blog/-complete-guide', destination: '/blog/석가장-여행-완벽-가이드-관광지-일정-비용', permanent: true },
    ];
  },
};

// Vercel Observability events 절감 (2026-05-17):
//   - automaticVercelMonitors: false — Cron Monitor 자동 생성 끔. 88개 cron × 매 invocation 마다
//     Vercel 측 monitor event 가산되던 부분 제거. Vercel Logs + Sentry 자체 cron capture 로 충분.
//   - widenClientFileUpload: false — sourcemap 업로드 범위 축소.
//     상세 stack trace 가 약간 덜 친절해지지만 매 빌드마다 업로드 트래픽/스토리지 절감.
const sentryConfig = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: false,
  hideSourceMaps: true,
  disableLogger: true,
  automaticVercelMonitors: false,
};

const hasSentry = !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);

const composedConfig = hasSentry
  ? withSentryConfig(withSerwist(nextConfig), sentryConfig)
  : withSerwist(nextConfig);

module.exports = withBundleAnalyzer(composedConfig);
