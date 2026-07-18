import { describe, expect, it } from 'vitest';
import { repairBlogFinalCustomerSurface } from './blog-final-customer-surface';

describe('repairBlogFinalCustomerSurface', () => {
  it('removes visible generation instructions and repeated public paragraphs', () => {
    const repeated =
      '발리 7월은 건기라 비가 적고 낮에는 덥습니다. 반팔 위주로 준비하되, 냉방이 강한 차량과 식당을 대비해 얇은 긴팔을 챙기면 충분합니다.';
    const result = repairBlogFinalCustomerSurface({
      destination: '발리',
      primaryKeyword: '발리 7월 날씨 옷차림',
      markdown: [
        '# 발리 7월 날씨 옷차림',
        '',
        repeated,
        '',
        '(첫 번째) 이 섹션은 주로 팁 위주라 구체적인 수치보다는 흐름을 설명합니다.',
        '',
        repeated,
        '',
        '## 준비물 체크',
        '',
        '| 상황 | 준비물 | 이유 |',
        '| --- | --- | --- |',
        '| 해변 | 래시가드 | 자외선 차단 |',
        '| 차량 이동 | 얇은 겉옷 | 냉방 대비 |',
        '| 아이 동반 | 상비약 | 현지 구매 변수 |',
      ].join('\n'),
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toEqual(expect.arrayContaining([
      'remove_generated_instruction_residue',
      'dedupe_repeated_plain_paragraphs',
    ]));
    expect(result.markdown).not.toContain('(첫 번째)');
    expect(result.markdown).not.toContain('이 섹션은 주로');
    expect(result.markdown.match(/발리 7월은 건기라/g)?.length).toBe(1);
  });

  it('replaces an entry-document article lead that drifts into price comparison', () => {
    const result = repairBlogFinalCustomerSurface({
      title: '광복절 여행 가이드 2026 | 입국 조건과 준비 서류 체크',
      primaryKeyword: '입국 조건 준비 서류 체크',
      slug: 'visa-info',
      markdown: [
        '# 광복절 여행 가이드 2026 | 입국 조건과 준비 서류 체크',
        '',
        '광복절 여행은 가격표만 보면 비슷해 보여도 차량 이동, 식사 포함, 현지 추가비 3가지에서 체감 차이가 납니다. 예약 전에는 총액과 동선을 같은 표에 놓고 비교하세요.',
        '',
        '## 입국 조건 확인',
        '',
        '여권 유효기간과 체류 가능 일수는 출발 전 공식 안내로 다시 확인해야 합니다.',
      ].join('\n'),
    });

    const lead = result.markdown.split('\n\n')[1] ?? '';
    expect(result.changed).toBe(true);
    expect(result.changes).toContain('ensure_answer_first_lead');
    expect(lead).toContain('입국 조건');
    expect(lead).toContain('여권 유효기간');
    expect(lead).not.toContain('가격표');
    expect(lead).not.toContain('현지 추가비');
  });

  it('removes empty CTA residue and chatty intro blocks before final publish', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: '몽골',
      primaryKeyword: '몽골 7월 날씨',
      markdown: [
        '# 몽골 7월 날씨',
        '',
        '몽골 7월은 낮 25~30도, 밤 10도 안팎까지 떨어질 수 있어 얇은 긴팔과 플리스, 방수 재킷을 함께 챙기는 편이 안전합니다.',
        '',
        '안녕하세요, 소중한 여행을 계획하시는 여러분. 7월 몽골은 초원이 가장 푸른 시기라 더없이 좋지만, 날씨가 자주 바뀌어 준비가 중요합니다.',
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

    expect(result.changed).toBe(true);
    expect(result.changes).toEqual(expect.arrayContaining(['remove_empty_cta_residue', 'remove_chatty_info_intro']));
    expect(result.markdown).not.toContain('안녕하세요');
    expect(result.markdown).not.toContain('지금 바로 를 클릭');
  });

  it('normalizes destination placeholders and generated residue', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: '몽골',
      primaryKeyword: '몽골 7월 날씨',
      markdown: [
        '# 몽골 7월 날씨',
        '',
        '몽골 날씨, 출발 7일 전 무엇을 다시 봐야 할까요? 낮과 밤 기온을 비교하면 짐 실수를 줄일 수 있습니다.',
        '',
        '여소남에서는 현재 3개의 현지 관련 상품을 비교할 수 있습니다.',
        '',
        '### 여행 정보를 볼 때 가장 먼저 확인할 항목은 무엇인가요?',
        '현지 날씨와 현지 이동 조건을 같이 확인하세요.',
        '',
        '#몽골 #여행정보 #몽골 #여행정보 #날씨 #몽골',
      ].join('\n'),
    });

    expect(result.changed).toBe(true);
    expect(result.markdown).not.toContain('현지 관련 상품');
    expect(result.markdown).not.toContain('여행 정보를 볼 때');
    expect(result.markdown).toContain('몽골 정보를 볼 때');
    expect(result.markdown).toContain('몽골 날씨');
    expect(result.markdown.match(/#몽골/g)?.length).toBe(1);
  });

  it('repairs broken markdown URL residue without exposing utm fragments', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: '세부',
      markdown: [
        '# 세부 여행',
        '',
        '세부, 먼저 무엇을 확인해야 할까요? 이동 시간과 비용을 같이 보면 가족 일정 선택이 쉬워집니다.',
        '',
        '[내 일정 기준으로 확인](/group-inquiry?utm_source=blog',
        'utm_medium=article)',
      ].join('\n'),
    });

    expect(result.markdown).toContain('[내 일정 기준으로 확인](/group-inquiry?utm_source=blogutm_medium=article)');
    expect(result.markdown).not.toMatch(/^\s*utm_medium=/m);
  });

  it('keeps one answer-first lead before the first section', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: '클락',
      primaryKeyword: '클락 날씨',
      markdown: [
        '# 클락 여행 가이드',
        '',
        '클락 날씨, 출발 7일 전 무엇을 다시 봐야 할까요? 낮과 밤 기온, 비 예보, 필요한 옷차림을 먼저 비교하면 현지에서 짐과 동선 실수를 줄일 수 있습니다.',
        '',
        '같은 가격처럼 보여도 차량 이동 1-2시간과 클락 결제 조건에 따라 체감 만족도가 달라질 수 있습니다.',
        '',
        '## 핵심 요약',
        '',
        '- 우기에는 우산을 챙깁니다.',
      ].join('\n'),
    });

    const beforeFirstSection = result.markdown.split('\n## 핵심 요약')[0];
    expect(beforeFirstSection).toContain('클락');
    expect(beforeFirstSection).toMatch(/날씨|옷차림|준비물|기온|비 예보/);
    expect(beforeFirstSection).not.toContain('같은 가격처럼 보여도');
  });

  it('rebuilds a weak fragment lead into a customer answer-first paragraph', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: '다낭',
      primaryKeyword: '다낭 공항에서 시내 이동 방법',
      markdown: [
        '# 다낭 공항에서 시내 이동 방법',
        '',
        '택시, 그랩, 셔틀버스 등 여러 이동 수단 확인',
        '',
        '## 이동 수단 비교',
        '| 이동 수단 | 예상 요금 | 예상 시간 |',
        '| --- | --- | --- |',
        '| 택시 | 100,000VND | 15~20분 |',
        '| 그랩 | 110,000VND | 20분 |',
        '| 셔틀 | 숙소별 상이 | 30분 |',
      ].join('\n'),
    });

    const firstSection = result.markdown.split('\n## 이동 수단 비교')[0];
    expect(firstSection).toContain('실수 가능성이 낮은 동선');
    expect(firstSection).not.toContain('택시, 그랩, 셔틀버스 등 여러 이동 수단 확인');
    expect(result.changes).toContain('ensure_answer_first_lead');
  });

  it('rotates cost and weather answer-first leads by article context', () => {
    const costA = repairBlogFinalCustomerSurface({
      destination: '몽골',
      primaryKeyword: '몽골 여행 예산',
      slug: 'mongolia-food-budget',
      markdown: ['# 몽골 여행 예산', '', '짧음', '', '## 예산표'].join('\n'),
    }).markdown.split('\n\n')[1];
    const costB = repairBlogFinalCustomerSurface({
      destination: '몽골',
      primaryKeyword: '몽골 여행 예산',
      slug: 'mongolia-shopping-budget',
      markdown: ['# 몽골 여행 예산', '', '짧음', '', '## 예산표'].join('\n'),
    }).markdown.split('\n\n')[1];
    const weather = repairBlogFinalCustomerSurface({
      destination: '몽골',
      primaryKeyword: '몽골 7월 날씨 옷차림',
      slug: 'mongolia-july-weather-packing',
      markdown: ['# 몽골 7월 날씨 옷차림', '', '짧음', '', '## 옷차림'].join('\n'),
    }).markdown.split('\n\n')[1];

    expect(costA).not.toBe(costB);
    expect(costA).toMatch(/예산|비용|상품가|현지/);
    expect(weather).toMatch(/날씨|옷차림|준비물|기온|비 예보/);
    expect(costA).not.toContain('먼저 총액에서 무엇이 빠지는지');
    expect(weather).not.toContain('출발 7일 전 무엇을 다시 봐야 할까요');
  });

  it('repairs repeated fleet opening formulas even when the lead is long enough', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: '세부',
      primaryKeyword: '세부 여행 예산',
      slug: 'cebu-food-budget',
      markdown: [
        '# 세부 여행 예산',
        '',
        '세부 먼저 총액에서 무엇이 빠지는지 봐야 할까요? 1인 하루 식사·교통·선택 관광 비용을 상품가와 나눠 보면 예약 전 비교가 훨씬 쉬워집니다.',
        '',
        '## 예산표',
      ].join('\n'),
    });

    expect(result.markdown).not.toContain('먼저 총액에서 무엇이 빠지는지');
    expect(result.markdown).toMatch(/세부.*(?:예산|비용|상품가|현지)/);
    expect(result.changes).toContain('ensure_answer_first_lead');
  });

  it('repairs destination-prefixed weather formula openings', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: '세부',
      primaryKeyword: '세부 7월 날씨 옷차림',
      slug: 'cebu-july-weather-clothes-checklist-2026',
      markdown: [
        '# 세부 7월 날씨 옷차림',
        '',
        '세부, 출발 7일 전 무엇을 다시 봐야 할까요? 낮과 밤 기온, 비 예보, 필요한 옷차림을 먼저 비교하면 세부 현지에서 짐과 동선 실수를 줄일 수 있습니다.',
        '',
        '## 옷차림 체크',
      ].join('\n'),
    });

    expect(result.markdown).not.toContain('출발 7일 전 무엇을 다시 봐야 할까요');
    expect(result.markdown).toMatch(/세부.*(?:날씨|옷차림|준비물|기온|비 예보)/);
    expect(result.changes).toContain('ensure_answer_first_lead');
  });

  it('repairs keyword-prefixed weather formula openings with a comma', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: '시드니',
      primaryKeyword: '시드니 7월 날씨',
      slug: 'sydney-july-winter-weather-guide',
      markdown: [
        '# 시드니 7월 날씨',
        '',
        '시드니 날씨, 출발 7일 전 무엇을 다시 봐야 할까요? 낮과 밤 기온, 비 예보, 필요한 옷차림을 먼저 비교하면 현지에서 짐과 동선 실수를 줄일 수 있습니다.',
        '',
        '## 월별 날씨 체크표',
      ].join('\n'),
    });

    expect(result.markdown).not.toContain('출발 7일 전 무엇을 다시 봐야 할까요');
    expect(result.markdown).toMatch(/시드니.*(?:출발 7일|출발 24시간|3가지)/);
    expect(result.changes).toContain('ensure_answer_first_lead');
  });

  it('repairs old answer-first weather boilerplate that only looks like an answer', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: '발리',
      primaryKeyword: '발리 7월 날씨',
      slug: 'bali-weather-packing',
      markdown: [
        '# 발리 7월 날씨',
        '',
        '발리 7월 날씨은 먼저 발리 7월 날씨 한눈에 보기, 7월 기온/강수/습도 표 기준으로 확인하면 됩니다.',
        '',
        '## 핵심 요약',
      ].join('\n'),
    });

    expect(result.markdown).not.toContain('날씨은 먼저');
    expect(result.markdown).not.toContain('기준으로 확인하면 됩니다');
    expect(result.markdown).toMatch(/발리.*(?:출발 7일|출발 24시간|3가지)/);
    expect(result.changes).toContain('ensure_answer_first_lead');
  });

  it('splits only long paragraph walls and preserves short answer leads', () => {
    const longParagraph = Array.from({ length: 45 }, (_, index) => `문장 ${index + 1}입니다`).join(' ');
    const lead = '발리, 먼저 무엇을 확인해야 할까요? 일정과 비용, 이동 조건을 함께 비교하면 출발 전 바뀔 수 있는 조건을 줄이고 가족 여행 준비도 훨씬 쉬워집니다.';
    const result = repairBlogFinalCustomerSurface({
      destination: '발리',
      markdown: [
        '# 발리 여행',
        '',
        lead,
        '',
        longParagraph,
      ].join('\n'),
    });

    expect(result.markdown).toContain(lead);
    expect(result.markdown).toContain('문장 1입니다\n\n문장 2입니다');
  });
});
