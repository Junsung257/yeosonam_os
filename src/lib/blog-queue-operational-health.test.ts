import { describe, expect, it } from 'vitest';
import {
  classifyBlogQueueOperationalIssue,
  getBlogQueueOperationalState,
  summarizeBlogQueueOperationalHealth,
} from './blog-queue-operational-health';

describe('blog queue operational health', () => {
  it('classifies product open-contract failures even when stored failure_code is unknown', () => {
    const row = {
      status: 'failed',
      attempts: 1,
      last_error: 'product_customer_open_contract_failed:mobile_proof stale for current package',
      meta: { failure_code: 'unknown' },
    };

    expect(classifyBlogQueueOperationalIssue(row)).toBe('product_open_contract');
    expect(getBlogQueueOperationalState(row)).toMatchObject({
      attention: false,
      manualReview: true,
      retryable: false,
      terminal: true,
      action: 'collect_product_evidence',
    });
  });

  it('keeps quarantined editorial failures out of actionable failed counts', () => {
    const summary = summarizeBlogQueueOperationalHealth([
      {
        status: 'failed',
        attempts: 1,
        last_error: '1/19 failed: [intent_quality] early_strong_cta',
        meta: {
          failure_code: 'intent_quality',
          quarantine_reason: 'intent_quality',
          self_heal_blocked: true,
        },
      },
      {
        status: 'failed',
        attempts: 0,
        last_error: 'temporary database timeout',
        meta: {},
      },
    ]);

    expect(summary.actionable_failed_count).toBe(1);
    expect(summary.manual_review_count).toBe(1);
    expect(summary.action_counts).toMatchObject({
      editorial_backlog: 1,
      retry_failed: 1,
    });
  });

  it('routes max-attempt repairable quality failures to editorial recovery instead of hidden terminal', () => {
    const state = getBlogQueueOperationalState({
      status: 'failed',
      attempts: 2,
      last_error: '2/20 failed: [render_integrity] literal_markdown_bold · [article_quality_v2] standalone_markdown_bold',
      meta: {
        failure_code: 'render_integrity',
      },
    });

    expect(state).toMatchObject({
      attention: false,
      manualReview: true,
      retryable: false,
      terminal: true,
      action: 'editorial_backlog',
    });
  });

  it('marks old generating rows as stale recovery work', () => {
    const now = new Date('2026-07-01T00:00:00.000Z');
    const state = getBlogQueueOperationalState({
      status: 'generating',
      attempts: 1,
      updated_at: '2026-06-30T23:00:00.000Z',
    }, now);

    expect(state).toMatchObject({
      attention: true,
      retryable: true,
      action: 'recover_stale_generating',
    });
  });

  it('does not flag same-day queued inventory as overdue', () => {
    const now = new Date('2026-07-01T13:00:00.000Z');

    const sameDayReady = getBlogQueueOperationalState({
      status: 'queued',
      target_publish_at: '2026-07-01T03:00:00.000Z',
    }, now);
    const oldReady = getBlogQueueOperationalState({
      status: 'queued',
      target_publish_at: '2026-06-29T03:00:00.000Z',
    }, now);

    expect(sameDayReady).toMatchObject({
      attention: false,
      action: 'publish_ready',
    });
    expect(oldReady).toMatchObject({
      attention: true,
      action: 'publish_ready',
    });
  });

  it('does not report candidate-contract blockers as publish-ready queue inventory', () => {
    const summary = summarizeBlogQueueOperationalHealth([
      {
        status: 'queued',
        topic: '7월 호주 시드니 여행, 한국과 반대! 겨울 날씨와 즐길 거리 — 총정리',
        destination: '시드니',
        meta: { expected_slug: '7' },
      },
      {
        status: 'queued',
        topic: '클락 월별 날씨와 옷차림 가이드',
        destination: '클락',
        meta: { expected_slug: 'clark-monthly-weather-clothing' },
      },
      {
        status: 'queued',
        source: 'pillar',
        topic: '여름방학 가족 해외여행, 아이와 가기 좋은 안전한 휴양지 추천',
        meta: {},
      },
    ]);

    expect(summary.candidate_contract_blocked_count).toBe(1);
    expect(summary.pillar_deferred_count).toBe(1);
    expect(summary.overdue_queued_count).toBe(0);
    expect(summary.issue_counts).toMatchObject({
      candidate_pre_publish_contract: 1,
      pillar_deferred: 1,
      none: 1,
    });
    expect(summary.action_counts).toMatchObject({
      quarantine_candidate_contract: 1,
      defer_pillar_candidate: 1,
      publish_ready: 1,
    });
  });

  it('hides already quarantined candidate-contract failures from manual rewrite backlog', () => {
    const summary = summarizeBlogQueueOperationalHealth([
      {
        status: 'failed',
        topic: '괌 여행 가이드 2026 | 예산·경비·비용 체크',
        destination: '괌',
        last_error: 'candidate_pre_publish_contract:machine_topic_separator|weak_expected_slug',
        meta: {
          failure_code: 'candidate_pre_publish_contract',
          quarantine_reason: 'candidate_pre_publish_contract',
          self_heal_blocked: true,
        },
      },
    ]);

    expect(summary.manual_review_count).toBe(0);
    expect(summary.hidden_history_count).toBe(1);
    expect(summary.action_counts).toMatchObject({
      hidden_terminal: 1,
    });
  });
});
