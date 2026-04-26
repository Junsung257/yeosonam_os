const withSerwist = require('@serwist/next').default({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  cacheOnNavigation: true,
  disable: process.env.NODE_ENV !== 'production',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ESLint 는 별도 step 에서 실행. next build 내부 lint 는 .eslintrc.json 플러그인 미설치로 실패하므로 일시 무력화.
  // 운영 CI 에 `npm run lint` 를 별도 step 으로 명시하고 플러그인 설치 후 본 옵션 제거 권장.
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // @resvg/resvg-js 는 .node native binding 포함 → webpack 이 처리 불가.
    //   external 로 빼서 런타임에 require() 처리 (webpack 이 아예 터치 안 함).
    // satori 도 yoga-wasm 번들 포함이라 external 권장.
    serverComponentsExternalPackages: [
      'isomorphic-dompurify',
      '@resvg/resvg-js',
      'satori',
    ],
    // 자주 쓰는 큰 라이브러리에 자동 트리쉐이킹 적용 — dev 첫 컴파일/HMR 속도 개선.
    // 특히 lucide-react는 import 1개당 전체 아이콘 번들이 통째로 들어가는 패턴이라 효과 큼.
    // @supabase/supabase-js는 ESM/CJS 혼합이라 optimizePackageImports와 호환 안 됨(webpack chunk
    // 깨짐) — 제외.
    optimizePackageImports: [
      'lucide-react',
      'date-fns',
      'react-icons',
      'recharts',
    ],
    // RSC와 클라이언트 컴파일을 병렬화 — 첫 컴파일 30s대 → 절반대로 단축 기대.
    // (webpackBuildWorker는 production build 전용이라 dev에서 부작용 — 제외)
    parallelServerCompiles: true,
    parallelServerBuildTraces: true,
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.pexels.com',
      },
      {
        protocol: 'https',
        hostname: 'ixaxnvbmhzjvupissmly.supabase.co',
      },
    ],
  },
  // 상품 상세 라우트 통일 — /packages/[id] 를 단일 진실 소스로
  // /tour/[id] 와 /products/[id] 는 영구 리다이렉트(308)
  // 추가: 정식 도메인은 www.yeosonam.com. non-www 는 SEO 신호 통합을 위해 영구 리다이렉트(308).
  // (Vercel 기본 도메인 alias 는 307 임시 리다이렉트라 PageRank 가 통합되지 않음)
  async redirects() {
    return [
      { source: '/tour/:id', destination: '/packages/:id', permanent: true },
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

module.exports = withSerwist(nextConfig);
