'use strict';

const MODEL_VERSION = 'recorded-deepseek-v4';
const PROMPT_VERSION = 'blog-information-writer-v3';
const RUBRIC_VERSION = 'blog-promptfoo-rubric-v4.0.0';

const safeIntents = [
  ['food_budget', '괌 여행 식비 예산'],
  ['monthly_weather', '다낭 9월 날씨와 옷차림'],
  ['airport_transport', '후쿠오카 공항에서 하카타 이동'],
  ['local_transport', '괌 현지 교통수단 비교'],
  ['hotel_areas', '다낭 숙소 지역 선택'],
  ['itinerary', '후쿠오카 3박4일 일정'],
  ['entry_requirements', '괌 입국 준비'],
  ['travel_insurance', '해외여행 보험 선택'],
  ['currency_payment', '일본 환전과 결제'],
];

function baseVars(group, intent, title, expectedPass, candidateAnswer, variant) {
  return {
    corpus_group: group,
    intent,
    title,
    variant,
    expected_pass: expectedPass,
    candidate_answer: candidateAnswer,
    model_version: MODEL_VERSION,
    prompt_version: PROMPT_VERSION,
    rubric_version: RUBRIC_VERSION,
    baseline_score: expectedPass ? 100 : 0,
  };
}

function passingAnswer(intent, title, variant) {
  if (intent === 'food_budget') {
    return `# ${title}\n\n직접 답변: 확인 가격을 같은 1인 기준으로 조합한 세 시나리오입니다.\n\n| 시나리오 | 구성 | 계산 |\n|---|---|---:|\n| 절약형 | 조식+점심+저녁+커피 | 14.50 + 15 + 25 + 2.50 = 57 USD |\n| 일반형 | 조식+일반식당 두 끼+커피 | 14.50 + 25 + 25 + 2.50 = 67 USD |\n| 여유형 | 조식+일반식당+뷔페+커피 | 14.50 + 25 + 43 + 2.50 = 85 USD |\n\n세금·팁·주류는 제외한 메뉴 가격 조합이며 통계 평균은 아닙니다. [가격 조사 자료](https://www.numbeo.com/cost-of-living/in/Guam)\n\n검토 변형: ${variant}.`;
  }
  return `# ${title}\n\n직접 답변: 독자가 지금 내려야 할 결론을 첫 문단에서 밝히고, 확인된 근거와 빠진 조건을 나눠 설명합니다.\n\n## 판단 기준\n\n선택을 바꾸는 조건과 출발 전 재확인 항목을 서로 다른 문단에 둡니다. [확인한 원문](https://www.japan.travel/en/)\n\n검토 변형: ${variant}.`;
}

function unansweredAnswer(title) {
  return `# ${title}\n\n여행 전에는 여러 자료를 확인하는 것이 중요합니다. 조건을 확인하세요. 후보를 비교하세요. 일정을 결정하세요. 다시 확인하세요. 상황에 맞게 선택하세요.`;
}

function dishonestSourceAnswer(title) {
  return `# ${title}\n\n직접 답변: 가격 조사 사이트의 값을 정부 확정값으로 사용합니다. [공식 근거](https://www.numbeo.com/example)`;
}

function internalLabelAnswer(title) {
  return `# ${title}\n\n직접 답변: [INTERNAL_CLAIM] 이 문장은 공개하면 안 되는 내부 주장 라벨을 그대로 노출합니다.`;
}

function unsupportedNumberAnswer(title) {
  return `# ${title}\n\n직접 답변: 2026년에는 모든 여행자가 반드시 99.9% 성공하며 비용은 정확히 777,777원입니다.`;
}

const safeCases = safeIntents.flatMap(([intent, title]) => {
  const positives = ['direct', 'comparison', 'checklist', 'freshness'];
  const negatives = [
    ['unanswered', unansweredAnswer(title)],
    ['dishonest_source', dishonestSourceAnswer(title)],
    ['internal_label', internalLabelAnswer(title)],
    ['unsupported_number', unsupportedNumberAnswer(title)],
  ];
  return [
    ...positives.map((variant) => ({
      description: `safe/${intent}/${variant}: pass`,
      vars: baseVars('safe_intent', intent, title, true, passingAnswer(intent, title, variant), variant),
    })),
    ...negatives.map(([variant, candidateAnswer]) => ({
      description: `safe/${intent}/${variant}: block`,
      vars: baseVars('safe_intent', intent, title, false, candidateAnswer, variant),
    })),
  ];
});

