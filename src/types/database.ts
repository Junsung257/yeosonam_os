/**
 * @file database.ts
 * @description 여소남 OS 핵심 DB 테이블 TypeScript 인터페이스
 *
 * 동기화 기준:
 *   - products_v1.sql
 *   - upload_master_fk_v1.sql    (land_operator_id, departing_location_id FK)
 *   - marketing_system_v1.sql    (b2b_notes, public_itinerary, highlights)
 *   - products_ai_expansion_v1.sql (AI 확장 컬럼 + 신규 테이블)
 *
 * 주의:
 *   - `selling_price`는 GENERATED ALWAYS AS 컬럼 → INSERT/UPDATE 시 절대 포함 금지
 *   - `embedding`은 pgvector VECTOR(1536) → JS에서는 number[] 또는 null
 */


// ─── ProductStatus ─────────────────────────────────────────────────────────
/**
 * products.status 허용값
 *
 * lowercase (하위 호환):
 *   'draft'     — 기존 upload/route.ts 등 레거시 코드 사용 중
 *   'active'    — 레거시 활성 상태
 *   'expired'   — pg_cron 자동 만료 처리
 *   'cancelled' — 수동 취소
 *
 * uppercase (신규 HITL 상태 관리):
 *   'DRAFT'          — 파싱 완료 / 검토 전
 *   'REVIEW_NEEDED'  — AI 확신도 낮음 (ai_confidence_score < 70 권장)
 *   'ACTIVE'         — 검수 완료 / 판매 중
 *   'INACTIVE'       — 판매 중단 (기간 만료 외 수동 비활성)
 */
export type ProductStatus =
  | 'draft'
  | 'active'
  | 'expired'
  | 'cancelled'
  | 'DRAFT'
  | 'REVIEW_NEEDED'
  | 'ACTIVE'
  | 'INACTIVE';


// ─── Product ───────────────────────────────────────────────────────────────
/**
 * products 테이블 전체 컬럼 인터페이스
 *
 * PK: internal_code (예: "PUS-TP-MAC-05-0001")
 */
export interface Product {
  // ── 식별자 ──────────────────────────────────────────────────────────────
  /** PK. 자동 생성 코드 (형식: 출발-랜드사-목적지-일수-시퀀스) */
  internal_code: string;

  // ── 기본 정보 ────────────────────────────────────────────────────────────
  /** 고객 노출용 상품명 */
  display_name: string;
  /** 출발지 한국어 (예: "부산") */
  departure_region: string;
  /** 출발지 코드 (예: "PUS") */
  departure_region_code: string;
  /** 랜드사 전체명 (예: "투어폰") */
  supplier_name?: string | null;
  /** 랜드사 약자 코드 (예: "TP") */
  supplier_code: string;
  /** 목적지 한국어 (예: "마카오") */
  destination?: string | null;
  /** 목적지 코드 (예: "MAC") */
  destination_code: string;
  /** 여행 일수 */
  duration_days: number;

  // ── 일정 ────────────────────────────────────────────────────────────────
  departure_date?: string | null;          // ISO 8601 timestamp

  // ── 가격 구조 ────────────────────────────────────────────────────────────
  /** 원가 (랜드사 도매가) */
  net_price: number;
  /** 마진율 (0.10 = 10%) */
  margin_rate: number;
  /** 추가 할인액 */
  discount_amount: number;
  /**
   * 판매가 — GENERATED ALWAYS AS 컬럼
   * @readonly INSERT/UPDATE 시 절대 포함 금지
   */
  readonly selling_price: number;

  // ── AI 태그 ─────────────────────────────────────────────────────────────
  /** AI 자동 생성 태그 배열 */
  ai_tags: string[];
  /** 마케터 검수 마케팅 테마 태그 배열 (예: ["노옵션", "가족여행", "허니문"]) */
  theme_tags: string[];

  // ── 운영 관리 ────────────────────────────────────────────────────────────
  status: ProductStatus;
  internal_memo?: string | null;
  /** 업로드 원본 파일명 */
  source_filename?: string | null;

  // ── 마스터 FK (upload_master_fk_v1.sql) ─────────────────────────────────
  /** 랜드사 UUID FK → land_operators(id) */
  land_operator_id?: string | null;
  /** 출발지 UUID FK → departing_locations(id) */
  departing_location_id?: string | null;

