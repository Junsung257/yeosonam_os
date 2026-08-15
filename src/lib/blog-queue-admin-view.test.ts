import { describe, expect, it } from 'vitest';

import { resolveBlogQueueAdminView } from './blog-queue-admin-view';

describe('blog queue admin view', () => {
  it('opens the operator scope requested by dashboard drilldowns', () => {
    expect(resolveBlogQueueAdminView('attention', undefined)).toBe('attention');
    expect(resolveBlogQueueAdminView('manual', undefined)).toBe('manual');
    expect(resolveBlogQueueAdminView('history', undefined)).toBe('history');
  });

  it('lets an explicit status select the matching queue tab', () => {
    expect(resolveBlogQueueAdminView('attention', 'failed')).toBe('failed');
    expect(resolveBlogQueueAdminView('all', 'queued')).toBe('queued');
  });

  it('fails safely to the active operating queue', () => {
    expect(resolveBlogQueueAdminView('unknown', undefined)).toBe('active');
    expect(resolveBlogQueueAdminView(undefined, undefined)).toBe('active');
  });
});
