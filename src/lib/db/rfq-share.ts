/**
 * RFQ 공유 — 견적 요청서를 일행에게 공유
 *
 * share_token은 group_rfqs 테이블에 UUID로 저장됨.
 * 공유 페이지에서는 견적 상세 + 반응(좋아요/투표) + 링크 복사 기능 제공.
 */

import { getSupabase } from '../supabase';

export interface RfqShareReaction {
  id: string;
  rfq_id: string;
  visitor_token: string;
  reaction_type: 'like' | 'curious' | 'vote_a' | 'vote_b' | 'vote_c';
  comment?: string;
  created_at: string;
}

/** 공유용 RFQ 상세 (민감 정보 제외) */
export interface SharedRfqData {
  id: string;
  rfq_code: string;
  customer_name: string;
  destination: string;
  departure_date_from?: string;
  departure_date_to?: string;
  duration_nights?: number;
  adult_count: number;
  child_count: number;
  hotel_grade?: string;
  custom_requirements?: { group_type?: string; special_notes?: string };
  proposal_a?: { id: string; title: string; summary: string; price: number; ai_score?: number; tenant_name?: string };
  proposal_b?: { id: string; title: string; summary: string; price: number; ai_score?: number; tenant_name?: string };
  proposal_c?: { id: string; title: string; summary: string; price: number; ai_score?: number; tenant_name?: string };
  selected_proposal_id?: string;
  status: string;
  created_at: string;
}

/**
 * share_token으로 RFQ 조회 (공유용, 민감 정보 제외)
 */
export async function getSharedRfq(token: string): Promise<SharedRfqData | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const { data: rawData } = await sb
    .from('group_rfqs')
    .select(`
      id, rfq_code, customer_name, destination,
      departure_date_from, departure_date_to, duration_nights,
      adult_count, child_count, hotel_grade, custom_requirements,
      status, created_at,
      selected_proposal_id
    `)
    .eq('share_token', token)
    .single();

  if (!rawData) return null;

  const d = rawData as unknown as { id: string };

  const { data: proposals } = await sb
    .from('rfq_proposals')
    .select('id, proposal_title, itinerary_summary, total_selling_price, ai_review, rank, status, tenants!inner(name)')
    .eq('rfq_id', d.id)
    .in('status', ['submitted', 'approved', 'selected'])
    .order('rank', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(3);

  const result: Record<string, unknown> = { ...d };

  if (proposals) {
    const labels = ['proposal_a', 'proposal_b', 'proposal_c'];
    const resultAny = result;
    proposals.forEach((p, i) => {
      if (i < 3) {
        const pp = p as unknown as {
          id: string;
          proposal_title: string | null;
          itinerary_summary: string | null;
          total_selling_price: number;
          ai_review?: { score?: number };
          tenants?: { name: string };
        };
        const score = pp.ai_review?.score ?? null;
        const tenantName = pp.tenants?.name ?? null;
        resultAny[labels[i]] = {
          id: pp.id,
          title: pp.proposal_title ?? '맞춤 제안',
          summary: pp.itinerary_summary ?? '일정 요약을 준비 중입니다.',
          price: pp.total_selling_price,
          ai_score: score,
          tenant_name: tenantName,
        };
      }
    });
  }

  return result as unknown as SharedRfqData;
}

/**
 * 반응 추가
 */
export async function addRfqReaction(
  rfqId: string,
  visitorToken: string,
  reactionType: RfqShareReaction['reaction_type'],
  comment?: string,
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;

  const { error } = await (sb.from('rfq_share_reactions') as unknown as { upsert: (rows: unknown, opts?: unknown) => Promise<{ error: unknown }> })
    .upsert(
      { rfq_id: rfqId, visitor_token: visitorToken, reaction_type: reactionType, comment },
      { onConflict: 'rfq_id, visitor_token, reaction_type' },
    );

  if (error) {
    console.error('반응 추가 실패:', error);
    return false;
  }
  return true;
}

/**
 * RFQ의 반응 현황 조회
 */
export async function getRfqReactions(rfqId: string): Promise<RfqShareReaction[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const { data } = await sb
    .from('rfq_share_reactions')
    .select('*')
    .eq('rfq_id', rfqId);

  return (data ?? []) as RfqShareReaction[];
}
