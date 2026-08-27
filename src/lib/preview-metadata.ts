import type { Metadata } from 'next';

export const DEFAULT_SITE_URL = 'https://www.yeosonam.com';
export const APPROVED_PRODUCTION_HOSTNAMES = new Set([
  'yeosonam.com',
  'www.yeosonam.com',
]);

const SITE_NAME = '여소남';
const SITE_TITLE = '여소남 | 부산 출발 패키지·크루즈·골프 전문 여행사';
const SITE_DESCRIPTION =
  '부산 출발 패키지·크루즈·골프 상품을 비교하고, 예약 전 실시간 가격과 조건을 다시 확인하는 여소남입니다.';
export function configuredSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim()
    || process.env.NEXT_PUBLIC_BASE_URL?.trim()
    || DEFAULT_SITE_URL;
}

export function safeHttpOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function normalizeHostname(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    return parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

export function isApprovedProductionEnvironment(input: {
  vercelEnv?: string | null;
  siteUrl?: string | null;
  requestHost?: string | null;
}): boolean {
  if (input.vercelEnv !== 'production') return false;

  const siteOrigin = safeHttpOrigin(input.siteUrl);
  if (!siteOrigin || new URL(siteOrigin).protocol !== 'https:') return false;

  const siteHostname = normalizeHostname(siteOrigin);
  const requestHostname = normalizeHostname(input.requestHost);
  return Boolean(
    siteHostname
      && requestHostname
      && APPROVED_PRODUCTION_HOSTNAMES.has(siteHostname)
      && APPROVED_PRODUCTION_HOSTNAMES.has(requestHostname),
  );
}

export function previewRobots(): NonNullable<Metadata['robots']> {
  return {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
    googleBot: {
      index: false,
      follow: false,
      noarchive: true,
      nosnippet: true,
      'max-snippet': 0,
      'max-image-preview': 'none',
      'max-video-preview': 0,
    },
  };
}

export function buildRootMetadata(input: {
  isApprovedProduction: boolean;
  siteUrl: string;
  googleVerification?: string | null;
}): Metadata {
  const shared: Metadata = {
    title: {
      default: SITE_TITLE,
      template: `%s | ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    keywords: [
      '단체여행',
      '패키지여행',
      '랜드사',
      '여행사',
      '해외여행',
      '단체해외여행',
      '허니문',
      '효도여행',
      '여행견적',
      '여행비교',
      '발리여행',
      '태국여행',
      '유럽여행',
      '크루즈',
    ],
    manifest: '/manifest.json',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: SITE_NAME,
    },
    other: {
      'mobile-web-app-capable': 'yes',
    },
    icons: {
      icon: '/logo.png',
      apple: '/logo.png',
    },
  };

  if (!input.isApprovedProduction) {
    return { ...shared, robots: previewRobots() };
  }

  const baseUrl = safeHttpOrigin(input.siteUrl) ?? DEFAULT_SITE_URL;
  return {
    ...shared,
    metadataBase: new URL(baseUrl),
    authors: [{ name: SITE_NAME, url: baseUrl }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
    },
    openGraph: {
      type: 'website',
      locale: 'ko_KR',
      url: baseUrl,
      siteName: SITE_NAME,
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [{
        url: `${baseUrl}/og-image.png`,
        width: 1200,
        height: 630,
        alt: SITE_TITLE,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [`${baseUrl}/og-image.png`],
    },
    alternates: {
      canonical: baseUrl,
      languages: { 'ko-KR': baseUrl },
    },
    verification: {
      ...(input.googleVerification ? { google: input.googleVerification } : {}),
      other: { 'naver-site-verification': 'af1da2c30b83023aa5c6f290ba2fc2460ef25edf' },
    },
  };
}
