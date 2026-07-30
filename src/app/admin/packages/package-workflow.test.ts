import { describe, expect, it, vi } from 'vitest';
import {
  generatePackageContentChannels,
  packageDatabaseStatuses,
  parseAdminPackageStatus,
} from './package-workflow';

describe('admin package workflow', () => {
  it('accepts only supported status drilldowns', () => {
    expect(parseAdminPackageStatus('pending')).toBe('pending');
    expect(parseAdminPackageStatus('selling')).toBe('selling');
    expect(parseAdminPackageStatus('unknown')).toBe('all');
    expect(packageDatabaseStatuses('pending')).toEqual(['pending', 'pending_review', 'draft']);
  });

  it('records only channels whose HTTP request succeeded', async () => {
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const channel = JSON.parse(String(init?.body)).channel as string;
      if (channel === 'naver_blog') return new Response(JSON.stringify({ creative: { id: '1' } }), { status: 201 });
      if (channel === 'instagram_card') return new Response(JSON.stringify({ error: '생성 제한' }), { status: 429 });
      throw new Error('network down');
    });

    const result = await generatePackageContentChannels('pkg-1', request);

    expect(result.successful).toEqual(['naver_blog']);
    expect(result.failed).toEqual([
      { channel: 'instagram_card', reason: '생성 제한' },
      { channel: 'google_search', reason: 'network down' },
    ]);
    expect(request).toHaveBeenCalledTimes(3);
  });
});
