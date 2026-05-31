import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import {
  fetchAllPerformance,
  getGoogleAdsConfigStatus,
  getNaverAdsConfigStatus,
} from '@/lib/search-ads-api';
import type { SearchAdKeyword } from '@/lib/keyword-brain';

export const dynamic = 'force-dynamic';

const handler = async (request: NextRequest): Promise<NextResponse> => {
  const body = await request.json().catch(() => ({}));
  const keywords = Array.isArray(body.keywords) ? body.keywords : [];

  if (!keywords.length) {
    return NextResponse.json({
      performance: [],
      providers: {
        naver: getNaverAdsConfigStatus(),
        google: getGoogleAdsConfigStatus(),
      },
    });
  }

  const performance = await fetchAllPerformance(keywords as SearchAdKeyword[]);

  return NextResponse.json({
    performance,
    providers: {
      naver: getNaverAdsConfigStatus(),
      google: getGoogleAdsConfigStatus(),
    },
  });
};

export const POST = withAdminGuard(handler);
