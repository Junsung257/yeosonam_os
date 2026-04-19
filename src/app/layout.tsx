import type { Metadata, Viewport } from 'next';
import './globals.css';
import MetaPixel from '@/components/MetaPixel';
import JarvisFloatingWidget from '@/components/JarvisFloatingWidget';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: '여소남 | 단체·패키지 여행 전문 플랫폼',
    template: '%s | 여소남',
  },
  description:
    '여소남은 단체여행·패키지여행 전문 AI 중개 플랫폼입니다. 랜드사 직거래 없이 안심하고 비교·예약하세요. 숨은 비용 없는 투명한 여행.',
  keywords: [
    '단체여행', '패키지여행', '랜드사', '여행사', '해외여행',
    '단체해외여행', '허니문', '효도여행', '여행견적', '여행비교',
    '발리여행', '태국여행', '유럽여행', '크루즈',
  ],
  authors: [{ name: '여소남', url: BASE_URL }],
  creator: '여소남',
  publisher: '여소남',
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: BASE_URL,
    siteName: '여소남',
    title: '여소남 | 단체·패키지 여행 전문 플랫폼',
    description: '랜드사 직거래 없는 안심 여행. AI 비교로 숨은 비용 제로.',
    images: [
      {
        url: `${BASE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: '여소남 — 단체·패키지 여행 플랫폼',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '여소남 | 단체·패키지 여행',
    description: '랜드사 직거래 없는 안심 여행. AI 비교로 숨은 비용 제로.',
    images: [`${BASE_URL}/og-image.png`],
  },
  alternates: {
    canonical: BASE_URL,
    languages: { 'ko-KR': BASE_URL },
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || '',
    other: {
      'naver-site-verification': 'af1da2c30b83023aa5c6f290ba2fc2460ef25edf',
    },
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '여소남 관리',
  },
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#001f3f' },
    { media: '(prefers-color-scheme: dark)', color: '#001f3f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="alternate" type="application/rss+xml" title="여소남 블로그 RSS" href="/api/rss" />
        <link rel="preconnect" href="https://images.pexels.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://images.pexels.com" />
        <link rel="preconnect" href="https://ixaxnvbmhzjvupissmly.supabase.co" />
        <link rel="dns-prefetch" href="https://ixaxnvbmhzjvupissmly.supabase.co" />
        {/* 사이트 전역 JSON-LD: TravelAgency */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'TravelAgency',
              name: '여소남',
              url: BASE_URL,
              logo: `${BASE_URL}/logo.png`,
              description: '단체·패키지 여행 전문 AI 중개 플랫폼',
              address: { '@type': 'PostalAddress', addressCountry: 'KR' },
              sameAs: [
                'https://blog.naver.com/yesonam',
                'https://www.instagram.com/yesonam',
              ],
            }),
          }}
        />
      </head>
      <body className="bg-gray-50 antialiased">
        <MetaPixel />
        {children}
        <JarvisFloatingWidget />
      </body>
    </html>
  );
}
