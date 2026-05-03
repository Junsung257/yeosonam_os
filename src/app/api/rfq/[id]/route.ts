import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getGroupRfq,
  updateGroupRfq,
} from '@/lib/supabase';

const TIER_DELAY_MS = parseInt(process.env.RFQ_TIER_DELAY_MINUTES ?? '10') * 60 * 1000;

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  try {
    const rfq = await getGroupRfq(id);
    if (!rfq) {
      return NextResponse.json({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ rfq });
  } catch (error) {
    console.error('RFQ 조회 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'RFQ 조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { action, ...rest } = body;

    if (action === 'publish') {
      const now = Date.now();
      const patch = {
        status: 'published' as const,
        published_at: new Date(now).toISOString(),
        gold_unlock_at: new Date(now).toISOString(),
        silver_unlock_at: new Date(now + TIER_DELAY_MS).toISOString(),
        bronze_unlock_at: new Date(now + 2 * TIER_DELAY_MS).toISOString(),
        bid_deadline: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      };
      const rfq = await updateGroupRfq(id, patch);
      if (!rfq) {
        return NextResponse.json({ error: 'RFQ 게시에 실패했습니다.' }, { status: 500 });
      }
      return NextResponse.json({ rfq });
    }

    if (action === 'transition') {
      const { status } = rest;
      if (!status) {
        return NextResponse.json({ error: 'status가 필요합니다.' }, { status: 400 });
      }
      const rfq = await updateGroupRfq(id, { status });
      if (!rfq) {
        return NextResponse.json({ error: 'RFQ 상태 변경에 실패했습니다.' }, { status: 500 });
      }
      return NextResponse.json({ rfq });
    }

    // 일반 업데이트
    const rfq = await updateGroupRfq(id, rest);
    if (!rfq) {
      return NextResponse.json({ error: 'RFQ 업데이트에 실패했습니다.' }, { status: 500 });
    }
    return NextResponse.json({ rfq });
  } catch (error) {
    console.error('RFQ 업데이트 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'RFQ 업데이트에 실패했습니다.' },
      { status: 500 }
    );
  }
}
