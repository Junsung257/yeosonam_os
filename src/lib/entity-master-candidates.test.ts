import { describe, expect, it } from 'vitest';
import {
  evaluateMasterCandidate,
  mergeCandidateExternalSources,
  normalizeCandidateLabel,
} from './entity-master-candidates';

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
    expect(decision.suggestedMaster.public_gate).toMatchObject({
      public_gate: 'publishable_ready',
      route_impact: 'none',
    });
  });

  it('keeps probable places internal until identity evidence is verified', () => {
    const decision = evaluateMasterCandidate({
      rawLabel: '\uB9C8\uD669\uAD6C \uB300\uD611\uACE1',
      category: 'attraction',
      country: '\uC911\uAD6D',
      region: '\uC5F0\uAE38',
      occurrenceCount: 7,
      evidenceCount: 4,
      packageCount: 4,
    });

    expect(decision.autoAction).toBe('create_internal_master');
    expect(decision.suggestedMaster.customer_publishable).toBe(false);
    expect(decision.suggestedMaster.public_gate).toMatchObject({
      public_gate: 'internal_only',
      route_impact: 'warning',
      operator_action: 'keep as hidden internal candidate until verified; never expose in customer payload',
    });
  });

  it('deduplicates external evidence before candidate group evaluation persists it', () => {
    const sources = mergeCandidateExternalSources([
      { source: 'wikidata', id: 'Q1', confidence: 0.9, name: 'A' },
      { source: 'wikidata', id: 'Q1', confidence: 0.9, name: 'A' },
      { source: 'official_site', url: 'https://example.com', confidence: 0.8, name: 'A official' },
    ]);

    expect(sources).toHaveLength(2);
    expect(sources.map(source => source.source)).toEqual(['wikidata', 'official_site']);
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
    expect(descriptive.autoAction).toBe('reject_noise');
    expect(descriptive.promotionStatus).toBe('rejected_noise');
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
      '[부관훼리] 초특가로 떠나는 가성비 3일',
      '6, 13, 20, 27',
      '5, 7, 8, 12, 13, 14, 15, 19',
      '자율',
      '차창',
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

  it('rejects booking and generic market tokens instead of creating attraction masters', () => {
    const rejectedLabels = [
      '\uBC1C\uAD8C',
      '\uB098\uC774\uD2B8 \uB9C8\uCF13',
      '\uC57C\uC2DC\uC7A5',
      '\uC720 \uD6C4 \uC778',
    ];

    for (const rawLabel of rejectedLabels) {
      const decision = evaluateMasterCandidate({
        rawLabel,
        category: 'attraction',
        occurrenceCount: 2,
        evidenceCount: 2,
        packageCount: 1,
      });

      expect(decision.autoAction).toBe('reject_noise');
      expect(decision.promotionStatus).toBe('rejected_noise');
      expect(decision.suggestedMaster.customer_publishable).toBe(false);
    }
  });

  it('rejects food, flight, and commercial fragments from becoming attraction masters', () => {
    const rejectedLabels = [
      '증편)',
      '반세오',
      '세트',
      '랍스터1⁄2)',
      '정규)',
      '비어플라자',
      '포 함 사 항',
      '비       고',
      '매운탕',
    ];

    for (const rawLabel of rejectedLabels) {
      const decision = evaluateMasterCandidate({
        rawLabel,
        category: 'attraction',
        occurrenceCount: 80,
        evidenceCount: 10,
        packageCount: 8,
      });

      expect(decision.autoAction).toBe('reject_noise');
      expect(decision.promotionStatus).toBe('rejected_noise');
      expect(decision.suggestedMaster.customer_publishable).toBe(false);
    }
  });

  it('does not auto-create attraction masters from repetition alone', () => {
    const decision = evaluateMasterCandidate({
      rawLabel: '새로운반복문구',
      category: 'attraction',
      occurrenceCount: 500,
      evidenceCount: 50,
      packageCount: 20,
    });

    expect(decision.autoAction).toBe('needs_review');
    expect(decision.promotionStatus).toBe('needs_review');
    expect(decision.suggestedMaster.customer_publishable).toBe(false);
  });

  it('extracts readable Korean canonical attraction names from descriptive backlog labels', () => {
    const cases = [
      ['200M의 봉우리 2개가 연결되어 있는 천하제일교', '천하제일교'],
      ['7개의 봉우리가 북두칠성을 가리키는 칠성산', '칠성산'],
      ['장가계의 혼이라 불리는 천문산 등정', '천문산'],
      ['푸꾸옥의 명소 소나씨 야시장 자유시간 ★특전! 망고주스 1인 1잔 서비스★', '소나씨 야시장'],
      ['또는 캠비치', '캠비치'],
      ['세계 6대 해변으로 꼽히는 사오비치 관광', '사오비치'],
      ['백두산 서파 코스 금강대협곡 방문', '금강대협곡'],
      ['베트남 현지 분위기가 녹아있는 한시장', '한시장'],
      ['▷일본 CF에 자주 등장하는 명소 패치워크의 길(차창관광)', '패치워크의 길'],
      ['도야 불꽃놀이 : 4/28~10/31 (20:45 경부터 20분간 // 개별자유)', '도야 불꽃놀이'],
      ['▷오타루의 아름다운 상징 오타루운하 관광', '오타루운하'],
      ['성요셉 대성당 관광', '성요셉 대성당'],
      ['▷청푸른 빛의 신비로운 호수 아오이이케(청의 호수)', '청의 호수'],
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

  it('prefers the real place name before explanatory parentheses', () => {
    const cases = [
      ['\uC911\uC815\uAE30\uB150\uB2F9 (\uC7A5\uAC1C\uC11D \uAE30\uB150 \uAC74\uB9BD)', '\uC911\uC815\uAE30\uB150\uB2F9'],
      ['\uC0AC\uB9BC\uAD00\uC800 (\uC7A5\uAC1C\uC11D \uCD1D\uD1B5\uC758 \uAD00\uC800)', '\uC0AC\uB9BC\uAD00\uC800'],
      ['\uD64D\uB9C8\uC624\uCCAD (\uC61B \uB124\uB35C\uB780\uB4DC \uAC74\uCD95\uBB3C)', '\uD64D\uB9C8\uC624\uCCAD'],
      ['\uB791\uBE44\uC5E5 \uC804\uB9DD\uB300 (\uC9DA\uCC28 OR 7\uC778\uC2B9)', '\uB791\uBE44\uC5E5 \uC804\uB9DD\uB300'],
      ['\uB300\uC18C\uC0AC(\u5927\u53EC\u5BFA)', '\uB300\uC18C\uC0AC'],
      ['\uC5D0\uB3C4\uC2DC\uB300 \uBB38\uD654\uB97C \uCCB4\uD5D8\uD558\uB294 \uD14C\uB9C8\uD30C\uD06C \uC9C0\uB2E4\uC774\uBB34\uB77C(\uC2DC\uB300\uCD0C)', '\uC2DC\uB300\uCD0C'],
    ];

    for (const [rawLabel, expected] of cases) {
      const decision = evaluateMasterCandidate({
        rawLabel,
        category: 'attraction',
        occurrenceCount: 2,
        evidenceCount: 1,
      });

      expect(decision.normalizedLabel).toBe(expected);
    }
  });

  it('extracts concise customer-facing names from descriptive attraction candidates', () => {
    const cases = [
      ['\uC544\uC2DC\uC544 \uCD5C\uB300 \uADDC\uBAA8 \uBE48 \uC0AC\uD30C\uB9AC\uC6D4\uB4DC \uAD00\uAD11', '\uBE48 \uC0AC\uD30C\uB9AC\uC6D4\uB4DC'],
      ['\uBCFC\uAC70\uB9AC \uAC00\uB4DD\uD55C \uC18C\uB098\uC2DC \uC57C\uC2DC\uC7A5 \uD22C\uC5B4 \u2665\uB9DD\uACE0\uC8FC\uC2A4 1\uC794 \uC81C\uACF5\u2665', '\uC18C\uB098\uC2DC \uC57C\uC2DC\uC7A5'],
      ['\u25B6\uBCF4\uB78F\uBE5B \uC57C\uACBD\uACFC \uC774\uC0C9\uC801\uC778 \uC2DC\uC7A5\uC758 \uC870\uD654 [\uBD80\uC774\uD398\uC2A4\uD2B8 \uBC14\uC790 \uB098\uC774\uD2B8 \uB9C8\uCF13]', '\uBD80\uC774\uD398\uC2A4\uD2B8 \uBC14\uC790 \uB098\uC774\uD2B8 \uB9C8\uCF13'],
      ['\uAD6D\uAC00\uAE09 \uD48D\uACBD\uBA85\uC2B9\uAD6C \uB3D9\uAC15\uD638\uD48D\uACBD\uAD6C', '\uB3D9\uAC15\uD638\uD48D\uACBD\uAD6C'],
      ['\uD0DC\uAD6D\uC758 \uC5ED\uC0AC,\uBB38\uD654,\uC885\uAD50,\uAC74\uCD95 \uBB38\uD654\uB97C \uCD95\uC57D\uD55C \uC138\uACC4 \uCD5C\uB300\uC758 \uC57C\uC678 \uBC15\uBB3C\uAD00 \uBB34\uC559\uBCF4\uB780 \uAD00\uAD11', '\uBB34\uC559\uBCF4\uB780'],
      ['\uAD11\uD65C\uD55C \uB179\uCC28\uBC2D. \uACC4\uB2E8\uC2DD \uCC28\uBC2D\uACFC \uD6C4\uC9C0\uC0B0\uC774 \uC5B4\uC6B0\uB7EC\uC9C4 \uC624\uBD80\uCE58\uC0AC\uC0AC\uBC14', '\uC624\uBD80\uCE58\uC0AC\uC0AC\uBC14'],
      ['\uCE6D\uAE30\uC2A4\uCE78 \uAC74\uAD6D \uAE30\uB150\uC73C\uB85C \uC138\uC6CC\uC9C4 \uCE6D\uAE30\uC2A4\uCE78 \uAE30\uB9C8\uB3D9\uC0C1', '\uCE6D\uAE30\uC2A4\uCE78 \uAE30\uB9C8\uB3D9\uC0C1'],
      ['\uBCA0\uD2B8\uB0A8\uC5D0\uC11C \uC720\uBA85\uD55C \uBA38\uB4DC\uC628\uCC9C', '\uBA38\uB4DC\uC628\uCC9C'],
      ['\uC804\uD1B5 \uC720\uD669 \uC7AC\uBC30\uC9C0 \uC720\uB178\uD558\uB098 \uAD00\uAD11', '\uC720\uB178\uD558\uB098'],
      ['80\uB144 \uC804 \uD654\uC0B0\uBD84\uD654\uB85C \uB9CC\uB4E4\uC5B4\uC9C4 \uC1FC\uD654\uC2E0\uC0B0 \uD65C\uD654\uC0B0', '\uC1FC\uD654\uC2E0\uC0B0 \uD65C\uD654\uC0B0'],
    ];

    for (const [rawLabel, expected] of cases) {
      const decision = evaluateMasterCandidate({
        rawLabel,
        category: 'attraction',
        occurrenceCount: 3,
        evidenceCount: 2,
        packageCount: 1,
      });

      expect(decision.normalizedLabel).toBe(expected);
    }
  });

  it('keeps readable multi-attraction supplier prose in review instead of picking one place', () => {
    const cases = [
      ['용암 분출로 인해 생긴 금강대협곡 / 고산화원 관광', '고산화원'],
      ['천문산을 배경으로 펼쳐지는 대형오페라쇼 천문호선쇼 관람', '천문호선쇼'],
      ['에메랄드 빛 바다가 아름다운 사오비치 또는 캠비치 방문', '사오비치'],
    ];

    for (const [rawLabel, expected] of cases) {
      const decision = evaluateMasterCandidate({
        rawLabel,
        category: 'attraction',
        occurrenceCount: 120,
        evidenceCount: 7,
        packageCount: 7,
      });

      expect(decision.normalizedLabel).toBe(expected);
      expect(decision.autoAction).toBe('needs_review');
      expect(decision.suggestedMaster.customer_publishable).toBe(false);
    }
  });

  it('rejects readable Korean product-condition and descriptive attraction fragments from the current backlog', () => {
    const labels = [
      '\uCF00\uC774\uBE14\uCE74\uD3B8\uB3C4',
      '\uAD81\uC804\uAC8C\uB974(2\uC778\uC2E4',
      '\uB300\uC131\uB2F9',
      '\uC624\uD6C4 \uD50C\uB808\uC774 \uC695\uC7A5',
      '\uD478\uAFB8\uC625\uC758 \uC791\uC740 \uC720\uB7FD',
      '\uAC01\uC885 \uB3D9\uBB3C\uC1FC\uC640 \uC0C8\uACF5\uC6D0\uB4F1 \uB2E4\uCC44\uB85C\uC6B4 \uBCFC\uAC70\uB9AC',
      '\uC18C\uC120\uC774 \uC2E0\uC120\uC744 \uB9CC\uB09C \uACF3\uC774\uB77C\uB294 \uC804\uC124\uC774 \uAE43\uB4E4\uC5B4 \uC788\uACE0',
      '\uD638\uD551\uC2E0\uCCAD\uC2DC',
      '\uC774\uB860 \uAD50\uC721',
      '\uD55C\uC57D\uBC29 \uC911 2\uD68C',
      '\uC911\uAD6D \uC120\uC885\uC744 \uB300\uD45C\uD558\uB294 \uCC9C\uB144\uACE0\uCC30',
      '\uCE6D\uB2E4\uC624\uC5D0\uC11C \uB9CC\uB098\uB294 \uC791\uC740 \uC720\uB7FD',
      '\uBE5B\uC73C\uB85C \uBB3C\uB4E0 \uACC4\uB9BC\uC758 \uBC24',
      '\uC0BC\uD310\uBC30\uB97C \uD0C0\uACE0 \uAE30\uC554\uAD34\uC11D \uC0AC\uC774 \uC218\uB85C\uB97C \uC9C0\uB098\uBA70 \uC790\uC5F0\uACBD\uAD00',
    ];

    for (const label of labels) {
      const decision = evaluateMasterCandidate({
        rawLabel: label,
        category: 'attraction',
        occurrenceCount: 3,
        evidenceCount: 2,
      });

      expect(decision.autoAction).toBe('reject_noise');
      expect(decision.promotionStatus).toBe('rejected_noise');
      expect(decision.suggestedMaster.customer_publishable).toBe(false);
    }
  });
});