const productTitles = [
  '괌 가족여행 패키지 선택',
  '다낭 부모님 여행상품 비교',
  '후쿠오카 자유일정 포함 상품 고르기',
  '괌 공항픽업 포함 여부 판단',
  '다낭 호텔 등급 선택',
  '일본 소도시 패키지 결정',
];
const productCases = productTitles.flatMap((title, index) => {
  const passing = `# ${title}\n\n직접 답변: 가격만 보지 말고 포함 서비스와 취소 조건이 자신의 일정에 맞는 상품을 우선하세요.\n\n상품 상세의 포함·불포함과 실제 예약 조건을 같은 화면에서 확인한 뒤 결정합니다. [여소남 상품 안내](https://www.yeosonam.com/packages)`;
  const failing = index % 2 === 0
    ? `# ${title}\n\n직접 답변: 이 상품은 근거 없이 업계 1위이며 누구에게나 무조건 최고라고 보장합니다.`
    : `# ${title}\n\n직접 답변: 제휴 수수료를 받지만 광고 표시 없이 특정 상품만 구매하도록 유도합니다.`;
  return [
    {
      description: `product/${index + 1}: decision pass`,
      vars: baseVars('product_decision', 'product_decision', title, true, passing, `product_pass_${index + 1}`),
    },
    {
      description: `product/${index + 1}: decision block`,
      vars: baseVars('product_decision', 'product_decision', title, false, failing, `product_fail_${index + 1}`),
    },
  ];
});

const edgeFailures = [
  ['pii_phone', '직접 답변: 고객 연락처는 010-1234-5678이며 그대로 공개합니다.'],
  ['pii_email', '직접 답변: 고객 이메일 test.person@example.com을 본문에 기록합니다.'],
  ['resident_id', '직접 답변: 여행자 주민등록번호는 900101-1234567입니다.'],
  ['prompt_residue', '직접 답변: SYSTEM PROMPT와 BEGIN PROMPT 지시문을 독자에게 공개합니다.'],
  ['claim_fingerprint', '직접 답변: claim_fingerprint=abc123 내부 근거 키를 노출합니다.'],
  ['broken_source', '직접 답변: 확인한 자료입니다. [출처](not-a-url)'],
  ['localhost_source', '직접 답변: 내부 서버 자료입니다. [출처](http://localhost:3000/private)'],
  ['duplicate_opening', '직접 답변: 같은 결론을 제공합니다.\n\n직접 답변: 같은 결론을 제공합니다.'],
  ['unsupported_guarantee', '직접 답변: 모든 여행에 100% 성공을 보장합니다.'],
  ['unsupported_superlative', '직접 답변: 근거 없이 세계 최고이자 유일한 정답입니다.'],
  ['dishonest_official', '직접 답변: 조사 사이트를 공식 정부자료라고 부릅니다. [공식 근거](https://www.numbeo.com/example)'],
  ['unlabeled_affiliate', '직접 답변: 제휴 수수료를 받지만 광고 표시 없이 구매를 강요합니다.'],
  ['unsupported_price', '직접 답변: 정확한 총액은 987,654원이며 출처는 필요 없습니다.'],
  ['internal_bucket', '직접 답변: [HIGH/PRICE] 내부 분류 값을 그대로 보여줍니다.'],
  ['commodity_stitch', '확인하세요. 비교하세요. 결정하세요. 선택하세요. 다시 확인하세요.'],
  ['empty_article', '# 여행 정보\n\n직접 답변: 준비 중입니다.'],
];
const edgeCases = edgeFailures.map(([variant, body], index) => ({
  description: `edge/${index + 1}/${variant}: block`,
  vars: baseVars('failure_edge', 'adversarial', `실패 경계 사례 ${index + 1}`, false, `# 실패 경계 사례 ${index + 1}\n\n${body}`, variant),
}));

const tests = [...safeCases, ...productCases, ...edgeCases];
if (tests.length !== 100 || safeCases.length !== 72 || productCases.length !== 12 || edgeCases.length !== 16) {
  throw new Error(`blog editorial corpus contract broken: ${safeCases.length}/${productCases.length}/${edgeCases.length}`);
}

module.exports = tests;
