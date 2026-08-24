import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import PartytownInit from '@/components/PartytownInit';
import AffiliateAttributionBanner from '@/components/customer/AffiliateAttributionBanner';
import LayoutClientWidgets from '@/components/LayoutClientWidgets';
import { serializeJsonLdForScript } from '@/lib/json-ld';
import { getPublicAnalyticsConfig, isProductionAnalyticsRuntime } from '@/lib/analytics/config';
import GoogleTagManagerNoScript from '@/components/analytics/GoogleTagManagerNoScript';
import {
  buildRootMetadata,
  configuredSiteUrl,
  isApprovedProductionEnvironment,
  normalizeHostname,
  safeHttpOrigin,
} from '@/lib/preview-metadata';

const ENABLE_SPEED_INSIGHTS = process.env.VERCEL === '1';
const SITE_NAME = '여소남';
export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const requestHost = requestHeaders.get('x-forwarded-host')?.split(',')[0]?.trim()
    || requestHeaders.get('host');
  const siteUrl = configuredSiteUrl();
  return buildRootMetadata({
    isApprovedProduction: isApprovedProductionEnvironment({
      vercelEnv: process.env.VERCEL_ENV,
      siteUrl,
      requestHost,
    }),
    siteUrl,
    googleVerification:
      process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
      || process.env.GOOGLE_SITE_VERIFICATION,
  });
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#2563eb' },
    { media: '(prefers-color-scheme: dark)', color: '#1e3a8a' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const requestHost = requestHeaders.get('x-forwarded-host')?.split(',')[0]?.trim()
    || requestHeaders.get('host');
  const siteUrl = configuredSiteUrl();
  const isApprovedProduction = isApprovedProductionEnvironment({
    vercelEnv: process.env.VERCEL_ENV,
    siteUrl,
    requestHost,
  });
  const canonicalUrl = safeHttpOrigin(siteUrl);
  const supabaseOrigin = safeHttpOrigin(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  );
  const analyticsConfig = getPublicAnalyticsConfig();
  let expectedHostname = 'www.yeosonam.com';
  try {
    expectedHostname = new URL(analyticsConfig.siteUrl).hostname;
  } catch {
    // Invalid base URLs leave analytics disabled by the shared runtime guard.
  }
  const analytics = {
    containerId: analyticsConfig.gtmContainerId,
    measurementId: analyticsConfig.ga4MeasurementId,
    runtimeEnabled: isProductionAnalyticsRuntime(analyticsConfig, {
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
      hostname: normalizeHostname(requestHost) || '__unknown__',
    }),
    expectedHostname,
  };
  const storedConsent = cookieStore.get('ys_consent_v2')?.value ?? '';
  const noscriptEnabled = analytics.runtimeEnabled
    && (storedConsent.includes('a') || storedConsent.includes('m'));
  return (
    <html lang="ko">
      <head>
        {isApprovedProduction ? (
          <>
            <meta name="facebook-domain-verification" content="6b5xtc0m174vrt9fz1gtlmj2uaab0t" />
            <link rel="alternate" type="application/rss+xml" title="여소남 블로그 RSS" href="/api/rss" />
          </>
        ) : null}
        <link rel="preconnect" href="https://images.pexels.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://images.pexels.com" />
        {supabaseOrigin ? (
          <>
            <link rel="preconnect" href={supabaseOrigin} />
            <link rel="dns-prefetch" href={supabaseOrigin} />
          </>
        ) : null}
        {isApprovedProduction && canonicalUrl ? (
          <>
            <script
              suppressHydrationWarning
              type="application/ld+json"
              dangerouslySetInnerHTML={{
                __html: serializeJsonLdForScript({
                  '@context': 'https://schema.org',
                  '@type': 'Organization',
                  name: SITE_NAME,
                  url: canonicalUrl,
                  logo: `${canonicalUrl}/logo.png`,
                  description: '부산 출발 패키지·크루즈·골프 전문 여행사',
                  address: { '@type': 'PostalAddress', addressCountry: 'KR' },
                }),
              }}
            />
            <script
              suppressHydrationWarning
              type="application/ld+json"
              dangerouslySetInnerHTML={{
                __html: serializeJsonLdForScript({
                  '@context': 'https://schema.org',
                  '@type': 'WebSite',
                  name: SITE_NAME,
                  url: canonicalUrl,
                  potentialAction: {
                    '@type': 'SearchAction',
                    target: {
                      '@type': 'EntryPoint',
                      urlTemplate: `${canonicalUrl}/packages?q={search_term_string}`,
                    },
                    'query-input': 'required name=search_term_string',
                  },
                }),
              }}
            />
          </>
        ) : null}
      </head>
      <body className="bg-gray-50 antialiased">
        <GoogleTagManagerNoScript
          containerId={analytics.containerId}
          enabled={noscriptEnabled}
        />
        <PartytownInit />
        <AffiliateAttributionBanner />
        {children}
        <LayoutClientWidgets analytics={analytics} />
        {ENABLE_SPEED_INSIGHTS ? <SpeedInsights /> : null}
      </body>
    </html>
  );
}
