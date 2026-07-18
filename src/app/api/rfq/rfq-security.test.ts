import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/rfq-request-auth', () => ({
  resolveRfqActor: vi.fn(),
  hasValidRfqShareToken: vi.fn(),
  presentedRfqShareToken: vi.fn(() => 'presented'),
  rfqUnauthorizedResponse: vi.fn(() => Response.json({ error: 'Unauthorized' }, { status: 401 })),
  rfqForbiddenResponse: vi.fn(() => Response.json({ error: 'Forbidden' }, { status: 403 })),
}));

vi.mock('@/lib/admin-guard', () => ({
  requireAdminRequest: vi.fn(),
  isAdminRequest: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  findOrCreateCustomerByPhone: vi.fn(),
}));

vi.mock('@/lib/db/rfq-server', () => ({
  getGroupRfq: vi.fn(),
  getRfqShareIdentity: vi.fn(),
  createGroupRfq: vi.fn(),
  listGroupRfqs: vi.fn(),
  findRecentDuplicateGroupRfq: vi.fn(),
  getRfqBids: vi.fn(),
  claimRfqBid: vi.fn(),
  updateGroupRfq: vi.fn(),
  getRfqProposals: vi.fn(),
  createRfqProposal: vi.fn(),
  updateRfqProposal: vi.fn(),
  updateRfqBid: vi.fn(),
  getRfqMessages: vi.fn(),
  createRfqMessage: vi.fn(),
  getRfqTenantForAuthorizedRequest: vi.fn(),
  addRfqReaction: vi.fn(),
}));

vi.mock('@/lib/rate-limiter', () => ({ rateLimit: vi.fn(async () => null) }));

vi.mock('@/lib/rfq-ai', () => ({
  processCustomerMessage: vi.fn(async (content: string) => ({ processed: content, pii_detected: false })),
  processTenantMessage: vi.fn(async (content: string) => ({ processed: content, pii_detected: false })),
  reviewProposal: vi.fn(),
  generateFactBombingReport: vi.fn(),
}));

vi.mock('@/lib/push-dispatcher', () => ({
  dispatchPush: vi.fn(async () => undefined),
}));

import { isAdminRequest, requireAdminRequest } from '@/lib/admin-guard';
import {
  hasValidRfqShareToken,
  resolveRfqActor,
} from '@/lib/rfq-request-auth';
import {
  claimRfqBid,
  createGroupRfq,
  createRfqProposal,
  createRfqMessage,
  getGroupRfq,
  getRfqBids,
  getRfqMessages,
  getRfqProposals,
  updateGroupRfq,
  getRfqTenantForAuthorizedRequest,
  findRecentDuplicateGroupRfq,
  addRfqReaction,
  getRfqShareIdentity,
} from '@/lib/db/rfq-server';
import { GET as getProposals } from './[id]/proposals/route';
import { GET as getMessages, POST as postMessage } from './[id]/messages/route';
import { GET as getBids, POST as postBid } from './[id]/bid/route';
import { GET as getAnalysis, POST as postAnalysis } from './[id]/analyze/route';
import { GET as getContract } from './[id]/contract/route';
import { GET as getProposal, POST as postProposal } from './[id]/bid/[bidId]/proposal/route';
import { POST as createPublicRfq } from './route';
import { POST as selectProposal } from './[id]/select/route';
import { POST as postReaction } from './share/reaction/route';
import { GET as getRfqDetail } from './[id]/route';

const mockedActor = vi.mocked(resolveRfqActor);
const mockedShare = vi.mocked(hasValidRfqShareToken);
const mockedAdminGuard = vi.mocked(requireAdminRequest);
const mockedIsAdmin = vi.mocked(isAdminRequest);
const mockedGetRfq = vi.mocked(getGroupRfq);
const mockedGetBids = vi.mocked(getRfqBids);
const mockedGetProposals = vi.mocked(getRfqProposals);
const mockedGetMessages = vi.mocked(getRfqMessages);
const mockedCreateMessage = vi.mocked(createRfqMessage);
const mockedClaimBid = vi.mocked(claimRfqBid);
const mockedCreateGroupRfq = vi.mocked(createGroupRfq);
const mockedCreateProposal = vi.mocked(createRfqProposal);
const mockedGetRfqTenant = vi.mocked(getRfqTenantForAuthorizedRequest);
const mockedUpdateRfq = vi.mocked(updateGroupRfq);
const mockedDuplicateRfq = vi.mocked(findRecentDuplicateGroupRfq);
const mockedAddReaction = vi.mocked(addRfqReaction);
const mockedShareIdentity = vi.mocked(getRfqShareIdentity);

