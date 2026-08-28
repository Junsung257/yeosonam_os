import { describe, expect, it } from 'vitest';
import { sanitizeTenantPortalRfq } from '@/lib/tenant-portal-rfq';
import type { GroupRfq } from '@/lib/db/rfq';

const rfq = {
  id: 'rfq-1',
  rfq_code: 'GRP-0001',
  customer_name: '홍길동',
  customer_phone: '010-1234-5678',
  customer_id: 'customer-1',
  destination: '삿포로',
  adult_count: 10,
  child_count: 2,
  budget_per_person: 1_000_000,
  total_budget: 12_000_000,
  special_requests: '홍길동 010-1234-5678 알레르기 있음',
  custom_requirements: { internal: true },
  ai_interview_log: [{ private: true }],
  share_token: 'secret-share-token',
  status: 'published',
  max_proposals: 5,
  created_at: '2026-08-28T00:00:00.000Z',
  updated_at: '2026-08-28T00:00:00.000Z',
} as unknown as GroupRfq;

describe('tenant portal RFQ projection', () => {
  it('removes private fields and commercial details while locked', () => {
    const safe = sanitizeTenantPortalRfq(rfq, false) as Record<string, unknown>;

    expect(safe.customer_name).toBe('고객 (익명)');
    expect(safe).not.toHaveProperty('customer_phone');
    expect(safe).not.toHaveProperty('customer_id');
    expect(safe).not.toHaveProperty('share_token');
    expect(safe).not.toHaveProperty('ai_interview_log');
    expect(safe).not.toHaveProperty('custom_requirements');
    expect(safe).not.toHaveProperty('budget_per_person');
    expect(safe).not.toHaveProperty('total_budget');
    expect(safe).not.toHaveProperty('special_requests');
  });

  it('keeps unlocked details but redacts PII in free text', () => {
    const safe = sanitizeTenantPortalRfq(rfq, true) as Record<string, unknown>;

    expect(safe.budget_per_person).toBe(1_000_000);
    expect(safe.total_budget).toBe(12_000_000);
    expect(safe.special_requests).toContain('[PHONE]');
    expect(safe.special_requests).not.toContain('010-1234-5678');
    expect(safe.customer_name).toBe('고객 (익명)');
  });
});
