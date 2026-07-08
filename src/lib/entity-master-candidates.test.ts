import { describe, expect, it } from 'vitest';
import { evaluateMasterCandidate, normalizeCandidateLabel } from './entity-master-candidates';

describe('entity master candidate automation', () => {
  it('rejects movement tokens instead of creating attraction masters', () => {
    const decision = evaluateMasterCandidate({
      rawLabel: '도보',
      category: 'attraction',
      country: '일본',
      region: '나리타',
      occurrenceCount: 37,
      evidenceCount: 9,
      packageCount: 5,
    });

    expect(decision.autoAction).toBe('reject_noise');
    expect(decision.promotionStatus).toBe('rejected_noise');
    expect(decision.suggestedMaster.customer_publishable).toBe(false);
  });

  it('rejects section headings instead of treating them as attractions', () => {
    const decision = evaluateMasterCandidate({
      rawLabel: '[포함 사항]',
      category: 'attraction',
      occurrenceCount: 30,
      evidenceCount: 10,
      packageCount: 3,
    });

    expect(decision.autoAction).toBe('reject_noise');
    expect(decision.decisionReason).toContain('section heading');
  });

  it('structures room and golf details as non-master fragments', () => {
    const room = evaluateMasterCandidate({
      rawLabel: '2인실-스탠다드',
      category: 'hotel',
      occurrenceCount: 12,
      evidenceCount: 4,
      packageCount: 2,
    });
    const golf = evaluateMasterCandidate({
      rawLabel: '그린피 + 캐디피 + 카트피',
      category: 'optional_tour',
      occurrenceCount: 31,
      evidenceCount: 8,
      packageCount: 4,
    });

    expect(room.autoAction).toBe('structure_non_master');
    expect(golf.autoAction).toBe('structure_non_master');
  });

  it('creates probable attraction candidates as internal, not customer-publishable, without external proof', () => {
    const decision = evaluateMasterCandidate({
      rawLabel: '곡강 유적지 공원',
      category: 'attraction',
      country: '중국',
      region: '서안',
      occurrenceCount: 4,
      evidenceCount: 3,
      packageCount: 2,
    });

    expect(decision.autoAction).toBe('create_internal_master');
    expect(decision.promotionStatus).toBe('auto_internal');
    expect(decision.suggestedMaster.customer_publishable).toBe(false);
  });

  it('requires independent external identity sources before publishable automation', () => {
    const decision = evaluateMasterCandidate({
      rawLabel: '곡강 유적지 공원',
      category: 'attraction',
      country: '중국',
      region: '서안',
      occurrenceCount: 12,
      evidenceCount: 8,
      packageCount: 4,
      externalSources: [
        { source: 'wikidata', id: 'Q123', confidence: 0.9 },
        { source: 'official_site', url: 'https://example.com', confidence: 0.85 },
      ],
    });

    expect(decision.autoAction).toBe('create_publishable_master');
    expect(decision.promotionStatus).toBe('publishable_ready');
    expect(decision.suggestedMaster.customer_publishable).toBe(true);
  });

  it('extracts a compact attraction label from supplier descriptive prose', () => {
    const decision = evaluateMasterCandidate({
      rawLabel: '고대 황제와 문인들의 놀이터 공강지공원',
      category: 'attraction',
      country: '중국',
      region: '서안',
      occurrenceCount: 10,
      evidenceCount: 1,
      packageCount: 1,
    });

    expect(decision.normalizedLabel).toBe('공강지공원');
    expect(decision.autoAction).toBe('create_internal_master');
  });

  it('keeps descriptive and multi-attraction phrases in review', () => {
    const descriptive = evaluateMasterCandidate({
      rawLabel: '지형이 수많은 볼거리를 제공합니다',
      category: 'attraction',
      occurrenceCount: 1,
      evidenceCount: 1,
    });
    const multi = evaluateMasterCandidate({
      rawLabel: '막탄슈라인, 막탄 산토니뇨 성당',
      category: 'attraction',
      occurrenceCount: 1,
      evidenceCount: 1,
    });

    expect(descriptive.autoAction).toBe('needs_review');
    expect(multi.autoAction).toBe('needs_review');
  });

  it('rejects operational fragments from the June unmatched backlog', () => {
    const airport = evaluateMasterCandidate({
      rawLabel: '漠PUS-FSZ',
      category: 'attraction',
      occurrenceCount: 12,
      evidenceCount: 4,
    });
    const productTitle = evaluateMasterCandidate({
      rawLabel: '카멜리아 후쿠오카 갓성비 시내핵심 3일',
      category: 'attraction',
      occurrenceCount: 3,
      evidenceCount: 1,
    });
    const guideNotice = evaluateMasterCandidate({
      rawLabel: '※ 한국인 또는 한국어 가능 현지 가이드',
      category: 'attraction',
      occurrenceCount: 10,
      evidenceCount: 5,
    });
    const destinationTag = evaluateMasterCandidate({
      rawLabel: '#시즈오카',
      category: 'attraction',
      occurrenceCount: 21,
      evidenceCount: 7,
    });

    expect(airport.promotionStatus).toBe('rejected_noise');
    expect(productTitle.promotionStatus).toBe('rejected_noise');
    expect(guideNotice.promotionStatus).toBe('rejected_noise');
    expect(destinationTag.promotionStatus).toBe('rejected_noise');
  });

  it('does not auto-create internal masters from descriptive route prose', () => {
    const routeMetric = evaluateMasterCandidate({
      rawLabel: '총길이 430M',
      category: 'attraction',
      occurrenceCount: 6,
      evidenceCount: 3,
    });
    const descriptive = evaluateMasterCandidate({
      rawLabel: '가파른 협곡이 어우러져 중국 북방 산수의 웅장함과 아름다움을 한껏 드러냅니다.',
      category: 'attraction',
      occurrenceCount: 20,
      evidenceCount: 10,
    });

    expect(routeMetric.promotionStatus).toBe('rejected_noise');
    expect(descriptive.autoAction).toBe('needs_review');
    expect(descriptive.suggestedMaster.customer_publishable).toBe(false);
  });

  it('rejects low-value operational leftovers instead of making candidate places', () => {
    const familyDoc = evaluateMasterCandidate({
      rawLabel: '- 부모와 동행해도 영문 가족관계증명서 반드시 지참',
      category: 'attraction',
    });
    const benefit = evaluateMasterCandidate({
      rawLabel: '커피 또는 음료 제공',
      category: 'attraction',
    });
    const surcharge = evaluateMasterCandidate({
      rawLabel: '유류할증료',
      category: 'attraction',
    });
    const genericPark = evaluateMasterCandidate({
      rawLabel: '놀이공원 무제한 이용 가능',
      category: 'attraction',
    });

    expect(familyDoc.promotionStatus).toBe('rejected_noise');
    expect(benefit.promotionStatus).toBe('rejected_noise');
    expect(surcharge.promotionStatus).toBe('rejected_noise');
    expect(genericPark.promotionStatus).toBe('rejected_noise');
  });

  it('keeps two-token attraction names when the suffix token is generic by itself', () => {
    const decision = evaluateMasterCandidate({
      rawLabel: '사이샹 옛거리',
      category: 'attraction',
      occurrenceCount: 2,
      evidenceCount: 2,
    });

    expect(decision.normalizedLabel).toBe('사이샹 옛거리');
  });

  it('extracts the real place name from "called as" descriptions', () => {
    const decision = evaluateMasterCandidate({
      rawLabel: '비밀의 사원이라 불리는 링엄사',
      category: 'attraction',
      occurrenceCount: 10,
      evidenceCount: 5,
    });

    expect(decision.normalizedLabel).toBe('링엄사');
    expect(decision.autoAction).toBe('create_internal_master');
  });

  it('normalizes decorative supplier prefixes without losing the useful label', () => {
    expect(normalizeCandidateLabel('▶인생샷의 성지! 연인들의 필수 방문 코스 [키스 오브 브릿지]'))
      .toBe('인생샷의 성지! 연인들의 필수 방문 코스 [키스 오브 브릿지]');
  });
  it('rejects readable Korean operational fragments from the current unmatched backlog', () => {
    const rejectedLabels = [
      '20분',
      '관광3시간소요',
      'VIP통로',
      '엘리베이터',
      '도보산책',
      '총길이 430M, 넓이 6M, 계곡에서의 높이 300M에 달하는 세계 최고의',
      '특전4] 이탈리아의 베네치아를 본따 만든 잠들지 않는 도시',
    ];

    for (const rawLabel of rejectedLabels) {
      const decision = evaluateMasterCandidate({
        rawLabel,
        category: 'attraction',
        occurrenceCount: 20,
        evidenceCount: 4,
        packageCount: 2,
      });

      expect(decision.autoAction).toBe('reject_noise');
      expect(decision.promotionStatus).toBe('rejected_noise');
      expect(decision.suggestedMaster.customer_publishable).toBe(false);
    }
  });

  it('extracts readable Korean canonical attraction names from descriptive backlog labels', () => {
    const cases = [
      ['200M의 봉우리 2개가 연결되어 있는 천하제일교', '천하제일교'],
      ['7개의 봉우리가 북두칠성을 가리키는 칠성산', '칠성산'],
      ['장가계의 혼이라 불리는 천문산 등정', '천문산'],
      ['천문산을 배경으로 펼쳐지는 대형오페라쇼 천문호선쇼 관람', '천문호선쇼'],
      ['푸꾸옥의 명소 소나씨 야시장 자유시간 ★특전! 망고주스 1인 1잔 서비스★', '소나씨 야시장'],
      ['또는 캠비치', '캠비치'],
      ['세계 6대 해변으로 꼽히는 사오비치 관광', '사오비치'],
      ['백두산 서파 코스 금강대협곡 방문', '금강대협곡'],
      ['베트남 현지 분위기가 녹아있는 한시장', '한시장'],
    ];

    for (const [rawLabel, expected] of cases) {
      const decision = evaluateMasterCandidate({
        rawLabel,
        category: 'attraction',
        occurrenceCount: 20,
        evidenceCount: 4,
        packageCount: 2,
      });

      expect(decision.normalizedLabel).toBe(expected);
      expect(decision.autoAction).toBe('create_internal_master');
      expect(decision.suggestedMaster.customer_publishable).toBe(false);
    }
  });
});
