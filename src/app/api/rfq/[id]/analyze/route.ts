import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
} from '@/lib/supabase';
import { getGroupRfq, getRfqProposals, updateGroupRfq, updateRfqProposal } from '@/lib/db/rfq-server';
import { generateFactBombingReport } from '@/lib/rfq-ai';
import { sensitiveBackendUnavailable } from '@/lib/sensitive-api-fail-closed';
import { requireAdminRequest } from '@/lib/admin-guard';

// GET: 기 분석된 TOP 3 제안서 + 순위 반환 (캐시된 결과)
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  const params = await props.params;
  const { id: rfqId } = params;

  if (!isSupabaseConfigured) {
    return sensitiveBackendUnavailable('rfq_analyze');
  }

  try {
    const proposals = await getRfqProposals(rfqId);
    const ranked = proposals
      .filter(p => p.rank != null)
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    return NextResponse.json({ ranked, count: ranked.length }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('분석 결과 조회 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '분석 결과 조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  const params = await props.params;
  const { id: rfqId } = params;

  if (!isSupabaseConfigured) {
    return sensitiveBackendUnavailable('rfq_analyze');
  }

  try {
    const rfq = await getGroupRfq(rfqId);
    if (!rfq) {
      return NextResponse.json({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }

    const proposals = await getRfqProposals(rfqId);
    const submittedProposals = proposals.filter(
      p => p.status === 'submitted' || p.status === 'approved'
    );

    if (submittedProposals.length === 0) {
      return NextResponse.json(
        { error: '분석할 제안서가 없습니다.' },
        { status: 400 }
      );
    }

    const factResult = await generateFactBombingReport(rfq, submittedProposals);

    // 각 제안서의 순위 업데이트
    for (let i = 0; i < factResult.ranked.length; i++) {
      const rankedProposal = factResult.ranked[i];
      if (rankedProposal?.id) {
        await updateRfqProposal(rankedProposal.id, { rank: i + 1 });
      }
    }

    // RFQ 상태 전환
    if (rfq.status !== 'awaiting_selection') {
      await updateGroupRfq(rfqId, { status: 'awaiting_selection' });
    }

    return NextResponse.json({
      ranked: factResult.ranked,
      report_html: factResult.report_html,
      key_insights: factResult.key_insights,
    });
  } catch (error) {
    console.error('팩트 폭격 분석 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '분석에 실패했습니다.' },
      { status: 500 }
    );
  }
}
