export type OpsQueueAction =
  | 'executor_dry_run'
  | 'confirm_failed'
  | 'acknowledge_blocker';

export type OpsQueueSource =
  | 'platform_job'
  | 'conversion_upload_job'
  | 'platform_job_confirmation'
  | 'conversion_upload_confirmation'
  | 'execution_attempt';

export type OpsQueueActionDecision = {
  allowed: boolean;
  action: OpsQueueAction;
  source: OpsQueueSource;
  targetType: 'platform_job' | 'conversion_upload_job' | 'execution_attempt';
  externalApiWrite: false;
  resultStatus?: 'failed';
  blockedReason?: string;
};

const PLATFORM_SOURCES = new Set<OpsQueueSource>(['platform_job', 'platform_job_confirmation']);

export function decideOpsQueueAction(input: {
  source: string;
  action: string;
}): OpsQueueActionDecision {
  const source = input.source as OpsQueueSource;
  const action = input.action as OpsQueueAction;
  const validSources: OpsQueueSource[] = [
    'platform_job',
    'conversion_upload_job',
    'platform_job_confirmation',
    'conversion_upload_confirmation',
    'execution_attempt',
  ];
  const validActions: OpsQueueAction[] = ['executor_dry_run', 'confirm_failed', 'acknowledge_blocker'];

  if (!validSources.includes(source)) {
    return {
      allowed: false,
      action: 'acknowledge_blocker',
      source: 'execution_attempt',
      targetType: 'execution_attempt',
      externalApiWrite: false,
      blockedReason: 'invalid_ops_queue_source',
    };
  }
  if (!validActions.includes(action)) {
    return {
      allowed: false,
      action: 'acknowledge_blocker',
      source,
      targetType: source === 'execution_attempt' ? 'execution_attempt' : PLATFORM_SOURCES.has(source) ? 'platform_job' : 'conversion_upload_job',
      externalApiWrite: false,
      blockedReason: 'invalid_ops_queue_action',
    };
  }

  const targetType = source === 'execution_attempt'
    ? 'execution_attempt'
    : PLATFORM_SOURCES.has(source)
      ? 'platform_job'
      : 'conversion_upload_job';

  if (action === 'executor_dry_run' && !['platform_job', 'conversion_upload_job'].includes(source)) {
    return {
      allowed: false,
      action,
      source,
      targetType,
      externalApiWrite: false,
      blockedReason: 'executor_dry_run_requires_executor_queue_row',
    };
  }

  if (action === 'confirm_failed' && !['platform_job_confirmation', 'conversion_upload_confirmation'].includes(source)) {
    return {
      allowed: false,
      action,
      source,
      targetType,
      externalApiWrite: false,
      blockedReason: 'confirm_failed_requires_confirmation_queue_row',
    };
  }

  return {
    allowed: true,
    action,
    source,
    targetType,
    externalApiWrite: false,
    resultStatus: action === 'confirm_failed' ? 'failed' : undefined,
  };
}
