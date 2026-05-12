/**
 * Group RFQ — AI 단체여행 무인 중개 & 선착순 입찰 엔진
 *
 * supabase.ts god 모듈에서 분리 (2026-04-27).
 * 호출자는 기존 그대로 `@/lib/supabase` 에서 import 가능 (re-export 유지).
 */

import { getSupabase } from '../supabase';

// ─── 타입 ────────────────────────────────────────────────────

export interface GroupRfq {
  id:                   string;
  rfq_code:             string;
  customer_id?:         string;
  customer_name:        string;
  customer_phone?:      string;
  destination:          string;
  departure_date_from?: string;
  departure_date_to?:   string;
  duration_nights?:     number;
  adult_count:          number;
  child_count:          number;
  budget_per_person?:   number;
  total_budget?:        number;
  hotel_grade?:         string;
  meal_plan?:           string;
  transportation?:      string;
  special_requests?:    string;
  custom_requirements?: Record<string, unknown>;
  status:               'draft'|'published'|'bidding'|'analyzing'|'awaiting_selection'|'contracted'|'completed'|'cancelled';
  published_at?:        string;
  gold_unlock_at?:      string;
  silver_unlock_at?:    string;
  bronze_unlock_at?:    string;
  bid_deadline?:        string;
  max_proposals:        number;
  selected_proposal_id?: string;
  ai_interview_log?:    unknown[];
  created_at:           string;
  updated_at:           string;
}

export interface RfqBid {
  id:              string;
  rfq_id:          string;
  tenant_id:       string;
  tenant_name?:    string;   // JOIN용
  status:          'locked'|'submitted'|'selected'|'rejected'|'timeout'|'withdrawn';
  locked_at:       string;
  submit_deadline: string;
  submitted_at?:   string;
  is_penalized:    boolean;
  penalty_reason?: string;
}

export interface ChecklistItem {
  included: boolean;
  amount:   number | null;
  note:     string;
}

export interface ProposalChecklist {
  guide_fee:      ChecklistItem;
  driver_tip:     ChecklistItem;
  fuel_surcharge: ChecklistItem;
  local_tax:      ChecklistItem;
  water_cost:     ChecklistItem;
  inclusions:     string[];
  exclusions:     string[];
  optional_tours: { name: string; price: number }[];
  hotel_info:     { grade: string; name: string; notes: string };
  meal_plan:      string;
  transportation: string;
}

export interface RfqProposal {
  id:                   string;
  rfq_id:               string;
  bid_id:               string;
  tenant_id:            string;
  tenant_name?:         string;   // JOIN용
  proposal_title?:      string;
  itinerary_summary?:   string;
  total_cost:           number;
  total_selling_price:  number;
  hidden_cost_estimate: number;
  real_total_price?:    number;
  checklist:            Partial<ProposalChecklist>;
  checklist_completed:  boolean;
  ai_review?:           { score: number; issues: string[]; suggestions: string[]; fact_check: string[] };
  ai_reviewed_at?:      string;
  rank?:                number;
  status:               'draft'|'submitted'|'reviewing'|'approved'|'selected'|'rejected';
  submitted_at?:        string;
  created_at:           string;
  updated_at:           string;
}

export interface RfqMessage {
  id:                     string;
  rfq_id:                 string;
  proposal_id?:           string;
  sender_type:            'customer'|'tenant'|'ai'|'system';
  sender_id?:             string;
  raw_content:            string;
  processed_content?:     string;
  pii_detected:           boolean;
  pii_blocked:            boolean;
  recipient_type:         'customer'|'tenant'|'admin';
  is_visible_to_customer: boolean;
  is_visible_to_tenant:   boolean;
  created_at:             string;
}