const params = { params: Promise.resolve({ id: 'rfq-1' }) };
const proposalParams = { params: Promise.resolve({ id: 'rfq-1', bidId: 'bid-1' }) };
const baseRfq = {
  id: 'rfq-1',
  rfq_code: 'GRP-1001',
  share_token: 'share-1',
  customer_name: 'Customer',
  destination: 'Tokyo',
  adult_count: 2,
  child_count: 0,
  status: 'published' as const,
  max_proposals: 3,
  created_at: '2026-07-19T00:00:00.000Z',
  updated_at: '2026-07-19T00:00:00.000Z',
};

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(`https://www.yeosonam.com${path}`, init);
}

describe('RFQ API security boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedActor.mockResolvedValue(null);
    mockedShare.mockReturnValue(false);
    mockedAdminGuard.mockResolvedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }) as never);
    mockedIsAdmin.mockResolvedValue(false);
    mockedGetRfq.mockResolvedValue(baseRfq);
    mockedGetBids.mockResolvedValue([]);
    mockedGetProposals.mockResolvedValue([]);
    mockedGetMessages.mockResolvedValue([]);
    mockedGetRfqTenant.mockResolvedValue({ id: 'tenant-a', tier: 'GOLD' });
    mockedUpdateRfq.mockResolvedValue({ ...baseRfq, status: 'bidding' });
    mockedDuplicateRfq.mockResolvedValue(false);
    mockedAddReaction.mockResolvedValue(true);
    mockedShareIdentity.mockResolvedValue({ id: 'rfq-1', share_token: 'share-1' });
  });

  it('blocks anonymous proposal and bid-list disclosure', async () => {
    const proposalResponse = await getProposals(request('/api/rfq/rfq-1/proposals'), params);
    const bidResponse = await getBids(request('/api/rfq/rfq-1/bid'), params);

    expect(proposalResponse.status).toBe(401);
    expect(bidResponse.status).toBe(401);
    expect(mockedGetProposals).not.toHaveBeenCalled();
    expect(mockedGetBids).not.toHaveBeenCalled();
  });

  it('preserves anonymous customer RFQ creation as the public entry point', async () => {
    mockedCreateGroupRfq.mockResolvedValue(baseRfq);

    const response = await createPublicRfq(request('/api/rfq', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'Customer',
        customer_phone: '01012345678',
        destination: 'Tokyo',
        adult_count: 2,
        custom_requirements: { privacy_consent: true },
      }),
    }));

    expect(response.status).toBe(201);
    expect(mockedCreateGroupRfq).toHaveBeenCalledWith(expect.objectContaining({
      customer_name: 'Customer',
      customer_phone: '010-1234-5678',
      destination: 'Tokyo',
      adult_count: 2,
      status: 'draft',
    }));
  });

  it('rejects non-boolean consent, malformed ranges, and recent duplicates', async () => {
    const invalidConsent = await createPublicRfq(request('/api/rfq', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'Customer', customer_phone: '01012345678', destination: 'Tokyo',
        adult_count: 2, custom_requirements: { privacy_consent: 'true' },
      }),
    }));
    expect(invalidConsent.status).toBe(400);

    const invalidCount = await createPublicRfq(request('/api/rfq', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'Customer', customer_phone: '01012345678', destination: 'Tokyo',
        adult_count: 501, custom_requirements: { privacy_consent: true },
      }),
    }));
    expect(invalidCount.status).toBe(400);

    mockedDuplicateRfq.mockResolvedValue(true);
    const duplicate = await createPublicRfq(request('/api/rfq', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'Customer', customer_phone: '01012345678', destination: 'Tokyo',
        adult_count: 2, custom_requirements: { privacy_consent: true },
      }),
    }));
    expect(duplicate.status).toBe(409);
    expect(mockedCreateGroupRfq).not.toHaveBeenCalled();
  });

  it('derives customer message visibility from a valid share token, not viewAs=admin', async () => {
    mockedShare.mockReturnValue(true);
    mockedGetMessages.mockResolvedValue([{
      id: 'message-1',
      rfq_id: 'rfq-1',
      sender_type: 'customer',
      raw_content: 'phone 010-1234-5678',
      processed_content: 'phone [REDACTED]',
      pii_detected: true,
      pii_blocked: true,
      recipient_type: 'tenant',
      is_visible_to_customer: true,
      is_visible_to_tenant: false,
      created_at: '2026-07-19T00:00:00.000Z',
    }]);

    const response = await getMessages(
      request('/api/rfq/rfq-1/messages?viewAs=admin&share_token=share-1'),
      params,
    );

    expect(response.status).toBe(200);
    expect(mockedGetMessages).toHaveBeenCalledWith('rfq-1', 'customer', undefined);
    const body = await response.json();
    expect(body.messages[0].raw_content).toBe('phone [REDACTED]');
    expect(JSON.stringify(body)).not.toContain('010-1234-5678');
  });

  it('prevents a share-link caller from spoofing a tenant message', async () => {
    mockedShare.mockReturnValue(true);

    const response = await postMessage(
      request('/api/rfq/rfq-1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sender_type: 'tenant',
          sender_id: 'victim-user',
          share_token: 'share-1',
          raw_content: 'hello',
        }),
      }),
      params,
    );

    expect(response.status).toBe(401);
    expect(mockedCreateMessage).not.toHaveBeenCalled();
  });

  it('returns 5xx on a null message insert and preserves an authenticated admin send', async () => {
    mockedActor.mockResolvedValue({ kind: 'admin' });
    mockedCreateMessage.mockResolvedValue(null);
    const failed = await postMessage(request('/api/rfq/rfq-1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ raw_content: 'hello' }),
    }), params);
    expect(failed.status).toBe(500);

    mockedCreateMessage.mockResolvedValue({
      id: 'message-1', rfq_id: 'rfq-1', sender_type: 'customer', raw_content: 'hello',
      processed_content: 'hello', pii_detected: false, pii_blocked: false,
      recipient_type: 'tenant', is_visible_to_customer: true, is_visible_to_tenant: true,
      created_at: '2026-07-19T00:00:00.000Z',
    });
    const accepted = await postMessage(request('/api/rfq/rfq-1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ raw_content: 'hello' }),
    }), params);
    expect(accepted.status).toBe(201);
  });

  it('keeps owner selection admin-only even when a valid share token is supplied', async () => {
    mockedShare.mockReturnValue(true);
    const response = await selectProposal(request('/api/rfq/rfq-1/select', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rfq-share-token': 'share-1' },
      body: JSON.stringify({ proposal_id: 'proposal-1', share_token: 'share-1' }),
    }), params);

    expect(response.status).toBe(401);
    expect(mockedGetRfq).not.toHaveBeenCalled();
  });

  it('validates the RFQ share token before persisting a reaction', async () => {
    const denied = await postReaction(request('/api/rfq/share/reaction', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rfqId: 'rfq-1', visitorToken: 'visitor-123', reactionType: 'like', shareToken: 'wrong' }),
    }));
    expect(denied.status).toBe(403);
    expect(mockedAddReaction).not.toHaveBeenCalled();

    mockedShare.mockReturnValue(true);
    const accepted = await postReaction(request('/api/rfq/share/reaction', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rfqId: 'rfq-1', visitorToken: 'visitor-123', reactionType: 'like', shareToken: 'share-1' }),
    }));
    expect(accepted.status).toBe(200);
    expect(mockedAddReaction).toHaveBeenCalledWith('rfq-1', 'visitor-123', 'like', undefined);
  });

  it('validates share identity before any full RFQ row read and marks PII detail private', async () => {
    mockedShare.mockReturnValue(false);
    const denied = await getMessages(
      request('/api/rfq/rfq-1/messages?share_token=wrong'),
      params,
    );
    expect(denied.status).toBe(401);
    expect(mockedShareIdentity).toHaveBeenCalledWith('rfq-1');
    expect(mockedGetRfq).not.toHaveBeenCalled();

    mockedAdminGuard.mockResolvedValue(null);
    mockedIsAdmin.mockResolvedValue(true);
    const detail = await getRfqDetail(request('/api/rfq/rfq-1'), params);
    expect(detail.status).toBe(200);
    expect(detail.headers.get('cache-control')).toBe('private, no-store');
  });

  it('rejects a contract share token before reading the full RFQ row', async () => {
    mockedShare.mockReturnValue(false);
    const response = await getContract(
      request('/api/rfq/rfq-1/contract?share_token=wrong'),
      params,
    );

    expect(response.status).toBe(401);
    expect(mockedShareIdentity).toHaveBeenCalledWith('rfq-1');
    expect(mockedGetRfq).not.toHaveBeenCalled();
  });

  it('rejects body tenant_id spoofing and uses the verified tenant binding', async () => {
    mockedActor.mockResolvedValue({ kind: 'tenant', tenantId: 'tenant-a', userId: 'user-a' });

    const rejected = await postBid(
      request('/api/rfq/rfq-1/bid', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_id: 'tenant-b' }),
      }),
      params,
    );
    expect(rejected.status).toBe(403);
    expect(mockedClaimBid).not.toHaveBeenCalled();

    mockedClaimBid.mockResolvedValue({ id: 'bid-a', rfq_id: 'rfq-1', tenant_id: 'tenant-a' } as never);
    const accepted = await postBid(
      request('/api/rfq/rfq-1/bid', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_id: 'tenant-a' }),
      }),
      params,
    );
    expect(accepted.status).toBe(201);
    expect(mockedClaimBid).toHaveBeenCalledWith('rfq-1', 'tenant-a');
  });

  it('binds proposal access and creation to the bid owner, not body tenant_id', async () => {
    mockedActor.mockResolvedValue({ kind: 'tenant', tenantId: 'tenant-a', userId: 'user-a' });
    mockedGetBids.mockResolvedValue([{
      id: 'bid-1',
      rfq_id: 'rfq-1',
      tenant_id: 'tenant-b',
    } as never]);

    const rejected = await getProposal(
      request('/api/rfq/rfq-1/bid/bid-1/proposal'),
      proposalParams,
    );
    expect(rejected.status).toBe(403);
    expect(mockedGetProposals).not.toHaveBeenCalled();

    mockedGetBids.mockResolvedValue([{
      id: 'bid-1',
      rfq_id: 'rfq-1',
      tenant_id: 'tenant-a',
      status: 'locked',
    } as never]);
    mockedCreateProposal.mockResolvedValue({ id: 'proposal-1', tenant_id: 'tenant-a' } as never);

    const accepted = await postProposal(
      request('/api/rfq/rfq-1/bid/bid-1/proposal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenant_id: 'tenant-b',
          total_cost: 100,
          total_selling_price: 120,
          checklist: {
            guide_fee: { included: true },
            driver_tip: { included: true },
            fuel_surcharge: { included: true },
            local_tax: { included: true },
            water_cost: { included: true },
          },
        }),
      }),
      proposalParams,
    );
    expect(accepted.status).toBe(201);
    expect(mockedCreateProposal).toHaveBeenCalledWith(expect.objectContaining({
      rfq_id: 'rfq-1',
      bid_id: 'bid-1',
      tenant_id: 'tenant-a',
    }));
  });

  it('keeps RFQ analysis mutations admin-only', async () => {
    const getResponse = await getAnalysis(request('/api/rfq/rfq-1/analyze'), params);
    const postResponse = await postAnalysis(request('/api/rfq/rfq-1/analyze', { method: 'POST' }), params);

    expect(getResponse.status).toBe(401);
    expect(postResponse.status).toBe(401);
    expect(mockedGetProposals).not.toHaveBeenCalled();
  });

  it('escapes stored RFQ and proposal text in generated contract HTML', async () => {
    mockedAdminGuard.mockResolvedValue(null);
    mockedGetRfq.mockResolvedValue({
      ...baseRfq,
      destination: '<script>alert(1)</script>',
      special_requests: '<img src=x onerror=alert(1)>',
      status: 'contracted',
      selected_proposal_id: 'proposal-1',
    });
    mockedGetProposals.mockResolvedValue([{
      id: 'proposal-1',
      rfq_id: 'rfq-1',
      bid_id: 'bid-1',
      tenant_id: 'tenant-a',
      total_cost: 1,
      total_selling_price: 2,
      hidden_cost_estimate: 0,
      checklist: { inclusions: ['<svg onload=alert(1)>'], exclusions: [] },
      checklist_completed: true,
      status: 'selected',
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:00.000Z',
    }]);

    const response = await getContract(request('/api/rfq/rfq-1/contract'), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.contract_html).not.toContain('<script>');
    expect(body.contract_html).not.toContain('<img src=x');
    expect(body.contract_html).not.toContain('<svg onload');
    expect(body.contract_html).toContain('&lt;script&gt;');
  });
});
