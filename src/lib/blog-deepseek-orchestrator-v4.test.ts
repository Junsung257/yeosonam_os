import { describe, expect, it } from 'vitest';
import {
  BLOG_DEEPSEEK_MODELS,
  buildDeepSeekRewritePromptV4,
  calculateDeepSeekCostV4,
  decideBlogQualityRouteV4,
  isBlogGenerationWindowKstV4,
  isDeepSeekOffPeakAt,
  isDeepSeekPeakAt,
  nextBlogPublicationSlotKstV4,
  normalizeBlogWriterHeadingV4,
  resolveBlogPublicationRampCapV4,
  resolveDeepSeekPriceV4,
} from './blog-deepseek-orchestrator-v4';

describe('blog DeepSeek orchestrator V4', () => {
  it('publishes only a blocker-free score of 90 or more', () => {
    expect(decideBlogQualityRouteV4({ score: 90, completedAttempts: 1 })).toMatchObject({
      route: 'approved_for_slot', publishable: true,
    });
    expect(decideBlogQualityRouteV4({
      score: 96, completedAttempts: 1, hardBlockers: ['unsupported_number'],
    })).toMatchObject({ route: 'rewrite_pro_high', publishable: false });
    expect(decideBlogQualityRouteV4({
      score: 100, completedAttempts: 1, failureReasons: ['publish_gate:public_customer_quality'],
    })).toMatchObject({ route: 'rewrite_pro_high', publishable: false });
  });

  it('re-researches missing evidence but rewrites removable unsupported prose', () => {
    expect(decideBlogQualityRouteV4({
      score: 71, completedAttempts: 1, hardBlockers: ['missing_evidence'],
    })).toMatchObject({ route: 'reresearch', nextStage: null });
    expect(decideBlogQualityRouteV4({
      score: 71, completedAttempts: 1, hardBlockers: ['unsupported_number'],
    })).toMatchObject({ route: 'rewrite_pro_max', nextStage: 'rewrite_pro_max' });
    expect(decideBlogQualityRouteV4({
      score: 82, completedAttempts: 1, hardBlockers: ['unsupported_first_party_claim'],
    })).toMatchObject({ route: 'rewrite_pro_high', nextStage: 'rewrite_pro_high' });
  });

  it('routes 75-89 to Pro high and lower soft scores to Pro max', () => {
    expect(decideBlogQualityRouteV4({ score: 89.99, completedAttempts: 1 }).nextStage).toBe('rewrite_pro_high');
    expect(decideBlogQualityRouteV4({ score: 74.99, completedAttempts: 1 }).nextStage).toBe('rewrite_pro_max');
  });

  it('uses the third model call for a final max rewrite even when attempt two did not converge', () => {
    expect(decideBlogQualityRouteV4({
      score: 79,
      previousScore: 76,
      completedAttempts: 2,
    })).toMatchObject({
      route: 'rewrite_pro_max',
      nextStage: 'rewrite_pro_max',
      reasons: expect.arrayContaining(['final_rewrite_attempt', 'rewrite_not_converging_observed']),
    });
    expect(decideBlogQualityRouteV4({
      score: 74,
      previousScore: 70,
      completedAttempts: 2,
      hardBlockers: ['unsupported_number'],
    })).toMatchObject({ route: 'rewrite_pro_max', nextStage: 'rewrite_pro_max' });
  });

  it('quarantines only after the third completed model call', () => {
    expect(decideBlogQualityRouteV4({ score: 89, completedAttempts: 3 }).route).toBe('quarantine');
  });

  it('builds a bounded rewrite contract that preserves the claim-ledger envelope', () => {
    const prompt = buildDeepSeekRewritePromptV4({
      originalDraft: '# 다낭\n\n초안 본문',
      failureEvidence: ['unsupported_number', 'primary_decision_not_answered'],
      researchFingerprint: 'research-1',
      claimFingerprint: 'claims-1',
      evidencePacket: {
        fixedTitle: '다낭 가볼만한곳: 일정과 체력으로 선택하기',
        primaryQuery: '다낭 가볼만한곳',
        primaryDecision: '내 일정에 어떤 장소가 맞는가?',
        sectionPurposes: ['선택 기준 — 체력에 맞는 장소는 어디인가?'],
        approvedClaims: [{
          claimText: '오행산은 도시에서 15분 거리입니다.',
          claimType: 'duration',
          riskLevel: 'LOW',
          sourceUrls: ['https://vietnam.travel/example'],
        }],
        officialSourceUrls: ['https://vietnam.travel/example'],
        internalLink: 'https://www.yeosonam.com/blog/destination/%EB%8B%A4%EB%82%AD',
        includeFaq: false,
        includeChecklist: false,
      },
    });

    expect(prompt).toContain('Answer that decision directly in the first paragraph.');
    expect(prompt).toContain('Delete every numeric expression that does not appear verbatim in an approved claim.');
    expect(prompt).toContain('INFORMATION_CLAIM_LEDGER_START');
    expect(prompt).toContain('INFORMATION_CLAIM_LEDGER_END -->');
    expect(prompt).toContain('- unsupported_number');
    expect(prompt).not.toContain('# 다낭\n\n초안 본문');
    expect(prompt).toContain('previous draft is intentionally omitted');
    expect(prompt).toContain('Approved claims (the complete factual universe');
    expect(prompt).toContain('오행산은 도시에서 15분 거리입니다.');
    expect(prompt).toContain('Do not use a table in this rewrite.');
    expect(prompt).toContain('The ledger must contain only the approved claim sentences');
    expect(prompt).toContain('exact citation markdown: [공식 근거](https://vietnam.travel/example)');
    expect(prompt).toContain('source-neutral editorial guidance');
    expect(prompt).toContain('one question-form H2');
    expect(prompt).toContain('Markdown bullet list of exactly 3 distinct reader-choice questions');
    expect(prompt).toContain('do not repeat a four-word Korean phrase more than twice');
    expect(prompt).toContain('Keep evidence-section H2 labels neutral');
    expect(prompt).toContain('Do not introduce a new place property inside a question');
  });

  it('normalizes only an exact plain fixed title into an H1', () => {
    expect(normalizeBlogWriterHeadingV4('고정 제목\n\n첫 문단입니다.', '고정 제목'))
      .toBe('# 고정 제목\n\n첫 문단입니다.');
    expect(normalizeBlogWriterHeadingV4('다른 제목\n\n첫 문단입니다.', '고정 제목'))
      .toBe('다른 제목\n\n첫 문단입니다.');
  });

  it('never auto-publishes HIGH risk without human approval', () => {
    expect(decideBlogQualityRouteV4({ score: 100, completedAttempts: 1, riskLevel: 'HIGH' })).toMatchObject({
      route: 'human_review', publishable: false,
    });
  });

  it('uses the official post-transition UTC peak windows', () => {
    expect(isDeepSeekPeakAt(new Date('2026-08-17T01:00:00.000Z'))).toBe(true);
    expect(isDeepSeekPeakAt(new Date('2026-08-17T04:00:00.000Z'))).toBe(false);
    expect(isDeepSeekPeakAt(new Date('2026-08-17T06:00:00.000Z'))).toBe(true);
    expect(isDeepSeekOffPeakAt(new Date('2026-08-17T10:00:00.000Z'))).toBe(true);
  });

  it('prices cache hit, miss and output tokens separately without a cheap unknown fallback', () => {
    expect(calculateDeepSeekCostV4(BLOG_DEEPSEEK_MODELS.draft, {
      inputTokens: 1_000_000, cacheHitInputTokens: 250_000, outputTokens: 100_000,
    }, new Date('2026-08-17T11:00:00.000Z')).estimatedCostUsd).toBe(0.23275);
    expect(() => resolveDeepSeekPriceV4('deepseek-unknown')).toThrow(/unsupported/);
  });

  it('recognizes the overnight KST compute window and clamps publication ramp stages', () => {
    expect(isBlogGenerationWindowKstV4(new Date('2026-08-16T16:00:00.000Z'))).toBe(true);
    expect(isBlogGenerationWindowKstV4(new Date('2026-08-16T22:00:00.000Z'))).toBe(false);
    expect(resolveBlogPublicationRampCapV4('max_20').cap).toBe(20);
    expect(resolveBlogPublicationRampCapV4('invalid').cap).toBe(3);
    expect(nextBlogPublicationSlotKstV4(new Date('2026-08-16T17:00:00.000Z')))
      .toBe('2026-08-17T00:00:00.000Z');
    expect(nextBlogPublicationSlotKstV4(new Date('2026-08-17T13:00:00.000Z')))
      .toBe('2026-08-18T00:00:00.000Z');
  });
});
