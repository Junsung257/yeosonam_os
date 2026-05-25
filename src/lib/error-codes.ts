/**
 * 여소남 OS — 중앙 에러 코드 시스템
 *
 * 모든 API 응답과 error.tsx에서 이 코드를 사용하여
 * 일관된 에러 식별과 사용자 메시지를 제공한다.
 *
 * 코드 규칙:
 *   E + 계층(1자리) + 도메인(1자리) + 번호(2자리)
 *   예: E1001 = 1계층(고객) + 0(일반) + 01 (첫번째)
 *
 * 계층:
 *   1xxx = 고객/프론트엔드
 *   2xxx = API/서버
 *   3xxx = DB/인프라
 *   4xxx = 외부 연동
 *   5xxx = AI/LLM
 *
 * 도메인 (두번째 자리):
 *   x0xx = 일반/제네릭
 *   x1xx = 예약/결제
 *   x2xx = 상품/패키지
 *   x3xx = 여행지/관광지
 *   x4xx = 블로그/콘텐츠
 *   x5xx = 인증/권한
 *   x6xx = 마케팅/제휴
 *   x7xx = AI/자비스
 *   x8xx = 파일/미디어
 *
 * 사용법:
 *   import { ErrorCodes, getErrorByCode, AppError } from '@/lib/error-codes';
 *   throw new AppError('E1001', { bookingId: '123' });
 *   → { code: 'E1001', httpStatus: 404, message: '예약 정보를 찾을 수 없습니다', ... }
 */

export interface ErrorCodeDef {
  code: string;
  httpStatus: number;
  message: string;        // 사용자 노출 메시지 (한국어)
  description: string;    // 내부 설명 (디버깅용, 사용자 미노출)
  retryable: boolean;     // 재시도 가능?
  action?: string;        // 사용자 권장 행동
  docsUrl?: string;       // 도움말 링크
}

