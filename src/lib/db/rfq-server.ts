import { getSupabaseAdmin } from '../supabase';
import type { GroupRfq, RfqBid, RfqMessage, RfqProposal } from './rfq';
import type { RfqShareReaction } from './rfq-share';

/**
 * Server-only RFQ repository. Route handlers must use this module after they
 * authorize the request; the legacy `db/rfq` helpers use the browser/anon
 * client and are intentionally not suitable for privileged server CRUD.
 */
function db() {
  const client = getSupabaseAdmin();
  if (!client) throw new Error('Supabase service-role client is unavailable');
  return client;
}

function assertNoError(error: unknown, operation: string): void {
  if (error) throw new Error(`${operation} failed`);
}

function generateRfqCode(): string {
  return `GRP-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

export interface AuthorizedRfqTenant {
  id: string;
  tier: 'GOLD' | 'SILVER' | 'BRONZE';
}

export interface ActiveRfqTenantMembership {
  tenantId: string;
  userId: string;
  role: 'tenant_admin' | 'tenant_staff';
}

export async function getActiveRfqTenantMembership(
  userId: string,
  metadataTenantId?: string | null,
): Promise<ActiveRfqTenantMembership | null> {
  let query = db()
    .from('tenant_memberships')
    .select('tenant_id, user_id, role, is_active, tenants!inner(status)')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('tenants.status', 'active');
  if (metadataTenantId) query = query.eq('tenant_id', metadataTenantId);
  const { data, error } = await query.limit(2);
  assertNoError(error, 'RFQ tenant membership lookup');

  const rows = (data ?? []) as Array<{
    tenant_id: string;
    user_id: string;
    role: string;
    is_active: boolean;
    tenants: { status: string } | null;
  }>;
  if (rows.length !== 1) return null;
  const membership = rows[0];
  if (!membership || membership.user_id !== userId || !membership.is_active
    || membership.tenants?.status !== 'active'
    || (metadataTenantId && membership.tenant_id !== metadataTenantId)
    || (membership.role !== 'tenant_admin' && membership.role !== 'tenant_staff')) {
    return null;
  }
  return { tenantId: membership.tenant_id, userId, role: membership.role };
}

export async function getRfqTenantForAuthorizedRequest(tenantId: string): Promise<AuthorizedRfqTenant | null> {
  const { data, error } = await db().from('tenants').select('id, tier').eq('id', tenantId).eq('status', 'active').maybeSingle();
  assertNoError(error, 'RFQ tenant lookup');
  return data as AuthorizedRfqTenant | null;
}

export async function createGroupRfq(data: Omit<GroupRfq, 'id' | 'rfq_code' | 'created_at' | 'updated_at'>): Promise<GroupRfq | null> {
  const { data: row, error } = await db().from('group_rfqs').insert([{ ...data, rfq_code: generateRfqCode() }] as never).select().single();
  assertNoError(error, 'RFQ create');
  return row as GroupRfq | null;
}

export async function getGroupRfq(id: string): Promise<GroupRfq | null> {
  const { data, error } = await db().from('group_rfqs').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'RFQ lookup');
  return data as GroupRfq | null;
}

export interface RfqShareIdentity {
  id: string;
  share_token: string | null;
}

/** Minimal capability lookup used before any share-token path reads an RFQ row. */
export async function getRfqShareIdentity(id: string): Promise<RfqShareIdentity | null> {
  const { data, error } = await db().from('group_rfqs').select('id, share_token').eq('id', id).maybeSingle();
  assertNoError(error, 'RFQ share identity lookup');
  return data as RfqShareIdentity | null;
}

export async function listGroupRfqs(status?: string, limit = 200): Promise<GroupRfq[]> {
  let query = db().from('group_rfqs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  assertNoError(error, 'RFQ list');
  return (data ?? []) as GroupRfq[];
}

export async function findRecentDuplicateGroupRfq(phone: string, destination: string, createdAfter: string): Promise<boolean> {
  const { data, error } = await db().from('group_rfqs').select('id').eq('customer_phone', phone).eq('destination', destination).gte('created_at', createdAfter).limit(1);
  assertNoError(error, 'RFQ duplicate lookup');
  return Boolean(data?.length);
}

export async function updateGroupRfq(id: string, patch: Partial<GroupRfq>): Promise<GroupRfq | null> {
  const { data, error } = await db().from('group_rfqs').update({ ...patch, updated_at: new Date().toISOString() } as never).eq('id', id).select().single();
  assertNoError(error, 'RFQ update');
  return data as GroupRfq | null;
}

export async function claimRfqBid(rfqId: string, tenantId: string): Promise<RfqBid | null> {
  const timeoutMin = Number.parseInt(process.env.RFQ_BID_TIMEOUT_MINUTES ?? '180', 10);
  const submitDeadline = new Date(Date.now() + timeoutMin * 60 * 1000).toISOString();
  const { data, error } = await db().from('rfq_bids').insert([{ rfq_id: rfqId, tenant_id: tenantId, submit_deadline: submitDeadline }] as never).select().single();
  assertNoError(error, 'RFQ bid claim');
  return data as RfqBid | null;
}

export async function getRfqBids(rfqId: string): Promise<RfqBid[]> {
  const { data, error } = await db().from('rfq_bids').select('*, tenants(name)').eq('rfq_id', rfqId).order('locked_at', { ascending: true });
  assertNoError(error, 'RFQ bids lookup');
  return ((data ?? []) as unknown[]).map(item => {
    const row = item as RfqBid & { tenants?: { name?: string } };
    return { ...row, tenant_name: row.tenants?.name };
  });
}

export async function updateRfqBid(id: string, patch: Partial<RfqBid>): Promise<void> {
  const { error } = await db().from('rfq_bids').update(patch as never).eq('id', id);
  assertNoError(error, 'RFQ bid update');
}

export async function getExpiredBids(): Promise<RfqBid[]> {
  const { data, error } = await db().from('rfq_bids').select('*').eq('status', 'locked').lt('submit_deadline', new Date().toISOString());
  assertNoError(error, 'Expired RFQ bids lookup');
  return (data ?? []) as RfqBid[];
}

export async function updateTenantReliability(tenantId: string, delta: number): Promise<void> {
  const client = db();
  const { data, error } = await client.from('tenants').select('reliability_score').eq('id', tenantId).maybeSingle();
  assertNoError(error, 'Tenant reliability lookup');
  if (!data) throw new Error('Tenant reliability lookup failed');
  const current = (data as { reliability_score: number }).reliability_score;
  const reliabilityScore = Math.max(0, Math.min(100, current + delta));
  const { error: updateError } = await client.from('tenants').update({ reliability_score: reliabilityScore } as never).eq('id', tenantId);
  assertNoError(updateError, 'Tenant reliability update');
}

export async function createRfqProposal(data: Omit<RfqProposal, 'id' | 'created_at' | 'updated_at'>): Promise<RfqProposal | null> {
  const { data: row, error } = await db().from('rfq_proposals').insert([data] as never).select().single();
  assertNoError(error, 'RFQ proposal create');
  return row as RfqProposal | null;
}

export async function getRfqProposals(rfqId: string): Promise<RfqProposal[]> {
  const { data, error } = await db().from('rfq_proposals').select('*, tenants(name)').eq('rfq_id', rfqId).order('rank', { ascending: true, nullsFirst: false });
  assertNoError(error, 'RFQ proposals lookup');
  return ((data ?? []) as unknown[]).map(item => {
    const row = item as RfqProposal & { tenants?: { name?: string } };
    return { ...row, tenant_name: row.tenants?.name };
  });
}

export async function updateRfqProposal(id: string, patch: Partial<RfqProposal>): Promise<RfqProposal | null> {
  const { data, error } = await db().from('rfq_proposals').update({ ...patch, updated_at: new Date().toISOString() } as never).eq('id', id).select().single();
  assertNoError(error, 'RFQ proposal update');
  return data as RfqProposal | null;
}

export async function createRfqMessage(data: Omit<RfqMessage, 'id' | 'created_at'>): Promise<RfqMessage | null> {
  const { data: row, error } = await db().from('rfq_messages').insert([data] as never).select().single();
  assertNoError(error, 'RFQ message create');
  return row as RfqMessage | null;
}

export async function getRfqMessages(rfqId: string, viewAs: 'customer' | 'tenant' | 'admin', proposalId?: string): Promise<RfqMessage[]> {
  let query = db().from('rfq_messages').select('*').eq('rfq_id', rfqId);
  if (proposalId) query = query.eq('proposal_id', proposalId);
  if (viewAs === 'customer') query = query.eq('is_visible_to_customer', true);
  else if (viewAs === 'tenant') query = query.eq('is_visible_to_tenant', true);
  const { data, error } = await query.order('created_at', { ascending: true });
  assertNoError(error, 'RFQ messages lookup');
  return (data ?? []) as RfqMessage[];
}

export async function addRfqReaction(rfqId: string, visitorToken: string, reactionType: RfqShareReaction['reaction_type'], comment?: string): Promise<boolean> {
  const { error } = await (db().from('rfq_share_reactions') as unknown as { upsert: (rows: unknown, options?: unknown) => Promise<{ error: unknown }> }).upsert(
    { rfq_id: rfqId, visitor_token: visitorToken, reaction_type: reactionType, comment },
    { onConflict: 'rfq_id, visitor_token, reaction_type' },
  );
  assertNoError(error, 'RFQ reaction upsert');
  return true;
}
