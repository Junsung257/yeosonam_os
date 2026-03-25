// ─── Intent Router: 정규식 기반 의도 분류 + ScreenContext 해석 ────────────────

export type IntentMode =
  | 'PRODUCT_MODE'   // 상품 검색, 최저가, 일정표
  | 'BOOKING_MODE'   // 예약·고객 관리
  | 'FINANCE_MODE'   // 입출금·통계·미수금
  | 'MULTI_MODE';    // 복합 명령 (도구 전체 로드)

// 프론트엔드에서 넘겨주는 화면 컨텍스트
export interface ScreenContext {
  currentPage?:       string;    // '/admin/bookings' | '/admin/customers' | '/admin/payments' ...
  currentCustomerId?: string;    // 고객 상세 보는 중이면 UUID
  currentBookingId?:  string;    // 예약 상세 보는 중이면 UUID
  selectedIds?:       string[];  // 체크박스 다중 선택된 ID 목록
}

export interface RouterResult {
  mode:            IntentMode;
  resolvedMessage: string;       // 지시대명사 치환된 메시지 (디버그용)
  injectedContext: Record<string, string>; // executeTool에 주입할 추가 컨텍스트
}

// ── 패턴 정의 ────────────────────────────────────────────────────────────────
const FINANCE_RE = /정산|입금|미수금|수납|통계|현황|장부|매출|마진|지급|미납|잔금|은행|대금/;
const PRODUCT_RE = /상품|추천|가격|견적|검색|찾아|특가|저렴|노팁|소규모|일정표|최저가|일정\s*짜/;
const BOOKING_RE = /예약|고객|등록|취소|확정|동반자|여권|목록|명단|가계약|처리|잡아/;
const MULTI_RE   = /예약.{0,20}입금|입금.{0,20}예약|예약하고.{0,30}처리|하고.{0,10}입금/;

// ── 지시대명사 패턴 ───────────────────────────────────────────────────────────
const THIS_CUSTOMER_RE = /이\s*사람|이\s*고객|해당\s*고객|그\s*고객/;
const THIS_BOOKING_RE  = /이\s*예약|해당\s*예약|그\s*예약/;

export function classifyIntent(
  message: string,
  ctx: ScreenContext = {}
): RouterResult {
  const isFinance = FINANCE_RE.test(message);
  const isProduct = PRODUCT_RE.test(message);
  const isBooking = BOOKING_RE.test(message);
  const isMulti   = MULTI_RE.test(message) || (isFinance && isBooking);

  // Mode 결정
  let mode: IntentMode;
  if (isMulti)                      mode = 'MULTI_MODE';
  else if (isFinance && !isBooking) mode = 'FINANCE_MODE';
  else if (isProduct && !isBooking) mode = 'PRODUCT_MODE';
  else                              mode = 'BOOKING_MODE';  // 기본값

  // 현재 결제 관리 화면에서 메시지 왔으면 Finance 우선
  if (ctx.currentPage === '/admin/payments' && !isProduct) {
    mode = isBooking ? 'MULTI_MODE' : 'FINANCE_MODE';
  }

  // 지시대명사 → 실제 ID 주입
  const injectedContext: Record<string, string> = {};
  let resolvedMessage = message;

  if (THIS_CUSTOMER_RE.test(message) && ctx.currentCustomerId) {
    injectedContext.prefilledCustomerId = ctx.currentCustomerId;
    resolvedMessage = resolvedMessage.replace(
      THIS_CUSTOMER_RE,
      `고객(ID:${ctx.currentCustomerId.slice(0, 8)})`
    );
  }
  if (THIS_BOOKING_RE.test(message) && ctx.currentBookingId) {
    injectedContext.prefilledBookingId = ctx.currentBookingId;
    resolvedMessage = resolvedMessage.replace(
      THIS_BOOKING_RE,
      `예약(ID:${ctx.currentBookingId.slice(0, 8)})`
    );
  }

  // selectedIds가 있으면 주입 (다중 선택 일괄 처리용)
  if (ctx.selectedIds && ctx.selectedIds.length > 0) {
    injectedContext.selectedIds = ctx.selectedIds.join(',');
  }

  return { mode, resolvedMessage, injectedContext };
}
