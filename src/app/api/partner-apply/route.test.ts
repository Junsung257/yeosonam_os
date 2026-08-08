import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  existing: null as { id: string; status: string } | null,
  insertData: { id: 'application-1', status: 'PENDING', applied_at: '2026-08-08T00:00:00.000Z' },
  insertError: null as { code?: string; message: string } | null,
  insert: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: { from: mocks.from },
}));

vi.mock('@/lib/secret-registry', () => ({ getSecret: vi.fn(() => '') }));

import { POST } from './route';

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/partner-apply', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'application-retry-0001',
    },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: '테스트 파트너',
  phone: '010-1234-5678',
  channel_type: 'blog',
  channel_url: 'https://example.com/channel',
  follower_count: 1200,
  intro: '여행 콘텐츠를 제작합니다.',
  business_type: 'individual',
  terms_accepted: true,
  disclosure_ack: true,
};

describe('POST /api/partner-apply', () => {
  beforeEach(() => {
    mocks.existing = null;
    mocks.insertError = null;
    mocks.insert.mockReset();
    mocks.from.mockReset();

    const existingQuery = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: mocks.existing })) })),
        })),
      })),
      insert: mocks.insert,
    };
    mocks.insert.mockImplementation((payload: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: mocks.insertData, error: mocks.insertError })),
      })),
      payload,
    }));
    mocks.from.mockReturnValue(existingQuery);
  });

  it('rejects submission until both required acknowledgements are present', async () => {
    const response = await POST(request({ ...validBody, disclosure_ack: false }));
    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('creates a schema-complete, retry-safe application', async () => {
    const response = await POST(request(validBody));
    expect(response.status).toBe(201);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      normalized_phone: '01012345678',
      idempotency_key: 'application-retry-0001',
      terms_bundle_version: '2026-08-08.v1',
      terms_accepted_at: expect.any(String),
      disclosure_ack_at: expect.any(String),
      has_invite_code: false,
    }));
  });

  it('returns conflict when the database concurrency boundary wins', async () => {
    mocks.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    const response = await POST(request(validBody));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: '이미 신청이 접수되어 있습니다.' });
  });
});
