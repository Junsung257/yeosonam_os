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
    ignoreDuringBuilds: false,
  },
  // Next 15: instrumentationHook 제거 — instrumentation.ts 가 자동 활성화됨.
  // Next 15: serverComponentsExternalPackages → 최상위 serverExternalPackages 로 이동.
  serverExternalPackages: [
    'isomorphic-dompurify',
    '@resvg/resvg-js', // .node native binding — webpack 처리 불가, 런타임 require()
    'satori',          // yoga-wasm 번들 포함 — external 권장
    'kordoc',          // ESM 전용 패키지 — 동적 import() 로 로드, webpack 번들 제외
    'pdf-parse',
  ],
  experimental: {
    // lucide-react: import 1개당 전체 아이콘 번들이 통째로 들어가는 패턴이라 barrel 최적화 효과 큼.
    // 주의: 실제 설치된 패키지만 등록할 것 — 미설치 패키지 등록 시 webpack factory undefined 에러 발생.
    optimizePackageImports: [
      'lucide-react',
    ],
    // Windows 환경에서 prod 빌드 중 manifest 누락(ENOENT) 재현이 있어 당분간 비활성화.
    // 안정화 후 CI/Linux에서만 조건부 재활성화 검토.
    webpackBuildWorker: false,
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
    ],
  },
  // 상품 상세 라우트 통일 — /packages/[id] 를 단일 진실 소스로
  // /tour/[id] 와 /products/[id] 는 영구 리다이렉트(308)
  // 추가: 정식 도메인은 www.yeosonam.com. non-www 는 SEO 신호 통합을 위해 영구 리다이렉트(308).
  // (Vercel 기본 도메인 alias 는 307 임시 리다이렉트라 PageRank 가 통합되지 않음)
  async headers() {
    return [
      {
        // 정적 자산 — 1년 불변 캐시 (Next.js 빌드 해시로 bust)
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // 공개 읽기 전용 API — Vercel Edge CDN 5분 캐시, stale-while-revalidate 10분
        source: '/api/destinations/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=600' }],
      },
      {
        source: '/api/exchange-rate',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=600, stale-while-revalidate=3600' }],
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