// ─────────────────────────────────────────────────────
// 에러 코드 레지스트리
// ─────────────────────────────────────────────────────
export const ErrorCodes: Record<string, ErrorCodeDef> = {
  // ─── 1xxx: 고객/프론트엔드 ──────────────────

  // 10xx: 일반
  E1000: { code: 'E1000', httpStatus: 400, message: '올바르지 않은 요청입니다', description: 'General bad request — validation or parsing failed', retryable: false, action: '입력 내용을 확인해주세요' },
  E1001: { code: 'E1001', httpStatus: 500, message: '페이지를 불러오는 중 문제가 발생했습니다', description: 'General page render error — unhandled exception in page component', retryable: true, action: '잠시 후 다시 시도해주세요' },
  E1002: { code: 'E1002', httpStatus: 404, message: '페이지를 찾을 수 없습니다', description: 'Not found — the requested URL does not exist', retryable: false, action: '주소를 확인하거나 홈으로 이동해주세요' },
  E1003: { code: 'E1003', httpStatus: 503, message: '서비스 점검 중입니다', description: 'Service unavailable — planned maintenance or overload', retryable: true, action: '잠시 후 다시 접속해주세요' },

  // 11xx: 예약
  E1101: { code: 'E1101', httpStatus: 404, message: '예약 정보를 찾을 수 없습니다', description: 'Booking not found in database', retryable: false, action: '예약 번호를 확인하거나 고객센터로 문의해주세요' },
  E1102: { code: 'E1102', httpStatus: 409, message: '이미 취소된 예약입니다', description: 'Booking already cancelled — idempotent operation', retryable: false, action: '기존 예약을 확인해주세요' },
  E1103: { code: 'E1103', httpStatus: 400, message: '지난 날짜는 예약할 수 없습니다', description: 'Booking date is in the past', retryable: false, action: '미래 날짜를 선택해주세요' },
  E1104: { code: 'E1104', httpStatus: 409, message: '선택하신 날짜는 마감되었습니다', description: 'Tour date or product is fully booked', retryable: false, action: '다른 날짜를 선택해주세요' },
  E1105: { code: 'E1105', httpStatus: 400, message: '최소 인원을 충족하지 않았습니다', description: 'Minimum participant count not met', retryable: false, action: '더 많은 인원으로 예약해주세요' },

  // 13xx: 결제
  E1301: { code: 'E1301', httpStatus: 402, message: '결제 처리 중 오류가 발생했습니다', description: 'Payment processing failed — generic', retryable: true, action: '다시 시도하거나 다른 결제 수단을 이용해주세요' },
  E1302: { code: 'E1302', httpStatus: 402, message: '카드 결제에 실패했습니다', description: 'Card declined by issuer', retryable: true, action: '다른 카드를 사용하거나 결제 정보를 확인해주세요' },
  E1303: { code: 'E1303', httpStatus: 500, message: '환불 처리 중 오류가 발생했습니다', description: 'Refund processing failed', retryable: false, action: '고객센터로 문의해주세요' },
  E1304: { code: 'E1304', httpStatus: 409, message: '이미 결제가 완료된 건입니다', description: 'Duplicate payment attempt', retryable: false, action: '마이페이지에서 결제 상태를 확인해주세요' },

  // 12xx: 상품/패키지
  E1211: { code: 'E1211', httpStatus: 404, message: '해당 여행 상품을 찾을 수 없습니다', description: 'Package/product not found', retryable: false, action: '다른 상품을 둘러보세요' },
  E1212: { code: 'E1212', httpStatus: 410, message: '판매가 종료된 상품입니다', description: 'Product no longer available/sold out', retryable: false, action: '다른 상품을 확인해주세요' },
  E1213: { code: 'E1213', httpStatus: 500, message: '상품 정보를 불러오지 못했습니다', description: 'Failed to fetch product details', retryable: true, action: '잠시 후 다시 시도해주세요' },

  // 14xx: 블로그/콘텐츠
  E1401: { code: 'E1401', httpStatus: 404, message: '블로그 글을 찾을 수 없습니다', description: 'Blog post not found', retryable: false, action: '다른 글을 둘러보세요' },
  E1402: { code: 'E1402', httpStatus: 500, message: '블로그 글을 불러오지 못했습니다', description: 'Failed to load blog post', retryable: true, action: '잠시 후 다시 시도해주세요' },
  E1403: { code: 'E1403', httpStatus: 500, message: '블로그 글 생성 중 오류가 발생했습니다', description: 'Blog post generation failed (AI or pipeline)', retryable: true, action: '잠시 후 다시 발행을 시도해주세요' },
  E1404: { code: 'E1404', httpStatus: 429, message: '블로그 발행 한도에 도달했습니다', description: 'Blog publish rate limit exceeded', retryable: true, action: '시간을 두고 다시 시도해주세요' },

  // 15xx: 인증/권한
  E1501: { code: 'E1501', httpStatus: 401, message: '로그인이 필요합니다', description: 'Authentication required', retryable: false, action: '로그인 후 다시 시도해주세요' },
  E1502: { code: 'E1502', httpStatus: 403, message: '접근 권한이 없습니다', description: 'Forbidden — insufficient permissions', retryable: false, action: '관리자에게 권한을 요청해주세요' },
  E1503: { code: 'E1503', httpStatus: 401, message: '로그인 세션이 만료되었습니다', description: 'Session expired — re-login required', retryable: false, action: '다시 로그인해주세요' },
  E1504: { code: 'E1504', httpStatus: 429, message: '너무 많은 요청을 보냈습니다', description: 'Rate limit exceeded', retryable: true, action: '잠시 후 다시 시도해주세요' },

  // 17xx: AI/자비스
  E1701: { code: 'E1701', httpStatus: 504, message: 'AI 응답 생성 중 시간이 초과되었습니다', description: 'LLM response timeout', retryable: true, action: '다시 시도하거나 질문을 줄여주세요' },
  E1702: { code: 'E1702', httpStatus: 429, message: 'AI 사용량을 초과했습니다', description: 'LLM API quota or rate limit exceeded', retryable: true, action: '잠시 후 다시 시도해주세요' },
  E1703: { code: 'E1703', httpStatus: 503, message: 'AI 서비스를 사용할 수 없습니다', description: 'LLM service unavailable', retryable: true, action: '잠시 후 다시 시도해주세요' },
  E1704: { code: 'E1704', httpStatus: 500, message: 'AI 응답 품질 검증에 실패했습니다', description: 'LLM output failed quality gate', retryable: true, action: '다시 시도해주세요' },

  // 18xx: 파일/미디어
  E1801: { code: 'E1801', httpStatus: 404, message: '이미지를 찾을 수 없습니다', description: 'Image/file not found', retryable: false, action: '새로고침하거나 다른 이미지를 선택해주세요' },
  E1802: { code: 'E1802', httpStatus: 413, message: '파일 크기가 너무 큽니다', description: 'File size exceeds limit', retryable: false, action: '10MB 이하의 파일을 선택해주세요' },
  E1803: { code: 'E1803', httpStatus: 415, message: '지원하지 않는 파일 형식입니다', description: 'Unsupported file format', retryable: false, action: 'JPG, PNG, WEBP 형식의 파일을 선택해주세요' },

  // ─── 2xxx: API/서버 ──────────────────────────
  E2001: { code: 'E2001', httpStatus: 500, message: '서버 오류가 발생했습니다', description: 'Unhandled server exception', retryable: true, action: '잠시 후 다시 시도해주세요' },
  E2002: { code: 'E2002', httpStatus: 400, message: '요청 데이터가 올바르지 않습니다', description: 'Request validation failed', retryable: false, action: '입력 내용을 확인해주세요' },
  E2003: { code: 'E2003', httpStatus: 400, message: '필수 항목이 누락되었습니다', description: 'Required field missing', retryable: false, action: '모든 필수 항목을 입력해주세요' },

  // ─── 3xxx: DB/인프라 ──────────────────────────
  E3001: { code: 'E3001', httpStatus: 503, message: '데이터베이스 연결에 실패했습니다', description: 'Supabase/DB connection failed', retryable: true, action: '잠시 후 다시 시도해주세요' },
  E3002: { code: 'E3002', httpStatus: 500, message: '데이터 조회 중 오류가 발생했습니다', description: 'Database query failed', retryable: true, action: '잠시 후 다시 시도해주세요' },
  E3003: { code: 'E3003', httpStatus: 409, message: '중복된 데이터가 존재합니다', description: 'Unique constraint violation', retryable: false, action: '다른 값으로 다시 시도해주세요' },

  // ─── 4xxx: 외부 연동 ──────────────────────────
  E4001: { code: 'E4001', httpStatus: 502, message: '외부 서비스 연결에 실패했습니다', description: 'External API connection failed', retryable: true, action: '잠시 후 다시 시도해주세요' },
  E4002: { code: 'E4002', httpStatus: 502, message: '결제 서비스와의 통신에 실패했습니다', description: 'Payment gateway communication failed', retryable: true, action: '잠시 후 다시 시도해주세요' },
  E4003: { code: 'E4003', httpStatus: 502, message: '검색 서비스를 사용할 수 없습니다', description: 'Search API (Naver/Google) unavailable', retryable: true, action: '잠시 후 다시 시도해주세요' },
};

