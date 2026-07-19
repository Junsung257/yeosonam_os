import { describe, expect, it } from 'vitest';
import { resolveContentHubStatusTransition } from '@/lib/content-hub-status-transition';

describe('resolveContentHubStatusTransition', () => {
  it.each([
    ['draft', 'publish', 'published'],
    ['published', 'publish', 'published'],
    ['draft', 'manually_published', 'manually_published'],
    ['published', 'manually_published', 'manually_published'],
    ['manually_published', 'archive', 'archived'],
    ['archived', 'archive', 'archived'],
  ])('allows %s --%s--> %s', (currentStatus, action, targetStatus) => {
    expect(resolveContentHubStatusTransition(currentStatus, action)).toEqual({
      ok: true,
      action,
      targetStatus,
    });
  });

  it.each([
    ['archived', 'publish'],
    ['archived', 'manually_published'],
    ['scheduled', 'publish'],
    ['review', 'archive'],
  ])('rejects disallowed transition from %s with %s', (currentStatus, action) => {
    expect(resolveContentHubStatusTransition(currentStatus, action)).toEqual({
      ok: false,
      reason: 'invalid_transition',
    });
  });

  it.each([undefined, null, '', 'delete', 'PUBLISH', 42])('rejects unknown action %s', (action) => {
    expect(resolveContentHubStatusTransition('draft', action)).toEqual({
      ok: false,
      reason: 'invalid_action',
    });
  });
});
