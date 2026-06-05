export type JarvisPendingActionStatus = 'pending' | 'approved' | 'rejected';

export interface HitlReviewDecision {
  nextStatus: JarvisPendingActionStatus;
  retryable: boolean;
  terminal: boolean;
  message: string;
}

export function decideHitlReviewStatus(input: {
  approved: boolean;
  executionSuccess?: boolean;
}): HitlReviewDecision {
  if (!input.approved) {
    return {
      nextStatus: 'rejected',
      retryable: false,
      terminal: true,
      message: '취소되었습니다.',
    };
  }

  if (input.executionSuccess === true) {
    return {
      nextStatus: 'approved',
      retryable: false,
      terminal: true,
      message: '실행 완료되었습니다.',
    };
  }

  return {
    nextStatus: 'pending',
    retryable: true,
    terminal: false,
    message: '실행에 실패했습니다. 문제를 수정한 뒤 다시 승인할 수 있습니다.',
  };
}

export function buildHitlFailurePayload(params: {
  error: string;
  toolName: string;
  toolArgs: unknown;
  pendingActionId: string;
}) {
  return {
    error: params.error,
    retryable: true,
    nextStatus: 'pending' as const,
    message: '실행에 실패했습니다. 문제를 수정한 뒤 다시 승인할 수 있습니다.',
    errorDetails: {
      toolName: params.toolName,
      toolArgs: params.toolArgs,
      pendingActionId: params.pendingActionId,
    },
  };
}
