import { type NextRequest, type NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  fetchAllPerformance,
  getGoogleAdsConfigStatus,
  getNaverAdsConfigStatus,
} from '@/lib/search-ads-api';
import type { SearchAdKeyword } from '@/lib/keyword-brain';

export const dynamic = 'force-dynamic';

const handler = async (request: NextRequest): Promise<NextResponse> => {
  try {
    const body = await request.json().catch(() => ({}));
    const keywords = Array.isArray(body.keywords) ? body.keywords : [];

    if (!keywords.length) {
      return apiResponse({
        performance: [],
        providers: {
          naver: getNaverAdsConfigStatus(),
          google: getGoogleAdsConfigStatus(),
        },
      });
    }

    const performance = await fetchAllPerformance(keywords as SearchAdKeyword[]);

    return apiResponse({
      performance,
      providers: {
        naver: getNaverAdsConfigStatus(),
        google: getGoogleAdsConfigStatus(),
      },
    });
  } catch (err) {
    return apiResponse(
      {
        error: sanitizeDbError(err, 'Failed to sync search ad performance'),
      performance: [],
      providers: {
        naver: getNaverAdsConfigStatus(),
        google: getGoogleAdsConfigStatus(),
      },
      },
      { status: 500 },
    );
  }
};

export const POST = withAdminGuard(handler);
