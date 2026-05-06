const withSerwist = require('@serwist/next').default({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  cacheOnNavigation: true,
  disable: process.env.NODE_ENV !== 'production',
});

const { withSentryConfig } = require('@sentry/nextjs');

const isProd = process.env.NODE_ENV === 'production';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ESLint 는 별도 step 에서 실행. next build 내부 lint 는 .eslintrc.json 플러그인 미설치로 실패하므로 일시 무력화.
  // 운영 CI 에 `npm run lint` 를 별도 step 으로 명시하고 플러그인 설치 후 본 옵션 제거 권장.
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    instrumentationHook: true,
    // @resvg/resvg-js 는 .node native binding 포함 → webpack 이 처리 불가.
    //   external 로 빼서 런타임에 require() 처리 (webpack 이 아예 터치 안 함).
    // satori 도 yoga-wasm 번들 포함이라 external 권장.
    serverComponentsExternalPackages: [
      'isomorphic-dompurify',
      '@resvg/resvg-js',
      'satori',
      // kordoc: ESM 전용 패키지 — 동적 import() 로 로드, external 로 webpack 번들 제외
      'kordoc',
      'pdf-parse',
    ],
    // lucide-react: import 1개당 전체 아이콘 번들이 통째로 들어가는 패턴이라 barrel 최적화 효과 큼.
    // 주의: 실제 설치된 패키지만 등록할 것 — 미설치 패키지 등록 시 webpack factory undefined 에러 발생.
    optimizePackageImports: [
      'lucide-react',
    ],
    // webpackBuildWorker 는 개발에 넣지 않음 — Windows 등에서 pack 캐시 복구 실패·
    // options.factory undefined(손상 청크)가 나기 쉬움. 프로덕션 빌드에서만 켠다.
    ...(isProd ? { webpackBuildWorker: true } : {}),
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
    ];
  },
};

const sentryConfig = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
  automaticVercelMonitors: true,
};

const hasSentry = !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);

module.exports = hasSentry
  ? withSentryConfig(withSerwist(nextConfig), sentryConfig)
  : withSerwist(nextConfig);
