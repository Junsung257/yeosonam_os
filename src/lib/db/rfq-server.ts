/**
 * Server-only RFQ repository for already-authorized routes and internal jobs.
 * Every tenant-scoped mutation keeps rfq_id, bid_id, and tenant_id in the
 * same predicate so service-role access cannot become an IDOR by omission.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import type { GroupRfq, RfqBid, RfqProposal } from '@/lib/db/rfq';

function adminClient() {
  return getSupabaseAdmin();
}

function mapBid(row: unknown): RfqBid {
  const value = row as RfqBid & { tenants?: { name?: string } | null };
  return { ...value, tenant_name: value.tenants?.name };
}

function mapProposal(row: unknown): RfqProposal {
  const value = row as RfqProposal & { tenants?: { name?: string } | null };
  return { ...value, tenant_name: value.tenants?.name };
}

export async function getServerGroupRfq(rfqId: string): Promise<GroupRfq | null> {
  const admin = adminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from('group_rfqs')
    .select('*')
    .eq('id', rfqId)
    .maybeSingle();
  if (error) throw error;
  return data as GroupRfq | null;
}

export async function listServerGroupRfqs(status?: string): Promise<GroupRfq[]> {
  const admin = adminClient();
  if (!admin) return [];
  let query = admin.from('group_rfqs').select('*').order('created_at', { ascending: false }).limit(200);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as GroupRfq[];
}

export async function getServerRfqBids(
  rfqId: string,
  tenantId?: string,
): Promise<RfqBid[]> {
  const admin = adminClient();
  if (!admin) return [];
  let query = admin
    .from('rfq_bids')
    .select('*, tenants(name)')
    .eq('rfq_id', rfqId)
    .order('locked_at', { ascending: true });
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapBid);
}

export async function getAuthorizedRfqBid(
  rfqId: string,
  bidId: string,
  tenantId: string,
): Promise<RfqBid | null> {
  const admin = adminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from('rfq_bids')
    .select('*, tenants(name)')
    .eq('id', bidId)
    .eq('rfq_id', rfqId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapBid(data) : null;
}

export async function claimAuthorizedRfqBid(
  rfqId: string,
  tenantId: string,
): Promise<RfqBid | null> {
  const admin = adminClient();
  if (!admin) return null;
  const timeoutMin = Number.parseInt(process.env.RFQ_BID_TIMEOUT_MINUTES ?? '180', 10);
  const submitDeadline = new Date(
    Date.now() + (Number.isFinite(timeoutMin) ? timeoutMin : 180) * 60 * 1000,
  ).toISOString();
  const { data, error } = await admin
    .from('rfq_bids')
    .insert({ rfq_id: rfqId, tenant_id: tenantId, submit_deadline: submitDeadline } as never)
    .select('*, tenants(name)')
    .single();
  if (error) {
    console.error('[rfq-server] bid claim failed', { code: error.code });
    return null;
  }
  return mapBid(data);
}

export async function updateAuthorizedRfqBid(
  rfqId: string,
  bidId: string,
  tenantId: string,
  patch: Partial<RfqBid>,
): Promise<boolean> {
  const admin = adminClient();
  if (!admin) return false;
  const { data, error } = await admin
    .from('rfq_bids')
    .update(patch as never)
    .eq('id', bidId)
    .eq('rfq_id', rfqId)
    .eq('tenant_id', tenantId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function getAuthorizedRfqProposal(
  rfqId: string,
  bidId: string,
  tenantId: string,
): Promise<RfqProposal | null> {
  const admin = adminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from('rfq_proposals')
    .select('*, tenants(name)')
    .eq('rfq_id', rfqId)
    .eq('bid_id', bidId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapProposal(data) : null;
}

export async function createAuthorizedRfqProposal(
  data: Omit<RfqProposal, 'id' | 'created_at' | 'updated_at' | 'tenant_name'>,
  tenantId: string,
): Promise<RfqProposal | null> {
  const admin = adminClient();
  if (!admin) return null;

  const { data: bid, error: bidError } = await admin
    .from('rfq_bids')
    .select('id')
    .eq('id', data.bid_id)
    .eq('rfq_id', data.rfq_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (bidError) throw bidError;
  if (!bid) return null;

  const { data: row, error } = await admin
    .from('rfq_proposals')
    .insert({ ...data, tenant_id: tenantId } as never)
    .select('*, tenants(name)')
    .single();
  if (error) {
    console.error('[rfq-server] proposal create failed', { code: error.code });
    return null;
  }
  return mapProposal(row);
}

export async function updateAuthorizedRfqProposal(
  rfqId: string,
  bidId: string,
  tenantId: string,
  proposalId: string,
  patch: Partial<RfqProposal>,
): Promise<RfqProposal | null> {
  const admin = adminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from('rfq_proposals')
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq('id', proposalId)
    .eq('rfq_id', rfqId)
    .eq('bid_id', bidId)
    .eq('tenant_id', tenantId)
    .select('*, tenants(name)')
    .maybeSingle();
  if (error) throw error;
  return data ? mapProposal(data) : null;
}

export async function getServerRfqProposals(rfqId: string): Promise<RfqProposal[]> {
  const admin = adminClient();
  if (!admin) return [];
  const { data, error } = await admin
    .from('rfq_proposals')
    .select('*, tenants(name)')
    .eq('rfq_id', rfqId)
    .order('rank', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map(mapProposal);
}

export async function updateServerRfqProposal(
  proposalId: string,
  patch: Partial<RfqProposal>,
): Promise<RfqProposal | null> {
  const admin = adminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from('rfq_proposals')
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq('id', proposalId)
    .select('*, tenants(name)')
    .maybeSingle();
  if (error) throw error;
  return data ? mapProposal(data) : null;
}

export async function updateServerGroupRfq(
  rfqId: string,
  patch: Partial<GroupRfq>,
): Promise<GroupRfq | null> {
  const admin = adminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from('group_rfqs')
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq('id', rfqId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data as GroupRfq | null;
}
