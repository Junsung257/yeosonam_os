import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ANALYTICS_EVENTS } from './analytics-events';
import { trackEngagement } from './tracker';

function latestTrackingPayload(fetchMock: ReturnType<typeof vi.fn>) {
  const [, init] = fetchMock.mock.calls.at(-1) ?? [];
  return JSON.parse(String((init as RequestInit).body));
}

describe('admin productivity tracking enrichment', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['/admin/payments?filter=outstanding', 'payments_outstanding'],
    ['/admin/payments?filter=unmatched', 'payments_unmatched'],
    ['/admin/land-settlements', 'land_settlements'],
    ['/admin/bookings?status=pending,confirmed', 'bookings_active'],
    ['/admin/rfqs', 'rfqs_queue'],
  ])('adds a specific queue key for %s', (href, expectedQueueKey) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    trackEngagement({
      event_type: ANALYTICS_EVENTS.adminActionCompleted,
      page_url: '/admin',
      metadata: {
        surface: 'today_work_queue',
        action: 'queue_opened',
        href,
      },
    });

    const payload = latestTrackingPayload(fetchMock);
    expect(payload.queue_key).toBe(expectedQueueKey);
    expect(payload.task_flow).toBe('dashboard_triage');
    expect(payload.command_source).toBe('today_work_queue');
    expect(payload.action_stage).toBe('navigation');
    expect(payload.click_count).toBe(1);
  });

  it('classifies RFQ action queue events as RFQ operations', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    trackEngagement({
      event_type: ANALYTICS_EVENTS.adminActionCompleted,
      page_url: '/admin/rfqs',
      metadata: {
        surface: 'rfqs_action_queue',
        action: 'select_queue',
        queue: 'rfqs_draft',
        count: 3,
      },
    });

    const payload = latestTrackingPayload(fetchMock);
    expect(payload.queue_key).toBe('rfqs_draft');
    expect(payload.task_flow).toBe('rfq_operations');
    expect(payload.command_source).toBe('work_queue');
    expect(payload.action_stage).toBe('navigation');
    expect(payload.click_count).toBe(1);
  });
});
