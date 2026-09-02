'use strict';

const intents = [
  ['food_budget', '괌 여행 식비 예산'],
  ['monthly_weather', '다낭 9월 날씨와 옷차림'],
  ['airport_transport', '후쿠오카 공항에서 하카타 이동'],
  ['local_transport', '괌 현지 교통수단 비교'],
  ['hotel_areas', '다낭 숙소 지역 선택'],
  ['itinerary', '후쿠오카 3박4일 일정'],
  ['entry_requirements', '괌 입국 준비'],
  ['travel_insurance', '해외여행 보험 선택'],
  ['currency_payment', '일본 환전과 결제'],
  ['shopping_souvenirs', '괌 쇼핑 품목과 예산'],
  ['attraction_selection', '다낭 가볼만한곳 선택'],
];

const currentGuamFailure = `# 괌 여행 식비 예산: 여행 방식별 예산 시나리오

괌 여행 식비 예산 기준을 세우려면 chinfe.menuguam.com·numbeo.com·rootzguam.com 근거 링크부터 확인하고, 실제로 먹을 항목만 고르세요. 고른 항목을 절약형·일반형·여유형 중 자신의 식사 계획에 맞는 기준으로 비교하세요.

[절약형 하루 예산] [간식] 커피는 2.50 USD이다. [공식 근거](https://chinfe.menuguam.com/)
[아침] 조식은 14.50 USD이다. [공식 근거](https://chinfe.menuguam.com/)
맥도날드 콤보는 15.00 USD이다. [공식 근거](https://www.numbeo.com/cost-of-living/in/Guam)
무엇을 포함할지 확인하세요. 한 끼 기준인지 비교하세요. 음료를 넣을지 결정하세요. 인원수를 확인하세요. 다시 선택하세요.`;

function passingAnswer(intent, title) {
  if (intent === 'food_budget') {
    return `# ${title}\n\n직접 답변: 확인 가격을 같은 1인 기준으로 조합한 세 시나리오입니다.\n\n| 시나리오 | 구성 | 계산 |\n|---|---|---:|\n| 절약형 | 조식+점심+저녁+커피 | 14.50 + 15 + 25 + 2.50 = 57 USD |\n| 일반형 | 조식+일반식당 두 끼+커피 | 14.50 + 25 + 25 + 2.50 = 67 USD |\n| 여유형 | 조식+일반식당+뷔페+커피 | 14.50 + 25 + 43 + 2.50 = 85 USD |\n\n세금·팁·주류는 제외한 메뉴 가격 조합이며 통계 평균은 아닙니다. [가격 조사 자료](https://www.numbeo.com/cost-of-living/in/Guam)`;
  }
  return `# ${title}\n\n직접 답변: 독자가 지금 내려야 할 결론을 첫 문단에서 밝히고, 확인된 근거와 빠진 조건을 나눠 설명합니다.\n\n## 판단 기준\n\n선택을 바꾸는 조건과 출발 전 재확인 항목을 서로 다른 문단에 둡니다. [확인한 원문](https://example.com/source)`;
}

function unansweredAnswer(title) {
  return `# ${title}\n\n여행 전에는 여러 자료를 확인하는 것이 중요합니다. 조건을 확인하세요. 후보를 비교하세요. 일정을 결정하세요. 다시 확인하세요. 상황에 맞게 선택하세요.`;
}

function dishonestSourceAnswer(title) {
  return `# ${title}\n\n직접 답변: 가격 조사 사이트의 값을 공식 확정값으로 사용합니다. [공식 근거](https://www.numbeo.com/example)`;
}

module.exports = intents.flatMap(([intent, title], index) => [
  {
    description: `${intent}: people-first pass`,
    vars: { intent, title, expected_pass: true, candidate_answer: passingAnswer(intent, title) },
  },
  {
    description: `${intent}: unanswered negative`,
    vars: {
      intent,
      title,
      expected_pass: false,
      candidate_answer: index === 0 ? currentGuamFailure : unansweredAnswer(title),
    },
  },
  {
    description: `${intent}: dishonest source negative`,
    vars: { intent, title, expected_pass: false, candidate_answer: dishonestSourceAnswer(title) },
  },
]);
