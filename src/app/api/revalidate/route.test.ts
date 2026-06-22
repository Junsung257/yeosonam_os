import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
  revalidateTag: mocks.revalidateTag,
}));

vi.mock('@/lib/secret-registry', () => ({
  getSecret: (key: string) => (key === 'REVALIDATE_SECRET' ? 'test-secret' : undefined),
}));

import { POST } from './route';

function request(body: Record<string, unknown>, headers?: Record<string, string>) {
  return new Request('https://www.yeosonam.com/api/revalidate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  }) as Parameters<typeof POST>[0];
}

describe('POST /api/revalidate', () => {
  beforeEach(() => {
    mocks.revalidatePath.mockClear();
    mocks.revalidateTag.mockClear();
  });

  it('revalidates paths with the canonical body secret contract', async () => {
    const response = await POST(request({ paths: ['/packages/pkg-1', '/lp/pkg-1'], secret: 'test-secret' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, revalidated: ['/packages/pkg-1', '/lp/pkg-1'] });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/packages/pkg-1');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/lp/pkg-1');
  });

  it('accepts legacy single path plus x-revalidate-secret from automation scripts', async () => {
    const response = await POST(request(
      { path: '/packages/pkg-2' },
      { 'x-revalidate-secret': 'test-secret' },
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, revalidated: ['/packages/pkg-2'] });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/packages/pkg-2');
  });

  it('rejects invalid secrets', async () => {
    const response = await POST(request({ paths: ['/packages/pkg-1'], secret: 'wrong' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Invalid secret' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
