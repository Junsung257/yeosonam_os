type ExternalPublishStageInput = {
  apply: boolean;
  canPublish: boolean;
  requests: Array<{ id: string }>;
  externalApiWrite: boolean;
  confirmExternalResult?: boolean;
};

export function decideExternalPublishStaging(input: ExternalPublishStageInput) {
  const requested = input.requests.length;
  const canStage = input.apply && input.canPublish && requested > 0;
  const externalApiWrite = input.externalApiWrite === true;
  const markApplied = canStage && externalApiWrite && input.confirmExternalResult === true;
  const blockers: string[] = [];

  if (!input.apply) blockers.push('dry_run_only');
  if (!input.canPublish) blockers.push('channel_not_executable');
  if (requested === 0) blockers.push('no_approved_requests');
  if (!externalApiWrite) blockers.push('external_api_write_not_performed');
  if (externalApiWrite && input.confirmExternalResult !== true) blockers.push('external_result_confirmation_required');

  return {
    can_stage_for_executor: canStage,
    mark_change_request_applied: markApplied,
    staged_request_ids: canStage ? input.requests.map((request) => request.id) : [],
    applied_request_ids: markApplied ? input.requests.map((request) => request.id) : [],
    external_api_write: false as const,
    external_api_write_performed: externalApiWrite,
    blockers: markApplied ? [] : blockers,
    next_action: markApplied
      ? 'External mutation was confirmed; change request can be marked applied.'
      : canStage
        ? 'Create audit/platform-job records only. Keep change request approved until audited executor confirms external result.'
        : 'Keep change request approved/proposed and resolve blockers before executor staging.',
  };
}
