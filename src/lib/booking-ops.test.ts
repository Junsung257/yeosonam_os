import { describe, expect, it } from 'vitest';
import {
  getBookingTaskAction,
  buildBookingOpsRuleHealth,
  groupBookingOpsActions,
  scoreBookingOpsAction,
  sortBookingOpsActions,
  toBookingOpsAction,
} from './booking-ops';
import type { InboxTaskRow } from '@/types/booking-tasks';

function task(overrides: Partial<InboxTaskRow>): InboxTaskRow {
  return {
    id: 'task-1',
    booking_id: 'booking-1',
    booking_no: 'BK-0001',
    package_title: 'Test package',
    customer_name: 'Test customer',
    departure_date: '2026-06-20',
    task_type: 'unpaid_balance_d7',
    priority: 1,
    title: 'Balance due',
    context: {},
    status: 'open',
    created_at: '2026-06-16T00:00:00.000Z',
    snoozed_until: null,
    ...overrides,
  };
}

describe('booking ops task mapping', () => {
  it('maps known task types to actionable CTAs', () => {
    expect(getBookingTaskAction('unpaid_balance_d7')).toMatchObject({
      kind: 'collect_balance',
      cta: '잔금 확인',
      autoResolvable: true,
    });
    expect(getBookingTaskAction('seat_check_required')).toMatchObject({
      kind: 'seat_check',
      cta: '좌석 확인',
      autoResolvable: false,
    });
  });

  it('falls back to opening the booking for unknown task types', () => {
    expect(getBookingTaskAction('custom_task')).toMatchObject({
      kind: 'open_booking',
      cta: '예약 열기',
      autoResolvable: false,
    });
  });

  it('scores urgent, stale, departure, and money risk signals', () => {
    const urgent = scoreBookingOpsAction({
      taskType: 'unpaid_balance_d7',
      priority: 0,
      ageMinutes: 60 * 49,
      amountAtRisk: 2_000_000,
      daysToDeparture: 2,
      autoResolvable: true,
    });
    const normal = scoreBookingOpsAction({
      taskType: 'happy_call_followup',
      priority: 2,
      ageMinutes: 30,
      amountAtRisk: 0,
      daysToDeparture: null,
      autoResolvable: true,
    });

    expect(urgent.score).toBeGreaterThan(normal.score);
    expect(urgent.reasons).toContain('48시간 초과');
    expect(urgent.reasons).toContain('출발 D-2');
  });

  it('sorts by next-best-action score first', () => {
    const now = new Date('2026-06-16T12:00:00.000Z');
    const actions = [
      toBookingOpsAction(task({ id: 'normal-old', priority: 2, created_at: '2026-06-15T00:00:00.000Z' }), now),
      toBookingOpsAction(task({ id: 'urgent-new', priority: 0, created_at: '2026-06-16T11:00:00.000Z', context: { balance: 100_000, days_until: 6 } }), now),
      toBookingOpsAction(task({ id: 'urgent-old', priority: 0, created_at: '2026-06-16T08:00:00.000Z', context: { balance: 2_000_000, days_until: 2 } }), now),
    ];

    expect(sortBookingOpsActions(actions).map((action) => action.id)).toEqual([
      'urgent-old',
      'urgent-new',
      'normal-old',
    ]);
  });

  it('groups multiple tasks on the same booking under the top action', () => {
    const now = new Date('2026-06-16T12:00:00.000Z');
    const grouped = groupBookingOpsActions([
      toBookingOpsAction(task({ id: 'balance', booking_id: 'booking-1', task_type: 'unpaid_balance_d7', context: { balance: 2_000_000, days_until: 2 } }), now),
      toBookingOpsAction(task({ id: 'docs', booking_id: 'booking-1', task_type: 'doc_missing_d3', context: { days_until: 2 } }), now),
      toBookingOpsAction(task({ id: 'other', booking_id: 'booking-2', task_type: 'happy_call_followup', priority: 2 }), now),
    ]);

    expect(grouped[0]).toMatchObject({
      id: 'balance',
      groupedTaskCount: 2,
      groupedTaskIds: ['balance', 'docs'],
    });
    expect(grouped[0].relatedActions.map((action) => action.id)).toEqual(['docs']);
  });

  it('surfaces stale and low-auto-resolve rule health signals', () => {
    const now = new Date('2026-06-16T12:00:00.000Z');
    const ruleHealth = buildBookingOpsRuleHealth([
      { task_type: 'unpaid_balance_d7', status: 'open', created_at: '2026-06-14T11:00:00.000Z' },
      { task_type: 'unpaid_balance_d7', status: 'open', created_at: '2026-06-14T10:00:00.000Z' },
      { task_type: 'unpaid_balance_d7', status: 'snoozed', created_at: '2026-06-14T09:00:00.000Z' },
      { task_type: 'unpaid_balance_d7', status: 'resolved', created_at: '2026-06-15T09:00:00.000Z', resolved_at: '2026-06-16T10:00:00.000Z' },
      { task_type: 'doc_missing_d3', status: 'auto_resolved', created_at: '2026-06-16T08:00:00.000Z', resolved_at: '2026-06-16T09:00:00.000Z' },
    ], now);

    expect(ruleHealth[0]).toMatchObject({
      taskType: 'unpaid_balance_d7',
      staleOver48h: 3,
      tuneReason: '오래된 작업 과다',
    });
    expect(ruleHealth.find((rule) => rule.taskType === 'doc_missing_d3')?.autoResolveRatePct).toBe(100);
  });
});
