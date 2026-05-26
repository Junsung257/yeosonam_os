import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin/',
        '/api/',
        '/m/',
        '/login',
        '/register',
        '/legal/',
        '/tenant/',
        '/_next/',
      ],
      crawlDelay: 10,
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
