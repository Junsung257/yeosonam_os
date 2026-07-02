import { describe, expect, it } from 'vitest';
import {
  buildBlogEditorialBacklogWorkReport,
  categorizeEditorialBacklogBlocker,
  extractEditorialBacklogBlockers,
} from './blog-editorial-backlog-work';

describe('blog editorial backlog work', () => {
  it('extracts gate blockers from meta and bracketed queue errors', () => {
    const blockers = extractEditorialBacklogBlockers({
      status: 'failed',
      attempts: 2,
      last_error: '1/19 failed: [intent_quality] early_strong_cta, [structure_integrity] checklist_shape_invalid',
      meta: {
        failure_code: 'intent_quality',
        quarantine_reason: 'intent_quality',
        self_heal_blocked: true,
      },
    });

    expect(blockers).toEqual(expect.arrayContaining([
      'intent_quality',
      'intent_quality:early_strong_cta',
      'structure_integrity:checklist_shape_invalid',
    ]));
  });

  it('maps editorial blockers into operational categories', () => {
    expect(categorizeEditorialBacklogBlocker('intent_quality:early_strong_cta')).toBe('reader_intent');
    expect(categorizeEditorialBacklogBlocker('structure_integrity:raw_directive_leak')).toBe('structure');
    expect(categorizeEditorialBacklogBlocker('keyword_density')).toBe('keyword_use');
    expect(categorizeEditorialBacklogBlocker('engine_v2:product_decision_helpfulness')).toBe('engine_contract');
  });

  it('summarizes only quarantined editorial backlog rows', () => {
    const report = buildBlogEditorialBacklogWorkReport({
      now: new Date('2026-07-02T00:00:00.000Z'),
      rows: [
        {
          id: 'queue-intent',
          status: 'failed',
          attempts: 2,
          topic: '발리 가족 예산',
          destination: '발리',
          source: 'micro_angle',
          updated_at: '2026-07-01T00:00:00.000Z',
          last_error: '1/19 failed: [intent_quality] early_strong_cta',
          meta: {
            failure_code: 'intent_quality',
            quarantine_reason: 'intent_quality',
            self_heal_blocked: true,
          },
        },
        {
          id: 'queue-retry',
          status: 'failed',
          attempts: 0,
          last_error: 'temporary database timeout',
          meta: {},
        },
      ],
    });

    expect(report.total).toBe(1);
    expect(report.issue_counts).toMatchObject({ intent_quality: 1 });
    expect(report.category_counts).toMatchObject({ reader_intent: 1 });
    expect(report.next_actions).toEqual(['repair_info_or_product_writer_intent_contract']);
    expect(report.samples[0]).toMatchObject({
      queue_id: 'queue-intent',
      topic: '발리 가족 예산',
      blocker_categories: ['reader_intent'],
    });
  });
});
