export type BlogDecisionBlockKind =
  | 'weather'
  | 'cost'
  | 'itinerary'
  | 'food'
  | 'visa'
  | 'currency'
  | 'transport'
  | 'comparison'
  | 'preparation'
  | 'general';

interface BlogDecisionBlockInput {
  destination?: string | null;
  primaryKeyword?: string | null;
}

function cleanText(value: string | null | undefined, fallback: string): string {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

function countMarkdownTableRows(markdown: string): number {
  return (markdown.match(/(^|\n)\s*\|.+\|\s*$/gm) || []).length;
}

function hasDecisionTable(markdown: string): boolean {
  return countMarkdownTableRows(markdown) >= 4 || /<table\b/i.test(markdown);
}

function countListItems(markdown: string): number {
  return (markdown.match(/(^|\n)\s*(?:[-*]|\d+\.)\s+\S/g) || []).length;
}

function inferDecisionBlockKind(markdown: string, input: BlogDecisionBlockInput): BlogDecisionBlockKind | null {
  const haystack = `${input.destination || ''} ${input.primaryKeyword || ''} ${markdown.slice(0, 1800)}`.toLowerCase();

  if (/weather|날씨|우기|건기|기온|강수|태풍|옷차림/.test(haystack)) return 'weather';
  if (/budget|cost|expense|price|비용|예산|경비|금액|가격|예약/.test(haystack)) return 'cost';
  if (/itinerary|course|route|일정|코스|동선|이동시간|day\s*\d/.test(haystack)) return 'itinerary';
  if (/food|restaurant|맛집|외식|먹거리|메뉴|식당/.test(haystack)) return 'food';
  if (/visa|비자|입국|서류|\b(?:esta|eta)\b/.test(haystack)) return 'visa';
  if (/currency|exchange|환전|환율|결제|카드|현금/.test(haystack)) return 'currency';
  if (/transport|airport|transfer|교통|공항|항공권|이동|택시|기차|버스/.test(haystack)) return 'transport';
  if (/comparison|compare|vs|비교|차이|선택/.test(haystack)) return 'comparison';
  if (/checklist|preparation|packing|준비물|체크리스트|준비/.test(haystack)) return 'preparation';
  if (/guide|가이드|총정리|추천|주의사항/.test(haystack)) return 'general';
  return null;
}

function decisionTable(kind: BlogDecisionBlockKind, destination: string, keyword: string): string {
  if (kind === 'weather') {
    return [
      '| 구분 | 여행 판단 기준 | 준비 포인트 |',
      '| --- | --- | --- |',
      '| 기온 | 낮과 밤, 실내외 체감 차이를 함께 확인 | 얇은 겉옷과 통풍 좋은 옷을 함께 준비 |',
      '| 비/습도 | 우기, 소나기, 강수량 변화를 확인 | 접이식 우산, 방수팩, 잘 마르는 신발 준비 |',
      '| 자외선 | 야외 일정과 이동 시간을 확인 | 선크림, 모자, 선글라스 준비 |',
      '| 출발 전 | 출발 24시간 전 최신 예보 재확인 | 항공·투어 일정 변경 가능성 체크 |',
    ].join('\n');
  }

  if (kind === 'cost' || kind === 'currency') {
    return [
      '| 항목 | 확인 기준 | 놓치기 쉬운 비용 |',
      '| --- | --- | --- |',
      '| 항공/이동 | 출발지, 시간대, 수하물 포함 여부 | 좌석, 수하물, 심야 이동비 |',
      '| 숙박 | 위치, 조식, 리조트피 포함 여부 | 현지 세금, 보증금, 추가 인원 요금 |',
      '| 식비 | 1인 1일 기준 예산 | 음료, 팁, 서비스 차지 |',
      '| 투어/입장 | 사전 예약 필요 여부 | 현장 옵션, 픽업 추가금 |',
    ].join('\n');
  }

  if (kind === 'itinerary') {
    return [
      '| 일정 구간 | 핵심 확인 | 무리 줄이는 기준 |',
      '| --- | --- | --- |',
      '| 오전 | 이동 시작 시간과 첫 방문지 거리 | 장거리 이동 뒤 바로 강한 일정 배치 금지 |',
      '| 오후 | 메인 관광지 체류 시간 | 대기 시간과 휴식 시간을 같이 계산 |',
      '| 저녁 | 식사 위치와 숙소 복귀 동선 | 야간 이동 안전성과 교통 종료 시간 확인 |',
      '| 예비 시간 | 날씨·교통 지연 대비 | 하루 1~2시간 여유 확보 |',
    ].join('\n');
  }

  if (kind === 'food') {
    return [
      '| 선택 기준 | 확인할 점 | 추천 상황 |',
      '| --- | --- | --- |',
      '| 대표 음식 | 현지에서 자주 먹는 메뉴인지 | 처음 방문하는 여행자 |',
      '| 위치 | 숙소·관광지와의 거리 | 동선 낭비를 줄이고 싶을 때 |',
      '| 가격대 | 1인 예산과 포함 메뉴 | 가족·단체 식사 |',
      '| 위생/대기 | 회전율, 후기, 영업 시간 | 아이·부모님 동반 여행 |',
    ].join('\n');
  }

  if (kind === 'visa') {
    return [
      '| 확인 항목 | 기준 | 출발 전 행동 |',
      '| --- | --- | --- |',
      '| 여권 | 필요 유효기간과 훼손 여부 | 여권 만료일과 사증란 확인 |',
      '| 비자/입국 | 면제, 전자비자, 도착비자 여부 | 공식 기관에서 최신 조건 확인 |',
      '| 증빙 | 항공권, 숙소, 보험, 재정 증빙 | 모바일과 인쇄본 둘 다 준비 |',
      '| 예외 | 국적, 경유지, 체류 기간 | 출발 7일 전 재확인 |',
    ].join('\n');
  }

  if (kind === 'transport') {
    return [
      '| 이동 구간 | 확인할 점 | 추천 기준 |',
      '| --- | --- | --- |',
      '| 공항 이동 | 환승 시간, 입국 심사, 수하물 | 첫날 일정은 여유 있게 배치 |',
      '| 시내 이동 | 택시·대중교통·차량투어 비교 | 인원수와 짐의 양 기준으로 선택 |',
      '| 장거리 이동 | 소요 시간과 탑승 횟수 | 이동일에는 핵심 일정 1개만 배치 |',
      '| 비상 상황 | 지연, 결항, 막차 리스크 | 대체 교통과 연락처 확보 |',
    ].join('\n');
  }

  if (kind === 'comparison') {
    return [
      '| 비교 항목 | A안이 맞는 경우 | B안이 맞는 경우 |',
      '| --- | --- | --- |',
      '| 비용 | 총액을 낮추고 싶을 때 | 시간을 아끼는 것이 더 중요할 때 |',
      '| 편의성 | 직접 선택을 선호할 때 | 예약·이동을 맡기고 싶을 때 |',
      '| 리스크 | 변경 대응을 직접 할 수 있을 때 | 현지 변수 대응이 필요할 때 |',
      '| 추천 대상 | 경험 많은 여행자 | 가족·부모님·첫 방문 여행자 |',
    ].join('\n');
  }

  return [
    '| 확인 항목 | 왜 중요한가 | 출발 전 체크 |',
    '| --- | --- | --- |',
    `| ${destination} 핵심 조건 | 일정 만족도를 좌우합니다 | 위치, 이동, 비용을 함께 확인 |`,
    `| ${keyword} 관련 변수 | 검색 정보와 실제 현장이 다를 수 있습니다 | 최신 운영 여부 재확인 |`,
    '| 예약 조건 | 취소·변경 비용이 달라집니다 | 포함/불포함과 환불 규정 확인 |',
    '| 현지 변수 | 날씨·교통·영업일이 바뀝니다 | 대체 일정과 연락처 확보 |',
  ].join('\n');
}

function checklistBlock(kind: BlogDecisionBlockKind, destination: string): string {
  const heading = kind === 'preparation' ? '## 출발 전 준비물 체크리스트' : '## 출발 전 최종 체크리스트';
  return [
    heading,
    '',
    `- ${destination} 출발 전 여권, 예약번호, 항공 시간을 다시 확인합니다.`,
    '- 현지 날씨와 교통 상황을 출발 24시간 전에 다시 확인합니다.',
    '- 현금, 카드, 해외 결제 수단을 분산해서 준비합니다.',
    '- 비상 연락처, 보험, 병원/대사관 정보를 따로 저장합니다.',
    '- 포함/불포함, 취소 규정, 추가 비용을 예약 전 마지막으로 확인합니다.',
  ].join('\n');
}

export function ensureRequiredBlogDecisionBlocks(markdown: string, input: BlogDecisionBlockInput = {}): string {
  if (!markdown.trim()) return markdown;

  const destination = cleanText(input.destination, '여행지');
  const keyword = cleanText(input.primaryKeyword, destination);
  const kind = inferDecisionBlockKind(markdown, input);
  if (!kind) return markdown;

  let next = markdown.trimEnd();

  if (!hasDecisionTable(next)) {
    next = `${next}\n\n## 빠른 판단표\n\n${decisionTable(kind, destination, keyword)}\n`;
  }

  if (
    countListItems(next) < 5 &&
    /preparation|checklist|준비|준비물|체크리스트|guide|가이드|총정리|weather|날씨|cost|비용|budget|예산/i.test(
      `${kind} ${keyword} ${next.slice(0, 1000)}`,
    )
  ) {
    next = `${next.trimEnd()}\n\n${checklistBlock(kind, destination)}\n`;
  }

  return next.trim();
}
