import { describe, expect, it } from 'vitest';
import { inspectBlogCustomerQuality } from './blog-customer-quality';

describe('inspectBlogCustomerQuality', () => {
  it('blocks generic info openings that sound like reusable AI scaffolding', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '발리 식비 예산',
      destination: '발리',
      blogHtml: [
        '# 발리 여행 가이드 2026 | 예산과 실제 비용 체크',
        '',
        '답부터 말하면, 2026년 7월 기준 발리에서 먼저 볼 것은 예산 범위, 이동 순서, 현지 확인 사항입니다. 포함/불포함, 이동 시간, 현지 추가비용을 함께 비교하면 불필요한 이동과 추가 부담을 줄일 수 있습니다.',
        '',
        '## 핵심 요약',
        '',
        '- 발리 하루 식비는 1인 기준 25,000원 - 80,000원입니다.',
        '- 와룽은 한 끼 5,000원 안팎입니다.',
        '',
        '## 항목별 예산',
        '',
        '| 구분 | 금액 | 메모 |',
        '| --- | --- | --- |',
        '| 와룽 | 5,000원 | 현금 준비 |',
        '| 레스토랑 | 20,000원 | 세금 확인 |',
        '| 비치클럽 | 50,000원 | 서비스 차지 확인 |',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('generic_answer_opening');
  });

  it('blocks chatty blog intros that delay the answer-first promise', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '몽골 7월 날씨',
      destination: '몽골',
      blogHtml: [
        '# 몽골 7월 날씨',
        '',
        '몽골 7월은 낮 25~30도, 밤 10도 안팎까지 떨어질 수 있어 얇은 긴팔과 플리스, 방수 재킷을 함께 챙기는 편이 안전합니다.',
        '',
        '안녕하세요, 소중한 여행을 계획하시는 여러분. 7월 몽골은 초원이 가장 푸른 시기라 더없이 좋지만, 날씨가 자주 바뀌어 준비가 중요합니다.',
        '',
        '## 기온과 옷차림',
        '',
        '| 구분 | 기준 | 준비 |',
        '| --- | --- | --- |',
        '| 낮 | 25~30도 | 얇은 긴팔 |',
        '| 밤 | 10도 안팎 | 플리스 |',
        '| 비 | 짧은 소나기 | 방수 재킷 |',
        '',
        '- 외교부 해외안전여행 기준으로 출발 전 안전 공지를 확인합니다.',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('chatty_intro_residue');
  });

  it('blocks empty CTA residue that lost its button or link target', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '몽골 7월 날씨',
      destination: '몽골',
      blogHtml: [
        '# 몽골 7월 날씨',
        '',
        '몽골 7월은 낮 25~30도, 밤 10도 안팎까지 떨어질 수 있어 반팔보다 얇은 긴팔과 플리스, 방수 재킷을 함께 챙기는 편이 안전합니다.',
        '',
        '지금 바로 를 클릭해 꿈같은 몽골 여행을 시작해 보세요.',
        '',
        '## 기온과 옷차림',
        '',
        '| 구분 | 기준 | 준비 |',
        '| --- | --- | --- |',
        '| 낮 | 25~30도 | 얇은 긴팔 |',
        '| 밤 | 10도 안팎 | 플리스 |',
        '| 비 | 짧은 소나기 | 방수 재킷 |',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('empty_cta_residue');
  });

  it('blocks destinationless local labels when a concrete destination exists', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '몽골 준비물',
      destination: '몽골',
      blogHtml: [
        '# 몽골 준비물',
        '',
        '몽골 여행은 낮과 밤 기온 차이가 커서 겉옷, 방수 재킷, 보조배터리, 비상약을 먼저 챙겨야 현지에서 불편을 줄일 수 있습니다.',
        '',
        '## 준비 순서',
        '',
        '- 현지 비용: 출발 전 추가 비용을 확인합니다.',
        '- 현지 준비물: 계절과 고도 차이에 맞춰 챙깁니다.',
        '- 현지 예약: 이동 동선과 취소 조건을 확인합니다.',
        '',
        '| 구분 | 확인 | 이유 |',
        '| --- | --- | --- |',
        '| 옷 | 겉옷 | 밤 기온 대비 |',
        '| 비 | 우비 | 소나기 대비 |',
        '| 전원 | 보조배터리 | 게르 숙소 대비 |',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('destination_generic_residue');
  });

  it('blocks product copy with duplicate price suffix and repeated consultation fallback', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'product',
      productId: 'pkg-1',
      destination: '광저우',
      blogHtml: [
        '# 부산/김해출발 광저우 4박6일 패키지',
        '',
        '1,369,000원부터부터 보이는 광저우 4박 6일 상품은 출발지와 일정 강도에 따라 체감 가치가 달라집니다.',
        '',
        '## 10초 판단',
        '| 확인 항목 | 현재 기준 | 문의 때 볼 점 |',
        '| --- | --- | --- |',
        '| 가격 | 1,369,000원부터 | 상담에서 최종 확인 |',
        '| 출발 | 부산/김해 | 상담에서 최종 확인 |',
        '| 기간 | 4박6일 | 상담에서 최종 확인 |',
        '',
        '## 포함/불포함',
        '| 구분 | 항목 | 확인 포인트 |',
        '| --- | --- | --- |',
        '| 포함 | 왕복항공 | 상담에서 최종 확인 |',
        '| 포함 | 호텔 | 상담에서 최종 확인 |',
        '| 불포함 | 개인경비 | 상담에서 최종 확인 |',
        '',
        '## 문의 전 질문',
        '- 출발일과 인원을 확인합니다.',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['product_price_suffix_duplicate', 'product_consult_repetition']),
    );
  });

  it('passes a concrete customer-first info guide', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '몽골 7월 날씨',
      destination: '몽골',
      blogHtml: [
        '# 몽골 7월 날씨와 옷차림',
        '',
        '몽골 7월 여행은 낮 25도 안팎, 밤 10도 안팎의 일교차를 기준으로 준비하면 안전합니다. 얇은 긴팔, 방수 바람막이, 밤용 플리스 1벌을 나눠 챙기는 편이 가장 실용적입니다.',
        '',
        '## 상황별 옷차림',
        '',
        '| 상황 | 챙길 옷 | 이유 |',
        '| --- | --- | --- |',
        '| 낮 이동 | 얇은 긴팔 | 자외선과 바람 대응 |',
        '| 밤 별보기 | 플리스 또는 경량 패딩 | 체감온도 하락 |',
        '| 소나기 | 방수 바람막이 | 짧은 비 대응 |',
        '',
        '## 출발 전 확인',
        '',
        '- 외교부 해외안전여행과 항공사 수하물 규정을 확인합니다.',
      ].join('\n'),
    });

    expect(report.passed).toBe(true);
    expect(report.score).toBe(100);
  });

  it('flags pseudo-table lists that can render as broken comparison content', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '세부 첫날 이동',
      destination: '세부',
      blogHtml: [
        '# 세부 첫날 이동',
        '',
        '세부 첫날은 공항에서 숙소까지 이동 시간을 먼저 잡아두면 피로와 추가 비용을 줄일 수 있습니다.',
        '',
        '## 공항 이동 비교',
        '',
        '- 교통편: 특징 / 예상 소요 시간 / 예상 비용',
        '- 공항 택시: 미터기 사용 / 40분~1시간 / 400~700페소',
        '- 그랩: 앱 호출 / 40분~1시간 30분',
        '',
        '800',
        '- 픽업 서비스: 사전 예약 / 30분~1시간 / 700~1,500페소',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('table_render_risk');
  });

  it('allows fit and non-fit consultation lists without treating them as broken tables', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '몽골 여행 예산',
      destination: '몽골',
      blogHtml: [
        '# 몽골 여행 예산',
        '',
        '몽골 여행 예산은 식사, 이동, 선택 관광을 나눠 보면 실제 지출을 더 현실적으로 잡을 수 있습니다.',
        '',
        '## 맞는 사람과 안 맞는 사람',
        '',
        '- 맞는 사람: 이동 동선과 안전 변수를 먼저 줄이고 싶은 분.',
        '- 안 맞는 사람: 숙소와 이동을 모두 직접 조합하고 싶은 분.',
        '- 보류할 것: 출발일과 항공 시간이 확정되기 전에는 총액을 확정하지 않습니다.',
      ].join('\n'),
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain('table_render_risk');
  });

  it('allows official source link lists without mistaking URL separators for table columns', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '캐나다 로키산맥 대중교통',
      destination: '캐나다 로키산맥',
      blogHtml: [
        '# 캐나다 로키산맥 대중교통',
        '',
        '공식 운영사에서 노선과 예약 조건을 확인하세요.',
        '',
        '## 공식 운영사 근거',
        '',
        '- [Parks Canada](https://parks.canada.ca/pn-np/ab/banff/visit/parkbus/louise)',
        '- [Roam Transit 요금](https://roamtransit.com/fares/)',
        '- [Roam Transit 예약](https://roamtransit.com/fares/reservations/)',
      ].join('\n'),
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain('table_render_risk');
  });

  it('blocks readable Korean weather guides that open with reservation or cost copy', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '몽골 7월 날씨 옷차림',
      destination: '몽골',
      blogHtml: [
        '# 몽골 7월 날씨 옷차림 여행 준비물 체크리스트',
        '',
        '몽골 7월 날씨는 여행 전 비용, 이동 시간, 현지 결제 조건을 먼저 확인해야 시행착오를 줄일 수 있는 핵심 준비 항목입니다. 상품 예약 조건과 이동 동선을 함께 비교하면 현지에서 시간을 아낄 수 있습니다.',
        '',
        '## 몽골 7월 날씨 한눈에 보기',
        '',
        '| 지역 | 낮 기온 | 밤 기온 |',
        '| --- | --- | --- |',
        '| 울란바토르 | 25℃ | 12℃ |',
        '| 고비 | 30℃ | 15℃ |',
        '| 홉스골 | 20℃ | 8℃ |',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('weak_answer_first');
  });

  it('blocks readable Korean info posts with hard CTA in the top third', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '발리 가족여행 경비',
      destination: '발리',
      blogHtml: [
        '# 발리 가족여행 경비',
        '',
        '발리 가족여행 경비는 항공권, 숙소 위치, 현지 이동비를 먼저 나눠 보면 판단이 쉽습니다. 지금 바로 카카오톡 상담을 신청하면 남은 좌석과 최저가 상품을 빠르게 확인할 수 있습니다.',
        '',
        '## 경비 항목',
        '',
        '| 항목 | 확인 기준 | 메모 |',
        '| --- | --- | --- |',
        '| 항공 | 출발일 | 성수기 차이 |',
        '| 숙소 | 지역 | 이동비 차이 |',
        '| 현지비 | 동선 | 식비 포함 여부 |',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('early_sales_pressure');
  });

  it('blocks product posts without a DB-backed product consult brief', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'product',
      productId: 'pkg-100',
      primaryKeyword: '푸꾸옥 4박6일 패키지',
      destination: '푸꾸옥',
      blogHtml: [
        '# 부산출발 푸꾸옥 4박6일 패키지 799,000원~',
        '',
        '부산출발 푸꾸옥 4박6일 상품은 799,000원부터 확인하는 고객에게 맞습니다. 노옵션 조건과 자유시간 비중을 함께 보면 문의 전 판단이 쉬워집니다.',
        '',
        '## 포함/불포함',
        '- 포함 항목: 항공, 숙소, 일정 내 식사',
        '- 불포함 항목: 개인경비, 매너팁',
        '',
        '## 맞는 분',
        '- 부산 출발 직항 일정이 필요한 분',
        '',
        '## 맞지 않는 분',
        '- 모든 일정을 자유롭게 바꾸고 싶은 분',
        '',
        '## 가격이 달라지는 조건',
        '- 출발일, 인원, 객실 타입에 따라 달라질 수 있습니다.',
        '',
        '## 문의 전 질문',
        '- 출발일과 인원 기준 가능 여부를 확인하세요.',
      ].join('\n'),
      generationMeta: { writer: 'product_consultant_writer' },
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('product_source_contract_weak');
  });

  it('blocks product posts that repeat final-consultation fallback instead of decision facts', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'product',
      productId: 'pkg-101',
      primaryKeyword: '나트랑 3박5일 패키지',
      destination: '나트랑',
      blogHtml: [
        '# 부산출발 나트랑 3박5일 패키지 579,000원~',
        '',
        '부산출발 나트랑 3박5일 상품은 579,000원부터 확인하는 가족 고객에게 맞습니다. 포함 항목과 자유시간 조건을 먼저 보면 문의 전 판단이 쉬워집니다.',
        '',
        '## 포함/불포함',
        '- 포함 항목: 항공, 숙소, 일정 내 식사',
        '- 불포함 항목: 개인경비, 선택관광',
        '',
        '## 맞는 분',
        '- 부산 출발 패키지를 찾는 분',
        '',
        '## 맞지 않는 분',
        '- 자유일정을 길게 원하는 분',
        '',
        '## 가격이 달라지는 조건',
        '- 상담에서 최종 확인합니다.',
        '- 상담에서 최종 확인합니다.',
        '- 상담에서 최종 확인합니다.',
        '',
        '## 문의 전 질문',
        '- 출발일과 인원 기준 가능 여부를 알려주세요.',
      ].join('\n'),
      generationMeta: {
        writer: 'product_consultant_writer',
        product_consult_brief: {
          included: ['항공', '숙소'],
          excluded: ['개인경비'],
          fit_for: ['부산 출발 고객'],
          not_fit_for: ['자유일정 선호 고객'],
          risk_notes: ['출발일별 요금 변동'],
          consult_questions: ['출발일', '인원'],
        },
      },
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('product_consult_repetition');
  });

  it('blocks product posts that omit DB-backed included/excluded/risk evidence from the article', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'product',
      productId: 'pkg-102',
      primaryKeyword: '푸꾸옥 4박6일 패키지',
      destination: '푸꾸옥',
      blogHtml: [
        '# 부산출발 푸꾸옥 4박6일 패키지 799,000원~',
        '',
        '부산출발 푸꾸옥 4박6일 상품은 799,000원부터 확인하는 가족 고객에게 맞습니다. 일정 강도와 자유시간 비중을 먼저 보면 문의 전 판단이 쉬워집니다.',
        '',
        '## 포함/불포함',
        '- 포함 항목: 기본 포함 조건은 상담 시점에 다시 봅니다.',
        '- 불포함 항목: 개인별 추가 비용은 일정에 따라 달라질 수 있습니다.',
        '',
        '## 맞는 분',
        '- 부산 출발 패키지를 찾는 분',
        '',
        '## 맞지 않는 분',
        '- 자유일정을 길게 원하는 분',
        '',
        '## 가격이 달라지는 조건',
        '- 출발일과 인원에 따라 달라질 수 있습니다.',
        '',
        '## 문의 전 질문',
        '- 출발일과 인원 기준 가능 여부를 알려주세요.',
      ].join('\n'),
      generationMeta: {
        writer: 'product_consultant_writer',
        product_consult_brief: {
          included: ['왕복항공', '리조트 숙박', '일정 내 식사'],
          excluded: ['선택관광', '매너팁'],
          fit_for: ['부산 출발 고객'],
          not_fit_for: ['자유일정 선호 고객'],
          risk_notes: ['유류할증료 변동', '싱글차지 발생 가능'],
          consult_questions: ['출발일', '인원'],
        },
      },
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('product_evidence_omission');
  });

  it('blocks product posts that leak customer-hidden supplier or settlement terms', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'product',
      productId: 'pkg-103',
      primaryKeyword: '나트랑 3박5일 패키지',
      destination: '나트랑',
      blogHtml: [
        '# 부산출발 나트랑 3박5일 패키지 579,000원~',
        '',
        '부산출발 나트랑 3박5일 상품은 579,000원부터 확인하는 가족 고객에게 맞습니다. 포함 항목과 자유시간 조건을 먼저 보면 문의 전 판단이 쉬워집니다.',
        '',
        '## 포함/불포함',
        '- 포함 항목: 왕복항공, 호텔',
        '- 불포함 항목: 개인경비, 선택관광',
        '',
        '## 맞는 분',
        '- 부산 출발 패키지를 찾는 분',
        '',
        '## 맞지 않는 분',
        '- 자유일정을 길게 원하는 분',
        '',
        '## 가격이 달라지는 조건',
        '- 유류할증료 변동이 있을 수 있습니다.',
        '',
        '## 문의 전 질문',
        '- 출발일과 인원 기준 가능 여부를 알려주세요.',
        '',
        '내부 메모 기준 마진 조건은 별도 확인합니다.',
      ].join('\n'),
      generationMeta: {
        writer: 'product_consultant_writer',
        product_consult_brief: {
          included: ['왕복항공', '호텔'],
          excluded: ['개인경비', '선택관광'],
          fit_for: ['부산 출발 고객'],
          not_fit_for: ['자유일정 선호 고객'],
          risk_notes: ['유류할증료 변동'],
          consult_questions: ['출발일', '인원'],
        },
      },
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('product_internal_terms_leak');
  });

  it('flags changeable info guides without official or primary source support', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '태국 입국 서류',
      destination: '태국',
      blogHtml: [
        '# 태국 입국 서류 체크리스트',
        '',
        '태국 입국 서류는 여권 유효기간, 항공권, 숙소 정보부터 확인하면 됩니다. 가족 여행이라면 아이 여권과 영문 성명 일치 여부를 함께 챙기는 편이 안전합니다.',
        '',
        '## 출발 전 확인',
        '',
        '| 항목 | 확인 기준 | 메모 |',
        '| --- | --- | --- |',
        '| 여권 | 유효기간 | 영문명 확인 |',
        '| 항공권 | 왕복 여부 | 일정 확인 |',
        '| 숙소 | 주소 | 입국 심사 대비 |',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('info_source_support_weak');
  });

  it('flags long mobile paragraph walls even when the content has useful facts', () => {
    const longParagraph = [
      '몽골 7월 여행은 낮과 밤의 기온 차이가 커서 옷을 한 벌로 정하기보다 얇은 긴팔, 바람막이, 밤용 겉옷을 나눠 준비하는 편이 안전합니다.',
      '낮에는 햇빛과 자외선이 강하고 이동 중 먼지가 많을 수 있어 피부를 가리는 옷이 편하며, 밤에는 게르 캠프나 별보기 일정에서 체감온도가 빠르게 내려갈 수 있습니다.',
      '비가 오더라도 하루 종일 이어지는 장마라기보다 짧게 지나가는 소나기 형태가 많아 우산보다 방수 바람막이가 실용적인 경우가 많습니다.',
      '아이와 함께라면 감기약, 지사제, 밴드, 보습제처럼 현지에서 바로 구하기 어려운 물품을 작은 파우치에 따로 챙기는 것이 좋고, 이동 시간이 길어질 수 있으니 보조배터리와 간식도 같이 준비하면 좋습니다.',
      '현지에서 바로 사면 되는 물건과 한국에서 챙겨야 하는 물건을 나눠두면 짐은 줄이면서도 꼭 필요한 준비물은 놓치지 않을 수 있습니다.',
    ].join(' ');
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '몽골 7월 날씨 옷차림',
      destination: '몽골',
      blogHtml: [
        '# 몽골 7월 날씨 옷차림',
        '',
        longParagraph,
        '',
        '## 공식 확인 링크',
        '',
        '- 외교부 해외안전여행',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('mobile_readability_wall');
  });

  it('does not mistake a long, scannable markdown table for a mobile paragraph wall', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '괌 월별 날씨',
      destination: '괌',
      blogHtml: [
        '# 괌 월별 날씨',
        '',
        '괌 월별 날씨는 장기 평년값과 출발 직전 단기예보를 나눠 확인하면 준비가 쉽습니다.',
        '',
        '## 1~12월 기온과 강수',
        '',
        '| 월 | 최고기온 | 최저기온 | 강수량 | 강수일수 |',
        '| --- | --- | --- | --- | --- |',
        ...Array.from({ length: 12 }, (_, index) =>
          `| ${index + 1}월 | ${(29 + index / 10).toFixed(1)}°C | ${(24 + index / 10).toFixed(1)}°C | ${100 + index * 20}mm | ${(18 + index / 10).toFixed(1)}일 |`),
        '',
        '## 공식 확인 링크',
        '',
        '- [세계기상기구 괌 기후자료](https://worldweather.wmo.int/kr/json/1954_kr.xml)',
      ].join('\n'),
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain('mobile_readability_wall');
  });

  it('blocks leftover generic destination and generated product-name residue', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '발리 식비 예산',
      destination: '발리',
      blogHtml: [
        '# 발리 식비 예산',
        '',
        '발리 식비 예산은 1인 하루 식사비, 음료비, 서비스 차지를 나눠 보면 판단이 쉽습니다. 외교부와 현지 공식 안내도 출발 전에 함께 확인하면 안전합니다.',
        '',
        '여소남의 여행지 추천 상품 미리보기',
        '여소남의 상품 가격 변동_PKG_26년_8-10월_특정일 상품을 통해 현지 관련 상품을 확인해 보세요.',
        '',
        '## 비용표',
        '| 항목 | 기준 | 주의 |',
        '| --- | --- | --- |',
        '| 식사 | 1끼 | 세금 확인 |',
        '| 음료 | 하루 | 더위 변수 |',
        '| 팁 | 선택 | 서비스 차지 확인 |',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('placeholder_destination_copy');
  });

  it('blocks internal active-product and booking-signal values from customer articles', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '푸꾸옥 가족여행',
      destination: '푸꾸옥',
      blogHtml: [
        '# 푸꾸옥 가족여행',
        '',
        '푸꾸옥 가족여행은 아이 나이와 이동 시간을 먼저 정하면 일정을 고르기 쉽습니다.',
        '',
        '관련 상품 12개, 활성 상품 0개, 최근 예약 신호 0건입니다.',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('unsupported_internal_data');
  });
});
