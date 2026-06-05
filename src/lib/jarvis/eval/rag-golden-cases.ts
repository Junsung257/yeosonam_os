export interface RagEvalContext {
  title: string;
  url?: string;
  text: string;
}

export interface RagEvalFact {
  id: string;
  terms: string[];
}

export interface RagGoldenCase {
  id: string;
  query: string;
  description: string;
  contexts: RagEvalContext[];
  answer: string;
  expectedFacts: RagEvalFact[];
  answerClaims: RagEvalFact[];
  requiredCitations: string[];
  thresholds?: {
    contextRecall?: number;
    answerRelevancy?: number;
    faithfulness?: number;
    citationCoverage?: number;
  };
}

export const RAG_GOLDEN_CASES: RagGoldenCase[] = [
  {
    id: 'rag-danang-family-package',
    query: '부모님 모시고 갈 다낭 패키지 추천해줘',
    description: '가족 여행 추천은 호텔 등급, 무료 옵션, 쇼핑 여부를 검색 근거로 답해야 함',
    contexts: [
      {
        title: '다낭 셀렉텀 노아 3박5일',
        url: '/packages/danang-selectum-noah',
        text: '다낭 셀렉텀 노아 3박5일 상품은 5성 호텔 숙박, 무료 옵션 5개, 직항 항공, 쇼핑 일정 없음이 특징이다. 가족 여행과 부모님 동반 여행에 적합하다.',
      },
      {
        title: '다낭 가족여행 가이드',
        url: '/blog/danang-family-guide',
        text: '부모님 동반 다낭 여행은 호텔 등급, 이동 동선, 쇼핑 일정 유무를 우선 확인하는 것이 좋다.',
      },
    ],
    answer: '부모님과 함께라면 [다낭 셀렉텀 노아 3박5일](/packages/danang-selectum-noah)을 먼저 보겠습니다. 5성 호텔, 무료 옵션 5개, 직항 항공이고 쇼핑 일정이 없어 가족 여행에 맞습니다.',
    expectedFacts: [
      { id: 'five-star-hotel', terms: ['5성', '호텔'] },
      { id: 'free-options', terms: ['무료', '옵션', '5개'] },
      { id: 'no-shopping', terms: ['쇼핑', '일정'] },
    ],
    answerClaims: [
      { id: 'claim-five-star-hotel', terms: ['5성', '호텔'] },
      { id: 'claim-free-options', terms: ['무료', '옵션', '5개'] },
      { id: 'claim-no-shopping', terms: ['쇼핑', '일정'] },
    ],
    requiredCitations: ['다낭 셀렉텀 노아 3박5일'],
  },
  {
    id: 'rag-refund-policy-hedged',
    query: '취소하면 환불 가능해?',
    description: '환불/취소 정책은 단정 대신 담당자 확인 필요 문구와 정책 근거를 함께 사용',
    contexts: [
      {
        title: '여소남 취소·환불 정책',
        url: '/terms/refund',
        text: '취소와 환불은 상품별 약관, 항공권 발권 여부, 출발일 기준 취소 시점에 따라 달라진다. 정확한 금액과 가능 여부는 담당자 확인이 필요하다.',
      },
    ],
    answer: '[여소남 취소·환불 정책](/terms/refund) 기준으로 취소·환불은 상품별 약관, 항공권 발권 여부, 출발일 기준 시점에 따라 달라집니다. 정확한 금액과 가능 여부는 담당자 확인 후 안내드릴게요.',
    expectedFacts: [
      { id: 'policy-varies-by-product', terms: ['상품별', '약관'] },
      { id: 'policy-ticketing', terms: ['항공권', '발권'] },
      { id: 'policy-staff-confirm', terms: ['담당자', '확인'] },
    ],
    answerClaims: [
      { id: 'claim-varies-by-product', terms: ['상품별', '약관'] },
      { id: 'claim-ticketing', terms: ['항공권', '발권'] },
      { id: 'claim-staff-confirm', terms: ['담당자', '확인'] },
    ],
    requiredCitations: ['여소남 취소·환불 정책'],
  },
  {
    id: 'rag-attraction-guide',
    query: '세부에서 부모님 모시고 갈 만한 관광지 알려줘',
    description: '관광지 답변은 관광지 컨텍스트의 접근성·체류 포인트를 근거로 사용',
    contexts: [
      {
        title: '세부 시라오 가든',
        url: '/things-to-do/cebu/sirao-garden',
        text: '시라오 가든은 꽃 정원과 포토존이 유명한 세부 관광지다. 계단과 야외 이동이 있어 무릎이 불편한 고령 고객은 이동 동선을 확인하는 것이 좋다.',
      },
      {
        title: '세부 레아 신전',
        url: '/things-to-do/cebu/temple-of-leah',
        text: '레아 신전은 전망과 사진 포인트가 좋은 관광지이며 차량 접근이 비교적 편하다. 더운 시간대 방문은 피하는 편이 좋다.',
      },
    ],
    answer: '부모님 동반이면 [세부 레아 신전](/things-to-do/cebu/temple-of-leah)을 우선 추천합니다. 차량 접근이 비교적 편하고 전망·사진 포인트가 좋아요. 시라오 가든은 야외 이동과 계단이 있어 무릎이 불편하시면 동선을 먼저 확인하겠습니다.',
    expectedFacts: [
      { id: 'leah-car-access', terms: ['차량', '접근', '편'] },
      { id: 'leah-view-photo', terms: ['전망', '사진'] },
      { id: 'sirao-stairs', terms: ['계단', '야외', '이동'] },
    ],
    answerClaims: [
      { id: 'claim-car-access', terms: ['차량', '접근', '편'] },
      { id: 'claim-view-photo', terms: ['전망', '사진'] },
      { id: 'claim-sirao-stairs', terms: ['계단', '야외', '이동'] },
    ],
    requiredCitations: ['세부 레아 신전'],
  },
  {
    id: 'rag-blog-source',
    query: '다낭 우기 여행 팁 알려줘',
    description: '블로그형 답변은 출처 링크와 근거 문장 기반으로 안내',
    contexts: [
      {
        title: '다낭 우기 여행 준비 가이드',
        url: '/blog/danang-rainy-season',
        text: '다낭 우기는 짧고 강한 소나기가 잦다. 실내 관광지와 마사지 일정을 섞고, 바나힐은 날씨 예보를 확인해 조정하는 것이 좋다.',
      },
    ],
    answer: '[다낭 우기 여행 준비 가이드](/blog/danang-rainy-season)를 기준으로 보면, 우기에는 짧고 강한 소나기가 잦아서 실내 관광지와 마사지 일정을 섞는 편이 좋습니다. 바나힐은 날씨 예보를 보고 조정하세요.',
    expectedFacts: [
      { id: 'short-heavy-rain', terms: ['짧고', '강한', '소나기'] },
      { id: 'indoor-massage', terms: ['실내', '마사지'] },
      { id: 'banahill-weather', terms: ['바나힐', '날씨', '예보'] },
    ],
    answerClaims: [
      { id: 'claim-short-heavy-rain', terms: ['짧고', '강한', '소나기'] },
      { id: 'claim-indoor-massage', terms: ['실내', '마사지'] },
      { id: 'claim-banahill-weather', terms: ['바나힐', '날씨', '예보'] },
    ],
    requiredCitations: ['다낭 우기 여행 준비 가이드'],
  },
];
