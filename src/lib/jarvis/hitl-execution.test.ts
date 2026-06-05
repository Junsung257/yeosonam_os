import { describe, expect, it } from 'vitest';
import { buildHitlFailurePayload, decideHitlReviewStatus } from './hitl-execution';

describe('Jarvis HITL execution decisions', () => {
  it('marks rejected review as terminal and not retryable', () => {
    expect(decideHitlReviewStatus({ approved: false })).toEqual({
      nextStatus: 'rejected',
      retryable: false,
      terminal: true,
      message: '취소되었습니다.',
    });
  });

  it('marks successful approval as approved terminal state', () => {
    expect(decideHitlReviewStatus({ approved: true, executionSuccess: true })).toEqual({
      nextStatus: 'approved',
      retryable: false,
      terminal: true,
      message: '실행 완료되었습니다.',
    });
  });

  it('keeps failed execution pending so the operator can retry', () => {
    expect(decideHitlReviewStatus({ approved: true, executionSuccess: false })).toMatchObject({
      nextStatus: 'pending',
      retryable: true,
      terminal: false,
    });
  });

  it('returns retry metadata for failed execution responses', () => {
    expect(buildHitlFailurePayload({
      error: 'handler unavailable',
      toolName: 'create_booking',
      toolArgs: { booking_id: 'B-1' },
      pendingActionId: 'pa-1',
    })).toMatchObject({
      error: 'handler unavailable',
      retryable: true,
      nextStatus: 'pending',
      errorDetails: {
        toolName: 'create_booking',
        pendingActionId: 'pa-1',
      },
    });
  });
});