// ─────────────────────────────────────────────────────
// 헬퍼 함수
// ─────────────────────────────────────────────────────

/** 에러 코드로 ErrorCodeDef 조회 (없으면 E2001 fallback) */
export function getErrorByCode(code: string): ErrorCodeDef {
  return ErrorCodes[code] ?? ErrorCodes['E2001'];
}

/** 에러 객체로부터 ErrorCodeDef 추론 */
export function classifyError(err: unknown): ErrorCodeDef {
  if (err instanceof AppError) {
    return getErrorByCode(err.code);
  }
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.code === 'string' && ErrorCodes[e.code]) {
      return getErrorByCode(e.code);
    }
  }
  return ErrorCodes['E2001'];
}

// ─────────────────────────────────────────────────────
// AppError 클래스 (Cal.com ErrorWithCode 스타일)
// ─────────────────────────────────────────────────────

export class AppError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;
  public readonly timestamp: string;

  constructor(
    code: string,
    details?: Record<string, unknown>,
    customMessage?: string,
  ) {
    const def = getErrorByCode(code);
    super(customMessage ?? def.message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = def.httpStatus;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  /** 사용자에게 보여줄 메시지 */
  get userMessage(): string {
    return this.message;
  }

  /** 로깅용 문자열 */
  toLog(): string {
    return `[${this.code}] ${this.message} | details=${JSON.stringify(this.details)} | ts=${this.timestamp}`;
  }
}

// ─────────────────────────────────────────────────────
// error.tsx 전용 헬퍼
// ─────────────────────────────────────────────────────

export interface ErrorDisplayInfo {
  code: string;
  title: string;
  message: string;
  action: string;
  retryable: boolean;
  showStack: boolean;
}

/**
 * error.tsx에서 사용 — Error 객체를 사용자 친화적 DisplayInfo로 변환
 * 개발 환경에서만 스택 트레이스 노출
 */
export function toErrorDisplayInfo(error: Error & { digest?: string }): ErrorDisplayInfo {
  // AppError → 코드 기반 메시지
  if (error instanceof AppError) {
    const def = getErrorByCode(error.code);
    return {
      code: error.code,
      title: def.message,
      message: def.action ? `${def.message} ${def.action}` : def.message,
      action: def.action ?? '잠시 후 다시 시도해주세요',
      retryable: def.retryable,
      showStack: process.env.NODE_ENV === 'development',
    };
  }

  // digest 기반 에러 → Next.js 서버 에러
  if (error.digest) {
    return {
      code: 'E1001',
      title: '페이지를 불러오는 중 문제가 발생했습니다',
      message: `서버 오류가 발생했습니다. (참조: ${error.digest.slice(0, 8)})`,
      action: '잠시 후 다시 시도해주세요',
      retryable: true,
      showStack: process.env.NODE_ENV === 'development',
    };
  }

  // 그 외 일반 에러
  return {
    code: 'E1001',
    title: '페이지를 불러오는 중 문제가 발생했습니다',
    message: error.message || '알 수 없는 오류가 발생했습니다',
    action: '잠시 후 다시 시도해주세요',
    retryable: true,
    showStack: process.env.NODE_ENV === 'development',
  };
}
