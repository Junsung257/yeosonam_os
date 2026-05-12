/**
 * @file audit_api_field_drift.js — W-final F5
 *
 * 목적:
 *   travel_packages DB 테이블에 새 컬럼을 추가했는데 `PACKAGE_LIST_FIELDS`
 *   (API 응답 SELECT 리스트) 에 동기화하지 않으면 사일런트 누락이 발생한다.
 *   ERR-20260418-10 (surcharges PACKAGE_LIST_FIELDS 누락으로 A4 포스터
 *   써차지 기간 증발) 이 정확히 이 패턴이었다.
 *
 *   이 감사는:
 *     1) Supabase 에서 travel_packages 실제 컬럼 목록을 뽑고
 *     2) src/app/api/packages/route.ts 의 PACKAGE_LIST_FIELDS 상수 파싱
 *     3) 고객 노출 후보 컬럼이 빠져있으면 FAIL
 *
 *   CI 에서 실패하면 신규 컬럼 추가 시 API SELECT 동기화를 강제.
 *
 * 사용:
 *   node db/audit_api_field_drift.js           # 경고만, exit 0
 *   node db/audit_api_field_drift.js --strict  # 누락 발견 시 exit 1 (CI 용)
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 환경변수 로드
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const STRICT = process.argv.includes('--strict');

// 내부 전용 컬럼 (API 응답에서 고의적으로 제외 — 고객 노출 금지)
//   통상 고객이 볼 필요 없는 커미션/정산/감사 원문/임베딩 등
const INTERNAL_ONLY = new Set([
  'commission_rate',         // 커미션 — 내부
  'commission_fixed_amount', // 고정 커미션
  'total_paid_out',          // 정산
  'raw_text',                // 원문 — 고객 노출 금지 (감사용)
  'raw_text_hash',           // 해시 — 내부
  'agent_audit_report',      // Agent self-audit 원본
  'embedding',               // 벡터 임베딩
  'theme_tags',              // AI 내부 태그
  'filename',                // 소스 파일명
  'file_type',
  'uploaded_by',
  'settlement_confirmed',
  'paid_amount',             // 정산
  'raw_extracted_text',
  'parser_version',          // 내부 추적
  'validation_errors',       // draft 저장 시 내부 에러 덤프
  'baseline_requested_at',   // 비주얼 큐 내부
  'baseline_created_at',     // 비주얼 베이스라인 내부
  'baseline_baseline_image_url',
  'quick_created',           // 내부 플래그
  // W-final F5 (2026-04-21) — drift 감사 1회차 분류:
  'category_attrs',          // AI 내부 태깅 메타
  'cost_price',              // ⚠️ 원가 (KRW) — 고객 노출 절대 금지
  'usd_cost',                // ⚠️ 원가 (USD) — 고객 노출 절대 금지
  'created_by',              // 작성자 attribution
  'departing_location_id',   // FK (departure_airport 로 노출됨)
  'notes',                   // 내부 메모 가능성 높음 (special_notes 와 별개)
  'parsed_at',               // AI 파싱 메타
  'parsed_data',             // AI 파싱 raw JSON 덤프 (itinerary_data 이후 사용 안 함)
  'seats_ticketed',          // ERP 내부 재고 상태
  'structured_features',     // AI 추출 메타
  'tenant_id',               // 멀티테넌시 내부
  // 2026-04-26 — RAG 인덱싱 전용 마크다운 필드 (src/ 미사용, db/rag_reindex_all.js 만 참조)
  'highlights_md',           // RAG 인덱싱용 (고객 노출은 product_highlights 사용)
  'itinerary_md',            // RAG 인덱싱용 (고객 노출은 itinerary_data 사용)
  'terms_md',                // RAG 인덱싱용 (고객 노출은 notices_parsed 사용)
]);

// 허용 목록 — "있으면 좋지만 필수 아님". 빠져도 경고만.
const OPTIONAL = new Set([
  'ai_confidence_score', 'ai_tags', 'internal_memo', 'updated_at', 'source_filename',
  'view_count', 'inquiry_count', 'expired_at', 'is_active',
]);

async function getDbColumns() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[drift-audit] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정');
    process.exit(STRICT ? 1 : 0);
  }
  const sb = createClient(url, key);

  // travel_packages 에서 아무 행 하나 뽑아서 컬럼 이름 추출 (PostgREST information_schema 대신 간단)
  const { data, error } = await sb.from('travel_packages').select('*').limit(1);
  if (error) {
    console.error('[drift-audit] travel_packages 쿼리 실패:', error.message);
    process.exit(STRICT ? 1 : 0);
  }
  if (!data?.[0]) {
    console.warn('[drift-audit] travel_packages 가 비어있음 — 컬럼 검증 불가');
    process.exit(0);
  }
  return Object.keys(data[0]).sort();
}

function getApiSelectFields() {
  const routeFile = path.join(__dirname, '..', 'src', 'app', 'api', 'packages', 'route.ts');
  const src = fs.readFileSync(routeFile, 'utf8');
  const match = src.match(/PACKAGE_LIST_FIELDS\s*=\s*`([^`]+)`/);
  if (!match) {
    console.error('[drift-audit] PACKAGE_LIST_FIELDS 상수를 찾을 수 없음');
    process.exit(STRICT ? 1 : 0);
  }
  // 쉼표 분리, 공백 제거, JOIN 표현식(`products(...)`) 제외
  return match[1]
    .split(',')
    .map(s => s.trim())
    .filter(s => s && !s.includes('(')) // JOIN 은 필드가 아님
    .sort();
}

(async () => {
  console.log('🔍 API Field Drift 감사 시작 (F5)\n');

  const dbCols = await getDbColumns();
  const apiFields = new Set(getApiSelectFields());

  console.log(`   DB 컬럼: ${dbCols.length}개 / API SELECT: ${apiFields.size}개\n`);

  const missing = [];
  const optionalMissing = [];
  for (const col of dbCols) {
    if (apiFields.has(col)) continue;
    if (INTERNAL_ONLY.has(col)) continue;    // 의도적 제외
    if (OPTIONAL.has(col)) { optionalMissing.push(col); continue; }
    missing.push(col);
  }

  if (missing.length === 0 && optionalMissing.length === 0) {
    console.log('✅ Drift 없음 — 모든 고객 노출 컬럼이 API SELECT 에 동기화됨');
    process.exit(0);
  }

  if (optionalMissing.length > 0) {
    console.log(`⚠️  선택 필드 누락 (${optionalMissing.length}개, 경고):`);
    optionalMissing.forEach(c => console.log(`   - ${c}`));
    console.log('');
  }

  if (missing.length > 0) {
    console.error(`❌ 필수 필드 DRIFT 감지 (${missing.length}개):`);
    missing.forEach(c => console.error(`   - ${c}  → PACKAGE_LIST_FIELDS 에 추가 필요`));
    console.error('\n해결 방법:');
    console.error('  1) src/app/api/packages/route.ts 의 PACKAGE_LIST_FIELDS 에 누락 컬럼 추가');
    console.error('  2) 또는 db/audit_api_field_drift.js 의 INTERNAL_ONLY 에 추가 (고객 노출 금지)');
    console.error('\nERR-20260418-10 재발 방지: 신규 컬럼 추가 시 이 감사를 pre-merge 게이트로 사용할 것');
    process.exit(STRICT ? 1 : 0);
  }

  process.exit(0);
})().catch(e => {
  console.error('[drift-audit] 실행 실패:', e);
  process.exit(STRICT ? 1 : 0);
});
