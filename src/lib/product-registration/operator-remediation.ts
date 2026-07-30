export type RegistrationRemediationKind =
  | 'supplier_confirmation'
  | 'attraction_review'
  | 'customer_disclosure_review'
  | 'system_repair'
  | 'mobile_proof';

export type RegistrationRemediationField =
  | 'minimum_departure'
  | 'round_trip_flight'
  | 'unpriced_surcharge'
  | 'attraction_master'
  | 'customer_disclosure'
  | 'price'
  | 'itinerary'
  | 'hotel'
  | 'customer_copy'
  | 'mobile_proof'
  | 'unknown';

export type RegistrationRemediationIssue = string | {
  id?: string | null;
  code?: string | null;
  label?: string | null;
  message?: string | null;
  detail?: string | null;
  status?: string | null;
  severity?: string | null;
};

export type RegistrationRemediationAction = {
  kind: RegistrationRemediationKind;
  field: RegistrationRemediationField;
  title: string;
  instruction: string;
  issueIds: string[];
  evidence: string[];
  sourcePhrases: string[];
  actionHref: string | null;
  actionLabel: string | null;
};

export type RegistrationRemediationPlan = {
  ready: boolean;
  actions: RegistrationRemediationAction[];
  supplierRequestText: string | null;
};

type NormalizedIssue = {
  id: string;
  text: string;
};

type ActionDefinition = Omit<RegistrationRemediationAction, 'issueIds' | 'evidence' | 'sourcePhrases'>;

const GENERIC_REVIEW_RE = /^(?:v3:)?(?:needs_review|review_needed)$/i;

function normalizeIssue(issue: RegistrationRemediationIssue, index: number): NormalizedIssue | null {
  if (typeof issue === 'string') {
    const text = issue.trim();
    if (!text) return null;
    return {
      id: text.split(':').slice(0, 3).join(':') || `issue_${index + 1}`,
      text,
    };
  }

  if (issue.status === 'pass' || issue.status === 'skip' || issue.severity === 'info') return null;
  const id = String(issue.id ?? issue.code ?? `issue_${index + 1}`).trim();
  const text = [
    issue.id,
    issue.code,
    issue.label,
    issue.message,
    issue.detail,
  ].filter(Boolean).join(' ').trim();
  if (!text) return null;
  return { id, text };
}

