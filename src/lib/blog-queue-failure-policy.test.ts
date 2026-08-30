import { describe, expect, it } from 'vitest';
import {
  classifyBlogQueueFailure,
  isBlogDuplicateQueueFailure,
  shouldSelfHealBlogQueueItem,
} from './blog-queue-failure-policy';
import { shouldQuarantineQueuedBlogItem } from './blog-queue-lifecycle';

describe('blog queue failure policy', () => {
  it('blocks self-heal for missing pillar context', () => {
    const decision = classifyBlogQueueFailure('푸꾸옥 context missing: attractions+packages 0');

    expect(decision).toMatchObject({
      code: 'context_missing',
      retryable: false,
      selfHealAllowed: false,
    });
    expect(shouldSelfHealBlogQueueItem({
      lastError: '푸꾸옥 context missing: attractions+packages 0',
    })).toBe(false);
  });

  it('keeps deterministic quality failures self-healable so quota can be recovered', () => {
    const decision = classifyBlogQueueFailure('1/13 failed: [structure_integrity] checklist_shape_invalid');

    expect(decision).toMatchObject({
      code: 'structure_integrity',
      retryable: true,
      selfHealAllowed: true,
    });
    expect(shouldSelfHealBlogQueueItem({
      lastError: '1/13 failed: [structure_integrity] checklist_shape_invalid',
    })).toBe(true);

    for (const reason of [
      '2/19 failed: [links] internal link missing',
      '2/19 failed: [keyword_density] stuffing risk',
      'SEO score 71/100 - internal_links_cta',
      'quality failed: [intent_quality] weak_reading_design',
      '2/19 failed: [length] thin content minimum length',
    ]) {
      expect(classifyBlogQueueFailure(reason)).toMatchObject({
        retryable: true,
        selfHealAllowed: true,
      });
      expect(shouldSelfHealBlogQueueItem({ lastError: reason })).toBe(true);
    }
  });

  it('keeps rendered markdown residue failures recoverable for a repaired rerun', () => {
    const decision = classifyBlogQueueFailure(
      '2/20 실패: [render_integrity] literal_markdown_bold · [article_quality_v2] standalone_markdown_bold',
    );

    expect(decision).toMatchObject({
      code: 'render_integrity',
      retryable: true,
      selfHealAllowed: true,
    });
    expect(shouldSelfHealBlogQueueItem({
      lastError: '2/20 실패: [render_integrity] literal_markdown_bold',
    })).toBe(true);
  });

  it('classifies article quality v2 residue when render gate is not present', () => {
    expect(classifyBlogQueueFailure(
      'quality failed: [article_quality_v2] article quality v2 failed: standalone_markdown_bold',
    )).toMatchObject({
      code: 'article_quality_v2',
      retryable: true,
      selfHealAllowed: true,
    });
  });

  it('keeps engine v2 quality gaps recoverable by the current category repair loop', () => {
    expect(classifyBlogQueueFailure(
      'quality failed: [engine_v2] engine v2 90/100: engine_task_incomplete (reader_task_completion:90)',
    )).toMatchObject({
      code: 'engine_v2',
      retryable: true,
      selfHealAllowed: true,
    });
    expect(shouldSelfHealBlogQueueItem({
      lastError: 'quality failed: [engine_v2] sales_pressure_control:80',
    })).toBe(true);
  });

  it('classifies thin content and link gate failures without hiding them as unknown', () => {
    expect(classifyBlogQueueFailure(
      '2/19 실패: [length] 본문 2467자 — info 최소 2500자 미달 (thin content)',
    )).toMatchObject({
      code: 'length',
      retryable: true,
      selfHealAllowed: true,
    });

    expect(classifyBlogQueueFailure(
      '2/19 실패: [links] 내부링크 0개 — 최소 1개 필요',
    )).toMatchObject({
      code: 'links',
      retryable: true,
      selfHealAllowed: true,
    });
    expect(shouldSelfHealBlogQueueItem({
      lastError: '2/19 실패: [links] 내부링크 0개 — 최소 1개 필요',
    })).toBe(true);
  });

  it('honors stored quarantine metadata even if the text is ambiguous', () => {
    expect(shouldSelfHealBlogQueueItem({
      lastError: 'self-heal blocked',
      meta: {
        failure_code: 'context_missing',
        self_heal_blocked: true,
      },
    })).toBe(false);
  });

  it('preflight-quarantines queued duplicate rows instead of reclaiming them', () => {
    expect(shouldQuarantineQueuedBlogItem({
      attempts: 0,
      lastError: 'duplicate slug already exists',
      meta: {},
    })).toMatchObject({
      quarantine: true,
      status: 'skipped',
      reason: 'duplicate_content',
    });
  });

  it('does not mistake the editorial duplicate gate for an existing canonical duplicate', () => {
    const reason = [
      'blog_quality_v4_rewrite_pro_high:unsupported_number',
      'internal_link_irrelevant',
      'publish_gate:duplicate',
      'publish_gate:links',
      'publish_gate:intent_quality',
    ].join(',');

    expect(isBlogDuplicateQueueFailure(reason)).toBe(false);
    expect(classifyBlogQueueFailure(reason)).toMatchObject({
      code: 'intent_quality',
      retryable: true,
      selfHealAllowed: true,
      skipped: false,
    });
  });

  it('still recognizes real duplicate ownership and slug collisions', () => {
    for (const reason of [
      'duplicate slug already exists',
      'information_representative_duplicate_upgrade_review:canonical-slug',
      'recent_info_duplicate_before_generation: 최근 14일 내 동일 목적지 글 이미 발행됨',
    ]) {
      expect(isBlogDuplicateQueueFailure(reason)).toBe(true);
      expect(classifyBlogQueueFailure(reason)).toMatchObject({
        code: 'duplicate_content',
        retryable: false,
        skipped: true,
      });
    }
  });

  it('preflight-keeps retryable queued rows under the attempt limit', () => {
    expect(shouldQuarantineQueuedBlogItem({
      attempts: 1,
      lastError: 'temporary database timeout',
      meta: {},
      maxAttempts: 2,
    })).toMatchObject({
      quarantine: false,
    });
  });

  it('preflight-quarantines retryable rows after the attempt limit', () => {
    expect(shouldQuarantineQueuedBlogItem({
      attempts: 2,
      lastError: 'temporary database timeout',
      meta: {},
      maxAttempts: 2,
    })).toMatchObject({
      quarantine: true,
      status: 'failed',
      reason: 'db_write',
    });
  });

  it('preflight-quarantines evidence-insufficient candidates before another claim', () => {
    expect(shouldQuarantineQueuedBlogItem({
      attempts: 0,
      lastError: null,
      meta: { evidence_insufficient: true },
    })).toMatchObject({
      quarantine: true,
      status: 'failed',
      reason: 'evidence_insufficient',
    });
  });

  it('treats product open-contract failures as non-retryable publisher blockers', () => {
    expect(classifyBlogQueueFailure(
      'product_customer_open_contract_failed:mobile_proof:actual /packages mobile browser proof is stale',
    )).toMatchObject({
      code: 'product_open_contract',
      retryable: false,
      selfHealAllowed: false,
      skipped: false,
    });

    expect(shouldQuarantineQueuedBlogItem({
      attempts: 0,
      lastError: 'product_customer_open_contract_failed:mobile_proof:actual customer mobile browser proof hashes are missing',
      meta: {},
    })).toMatchObject({
      quarantine: true,
      status: 'failed',
      reason: 'product_open_contract',
    });
  });

  it('does not let stored unknown failure_code hide a product open-contract blocker', () => {
    expect(shouldSelfHealBlogQueueItem({
      lastError: 'product_customer_open_contract_failed:mobile_proof stale',
      meta: { failure_code: 'unknown' },
    })).toBe(false);

    expect(shouldQuarantineQueuedBlogItem({
      attempts: 1,
      lastError: 'product_customer_open_contract_failed:mobile_proof stale',
      meta: { failure_code: 'unknown' },
      maxAttempts: 2,
    })).toMatchObject({
      quarantine: true,
      status: 'failed',
      reason: 'product_open_contract',
    });
  });

  it('classifies blocked deterministic fallback artifacts as recoverable generation failures', () => {
    expect(classifyBlogQueueFailure(
      'deterministic_info_fallback_not_publishable',
    )).toMatchObject({
      code: 'deterministic_fallback_blocked',
      retryable: true,
      selfHealAllowed: true,
      skipped: false,
    });
  });

  it('retries a source-backed research payload emptied by sanitization', () => {
    expect(classifyBlogQueueFailure(
      'auto_research_extraction_empty:missing_sources,missing_evidence,missing_claims',
    )).toMatchObject({
      code: 'research_extraction',
      retryable: true,
      selfHealAllowed: true,
      skipped: false,
    });
  });
});
