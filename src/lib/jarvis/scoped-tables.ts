/**
 * 여소남 OS — Tenant Scoped Tables 카탈로그 (V2 §B.2.2)
 *
 * 자비스 에이전트가 접근하는 테이블을 3 그룹으로 분류한다:
 *
 *   STRICT   — tenant_id 필터 강제. NULL 금지. 타 테넌트 노출 = 즉시 사고.
 *              (예: 예약, 고객, 결제, 정산, 자비스 세션 — 운영 데이터 전량)
 *
 *   NULLABLE — tenant_id NULL 허용. NULL 인 행은 "여소남 본사 공유 카탈로그".
 *              테넌트가 조회할 때는 자기 테넌트 + NULL 둘 다 보임.
 *              (예: 상품, 블로그, 관광지 — 여소남이 올린 공유 콘텐츠 존재)
 *
 *   GLOBAL   — tenant_id 컬럼 자체가 없음. 전역 마스터. 필터 안 함.
 *              (예: tenants 자체, IATA 코드, 지역 마스터)
 *
 * 2026-04-22 현재 DB 스키마 기준. tenant_id 컬럼이 추가되는 테이블이 늘어나면 본 파일도 갱신.
 * 신규 테이블에 tenant_id 를 추가했는데 여기 등록하지 않으면 scoped-client 가 필터하지 않으니
 * 개발자는 **반드시** 같은 PR 에서 본 파일을 업데이트할 것.
 */

export const TENANT_SCOPED_TABLES = {
  /** tenant_id 강제 필터 (NULL 금지) */
  STRICT: new Set<string>([
    // 예약/고객/결제
    'bookings',
    'customers',
    'payments',
    'bank_transactions',
    'message_logs',
    'settlements',
    // 자비스 런타임
    'jarvis_sessions',
    'jarvis_tool_logs',
    'jarvis_pending_actions',
    'customer_facts',
    'agent_actions',
    // 테넌트 전용 리소스
    'inventory_blocks',
    'rfq_access',
    'rfq_proposals',
    'tenant_bot_profiles',     // Phase 5
    'jarvis_cost_ledger',      // Phase 5
  ]),

  /** tenant_id NULL 허용 — NULL 은 공유 카탈로그 (여소남 본사 데이터) */
  NULLABLE: new Set<string>([
    'travel_packages',
    'api_orders',
    'error_patterns',
    'content_creatives',
    'content_daily_stats',
    'content_insights',
    'blog_posts',
    'attractions',
    'jarvis_knowledge_chunks', // Phase 4
  ]),

  /** tenant_id 컬럼 없음 — 전역 마스터, 필터 안 함 */
  GLOBAL: new Set<string>([
    'tenants',
    'iata_codes',
    'regions',
    'departing_locations',
    'land_operators',
    'policies',
    'group_rfqs',              // RFQ 본체는 글로벌, rfq_access/proposals 만 STRICT
  ]),
} as const

/**
 * 디버그용 — 어떤 그룹에도 없는 테이블을 사용했는지 체크.
 * scoped-client 는 GLOBAL 로 간주해 통과시키므로, 등록 누락 시 조용히 격리 실패 가능.
 */
export function classifyTable(table: string): 'STRICT' | 'NULLABLE' | 'GLOBAL' | 'UNREGISTERED' {
  if (TENANT_SCOPED_TABLES.STRICT.has(table)) return 'STRICT'
  if (TENANT_SCOPED_TABLES.NULLABLE.has(table)) return 'NULLABLE'
  if (TENANT_SCOPED_TABLES.GLOBAL.has(table)) return 'GLOBAL'
  return 'UNREGISTERED'
}
