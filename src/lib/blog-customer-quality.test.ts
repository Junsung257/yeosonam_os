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
});