  // ── 마케팅 B2B/B2C (marketing_system_v1.sql) ────────────────────────────
  /** B2B 내부 조건/메모 (비인증 사용자 접근 차단) */
  b2b_notes?: string | null;
  /** B2C용 정제된 일정표 JSON */
  public_itinerary?: Record<string, unknown> | null;
  /** B2C 핵심 소구점 배열 */
  highlights?: string[] | null;

  // ── AI 파싱 확장 (products_ai_expansion_v1.sql) ──────────────────────────
  /** AI 파싱 확신도 0~100. 70 미만이면 REVIEW_NEEDED 권장 */
  ai_confidence_score?: number | null;

  /**
   * 핵심 세일즈 포인트 JSON
   * @example { hotel: "그랜드하얏트", airline: "대한항공", unique: ["야경투어포함"] }
   */
  selling_points?: {
    hotel?: string;
    airline?: string;
    unique?: string[];
    [key: string]: unknown;
  } | null;

  /**
   * 항공 정보 JSON
   * @example { airline: "OZ", depart: "07:30", arrive: "09:45", return_depart: "14:00" }
   */
  flight_info?: {
    airline?: string;
    flight_no?: string;
    depart?: string;
    arrive?: string;
    return_depart?: string;
    return_arrive?: string;
    [key: string]: unknown;
  } | null;

  /** PDF에서 추출한 원본 텍스트 전문 */
  raw_extracted_text?: string | null;

  /** PDF/카드뉴스에서 추출된 이미지 URL 배열 (Supabase Storage) */
  thumbnail_urls: string[];

  /**
   * RAG 검색용 벡터 임베딩 (OpenAI text-embedding-3-small, 1536차원)
   * pgvector VECTOR(1536) → JS에서는 number[] 또는 null
   * @readonly API 응답에서 노출하지 않도록 주의
   */
  embedding?: number[] | null;

  // ── 타임스탬프 ───────────────────────────────────────────────────────────
  created_at: string;
  updated_at: string;
}

/**
 * products INSERT 시 사용하는 타입
 * selling_price(GENERATED) 제외 + 필수 필드만 required
 */
export type ProductInsert = Omit<Product, 'selling_price' | 'embedding'> & {
  selling_price?: never;  // GENERATED 컬럼 — 절대 포함 금지
};


// ─── ProductPrice ──────────────────────────────────────────────────────────
/**
 * product_prices 테이블 — 상품별 날짜/요일별 가격 (1:N)
 *
 * target_date 또는 day_of_week 중 하나는 반드시 존재해야 합니다 (DB CHECK 제약).
 */
export interface ProductPrice {
  id: string;                              // UUID PK
  product_id: string;                      // FK → products(internal_code)

  /**
   * 특정 날짜 가격 (예: "2025-05-03")
   * day_of_week와 상호 배타적으로 사용 가능
   */
  target_date?: string | null;             // DATE → ISO date string

  /**
   * 요일별 정규 가격
   * @values 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'
   */
  day_of_week?: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN' | null;

  /** 원가 (랜드사 도매가) */
  net_price: number;
  /** 성인 판매가 */
  adult_selling_price?: number | null;
  /** 소아 가격 */
  child_price?: number | null;
  /** 가격 조건 메모 (예: "연휴 추가요금", "얼리버드 할인") */
  note?: string | null;

  created_at: string;
}

export type ProductPriceInsert = Omit<ProductPrice, 'id' | 'created_at'>;


// ─── AiTrainingLog ─────────────────────────────────────────────────────────
/**
 * ai_training_logs 테이블 — Data Flywheel 훈련 로그
 *
 * 직원이 AI 파싱 결과를 수정할 때마다 before/after를 기록.
 * 누적 데이터로 AI 프롬프트 개선 및 Fine-tuning에 활용.
 */
export interface AiTrainingLog {
  id: string;                              // UUID PK
  product_id?: string | null;             // FK → products(internal_code)

  /** AI가 파싱에 사용한 원본 텍스트 */
  original_raw_text?: string | null;

  /** AI가 반환한 파싱 결과 JSON */
  ai_parsed_json?: Record<string, unknown> | null;

  /** 직원이 수정한 최종 결과 JSON */
  human_corrected_json?: Record<string, unknown> | null;

