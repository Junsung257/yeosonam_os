import { describe, expect, it } from 'vitest';
import {
  INITIAL_ACTIVE_ACTION_IDS,
  reduceActiveActionIds,
} from './active-action-ids';

describe('Ad OS active action ids', () => {
  it('sets one active action id without changing the others', () => {
    const next = reduceActiveActionIds(INITIAL_ACTIVE_ACTION_IDS, {
      type: 'set',
      key: 'keywordActionId',
      id: 'keyword-1',
    });

    expect(next.keywordActionId).toBe('keyword-1');
    expect(next.changeRequestActionId).toBeNull();
    expect(next.opsQueueActionId).toBeNull();
  });

  it('returns the same state object when the requested id is already active', () => {
    const populated = reduceActiveActionIds(INITIAL_ACTIVE_ACTION_IDS, {
      type: 'set',
      key: 'opsQueueActionId',
      id: 'runtime-check',
    });

    expect(
      reduceActiveActionIds(populated, {
        type: 'set',
        key: 'opsQueueActionId',
        id: 'runtime-check',
      }),
    ).toBe(populated);
  });

  it('resets all active action ids', () => {
    const populated = reduceActiveActionIds(INITIAL_ACTIVE_ACTION_IDS, {
      type: 'set',
      key: 'changeRequestActionId',
      id: 'change-1',
    });

    expect(reduceActiveActionIds(populated, { type: 'reset' })).toEqual(INITIAL_ACTIVE_ACTION_IDS);
  });
});