function classifyIssue(issue: NormalizedIssue): ActionDefinition | null {
  const text = issue.text;
  const normalized = text.toLowerCase();

  if (GENERIC_REVIEW_RE.test(text.trim())) return null;

  if (
    /\.minimum_departure\b/.test(normalized)
    || /minimum[_\s-]*(?:departure|participants?)/.test(normalized)
    || /최소\s*(?:출발|행사)\s*(?:인원|인원수)?/.test(text)
  ) {
    return {
      kind: 'supplier_confirmation',
      field: 'minimum_departure',
      title: '최소 출발 인원 확인',
      instruction: '성인 기준 최소 출발 인원을 숫자로 받은 뒤 원문에 반영해야 합니다. 추정값이나 기본값은 사용할 수 없습니다.',
      actionHref: null,
      actionLabel: null,
    };
  }

  if (
    /\.flight(?:_times_complete)?\b/.test(normalized)
    || /flight[_\s-]*(?:time|number|segment|evidence|mismatch)/.test(normalized)
    || /(?:왕복\s*)?항공편명|출발편|귀국편|편명\s*(?:누락|없음)|항공\s*구간\s*(?:누락|불완전)/.test(text)
  ) {
    return {
      kind: 'supplier_confirmation',
      field: 'round_trip_flight',
      title: '왕복 항공편 확인',
      instruction: '출발편과 귀국편의 항공사·편명·출도착 시간을 원문으로 받아야 합니다. 시간표 검색값으로 상품 원문을 대신하지 않습니다.',
      actionHref: null,
      actionLabel: null,
    };
  }

  if (
    /\.high_risk_(?:notice|structured_fact)_values\b/.test(normalized)
    || /high-risk .*(?:required values|explicit safe state)/.test(normalized)
    || /(?:추가\s*비용|추가\s*요금|지상비|송영요금|현지\s*비용).{0,40}(?:금액|미정|없음|누락|확인)/.test(text)
    || /(?:금액|가격).{0,20}(?:없는|없음|누락).{0,20}(?:추가\s*비용|지상비|송영)/.test(text)
  ) {
    return {
      kind: 'supplier_confirmation',
      field: 'unpriced_surcharge',
      title: '추가비용 금액·조건 확인',
      instruction: '발생 조건, 적용 기간, 통화, 1인 기준 금액을 받아야 합니다. 추가비용이 없으면 “없음”이라는 명시적 확인이 필요합니다.',
      actionHref: null,
      actionLabel: null,
    };
  }

  if (
    /attraction_unmatched_queue_clear|entity_attraction_unresolved_clear/.test(normalized)
    || /mobile_media:attraction\.unmatched_major/.test(normalized)
    || /unmatched[_\s-]*attraction|attraction[_\s-]*(?:unresolved|unmatched)/.test(normalized)
    || /미매칭\s*관광지|관광지.{0,20}(?:미매칭|미해결|승인\s*필요)/.test(text)
  ) {
    return {
      kind: 'attraction_review',
      field: 'attraction_master',
      title: '관광지 사장님 검수',
      instruction: '기존 관광지의 다른 표기면 별칭으로 연결하고, 진짜 신규 장소면 사장님이 관광지 관리에서 직접 등록합니다. 자동 생성하지 않습니다.',
      actionHref: '/admin/attractions/unmatched',
      actionLabel: '미매칭 관광지 검수',
    };
  }

  if (
    /entity_(?:shopping|option|unknown).*review/.test(normalized)
    || /option_review_queue_clear/.test(normalized)
    || /customer-visible unknown entities|customer-disclosure review/.test(normalized)
    || /(?:쇼핑|선택관광|고객\s*노출\s*항목).{0,30}(?:검수|미해결|확인)/.test(text)
  ) {
    return {
      kind: 'customer_disclosure_review',
      field: 'customer_disclosure',
      title: '고객 고지 항목 검수',
      instruction: '쇼핑·선택관광·기타 고객 고지 문구를 원문과 대조해 유형과 금액을 확정합니다. 관광지로 자동 등록하지 않습니다.',
      actionHref: '/admin/attractions/unmatched',
      actionLabel: '고객 고지 검수',
    };
  }

  if (
    /mobile_browser_proof|mobile proof|mobile_browser|MOBILE_BROWSER_PROOF_REQUIRED/i.test(text)
    || /모바일.{0,20}(?:증명|실증|브라우저\s*검증)/.test(text)
  ) {
    return {
      kind: 'mobile_proof',
      field: 'mobile_proof',
      title: '고객 모바일 실증',
      instruction: '수정된 상품으로 `/packages`와 `/lp` 두 화면 및 예약·상담 버튼을 다시 검증한 뒤에만 공개합니다.',
      actionHref: null,
      actionLabel: null,
    };
  }

  if (
    /\bC(?:4|6|12|14)\b/.test(text)
    || /price_(?:rows|dates|amount|storage)|product_prices|price_dates|가격(?:표|행|데이터|원문)/i.test(text)
    || /price\s+(?:date|amount|storage|rows?)\s+(?:disagreement|mismatch|missing|error)/i.test(text)
  ) {
    return {
      kind: 'system_repair',
      field: 'price',
      title: '가격·출발일 원문 재대조',
      instruction: '원문 가격표와 날짜별 고객 판매가를 같은 근거 구간에서 다시 구성해야 합니다. 옵션·현지비용을 상품가로 승격하지 않습니다.',
      actionHref: null,
      actionLabel: null,
    };
  }

  if (/\bC7\b/.test(text) || /hotel|호텔|숙박/.test(text)) {
    return {
      kind: 'system_repair',
      field: 'hotel',
      title: '호텔·숙박 원문 재대조',
      instruction: '숙박 박수와 호텔명이 일정별로 맞는지 원문에서 다시 구성합니다. 등급이나 확정 호텔을 추정하지 않습니다.',
      actionHref: null,
      actionLabel: null,
    };
  }

  if (
    /\bC(?:1|9|16|17)\b/.test(text)
    || /itinerary|schedule|duration|일정|일차|여행\s*기간/.test(text)
  ) {
    return {
      kind: 'system_repair',
      field: 'itinerary',
      title: '일정 구조 재검증',
      instruction: '상품 경계, 일차 순서, 숙박수와 고객 노출 유형을 원문 기준으로 다시 맞춰야 합니다.',
      actionHref: null,
      actionLabel: null,
    };
  }

  if (/\bC18\b/.test(text) || /customer[_\s-]*(?:copy|visible text)|고객\s*문구|문자\s*깨짐/.test(text)) {
    return {
      kind: 'system_repair',
      field: 'customer_copy',
      title: '고객 문구 정리',
      instruction: '내부용 표현, 깨진 문자, 공급사 약어를 제거하되 가격·조건의 의미는 바꾸지 않습니다.',
      actionHref: null,
      actionLabel: null,
    };
  }

  return {
    kind: 'system_repair',
    field: 'unknown',
    title: '등록 엔진 재검증',
    instruction: '차단 사유를 원문과 대조해 안정적인 코드와 회귀 테스트로 고친 뒤 다시 검증해야 합니다.',
    actionHref: null,
    actionLabel: null,
  };
}

