import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  createTask: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@/lib/research/research-node-auth', () => ({
  isResearchNodeAuthorized: mocks.authorize,
}));

vi.mock('@/lib/agent/tasking', () => ({
  createAgentTaskIdempotently: mocks.createTask,
}));

vi.mock('@/lib/rate-limiter', () => ({
  rateLimit: mocks.rateLimit,
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseAdminConfigured: true,
}));

import { POST } from './route';

function validSignal() {
  return {
    schemaVersion: 1,
    sourceUrl: 'https://www.visitguam.com/?utm_source=pilot',
    sourcePlatform: 'web',
    title: '괌 공식 관광 정보 변화 후보',
    collectedAt: new Date().toISOString(),
    collector: 'crawlee',
    collectorVersion: '3.18.1',
    contentHash: `sha256:${'a'.repeat(64)}`,
    excerpt: '괌 공식 관광 정보 페이지의 변화 후보입니다.',
    evidenceClass: 'official_source_candidate',
    confidence: 0.8,
    officialSource: false,
    collectionMethod: 'public_page',
    contentCheck: {
      bodyPresent: true,
      requiredFieldsPresent: true,
      emptyResult: false,
      loginError: false,
    },
  };
}

function request(body: unknown, contentType = 'application/json') {
  return new NextRequest('https://yeosonam.com/api/internal/research/signals', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${'r'.repeat(48)}`,
      'content-type': contentType,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/internal/research/signals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mocks.authorize.mockReturnValue(true);
    mocks.rateLimit.mockResolvedValue(null);
    mocks.createTask.mockResolvedValue({ id: 'task-1', status: 'queued', duplicate: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects unauthorized traffic before rate limiting or persistence', async () => {
    mocks.authorize.mockReturnValue(false);

    const response = await POST(request(validSignal()));

    expect(response.status).toBe(401);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('keeps rate-limited responses private', async () => {
    mocks.rateLimit.mockResolvedValue(NextResponse.json({ error: 'limited' }, { status: 429 }));

    const response = await POST(request(validSignal()));

    expect(response.status).toBe(429);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('requires the distributed limiter for authenticated research intake', async () => {
    await POST(request(validSignal()));

    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      prefix: 'rl-research-intake',
      failClosed: true,
      requireDistributed: true,
    }));
  });

  it('rejects invalid health evidence before persistence', async () => {
    const response = await POST(request({
      ...validSignal(),
      contentCheck: { ...validSignal().contentCheck, emptyResult: true },
    }));

    expect(response.status).toBe(422);
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('rejects non-JSON media types before parsing or persistence', async () => {
    const response = await POST(request(validSignal(), 'text/plain'));

    expect(response.status).toBe(415);
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('accepts a valid signal as a review-only queued task', async () => {
    const response = await POST(request(validSignal()));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(mocks.createTask).toHaveBeenCalledOnce();
    expect(mocks.createTask.mock.calls[0]?.[0]).toMatchObject({
      source: 'research_node',
      status: 'queued',
      taskContext: {
        disposition: 'review_required',
        publicationAllowed: false,
        productFactAllowed: false,
      },
    });
    expect(body).toMatchObject({ task_id: 'task-1', review_status: 'review_required' });
  });
});
