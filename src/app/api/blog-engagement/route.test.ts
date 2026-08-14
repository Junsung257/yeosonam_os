import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  engagementInsert: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: { from: mocks.from },
}));

import { POST } from './route';

function request(body: Record<string, unknown>, consent = true) {
  return new NextRequest('http://localhost/api/blog-engagement', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(consent ? { cookie: 'ys_consent_v2=analytics-granted' } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/blog-engagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.engagementInsert.mockResolvedValue({ error: null });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'blog_engagement_logs') return { insert: mocks.engagementInsert };
      throw new Error(`unexpected table: ${table}`);
    });
  });

  it('does not write without analytics consent', async () => {
    const response = await POST(request({ content_creative_id: 'creative-1' }, false));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ skipped: true, reason: 'analytics_consent_required' });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('stores the consented article event with field dimensions and a one-way term hash', async () => {
    const response = await POST(request({
      content_creative_id: '10000000-0000-4000-8000-000000000001',
      event_type: 'scroll_50',
      max_scroll_depth_pct: 50,
      route: '/blog/osaka-hotel-area',
      device: 'mobile',
      connection_type: '4g',
      navigation_type: 'navigate',
      consent_state: 'granted',
      utm_term: 'osaka hotel area',
    }));

    expect(response.status).toBe(200);
    expect(mocks.engagementInsert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'scroll_50',
      route: '/blog/osaka-hotel-area',
      device: 'mobile',
      connection_type: '4g',
      navigation_type: 'navigate',
      consent_state: 'granted',
      search_query_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });
});