// RFQ 채번 헬퍼
function generateRfqCode(): string {
  return `GRP-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

// ── GroupRfq CRUD ────────────────────────────────────────────

export async function createGroupRfq(
  data: Omit<GroupRfq, 'id' | 'rfq_code' | 'created_at' | 'updated_at'>
): Promise<GroupRfq | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('group_rfqs')
    .insert([{ ...data, rfq_code: generateRfqCode() }] as never)
    .select()
    .single();
  if (error) { console.error('RFQ 생성 실패:', error); return null; }
  return row as GroupRfq;
}

export async function getGroupRfq(id: string): Promise<GroupRfq | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('group_rfqs')
    .select('*')
    .eq('id', id)
    .single();
  return data as GroupRfq | null;
}

export async function listGroupRfqs(status?: string, limit = 50): Promise<GroupRfq[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from('group_rfqs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return (data ?? []) as GroupRfq[];
}

export async function updateGroupRfq(id: string, patch: Partial<GroupRfq>): Promise<GroupRfq | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('group_rfqs')
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('RFQ 업데이트 실패:', error); return null; }
  return data as GroupRfq;
}

// ── RfqBid CRUD ──────────────────────────────────────────────

export async function claimRfqBid(rfqId: string, tenantId: string): Promise<RfqBid | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const timeoutMin = parseInt(process.env.RFQ_BID_TIMEOUT_MINUTES ?? '180');
  const submit_deadline = new Date(Date.now() + timeoutMin * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('rfq_bids')
    .insert([{ rfq_id: rfqId, tenant_id: tenantId, submit_deadline }] as never)
    .select()
    .single();
  if (error) { console.error('입찰 확정 실패:', error); return null; }
  return data as RfqBid;
}

export async function getRfqBids(rfqId: string): Promise<RfqBid[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('rfq_bids')
    .select('*, tenants(name)')
    .eq('rfq_id', rfqId)
    .order('locked_at', { ascending: true });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as RfqBid & { tenants?: { name?: string } };
    return { ...row, tenant_name: row.tenants?.name } as RfqBid;
  });
}

export async function updateRfqBid(id: string, patch: Partial<RfqBid>): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('rfq_bids').update(patch as never).eq('id', id);
}

export async function getExpiredBids(): Promise<RfqBid[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('rfq_bids')
    .select('*')
    .eq('status', 'locked')
    .lt('submit_deadline', new Date().toISOString());
  return (data ?? []) as RfqBid[];
}

// ── RfqProposal CRUD ─────────────────────────────────────────

export async function createRfqProposal(
  data: Omit<RfqProposal, 'id' | 'created_at' | 'updated_at'>
): Promise<RfqProposal | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('rfq_proposals')
    .insert([data] as never)
    .select()
    .single();
  if (error) { console.error('제안서 생성 실패:', error); return null; }
  return row as RfqProposal;
}

export async function getRfqProposals(rfqId: string): Promise<RfqProposal[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('rfq_proposals')
    .select('*, tenants(name)')
    .eq('rfq_id', rfqId)
    .order('rank', { ascending: true, nullsFirst: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as RfqProposal & { tenants?: { name?: string } };
    return { ...row, tenant_name: row.tenants?.name } as RfqProposal;
  });
}

export async function getRfqProposal(id: string): Promise<RfqProposal | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from('rfq_proposals').select('*').eq('id', id).single();
  return data as RfqProposal | null;
}

export async function updateRfqProposal(
  id: string, patch: Partial<RfqProposal>
): Promise<RfqProposal | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('rfq_proposals')
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('제안서 업데이트 실패:', error); return null; }
  return data as RfqProposal;
}

// ── RfqMessage CRUD ──────────────────────────────────────────

export async function createRfqMessage(
  data: Omit<RfqMessage, 'id' | 'created_at'>
): Promise<RfqMessage | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('rfq_messages')
    .insert([data] as never)
    .select()
    .single();
  if (error) { console.error('RFQ 메시지 생성 실패:', error); return null; }
  return row as RfqMessage;
}

export async function getRfqMessages(
  rfqId: string,
  viewAs: 'customer' | 'tenant' | 'admin',
  proposalId?: string
): Promise<RfqMessage[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from('rfq_messages').select('*').eq('rfq_id', rfqId);
  if (proposalId) q = q.eq('proposal_id', proposalId);
  if (viewAs === 'customer') q = q.eq('is_visible_to_customer', true);
  else if (viewAs === 'tenant') q = q.eq('is_visible_to_tenant', true);
  const { data } = await q.order('created_at', { ascending: true });
  return (data ?? []) as RfqMessage[];
}
