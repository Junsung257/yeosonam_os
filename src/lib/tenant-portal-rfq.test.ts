import { describe, expect, it } from 'vitest';
import type { GroupRfq } from '@/lib/db/rfq';
import { sanitizeTenantPortalRfq } from '@/lib/tenant-portal-rfq';

function rfq(overrides: Partial<GroupRfq> = {}): GroupRfq {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    rfq_code: 'RFQ-001',
    customer_name: 'Real Customer',
    destination: 'Tokyo',
    adult_count: 2,
    child_count: 0,
    status: 'published',
    max_proposals: 3,
    created_at: '2026-07-19T00:00:00.000Z',
    updated_at: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('sanitizeTenantPortalRfq', () => {
  it('removes customer and internal metadata while redacting free-text PII', () => {
    const sanitized = sanitizeTenantPortalRfq(rfq({
      customer_phone: '010-1234-5678',
      customer_id: '00000000-0000-4000-8000-000000000001',
      share_token: 'secret-share-token',
      ai_interview_log: [{ answer: 'private transcript' }],
      custom_requirements: {
        customer_email: 'customer@example.com',
        privacy_consent: true,
        utm: { source: 'campaign' },
        submitted_at: '2026-07-19T00:00:00.000Z',
      },
      special_requests: '연락은 customer@example.com 또는 010-1234-5678로 주세요',
    }));

    expect(sanitized.customer_name).toBe('고객 (익명)');
    expect(sanitized.special_requests).toContain('[EMAIL]');
    expect(sanitized.special_requests).toContain('[PHONE]');
    expect(sanitized.special_requests).not.toContain('customer@example.com');
    expect(sanitized.special_requests).not.toContain('010-1234-5678');
    expect(sanitized).not.toHaveProperty('customer_phone');
    expect(sanitized).not.toHaveProperty('customer_id');
    expect(sanitized).not.toHaveProperty('share_token');
    expect(sanitized).not.toHaveProperty('ai_interview_log');
    expect(sanitized).not.toHaveProperty('custom_requirements');
  });

  it('preserves a legitimate non-PII travel request', () => {
    const sanitized = sanitizeTenantPortalRfq(rfq({
      special_requests: '유아 카시트와 채식 식사가 필요합니다.',
    }));

    expect(sanitized.special_requests).toBe('유아 카시트와 채식 식사가 필요합니다.');
  });
});
