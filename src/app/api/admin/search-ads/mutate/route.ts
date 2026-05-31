import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { pauseKeyword, updateBid } from '@/lib/search-ads-api';
import type { SearchAdKeyword } from '@/lib/keyword-brain';

export const dynamic = 'force-dynamic';

type MutateBody = {
  action?: 'update_bid' | 'pause';
  keyword?: SearchAdKeyword;
  bid?: number;
};

const handler = async (request: NextRequest): Promise<NextResponse> => {
  const body = (await request.json().catch(() => ({}))) as MutateBody;
  if (!body.keyword || !body.action) {
    return NextResponse.json({ ok: false, error: 'keyword/action required' }, { status: 400 });
  }

  let ok = false;
  if (body.action === 'update_bid') {
    if (!Number.isFinite(body.bid) || Number(body.bid) <= 0) {
      return NextResponse.json({ ok: false, error: 'valid bid required' }, { status: 400 });
    }
    ok = await updateBid(body.keyword, Number(body.bid));
  } else if (body.action === 'pause') {
    ok = await pauseKeyword(body.keyword);
  }

  return NextResponse.json({ ok });
};

export const POST = withAdminGuard(handler);
