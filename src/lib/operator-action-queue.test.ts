import { describe, expect, it } from 'vitest';
import { decideOperatorQueueAction } from './operator-action-queue';

const now = new Date('2026-07-29T12:00:00.000Z');

describe('operator action queue', () => {
  it('puts a fresh lead first with one clear contact action', () => {
    expect(decideOperatorQueueAction({
      source: 'lead',
      createdAt: '2026-07-29T11:55:00.000Z',
      phone: '010-1234-5678',
      now,
    })).toMatchObject({
      rank: 1,
      label: '신규 상담',
      action: '연락하기',
      href: 'tel:01012345678',
    });
  });

  it('escalates an unanswered lead after ten minutes', () => {
    expect(decideOperatorQueueAction({
      source: 'lead',
      createdAt: '2026-07-29T11:40:00.000Z',
      phone: '010-1234-5678',
      now,
    })).toMatchObject({
      rank: 2,
      label: '10분 이상 미응답',
      waitingMinutes: 20,
    });
  });

  it('maps booking workflow tasks to the required next action', () => {
    expect(decideOperatorQueueAction({
      source: 'lead',
      createdAt: '2026-07-29T11:58:00.000Z',
      phone: '010-1234-5678',
      bookingId: 'booking-id',
      taskType: 'seat_check_required',
      now,
    })).toMatchObject({
      rank: 1,
      action: '연락하기',
      href: 'tel:01012345678',
    });
  });

  it('removes resolved workflow tasks from the active queue', () => {
    expect(decideOperatorQueueAction({
      source: 'lead',
      createdAt: '2026-07-29T10:00:00.000Z',
      bookingId: 'booking-id',
      taskType: 'seat_check_required',
      taskStatus: 'resolved',
      now,
    })).toMatchObject({
      rank: 8,
      action: '종료',
    });
  });
});