  /**
   * 변경된 필드 diff JSON
   * @example { net_price: { from: 0, to: 450000 }, destination: { from: null, to: "마카오" } }
   */
  correction_diff?: Record<string, { from: unknown; to: unknown }> | null;

  /** 수정한 직원의 auth.users UUID */
  corrected_by?: string | null;

  /** 파싱에 사용된 AI 모델 ID */
  ai_model_used?: string | null;

  /** 수정 전 ai_confidence_score */
  confidence_before?: number | null;

  /** 수정 후 사람이 평가한 신뢰도 */
  confidence_after?: number | null;

  created_at: string;
}

export type AiTrainingLogInsert = Omit<AiTrainingLog, 'id' | 'created_at'>;


// ─── DocumentHash ──────────────────────────────────────────────────────────
/**
 * document_hashes 테이블 — 파일 중복 업로드 차단
 *
 * 업로드 전 SHA-256 해시를 조회하여 동일 파일 재처리(토큰 낭비)를 방지.
 */
export interface DocumentHash {
  /** SHA-256 hex string (64자) — PK */
  file_hash: string;
  /** 원본 파일명 */
  file_name: string;
  /** 이 파일로 생성된 상품 코드 (있으면) */
  product_id?: string | null;
  created_at: string;
}

export type DocumentHashInsert = Omit<DocumentHash, 'created_at'>;


// ─── Phase 2a Append-only Ledger ───────────────────────────────────────────

export type LedgerAccount = 'paid_amount' | 'total_paid_out';

export type LedgerEntryType =
  | 'deposit'         // 고객 입금 → paid_amount +
  | 'refund'          // 고객 환불 → paid_amount -
  | 'payout'          // 랜드사 송금 → total_paid_out +
  | 'payout_reverse'  // 랜드사 송금 취소 → total_paid_out -
  | 'manual_adjust'   // 어드민 수동 보정 (양/음)
  | 'seed_backfill';  // Phase 2a 초기 시드 (1회성)

export type LedgerSource =
  | 'slack_ingest'
  | 'payment_match_confirm'
  | 'land_settlement_create'
  | 'land_settlement_reverse'
  | 'admin_manual_edit'
  | 'booking_create_softmatch'
  | 'bank_tx_manual_match'
  | 'sms_payment'
  | 'cron_resync'
  | 'seed_phase2a';

/**
 * Append-only 원장. UPDATE/DELETE 차단 (Postgres RULE).
 * SUM(ledger_entries.amount per booking, account) === bookings.<account>
 * 가 일일 reconcile 의 정합 기준.
 */
export interface LedgerEntry {
  id: string;
  booking_id: string;
  account: LedgerAccount;
  entry_type: LedgerEntryType;
  amount: number;            // signed (KRW). +면 잔액 증가, -면 감소. 0 entry 는 거부됨.
  currency: string;          // 기본 'KRW'
  source: LedgerSource;
  source_ref_id: string | null;     // bank_transactions.id, settlement_id, sms_payments.id 등
  idempotency_key: string | null;   // 멱등성 — UNIQUE
  memo: string | null;
  created_by: string | null;
  created_at: string;
}

/** reconcile_ledger() RPC 반환 행 — drift 발생 booking 만 */
export interface LedgerReconcileRow {
  booking_id: string;
  account: LedgerAccount;
  bookings_balance: number;
  ledger_sum: number;
  drift: number;       // bookings - ledger. 0 이어야 정상.
}


// ─── 유틸리티 타입 ──────────────────────────────────────────────────────────

/** Product 중 embedding 제외한 공개 안전 타입 (API 응답용) */
export type ProductPublic = Omit<Product, 'embedding' | 'b2b_notes' | 'raw_extracted_text'>;

/** status가 ACTIVE인 상품만 허용하는 타입 가드 */
export function isActiveProduct(p: Product): boolean {
  return p.status === 'ACTIVE' || p.status === 'active';
}

/** REVIEW_NEEDED 여부 판단 (ai_confidence_score 기반) */
export function needsReview(p: Pick<Product, 'ai_confidence_score' | 'status'>): boolean {
  if (p.status === 'REVIEW_NEEDED') return true;
  if (p.ai_confidence_score !== null && p.ai_confidence_score !== undefined) {
    return p.ai_confidence_score < 70;
  }
  return false;
}
