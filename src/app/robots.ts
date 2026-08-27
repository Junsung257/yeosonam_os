import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import {
  configuredSiteUrl,
  isApprovedProductionEnvironment,
  safeHttpOrigin,
} from '@/lib/preview-metadata';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers();
  const requestHost = requestHeaders.get('x-forwarded-host')?.split(',')[0]?.trim()
    || requestHeaders.get('host');
  const siteUrl = configuredSiteUrl();
  const isApprovedProduction = isApprovedProductionEnvironment({
    vercelEnv: process.env.VERCEL_ENV,
    siteUrl,
    requestHost,
  });

  if (!isApprovedProduction) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
    };
  }

  const canonicalUrl = safeHttpOrigin(siteUrl) ?? 'https://www.yeosonam.com';
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${canonicalUrl}/sitemap.xml`,
  };
}
