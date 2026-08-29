import { describe, expect, it } from 'vitest';
import { evaluateBlogEngineV2 } from './blog-engine-v2';
import { inspectPublicBlogCustomerQuality } from './blog-public-customer-quality';
import { checkAiReadability } from './blog-quality-gate';
import { renderBlogContentToHtml } from './blog-renderer';
import {
  BLOG_DEEPSEEK_MODELS,
  BLOG_QUALITY_MAX_ATTEMPTS_V4,
  buildDeepSeekRewritePromptV4,
  calculateDeepSeekCostV4,
  decideBlogQualityRouteV4,
  isBlogGenerationWindowKstV4,
  isDeepSeekOffPeakAt,
  isDeepSeekPeakAt,
  nextBlogPublicationSlotKstV4,
  normalizeBlogWriterHeadingV4,
  repairFoodBudgetRewriteOpeningV4,
  resolveBlogGenerationModelV4,
  resolveBlogPublicationRampCapV4,
  resolveDeepSeekPriceV4,
  selectDecisionRelevantRewriteClaimsV4,
} from './blog-deepseek-orchestrator-v4';

describe('blog DeepSeek orchestrator V4', () => {
  it('repairs a generic food-budget rewrite opening with reviewed source domains', () => {
    const repaired = repairFoodBudgetRewriteOpeningV4({
      markdown: [
        '# 괌 여행 식비 예산',
        '',
        '이 예산은 여행 방식별 포함 범위에 따라 달라집니다.',
        '',
        '## 근거 확인',
        '승인 문장',
      ].join('\n'),
      primaryQuery: '괌 여행 식비 예산',
      intentType: 'food_budget',
      approvedClaims: [{
        claimText: '승인 문장',
        claimType: 'price',
        riskLevel: 'MEDIUM',
        sourceUrls: ['https://chinfe.menuguam.com/', 'https://www.numbeo.com/example'],
      }],
    });

    expect(repaired).toContain('chinfe.menuguam.com·numbeo.com 근거 링크부터 확인');
    expect(repaired).not.toContain('이 예산은 여행 방식별 포함 범위에 따라 달라집니다.');
    expect(repaired).toContain('## 근거 확인');
  });

  it('repairs the opening after a plain fixed title is normalized to H1', () => {
    const normalized = normalizeBlogWriterHeadingV4([
      '괌 여행 식비 예산',
      '',
      '이 예산은 확인일 기준으로 수집된 항목만 포함합니다.',
      '',
      '## 근거 확인',
      '승인 문장',
    ].join('\n'), '괌 여행 식비 예산');
    const repaired = repairFoodBudgetRewriteOpeningV4({
      markdown: normalized,
      primaryQuery: '괌 여행 식비 예산',
      intentType: 'food_budget',
      approvedClaims: [{
        claimText: '승인 문장',
        claimType: 'price',
        riskLevel: 'MEDIUM',
        sourceUrls: ['https://chinfe.menuguam.com/'],
      }],
    });

    expect(normalized).toMatch(/^# 괌 여행 식비 예산/);
    expect(repaired).toContain('chinfe.menuguam.com 근거 링크부터 확인');
    expect(repaired).not.toContain('이 예산은 확인일 기준으로 수집된 항목만 포함합니다.');
  });

  it('does not replace a food-budget opening containing a number', () => {
    const markdown = '# 괌 식비\n\n승인된 가격은 25 USD이다.\n\n## 근거\n본문';
    expect(repairFoodBudgetRewriteOpeningV4({
      markdown,
      primaryQuery: '괌 식비',
      intentType: 'food_budget',
      approvedClaims: [{
        claimText: '승인된 가격은 25 USD이다.',
        claimType: 'price',
        riskLevel: 'MEDIUM',
        sourceUrls: ['https://example.com'],
      }],
    })).toBe(markdown);
  });

  it('publishes only a blocker-free score of 90 or more', () => {
    expect(decideBlogQualityRouteV4({ score: 90, completedAttempts: 1 })).toMatchObject({
      route: 'approved_for_slot', publishable: true,
    });
    expect(decideBlogQualityRouteV4({
      score: 96, completedAttempts: 1, hardBlockers: ['unsupported_number'],
    })).toMatchObject({ route: 'reresearch', publishable: false });
    expect(decideBlogQualityRouteV4({
      score: 100, completedAttempts: 1, failureReasons: ['publish_gate:public_customer_quality'],
    })).toMatchObject({ route: 'rewrite_pro_high', publishable: false });
  });

  it('re-researches missing or unsupported facts instead of asking a model to invent a repair', () => {
    expect(decideBlogQualityRouteV4({
      score: 71, completedAttempts: 1, hardBlockers: ['missing_evidence'],
    })).toMatchObject({ route: 'reresearch', nextStage: 'rewrite_pro_high' });
    expect(decideBlogQualityRouteV4({
      score: 71, completedAttempts: 1, hardBlockers: ['unsupported_number'],
    })).toMatchObject({ route: 'reresearch', nextStage: 'rewrite_pro_high' });
    expect(decideBlogQualityRouteV4({
      score: 82, completedAttempts: 1, hardBlockers: ['unsupported_first_party_claim'],
    })).toMatchObject({ route: 'reresearch', nextStage: 'rewrite_pro_high' });
  });

  it('routes 75-89 to Pro high and grounded sub-75 expression failures to DeepSeek Pro max', () => {
    expect(decideBlogQualityRouteV4({ score: 89.99, completedAttempts: 1 }).nextStage).toBe('rewrite_pro_high');
    expect(decideBlogQualityRouteV4({
      score: 74.99,
      completedAttempts: 1,
      researchValid: true,
      claimLedgerValid: true,
      failureReasons: ['primary_decision_not_answered', 'section_purpose_coverage'],
    })).toMatchObject({ route: 'rewrite_pro_max', nextStage: 'rewrite_pro_max' });
  });

  it('treats a missing concrete itinerary as rewritable structure when research is valid', () => {
    expect(decideBlogQualityRouteV4({
      score: 72,
      completedAttempts: 1,
      failureReasons: ['concrete_itinerary_blocks_missing'],
      researchValid: true,
      claimLedgerValid: true,
    })).toMatchObject({
      route: 'rewrite_pro_max',
      nextStage: 'rewrite_pro_max',
      publishable: false,
    });
  });

  it('uses bounded Pro repair calls when an earlier rewrite did not converge', () => {
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
    })).toMatchObject({ route: 'reresearch', nextStage: 'rewrite_pro_max' });
    expect(decideBlogQualityRouteV4({
      score: 93,
      previousScore: 86,
      completedAttempts: 2,
      researchAttempts: 1,
      researchValid: true,
      claimLedgerValid: false,
      lastStage: 'rewrite_pro_high',
      hardBlockers: ['unsupported_number'],
      failureReasons: ['claim_support_coverage_below_90_percent', 'unsupported_number_present'],
    })).toMatchObject({
      route: 'rewrite_pro_max',
      nextStage: 'rewrite_pro_max',
      reasons: expect.arrayContaining(['final_grounded_output_rewrite']),
    });
  });

  it('does not rewrite around missing, stale, conflicting, or saturated evidence', () => {
    for (const blocker of ['missing_evidence', 'stale_claim', 'claim_conflict_present']) {
      expect(decideBlogQualityRouteV4({
        score: 93,
        completedAttempts: 2,
        researchAttempts: 1,
        researchValid: true,
        lastStage: 'rewrite_pro_high',
        hardBlockers: [blocker],
      })).toMatchObject({ route: 'quarantine', nextStage: null });
    }
    expect(decideBlogQualityRouteV4({
      score: 93,
      completedAttempts: 2,
      researchAttempts: 1,
      researchValid: true,
      lastStage: 'rewrite_pro_high',
      hardBlockers: ['unsupported_number', 'template_saturation'],
    })).toMatchObject({ route: 'quarantine', nextStage: null });
  });

  it('quarantines sub-75 drafts when grounding is not explicit or the failure is factual', () => {
    expect(decideBlogQualityRouteV4({
      score: 70, completedAttempts: 1, failureReasons: ['primary_decision_not_answered'],
    })).toMatchObject({ route: 'quarantine', nextStage: null });
    expect(decideBlogQualityRouteV4({
      score: 70,
      completedAttempts: 1,
      researchValid: true,
      claimLedgerValid: true,
      failureReasons: ['unsupported_numeric_claim'],
    })).toMatchObject({ route: 'reresearch', nextStage: 'rewrite_pro_high' });
  });

  it('resolves every generation stage to an explicit DeepSeek model contract', () => {
    expect(resolveBlogGenerationModelV4('draft_flash')).toMatchObject({
      provider: 'deepseek', model: BLOG_DEEPSEEK_MODELS.draft, deepseekThinking: 'disabled',
    });
    expect(resolveBlogGenerationModelV4('rewrite_pro_high')).toMatchObject({
      provider: 'deepseek', model: BLOG_DEEPSEEK_MODELS.rewrite,
      deepseekThinking: 'disabled',
    });
    expect(resolveBlogGenerationModelV4('rewrite_pro_max')).toMatchObject({
      provider: 'deepseek', model: BLOG_DEEPSEEK_MODELS.rewrite,
      deepseekThinking: 'disabled',
    });
  });

  it('keeps grounded weak drafts in repair until the fifth completed model call', () => {
    expect(BLOG_QUALITY_MAX_ATTEMPTS_V4).toBe(5);
    expect(decideBlogQualityRouteV4({
      score: 89,
      completedAttempts: 3,
      researchValid: true,
      claimLedgerValid: true,
      failureReasons: ['primary_decision_not_answered'],
    })).toMatchObject({ route: 'rewrite_pro_max', nextStage: 'rewrite_pro_max' });
    expect(decideBlogQualityRouteV4({
      score: 89,
      completedAttempts: 4,
      researchValid: true,
      claimLedgerValid: true,
      failureReasons: ['primary_decision_not_answered'],
    })).toMatchObject({ route: 'rewrite_pro_max', nextStage: 'rewrite_pro_max' });
    expect(decideBlogQualityRouteV4({
      score: 89,
      completedAttempts: 5,
      researchValid: true,
      claimLedgerValid: true,
      failureReasons: ['primary_decision_not_answered'],
    }).route).toBe('quarantine');
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
        archetype: 'decision_comparison',
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
    expect(prompt).toContain('Selected approved claims (the complete factual universe');
    expect(prompt).toContain('오행산은 도시에서 15분 거리입니다.');
    expect(prompt).toContain('Do not use a table in this rewrite.');
    expect(prompt).toContain('The ledger must contain only the approved claim sentences');
    expect(prompt).toContain('exact citation markdown: [공식 근거](https://vietnam.travel/example)');
    expect(prompt).toContain('source-neutral editorial guidance');
    expect(prompt).toContain('[ARCHETYPE CONTRACT — decision_comparison]');
    expect(prompt).toContain('End with a concise choice summary, not generic questions.');
    expect(prompt).toContain('Do not repeat a four-word Korean phrase more than twice');
    expect(prompt).toContain('Give every evidence-section H2 a distinct decision purpose');
    expect(prompt).toContain('never as a new property of a place');
    expect(prompt).toContain('Never create one H2 per claim');
    expect(prompt).not.toContain('one evidence section per approved claim');
  });

  it('gives itinerary rewrites an executable evidence-bounded structure instead of generic questions', () => {
    const prompt = buildDeepSeekRewritePromptV4({
      originalDraft: 'untrusted',
      failureEvidence: ['public_customer:info_answer_mismatch'],
      researchFingerprint: 'research-itinerary',
      claimFingerprint: 'claims-itinerary',
      evidencePacket: {
        fixedTitle: '다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
        primaryQuery: '다낭 여행 일정과 이동 동선',
        primaryDecision: '언제 무엇을 해야 무리가 없는가?',
        archetype: 'itinerary_timeline',
        sectionPurposes: ['날짜보다 이동·예약·휴식 순서로 일정을 만든다'],
        approvedClaims: [{
          claimText: '오행산은 도시에서 15분 거리입니다.',
          claimType: 'duration',
          riskLevel: 'MEDIUM',
          sourceUrls: ['https://vietnam.travel/example'],
        }],
        officialSourceUrls: ['https://vietnam.travel/example'],
        internalLink: 'https://www.yeosonam.com/blog/destination/%EB%8B%A4%EB%82%AD',
        includeFaq: false,
        includeChecklist: false,
      },
    });

    expect(prompt).toContain('[ARCHETYPE CONTRACT — itinerary_timeline]');
    expect(prompt).toContain('Two unrelated duration claims never prove proximity, compatibility, a shared origin');
    expect(prompt).toContain('use "일정" and "동선" naturally');
    expect(prompt).toContain('without forcing a stock phrase');
    expect(prompt).toContain('at least two distinct time-block or route-option sections');
    expect(prompt).toContain('Never use 시작/중간/마무리 as substitute itinerary stages');
    expect(prompt).toContain('booking/access/operation recheck');
    expect(prompt).toContain('one distinct job each');
    expect(prompt).toContain('Every paragraph after the opening must add a new decision detail');
    expect(prompt).toContain('realistic rest decision');
    expect(prompt).toContain('A bare mention of 체력 is not a rest decision');
    expect(prompt).toContain('rain/closure/delay fallback');
    expect(prompt).toContain('Never output a generic planning checklist');
    expect(prompt).toContain('Do not merely list claims or finish with generic questions');
    expect(prompt).toContain('Write natural Korean with varied sentence shapes');
    expect(prompt).toContain('Exact duration or distance claims do not authorize qualitative labels');
    expect(prompt).toContain('Never write headings such as "짧은 이동 구간" or "이동 시간이 긴 일정".');
    expect(prompt).toContain('do not force every sentence to end in 하세요');
    expect(prompt).toContain('Semantic repetition also fails');
    expect(prompt).toContain('Never shorten or repeat a schedule/measurement outside its exact approved sentence');
    expect(prompt).toContain('Each approved fact may appear only once in the visible article');
    expect(prompt).toContain('Never combine two approved numeric claims into one sentence');
    expect(prompt).toContain('avoid status-like wording such as 예약 가능');
    expect(prompt).toContain('never write evaluative local assertions');
    expect(prompt).toContain('Never replace duration or climate with a generic factual label');
    expect(prompt).toContain('force a fixed heading count');
    expect(prompt).not.toContain('exactly 3 distinct reader-choice questions');
    expect(prompt).not.toContain('Do not write a table, itinerary');
    expect(prompt).not.toContain('route pairings unless');
  });

  it('requires every day block when an itinerary query has an explicit duration', () => {
    const prompt = buildDeepSeekRewritePromptV4({
      originalDraft: 'untrusted',
      failureEvidence: ['concrete_itinerary_blocks_missing'],
      researchFingerprint: 'research-duration',
      claimFingerprint: 'claims-duration',
      evidencePacket: {
        fixedTitle: '다낭 3박4일 여행 코스와 이동 동선: 장소별 실행 순서와 대체 동선',
        primaryQuery: '다낭 3박4일 여행 코스와 이동 동선',
        primaryDecision: '3박4일 동안 어느 날에 어느 장소를 배치해야 하는가?',
        archetype: 'itinerary_timeline',
        sectionPurposes: ['3박4일의 각 날짜에 근거가 있는 장소를 배치한다'],
        approvedClaims: [{
          claimText: 'Marble Mountains에서 Linh Ung Pagoda까지 차량으로 15분 걸립니다.',
          claimType: 'duration',
          riskLevel: 'MEDIUM',
          sourceUrls: ['https://vietnam.travel/example'],
        }],
        officialSourceUrls: ['https://vietnam.travel/example'],
        internalLink: 'https://www.yeosonam.com/blog/destination/%EB%8B%A4%EB%82%AD',
        includeFaq: false,
        includeChecklist: false,
      },
    });

    expect(prompt).toContain('Output exactly one separate H2 for every day');
    expect(prompt).toContain('"## 1일차: ..." through "## 4일차: ..."');
    expect(prompt).toContain('Never combine days in one heading');
    expect(prompt).toContain('Every day block must name an approved-claim entity');
    expect(prompt).toContain('one distinct reader choice or action beyond its heading');
    expect(prompt).toContain('at most one meta instruction about checking, comparing, or deciding evidence in each day block');
    expect(prompt).toContain('Within the first 200 visible characters, include one concrete reader trigger');
    expect(prompt).toContain('Do not add a "다음 확인 순서" or summary conclusion');
    expect(prompt).toContain('"가장 안전", "최적", or "전체 동선이 완성됩니다"');
    expect(prompt).toContain('In exactly one day-block body sentence');
    expect(prompt).toContain('"휴식 시간을 남기세요"');
    expect(prompt).toContain('The fallback heading alone does not count');
    expect(prompt).toContain('visible body (not headings) contains one explicit rest action');
  });

  it('gives route rewrites boarding, connection, arrival, and disruption decisions', () => {
    const prompt = buildDeepSeekRewritePromptV4({
      originalDraft: 'untrusted',
      failureEvidence: ['reader_decision_incomplete'],
      researchFingerprint: 'research-route',
      claimFingerprint: 'claims-route',
      evidencePacket: {
        fixedTitle: '간사이공항에서 난바 가는 법: 환승 부담으로 고르기',
        primaryQuery: '간사이공항에서 난바 가는 법',
        primaryDecision: '어떤 이동수단을 고르는가?',
        archetype: 'route_walkthrough',
        sectionPurposes: ['출발점부터 도착점까지 구간을 설명한다'],
        approvedClaims: [{
          claimText: '공항철도는 난바까지 40분 걸립니다.',
          claimType: 'duration',
          riskLevel: 'MEDIUM',
          sourceUrls: ['https://example.com/official-route'],
        }],
        officialSourceUrls: ['https://example.com/official-route'],
        internalLink: 'https://www.yeosonam.com/blog/destination/%EC%98%A4%EC%82%AC%EC%B9%B4',
        includeFaq: false,
        includeChecklist: false,
      },
    });

    expect(prompt).toContain('departure/boarding');
    expect(prompt).toContain('connection or middle segment');
    expect(prompt).toContain('arrival/alighting');
    expect(prompt).toContain('delay, sell-out, or last-service fallback');
  });

  it('keeps a grounded itinerary rewrite complete enough for the customer and answer-first gates', async () => {
    const markdown = [
      '# 다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
      '',
      '다낭 여행 일정은 이동 구간을 기준으로 방문 후보의 순서를 비교하세요. 가까운 후보를 먼저 표시하고 별도 이동 후보를 분리해 동선을 정리하세요. 공식 일정이 있는 후보는 마지막 단계에서 순서를 확정하세요.',
      '',
      '## 같은 흐름으로 묶을 후보',
      '',
      '- 출발 지점을 적은 뒤 가장 먼저 확인할 후보에 표시하세요.',
      '- 서로 이어서 볼 후보와 보류할 후보를 나눠 정리하세요.',
      '',
      'Marble Mountains에서 Linh Ung Pagoda까지 차량으로 15분 걸립니다.',
      '[공식 근거](https://www.vietnam.travel/things-to-do/must-do-da-nang-an-insider-list)',
      '',
      '다낭 시내에서 Marble Mountains까지 15분 걸립니다.',
      '[공식 근거](https://www.vietnam.travel/places-to-go/central-vietnam/da-nang)',
      '',
      '## 별도 이동 후보',
      '',
      '- 앞 구간과 한 번에 묶지 않을 후보를 따로 표시하세요.',
      '- 선택한 후보마다 이동 확인 순서를 한 줄로 정리하세요.',
      '',
      '다낭 시내에서 Bà Nà Hills까지 차량으로 40분 걸립니다.',
      '[공식 근거](https://vietnam.travel/things-to-do/must-visit-places-in-da-nang)',
      '',
      'Hai Van Pass는 21km 길이의 해안 도로입니다.',
      '[공식 근거](https://www.vietnam.travel/things-to-do/must-do-da-nang-an-insider-list)',
      '',
      'Hai Van Pass의 최고 고도는 496m입니다.',
      '[공식 근거](https://www.vietnam.travel/things-to-do/must-do-da-nang-an-insider-list)',
      '',
      '## 마지막 순서로 확인할 후보',
      '',
      'Dragon Bridge는 토·일요일 밤 9시에 불과 물을 뿜는 쇼를 합니다.',
      '[공식 근거](https://vietnam.travel/things-to-do/must-visit-places-in-da-nang)',
      '',
      '- 공식 일정과 앞선 이동 순서를 함께 놓고 마지막 방문 여부를 결정하세요.',
      '',
      '## 최종 일정 확정 순서',
      '',
      '- 출발 지점을 첫 줄에 기록하세요.',
      '- 같은 흐름으로 볼 후보에 같은 표시를 하세요.',
      '- 별도 이동 후보는 다른 칸으로 분리하세요.',
      '- 마지막 후보까지 확인한 뒤 전체 동선을 확정하세요.',
      '',
      '[다낭 여행 일정과 이동 동선 글 모아보기](https://www.yeosonam.com/blog/destination/%EB%8B%A4%EB%82%AD)',
    ].join('\n');

    expect(checkAiReadability(markdown, 'info', true).passed).toBe(true);
    expect(evaluateBlogEngineV2({
      blogHtml: markdown,
      primaryKeyword: '다낭 여행 일정과 이동 동선',
      destination: '다낭',
      generationMeta: {
        writer: 'info_writer',
        content_brief_v3: { archetype: 'itinerary_timeline' },
        content_brief: { search_intent: 'itinerary' },
      },
    }).metrics.task_completion).toBe(100);

    const rendered = await renderBlogContentToHtml(markdown);
    const customer = inspectPublicBlogCustomerQuality({
      expectedType: 'info',
      title: '다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
      html: `<article>${rendered}</article>`,
    });
    expect(customer.passed).toBe(true);
    expect(customer.issues.map((issue) => issue.code)).not.toContain('public_body_too_short');
  });

  it('selects a diverse deterministic claim subset for non-monthly rewrites', () => {
    const claims = Array.from({ length: 10 }, (_, index) => ({
      claimText: `${index + 1}번째 장소 공식 정보입니다.`,
      claimType: index === 8 ? 'duration' : 'factual',
      riskLevel: 'LOW',
      sourceUrls: [`https://example.com/${index + 1}`],
    }));
    const selected = selectDecisionRelevantRewriteClaimsV4({
      primaryQuery: '다낭 가볼만한곳',
      primaryDecision: '일정과 체력으로 장소를 선택한다',
      approvedClaims: claims,
    });

    expect(selected).toHaveLength(6);
    expect(selected).toContainEqual(claims[8]);
    expect(selectDecisionRelevantRewriteClaimsV4({
      primaryQuery: '다낭 가볼만한곳',
      primaryDecision: '일정과 체력으로 장소를 선택한다',
      approvedClaims: claims,
    })).toEqual(selected);
  });

  it('allows an itinerary rewrite to use eight distinct decision facts', () => {
    const claims = Array.from({ length: 10 }, (_, index) => ({
      claimText: `장소 ${index + 1}까지 차량으로 ${10 + index}분이 소요됩니다.`,
      claimType: 'duration',
      riskLevel: 'MEDIUM',
      sourceUrls: [`https://example.com/route-${index + 1}`],
    }));

    const selected = selectDecisionRelevantRewriteClaimsV4({
      primaryQuery: '다낭 3박4일 여행 코스와 이동 동선',
      primaryDecision: '각 날짜에 어느 장소를 배치해야 하는가?',
      approvedClaims: claims,
    });

    expect(selected).toHaveLength(8);
    expect(new Set(selected.map((claim) => claim.sourceUrls?.[0])).size).toBe(8);
  });

  it('prioritizes schedule and movement claims over landmark dimensions for itinerary rewrites', () => {
    const claims = [
      { claimText: 'Golden Bridge is 150m long.', claimType: 'factual', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/a'] },
      { claimText: 'Lady Buddha statue is 67m tall.', claimType: 'factual', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/b'] },
      { claimText: '오행산은 도시에서 차로 15분 거리입니다.', claimType: 'duration', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/c'] },
      { claimText: 'Marble Mountains is 15 minutes from the city by car.', claimType: 'duration', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/c'] },
      { claimText: '린응사는 오행산에서 차량으로 15분 거리입니다.', claimType: 'duration', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/d'] },
      { claimText: '바나힐은 다낭 시내에서 차로 40분 거리입니다.', claimType: 'duration', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/e'] },
      { claimText: '드래곤 브리지 쇼는 주말 오후 9시에 열립니다.', claimType: 'factual', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/f'] },
      { claimText: '오행산은 오전 7시 전에 방문하세요.', claimType: 'factual', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/g'] },
    ];
    const selected = selectDecisionRelevantRewriteClaimsV4({
      primaryQuery: '다낭 여행 일정과 이동 동선',
      primaryDecision: '언제 무엇을 해야 무리가 없는가?',
      approvedClaims: claims,
    });

    expect(selected).toHaveLength(5);
    expect(selected).toEqual(expect.arrayContaining([claims[2], claims[4], claims[5], claims[6], claims[7]]));
    expect(selected).not.toContainEqual(claims[0]);
    expect(selected).not.toContainEqual(claims[1]);
    expect(selected).not.toContainEqual(claims[3]);
  });

  it('drops dimension-only facts when three movement facts already complete an itinerary decision', () => {
    const selected = selectDecisionRelevantRewriteClaimsV4({
      primaryQuery: '다낭 여행 일정과 이동 동선',
      primaryDecision: '언제 무엇을 해야 무리가 없는가?',
      approvedClaims: [
        { claimText: '다낭에서 Linh Ung Pagoda까지 차량으로 15분 소요', claimType: 'duration', riskLevel: 'LOW' },
        { claimText: 'Marble Mountains는 다낭 시내에서 15분 거리', claimType: 'duration', riskLevel: 'LOW' },
        { claimText: 'Ba Na Hills는 다낭에서 서쪽으로 차량 40분 거리', claimType: 'duration', riskLevel: 'LOW' },
        { claimText: 'Linh Ung Pagoda의 Lady Buddha statue 높이는 67m', claimType: 'factual', riskLevel: 'LOW' },
        { claimText: 'Hai Van Pass는 21km 길이의 도로', claimType: 'factual', riskLevel: 'LOW' },
        { claimText: 'Hai Van Pass의 최고 지점은 해발 496m', claimType: 'factual', riskLevel: 'LOW' },
      ],
    });

    expect(selected).toHaveLength(3);
    expect(selected.every((claim) => claim.claimType === 'duration')).toBe(true);
  });

  it('drops Korean predicate-form landmark lengths from itinerary rewrites', () => {
    const selected = selectDecisionRelevantRewriteClaimsV4({
      primaryQuery: '다낭 여행 일정과 이동 동선',
      primaryDecision: '언제 무엇을 해야 무리가 없는가?',
      approvedClaims: [
        { claimText: '다낭에서 린 응 파고다까지 차량으로 15분 소요', claimType: 'duration', riskLevel: 'LOW' },
        { claimText: '마블마운틴까지 차량으로 15분 소요', claimType: 'duration', riskLevel: 'LOW' },
        { claimText: '바나힐까지 차량으로 40분 소요', claimType: 'duration', riskLevel: 'LOW' },
        { claimText: '골든브릿지 길이는 150m', claimType: 'factual', riskLevel: 'LOW' },
        { claimText: '하이반 패스 길이는 21km', claimType: 'factual', riskLevel: 'LOW' },
      ],
    });

    expect(selected).toHaveLength(3);
    expect(selected.every((claim) => claim.claimType === 'duration')).toBe(true);
  });

  it('drops suffix-form dimensions but keeps movement, access, schedule, and cost evidence', () => {
    const claims = [
      { claimText: 'Golden Bridge는 150m 길이입니다.', claimType: 'factual', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/bridge'] },
      { claimText: 'Linh Ung Pagoda의 동상은 67m입니다.', claimType: 'factual', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/statue'] },
      { claimText: 'Hai Van Pass의 최고 지점은 해발 496m입니다.', claimType: 'factual', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/pass'] },
      { claimText: 'Hai Van Pass 도로는 21km입니다.', claimType: 'factual', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/road'] },
      { claimText: '다낭 시내에서 Linh Ung Pagoda까지 차량으로 15분 소요됩니다.', claimType: 'duration', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/linh-ung'] },
      { claimText: 'Marble Mountains 관람에는 3~4시간이 소요됩니다.', claimType: 'duration', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/marble'] },
      { claimText: 'Non Nuoc에서 Hoi An까지 차량으로 30분 소요됩니다.', claimType: 'duration', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/hoi-an'] },
      { claimText: 'Marble Mountains 입장료는 성인 40,000 VND입니다.', claimType: 'price', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/admission'] },
      { claimText: 'Ba Na Hills 운영시간은 오전 8시부터 오후 10시입니다.', claimType: 'factual', riskLevel: 'MEDIUM', sourceUrls: ['https://example.com/hours'] },
    ];

    const selected = selectDecisionRelevantRewriteClaimsV4({
      primaryQuery: '다낭 3박4일 여행 코스와 이동 동선',
      primaryDecision: '날짜별 장소와 이동 순서를 정한다',
      approvedClaims: claims,
    });

    expect(selected).toEqual(expect.arrayContaining(claims.slice(4)));
    for (const decorativeClaim of claims.slice(0, 4)) {
      expect(selected).not.toContainEqual(decorativeClaim);
    }
  });

  it('keeps all twelve approved climate rows only for an explicit monthly assignment', () => {
    const claims = Array.from({ length: 12 }, (_, index) => ({
      claimText: `${index + 1}월 평균 기온은 ${20 + index}°C입니다.`,
      claimType: 'climate',
      riskLevel: 'MEDIUM',
      sourceUrls: ['https://example.com/climate'],
    }));

    expect(selectDecisionRelevantRewriteClaimsV4({
      primaryQuery: '홍콩 월별 날씨',
      primaryDecision: '여행 시기를 선택한다',
      approvedClaims: claims,
    })).toHaveLength(12);
    expect(selectDecisionRelevantRewriteClaimsV4({
      primaryQuery: '홍콩 여행 시기',
      primaryDecision: '여행 시기를 선택한다',
      approvedClaims: claims,
    })).toHaveLength(6);
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
    expect(resolveBlogPublicationRampCapV4('max_30').cap).toBe(30);
    expect(resolveBlogPublicationRampCapV4('ramp_10').cap).toBe(10);
    expect(resolveBlogPublicationRampCapV4('invalid').cap).toBe(3);
    expect(nextBlogPublicationSlotKstV4(new Date('2026-08-16T17:00:00.000Z')))
      .toBe('2026-08-17T00:00:00.000Z');
    expect(nextBlogPublicationSlotKstV4(new Date('2026-08-17T13:00:00.000Z')))
      .toBe('2026-08-18T00:00:00.000Z');
  });
});
