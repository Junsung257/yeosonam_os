const withSerwist = require('@serwist/next').default({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  cacheOnNavigation: true,
  disable: process.env.NODE_ENV !== 'production',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['isomorphic-dompurify'],
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
  async redirects() {
    return [
      { source: '/tour/:id', destination: '/packages/:id', permanent: true },
      { source: '/products/:id', destination: '/packages/:id', permanent: true },
    ];
  },
};

module.exports = withSerwist(nextConfig);
