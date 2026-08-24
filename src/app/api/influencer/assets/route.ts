import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { authInfluencer } from '@/lib/affiliate/jwt-or-pin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getPublicCatalogDetail, listPublicCatalog } from '@/lib/public-catalog';

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function publicMarketingCopies(value: unknown): Array<{ type?: string; title?: string; body?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map(item => ({
      type: typeof item.type === 'string' ? item.type : undefined,
      title: typeof item.title === 'string' ? item.title : undefined,
      body: typeof item.body === 'string' ? item.body : undefined,
    }))
    .filter(item => Boolean(item.title || item.body));
}

// GET: 마케팅 소재 — JWT 쿠키 또는 PIN 헤더(x-influencer-pin)
export async function GET(req: NextRequest) {
  try {
    const referral_code = req.nextUrl.searchParams.get('code');
    const packageId = req.nextUrl.searchParams.get('package_id');
    if (!referral_code) return apiResponse({ error: '코드 필요' }, { status: 400 });

    const auth = await authInfluencer(req, referral_code);
    if (!auth.ok) {
      return apiResponse({ error: auth.error }, { status: auth.status });
    }

    let cardNewsQuery = supabaseAdmin
      .from('card_news')
      .select('id, title, slides, package_id, status, created_at')
      .in('status', ['CONFIRMED', 'LAUNCHED'])
      .order('created_at', { ascending: false })
      .limit(50);

    if (packageId) {
      cardNewsQuery = cardNewsQuery.eq('package_id', packageId);
    }

    const { data: cardNews } = await cardNewsQuery;

    const catalogItems = await listPublicCatalog(supabaseAdmin, {
      limit: 50,
      ...(packageId ? { ids: [packageId] } : {}),
    });
    const publicPackages = (await Promise.all(catalogItems.map(async (item) => {
      const detail = await getPublicCatalogDetail(supabaseAdmin, item.id);
      return detail ? { item, package: detail.package } : null;
    }))).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const eligiblePackageIds = new Set(publicPackages.map(({ item }) => item.id));

    const assets = {
      card_news: (cardNews || []).filter((cn) => (
        typeof cn.package_id === 'string' && eligiblePackageIds.has(cn.package_id)
      )).map(cn => ({
        id: cn.id,
        title: cn.title,
        package_id: cn.package_id,
        slide_count: Array.isArray(cn.slides) ? cn.slides.length : 0,
        thumbnail: Array.isArray(cn.slides) && cn.slides.length > 0 ? cn.slides[0]?.image_url : null,
        created_at: cn.created_at,
      })),
      marketing_copies: publicPackages.map(({ item, package: pkg }) => ({
        package_id: item.id,
        title: item.title,
        destination: item.destination,
        duration: item.duration,
        price: item.price,
        copies: publicMarketingCopies(pkg.marketing_copies),
        highlights: stringArray(pkg.product_highlights),
        summary: typeof pkg.product_summary === 'string' ? pkg.product_summary : null,
      })).filter(pkg => pkg.copies.length > 0 || Boolean(pkg.summary)),
    };

    return apiResponse({ assets });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err, 'Server error') }, { status: 500 });
  }
}
