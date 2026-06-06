'use client';

import { useCallback, useReducer } from 'react';

export type ActiveActionIds = {
  keywordActionId: string | null;
  changeRequestActionId: string | null;
  opsQueueActionId: string | null;
};

export type ActiveActionIdKey = keyof ActiveActionIds;

export type ActiveActionIdsAction =
  | { type: 'set'; key: ActiveActionIdKey; id: string | null }
  | { type: 'reset' };

export const INITIAL_ACTIVE_ACTION_IDS: ActiveActionIds = {
  keywordActionId: null,
  changeRequestActionId: null,
  opsQueueActionId: null,
};

export function reduceActiveActionIds(
  state: ActiveActionIds,
  action: ActiveActionIdsAction,
): ActiveActionIds {
  if (action.type === 'reset') return INITIAL_ACTIVE_ACTION_IDS;
  if (state[action.key] === action.id) return state;
  return { ...state, [action.key]: action.id };
}

export function useActiveActionIds() {
  const [state, dispatch] = useReducer(reduceActiveActionIds, INITIAL_ACTIVE_ACTION_IDS);

  const setActiveActionId = useCallback((key: ActiveActionIdKey, id: string | null) => {
    dispatch({ type: 'set', key, id });
  }, []);

  return {
    ...state,
    setKeywordActionId: useCallback(
      (id: string | null) => setActiveActionId('keywordActionId', id),
      [setActiveActionId],
    ),
    setChangeRequestActionId: useCallback(
      (id: string | null) => setActiveActionId('changeRequestActionId', id),
      [setActiveActionId],
    ),
    setOpsQueueActionId: useCallback(
      (id: string | null) => setActiveActionId('opsQueueActionId', id),
      [setActiveActionId],
    ),
    resetActiveActionIds: useCallback(() => dispatch({ type: 'reset' }), []),
  };
}
