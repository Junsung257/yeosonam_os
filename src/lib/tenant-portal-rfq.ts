import { getSupabaseAdmin } from '@/lib/supabase';
import type { GroupRfq, RfqBid } from '@/lib/db/rfq';
import type { Tenant } from '@/lib/db/tenant';

type TenantPortalTenant = Pick<Tenant, 'id' | 'name' | 'status' | 'tier'>;

const TENANT_RFQ_FIELDS = 'id, rfq_code, destination, departure_date_from, departure_date_to, duration_nights, adult_count, child_count, budget_per_person, total_budget, hotel_grade, meal_plan, transportation, special_requests, custom_requirements, status, published_at, gold_unlock_at, silver_unlock_at, bronze_unlock_at, bid_deadline, max_proposals, selected_proposal_id, created_at, updated_at' as const;

export async function getTenantPortalTenant(
  tenantId: string,
): Promise<TenantPortalTenant | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from('tenants')
    .select('id, name, status, tier')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) throw error;
  return data as TenantPortalTenant | null;
}

export async function listTenantPortalRfqs(): Promise<GroupRfq[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];
  const { data, error } = await admin
    .from('group_rfqs')
    .select(TENANT_RFQ_FIELDS)
    .in('status', ['published', 'bidding'])
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as GroupRfq[];
}

export async function getTenantPortalRfq(rfqId: string): Promise<GroupRfq | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from('group_rfqs')
    .select(TENANT_RFQ_FIELDS)
    .eq('id', rfqId)
    .maybeSingle();
  if (error) throw error;
  return data as GroupRfq | null;
}

export async function getTenantPortalBid(
  rfqId: string,
  tenantId: string,
): Promise<RfqBid | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from('rfq_bids')
    .select('id, rfq_id, tenant_id, status, locked_at, submit_deadline, submitted_at, is_penalized')
    .eq('rfq_id', rfqId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw error;
  return data as RfqBid | null;
}
