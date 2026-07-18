export const CONTENT_HUB_ACTIONS = [
  'publish',
  'manually_published',
  'archive',
] as const;

export type ContentHubAction = (typeof CONTENT_HUB_ACTIONS)[number];
export type ContentHubTargetStatus = 'published' | 'manually_published' | 'archived';

type TransitionResult =
  | { ok: true; action: ContentHubAction; targetStatus: ContentHubTargetStatus }
  | { ok: false; reason: 'invalid_action' | 'invalid_transition' };

const TARGET_STATUS_BY_ACTION: Record<ContentHubAction, ContentHubTargetStatus> = {
  publish: 'published',
  manually_published: 'manually_published',
  archive: 'archived',
};

const ALLOWED_SOURCE_STATUSES: Record<ContentHubAction, ReadonlySet<string>> = {
  publish: new Set(['draft', 'published']),
  manually_published: new Set(['draft', 'published', 'manually_published']),
  archive: new Set(['draft', 'published', 'manually_published', 'archived']),
};

export function isContentHubAction(action: unknown): action is ContentHubAction {
  return typeof action === 'string' && CONTENT_HUB_ACTIONS.includes(action as ContentHubAction);
}

export function resolveContentHubStatusTransition(
  currentStatus: string,
  action: unknown,
): TransitionResult {
  if (!isContentHubAction(action)) {
    return { ok: false, reason: 'invalid_action' };
  }

  const typedAction = action as ContentHubAction;
  if (!ALLOWED_SOURCE_STATUSES[typedAction].has(currentStatus)) {
    return { ok: false, reason: 'invalid_transition' };
  }

  return {
    ok: true,
    action: typedAction,
    targetStatus: TARGET_STATUS_BY_ACTION[typedAction],
  };
}
