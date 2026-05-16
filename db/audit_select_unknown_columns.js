/**
 * @file audit_select_unknown_columns.js
 *
 * 목적:
 *   page.tsx / API route 의 SELECT 문자열에 **실제 DB 에 존재하지 않는 컬럼** 이
 *   박혀 있는지 검증.
 *
 * 배경 (ERR-shizuoka-detail-fields-postgrest @ 2026-05-16):
 *   src/app/packages/[id]/page.tsx 의 DETAIL_FIELDS 에 `min_people`, `thumbnail_urls`
 *   가 박혔는데 실제 travel_packages 테이블엔 없는 컬럼. PostgREST 가 unknown column
 *   을 만나면 200 응답을 반환하되 일부 필드(destination/itinerary_data) 를 silent
 *   누락 → 모바일 attraction 카드 전체 미표출 사고. src/types/database.ts 가 DB 와
 *   drift 상태였던 게 진짜 시작점.
 *
 * 검사:
 *   1) 대상 파일들에서 `\bXXX_FIELDS\s*=\s*\`...\`` 패턴의 SELECT 문자열 추출
 *   2) 각 컬럼을 트림하고 JOIN 식(`products(...)`) 제외
 *   3) DB 의 information_schema.columns 와 대조
 *   4) SELECT 에 박혔는데 DB 에 없으면 FAIL
 *
 * 사용:
 *   node db/audit_select_unknown_columns.js          # 경고만
 *   node db/audit_select_unknown_columns.js --strict # 누락 발견 시 exit 1 (CI gate)
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const STRICT = process.argv.includes('--strict');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// 대상: (파일경로, 상수명, DB 테이블) 튜플
const TARGETS = [
  { file: 'src/app/packages/[id]/page.tsx', constant: 'DETAIL_FIELDS', table: 'travel_packages' },
  { file: 'src/app/api/packages/route.ts', constant: 'PACKAGE_LIST_FIELDS', table: 'travel_packages' },
];

async function getDbColumns(table) {
  // information_schema 는 직접 query 불가. 대신 row 1개 fetch 해서 keys 추출.
  const { data, error } = await sb.from(table).select('*').limit(1);
  if (error) throw error;
  if (!data || data.length === 0) {
    console.warn(`[audit-select] ${table} 빈 테이블 — 검증 불가`);
    return null;
  }
  return new Set(Object.keys(data[0]));
}

/**
 * Top-level comma split — paren depth 추적으로 `products(internal_code, display_name)`
 * 같은 nested JOIN clause 를 통째 보존한 뒤 includes('(') 로 제외.
 */
function splitTopLevel(raw) {
  const parts = [];
  let buf = '';
  let depth = 0;
  for (const ch of raw) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      const t = buf.trim();
      if (t) parts.push(t);
      buf = '';
    } else {
      buf += ch;
    }
  }
  const last = buf.trim();
  if (last) parts.push(last);
  return parts;
}

function extractSelectFields(file, constant) {
  const full = path.join(__dirname, '..', file);
  if (!fs.existsSync(full)) {
    console.warn(`[audit-select] 파일 미존재: ${file}`);
    return null;
  }
  const src = fs.readFileSync(full, 'utf8');
  const re = new RegExp(`\\b${constant}\\s*=\\s*\`([^\`]+)\``);
  const match = src.match(re);
  if (!match) {
    console.warn(`[audit-select] ${file} 에서 ${constant} 상수 미발견`);
    return null;
  }
  return splitTopLevel(match[1])
    .filter(s => s && !s.includes('(')); // JOIN/관계 expr 제외
}

(async () => {
  console.log('🔍 SELECT 문자열에 미존재 컬럼 검증\n');
  let totalUnknown = 0;

  for (const t of TARGETS) {
    const dbCols = await getDbColumns(t.table);
    if (!dbCols) continue;

    const selectFields = extractSelectFields(t.file, t.constant);
    if (!selectFields) continue;

    const unknown = selectFields.filter(c => !dbCols.has(c));
    console.log(`  ${t.file} :: ${t.constant} (${selectFields.length}개 SELECT, DB ${dbCols.size}개)`);
    if (unknown.length === 0) {
      console.log(`    ✅ 정합`);
    } else {
      console.log(`    ❌ DB 미존재 ${unknown.length}개:`);
      unknown.forEach(c => console.log(`       - ${c}`));
      totalUnknown += unknown.length;
    }
  }

  if (totalUnknown === 0) {
    console.log('\n✅ 모든 SELECT 문자열 정합');
    process.exit(0);
  }

  console.error(`\n❌ DB 미존재 컬럼 총 ${totalUnknown}개 — PostgREST silent skip 사고 위험.`);
  console.error('   사고 이력: ERR-shizuoka-detail-fields-postgrest @ 2026-05-16');
  console.error('   해결: SELECT 문자열에서 컬럼 제거 또는 마이그레이션으로 컬럼 추가.');
  process.exit(STRICT ? 1 : 0);
})().catch(e => {
  console.error('[audit-select] 실행 실패:', e);
  process.exit(STRICT ? 1 : 0);
});
