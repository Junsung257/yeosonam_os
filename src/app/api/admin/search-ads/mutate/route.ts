import { type NextRequest, type NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { pauseKeyword, updateBid } from '@/lib/search-ads-api';
import type { SearchAdKeyword } from '@/lib/keyword-brain';

export const dynamic = 'force-dynamic';

type MutateBody = {
  action?: 'update_bid' | 'pause';
  keyword?: SearchAdKeyword;
  bid?: number;
};

const handler = async (request: NextRequest): Promise<NextResponse> => {
  try {
    const body = (await request.json().catch(() => ({}))) as MutateBody;
    if (!body.keyword || !body.action) {
      return apiResponse({ ok: false, error: 'keyword/action required' }, { status: 400 });
    }

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
