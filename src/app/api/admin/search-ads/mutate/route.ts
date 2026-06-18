import { type NextRequest, type NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  getGoogleAdsConfigStatus,
  getNaverAdsConfigStatus,
  isGoogleAdsMutableKeywordId,
  isNaverAdsMutableKeywordId,
  pauseKeyword,
  updateBid,
} from '@/lib/search-ads-api';
import type { SearchAdKeyword } from '@/lib/keyword-brain';

export const dynamic = 'force-dynamic';

type MutateBody = {
  action?: 'update_bid' | 'pause';
  keyword?: SearchAdKeyword;
  bid?: number;
};

function mutationGuard(keyword: SearchAdKeyword): NextResponse | null {
  if (keyword.platform === 'naver') {
    if (!isNaverAdsMutableKeywordId(keyword.id)) {
      return apiResponse(
        { ok: false, blocked: true, reason: 'invalid_external_keyword_id', error: 'real Naver keyword id required' },
        { status: 400 },
      );
    }

    const status = getNaverAdsConfigStatus();
    if (!status.configured) {
      return apiResponse(
        {
          ok: false,
          blocked: true,
          reason: 'naver_ads_unconfigured',
          missing: [
            ...(!status.apiKey ? ['NAVER_ADS_API_KEY'] : []),
            ...(!status.secretKey ? ['NAVER_ADS_SECRET_KEY'] : []),
            ...(!status.customerId ? ['NAVER_ADS_CUSTOMER_ID'] : []),
          ],
          error: 'Naver Ads account is not configured.',
        },
        { status: 503 },
      );
    }
    return null;
  }

  if (keyword.platform === 'google') {
    if (!isGoogleAdsMutableKeywordId(keyword.id)) {
      return apiResponse(
        { ok: false, blocked: true, reason: 'invalid_external_keyword_id', error: 'real Google Ads resource name required' },
        { status: 400 },
      );
    }

    const status = getGoogleAdsConfigStatus();
    if (!status.configured) {
      return apiResponse(
        {
          ok: false,
          blocked: true,
          reason: 'google_ads_unconfigured',
          missing: [
            ...(!status.developerToken ? ['GOOGLE_ADS_DEVELOPER_TOKEN'] : []),
            ...(!status.customerId ? ['GOOGLE_ADS_CUSTOMER_ID'] : []),
          ],
          error: 'Google Ads account is not configured.',
        },
        { status: 503 },
      );
    }
  }

  return null;
}

const handler = async (request: NextRequest): Promise<NextResponse> => {
  try {
    const body = (await request.json().catch(() => ({}))) as MutateBody;
    if (!body.keyword || !body.action) {
      return apiResponse({ ok: false, error: 'keyword/action required' }, { status: 400 });
    }

    const blocked = mutationGuard(body.keyword);
    if (blocked) return blocked;

    let ok = false;
    if (body.action === 'update_bid') {
      if (!Number.isFinite(body.bid) || Number(body.bid) <= 0) {
        return apiResponse({ ok: false, error: 'valid bid required' }, { status: 400 });
      }
      ok = await updateBid(body.keyword, Number(body.bid));
    } else if (body.action === 'pause') {
      ok = await pauseKeyword(body.keyword);
    }

    return apiResponse({ ok });
  } catch (err) {
    return apiResponse(
      { ok: false, error: sanitizeDbError(err, 'Failed to mutate search ad keyword') },
      { status: 500 },
    );
  }
};

export const POST = withAdminGuard(handler);