function supplierRequestLine(field: RegistrationRemediationField): string | null {
  if (field === 'minimum_departure') {
    return '- 최소 출발 인원: 성인 기준 확정 인원수를 숫자로 회신해 주세요.';
  }
  if (field === 'round_trip_flight') {
    return '- 왕복 항공편: 출발편·귀국편 각각 항공사, 편명, 출발시간, 도착시간을 회신해 주세요.';
  }
  if (field === 'unpriced_surcharge') {
    return '- 추가비용: 발생 조건, 적용 기간, 통화, 1인 기준 금액을 회신해 주세요. 없으면 “추가비용 없음”이라고 명시해 주세요.';
  }
  return null;
}

function extractSourcePhrase(issue: NormalizedIssue, field: RegistrationRemediationField): string | null {
  if (field !== 'attraction_master') return null;
  const match = issue.text.match(
    /(?:v3:unmatched_attraction|mobile_media:attraction\.unmatched_major):(.+)$/i,
  );
  const phrase = match?.[1]?.trim();
  return phrase && !/^\d+\s+(?:unmatched|unresolved)\b/i.test(phrase) ? phrase : null;
}

function buildSupplierRequestText(
  actions: RegistrationRemediationAction[],
  productTitle?: string | null,
): string | null {
  const lines = actions
    .filter(action => action.kind === 'supplier_confirmation')
    .map(action => supplierRequestLine(action.field))
    .filter((line): line is string => Boolean(line));
  if (lines.length === 0) return null;

  return [
    `상품: ${productTitle?.trim() || '상품명 확인 필요'}`,
    '고객 오픈 전 원문 보완 요청',
    '아래 항목은 고객 분쟁 방지를 위해 추정값이 아닌 확정 원문으로 회신 부탁드립니다.',
    ...lines,
  ].join('\n');
}

export function buildRegistrationRemediationPlan(
  issues: RegistrationRemediationIssue[],
  context: { productTitle?: string | null } = {},
): RegistrationRemediationPlan {
  const normalizedIssues = issues
    .map(normalizeIssue)
    .filter((issue): issue is NormalizedIssue => Boolean(issue));
  const actionsByField = new Map<RegistrationRemediationField, RegistrationRemediationAction>();

  for (const issue of normalizedIssues) {
    const definition = classifyIssue(issue);
    if (!definition) continue;
    const existing = actionsByField.get(definition.field);
    const sourcePhrase = extractSourcePhrase(issue, definition.field);
    if (existing) {
      if (!existing.issueIds.includes(issue.id)) existing.issueIds.push(issue.id);
      if (!existing.evidence.includes(issue.text)) existing.evidence.push(issue.text);
      if (sourcePhrase && !existing.sourcePhrases.includes(sourcePhrase)) {
        existing.sourcePhrases.push(sourcePhrase);
      }
      continue;
    }
    actionsByField.set(definition.field, {
      ...definition,
      issueIds: [issue.id],
      evidence: [issue.text],
      sourcePhrases: sourcePhrase ? [sourcePhrase] : [],
    });
  }

  const actions = [...actionsByField.values()];
  return {
    ready: actions.length === 0,
    actions,
    supplierRequestText: buildSupplierRequestText(actions, context.productTitle),
  };
}
