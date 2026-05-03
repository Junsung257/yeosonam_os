/**
 * 고객 여정(채팅 → 예약·준비물·정산 자동화) — 휴리스틱 단계 추론
 *
 * 목적: 사장님이 /admin/qa·공개 챗으로 대화하며 단계·준비물·자동화 힌트를 즉시 확인.
 * 추후: 예약/알림톡/정산 워커가 동일 스냅샷을 구독.
 */

export type JourneyStage =
  | 'discovery'
  | 'browsing'
  | 'booking_intent'
  | 'pre_trip'
  | 'settlement_question'
  | 'escalated';

export interface CustomerJourneySnapshot {
  stage: JourneyStage;
  updated_at: string;
  checklist_preview: string[];
  automation_hints: string[];
}

const BOOKING_RE = /(예약|신청|결제|계약금|입금|잔금|계약서|예약금)/;
const PREP_RE = /(준비물|짐|캐리어|여권|비자|e?\s*티켓|바우처|보험|어댑터|플러그|환전|체크리스트)/;
const SETTLEMENT_RE = /(정산|환불|취소\s*요청|클레임|보상|수수료)/;

const KNOWN: JourneyStage[] = [
  'discovery',
  'browsing',
  'booking_intent',
  'pre_trip',
  'settlement_question',
  'escalated',
];

function buildChecklistPreview(destinationHint: string | null): string[] {
  const base = [
    '여권 유효기간(통상 출국일 기준 6개월 이상)',
    'e-티켓·호텔 바우처 모바일 오프라인 저장',
    '여행자보험 증권 확인',
    '현금·카드·해외결제 수수료 확인',
  ];
  const sea =
    destinationHint &&
    /다낭|나트랑|푸꾸옥|푸켓|발리|세부|보라카이|괌|사이판|하와이/i.test(destinationHint);
  if (sea) {
    return [...base, '자외선 차단·모기 기피', '방수 파우치(해수욕·비)'];
  }
  const cold =
    destinationHint &&
    /훗카이도|삿포로|북해도|러시아|북유럽/i.test(destinationHint);
  if (cold) {
    return [...base, '보온·방한(체감 온도 확인)'];
  }
  return base;
}

function hintsFor(stage: JourneyStage): string[] {
  switch (stage) {
    case 'discovery':
      return ['[다음] 목적지·일정 수집 후 상품 매칭'];
    case 'browsing':
      return [
        '[자동] 상품 상세 링크 발송(카카오/이메일 연동 시)',
        '[자동] 관심 상품 카트/리드 저장',
      ];
    case 'booking_intent':
      return [
        '[자동] 예약 초안 생성 → 고객 확인(버튼/서명)',
        '[자동] 예약금 입금 안내 + D-15 잔금 리마인더 예약',
      ];
    case 'pre_trip':
      return [
        '[자동] 준비물 체크리스트 PDF/알림톡',
        '[자동] 출발 72h 전 날씨·환율·항공 체크인 링크 요약',
      ];
    case 'settlement_question':
      return [
        '[자동] 약관·취소 규정 조회',
        '[HITL] 환불/클레임 최종 확인 큐',
      ];
    case 'escalated':
      return ['[자동] 담당자 에스컬레이션 티켓·슬랙/카톡 알림'];
    default:
      return [];
  }
}

export interface JourneyTurnContext {
  userMessage: string;
  escalate: boolean;
  recommendedPackageIds: string[];
  critiqueSeverity: string;
  /** extractDestination 등으로 뽑은 힌트 */
  destinationHint: string | null;
}

function normalizePrev(raw: unknown): CustomerJourneySnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const stage = o.stage;
  if (typeof stage !== 'string' || !KNOWN.includes(stage as JourneyStage)) return null;
  return {
    stage: stage as JourneyStage,
    updated_at: typeof o.updated_at === 'string' ? o.updated_at : new Date().toISOString(),
    checklist_preview: Array.isArray(o.checklist_preview)
      ? o.checklist_preview.filter((x): x is string => typeof x === 'string')
      : [],
    automation_hints: Array.isArray(o.automation_hints)
      ? o.automation_hints.filter((x): x is string => typeof x === 'string')
      : [],
  };
}

/**
 * 한 턴 대화 뒤 여정 스냅샷 갱신 (DB journey 컬럼과 동기화)
 */
export function advanceCustomerJourney(
  prevRaw: unknown,
  ctx: JourneyTurnContext,
): CustomerJourneySnapshot {
  const prev = normalizePrev(prevRaw);
  const now = new Date().toISOString();
  const msg = ctx.userMessage.trim();
  let stage: JourneyStage = prev?.stage ?? 'discovery';

  if (ctx.escalate || ctx.critiqueSeverity === 'block') {
    stage = 'escalated';
  } else if (SETTLEMENT_RE.test(msg)) {
    stage = 'settlement_question';
  } else if (PREP_RE.test(msg)) {
    stage = 'pre_trip';
  } else if (BOOKING_RE.test(msg)) {
    stage = 'booking_intent';
  } else if (ctx.recommendedPackageIds.length > 0) {
    if (stage === 'discovery') stage = 'browsing';
    else if (stage !== 'escalated' && stage !== 'settlement_question') stage = 'browsing';
  }

  const needChecklist = stage === 'pre_trip' || stage === 'booking_intent';
  const checklist_preview = needChecklist
    ? buildChecklistPreview(ctx.destinationHint)
    : prev?.checklist_preview?.length
      ? prev.checklist_preview
      : [];

  return {
    stage,
    updated_at: now,
    checklist_preview,
    automation_hints: hintsFor(stage),
  };
}
