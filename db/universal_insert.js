/**
 * 범용 상품 등록기
 * 사용법: node db/universal_insert.js db/data/라오스_2026.json
 *
 * JSON 파일 형식: 배열 또는 단일 객체
 * [{ title, destination, ... }, { title, destination, ... }]
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ── env 로드 ──
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8');
const env = {};
envFile.split('\n').forEach(l => {
  const [k, ...v] = l.split('=');
  if (k && k.trim()) env[k.trim()] = v.join('=').trim();
});
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── 입력 파일 읽기 ──
const inputPath = process.argv[2];
if (!inputPath) {
  console.error('사용법: node db/universal_insert.js <json파일경로>');
  console.error('예시:   node db/universal_insert.js db/data/라오스_2026.json');
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, 'utf-8');
let packages = JSON.parse(raw);
if (!Array.isArray(packages)) packages = [packages];

// ── 기본값 병합 ──
const DEFAULTS = {
  category: 'package',
  status: 'pending',
  departure_airport: '부산(김해)',
  min_participants: 4,
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
  price_tiers: [],
  surcharges: [],
  excluded_dates: [],
  optional_tours: [],
  cancellation_policy: [],
  category_attrs: {},
  product_tags: [],
  product_highlights: [],
  notices_parsed: [],
  inclusions: [],
  excludes: [],
  accommodations: [],
  itinerary: [],
};

// travel_packages 테이블 컬럼 화이트리스트
const COLUMNS = [
  'title', 'destination', 'country', 'category', 'product_type', 'trip_style',
  'duration', 'nights', 'departure_airport', 'airline', 'departure_days',
  'min_participants', 'ticketing_deadline', 'status', 'price',
  'guide_tip', 'single_supplement', 'small_group_surcharge',
  'price_tiers', 'price_list', 'surcharges', 'excluded_dates',
  'optional_tours', 'cancellation_policy', 'category_attrs',
  'inclusions', 'excludes', 'special_notes', 'notices_parsed',
  'product_tags', 'product_highlights', 'product_summary',
  'itinerary', 'itinerary_data', 'accommodations',
  'raw_text', 'filename', 'file_type', 'confidence',
  'land_operator', 'land_operator_id', 'commission_rate',
  'internal_code',
];

function buildRow(pkg) {
  const merged = { ...DEFAULTS, ...pkg };
  const row = {};
  for (const col of COLUMNS) {
    if (merged[col] !== undefined) row[col] = merged[col];
  }
  return row;
}

async function main() {
  console.log(`📦 ${packages.length}개 상품 등록 시작... (${path.basename(inputPath)})\n`);

  const rows = packages.map(buildRow);

  // 제목 필수 검증
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].title) {
      console.error(`❌ ${i + 1}번째 상품에 title이 없습니다.`);
      process.exit(1);
    }
  }

  const { data, error } = await sb
    .from('travel_packages')
    .insert(rows)
    .select('id, title, status, price');

  if (error) {
    console.error('❌ 등록 실패:', error.message);
    process.exit(1);
  }

  console.log(`✅ ${data.length}개 상품 등록 완료!\n`);
  data.forEach((r, i) => {
    const priceStr = r.price ? `₩${r.price.toLocaleString()}` : '-';
    console.log(`  ${i + 1}. [${r.status}] ${r.title}`);
    console.log(`     ID: ${r.id} | 기준가: ${priceStr}`);
  });
}

main().catch(err => {
  console.error('❌ 오류:', err.message);
  process.exit(1);
});
