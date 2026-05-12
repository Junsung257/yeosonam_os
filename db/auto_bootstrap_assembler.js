#!/usr/bin/env node
/**
 * @file db/auto_bootstrap_assembler.js
 * @description 신규 지역 어셈블러 자동 부트스트랩 (P3 #1, ERR-bootstrap-manual-toil@2026-04-27)
 *
 * 목적:
 *   /register Step 3-1 에서 "해당 지역 상품 N>=3" 일 때, 기존 어셈블러가 없으면
 *   DB의 등록된 상품들로부터 BLOCKS / DESTINATION / TEMPLATES 를 자동 추출해서
 *   db/assembler_<slug>.stub.js 파일로 출력.
 *
 *   사장님(또는 Agent)이 stub 파일을 검수 후 db/assembler_<slug>.js 로 rename 하면
 *   다음 등록부터 어셈블러 자동 사용 (register.md Step 3-0 참조).
 *
 * 사용:
 *   node db/auto_bootstrap_assembler.js --region=칭다오 --dest-code=TAO [--out=db/assembler_qingdao.stub.js]
 *   node db/auto_bootstrap_assembler.js --region=장가계 --dest-code=DYG --slug=zhangjiajie
 *
 * 정책:
 *   - 자동 LLM 호출 X / 사진 자동 수집 X (ERR-20260418-33 준수)
 *   - long_desc / short_desc 는 stub 에 비워두고, 사장님이 /admin/attractions 또는
 *     수기 편집으로 보완.
 *   - keywords 는 활동 텍스트에서 단어 추출 (간이) — 어셈블러 운영 시작 전 정제 권장.
 *   - 기존 어셈블러가 있으면 거부 (덮어쓰기 방지)
 */

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { region: null, destCode: null, slug: null, outPath: null, minPackages: 3 };
  for (const a of args) {
    if (a.startsWith('--region=')) out.region = a.slice('--region='.length);
    else if (a.startsWith('--dest-code=')) out.destCode = a.slice('--dest-code='.length);
    else if (a.startsWith('--slug=')) out.slug = a.slice('--slug='.length);
    else if (a.startsWith('--out=')) out.outPath = a.slice('--out='.length);
    else if (a.startsWith('--min=')) out.minPackages = parseInt(a.slice('--min='.length));
  }
  return out;
}

function loadEnv() {
  const envFile = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf-8');
  const env = {};
  envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
  return env;
}

// ── 활동 텍스트 정규화 ──
// "▶중국 청도 10경으로 꼽히는 잔교" → "잔교"
// "▶100년 청도 맥주의 역사를 볼 수 있는 맥주박물관 (...)" → "맥주박물관"
function extractAttractionName(activity) {
  if (!activity || typeof activity !== 'string') return null;
  let s = activity.replace(/^[▶◆●■★]/, '').trim();
  // 괄호 제거
  s = s.replace(/[\(（].*?[\)）]/g, '').trim();
  // 마지막 명사 추출 — 한국어 휴리스틱: 꾸밈말 뒤 마지막 ~10자 남기기
  // "10경으로 꼽히는 잔교" → "잔교"
  // 수식어 끝 패턴: ...는/의/한/된/되는/이는/되어/위치한/꼽히는 + 명사
  const m = s.match(/(?:는|의|한|된|되는|이는|되어|위치한|꼽히는|불리는|이루어진|구성된|만들어진|남아있는|볼\s*수\s*있는|느껴보는|걸어보는|활기찬|아름다운|역사적인|핵심적인|숨겨진|조성된)\s+([가-힣A-Za-z0-9·\-+]+(?:\s*[가-힣A-Za-z0-9]+){0,3})$/);
  if (m && m[1]) return m[1].trim();
  // 전체 문장이 짧으면 (~15자) 그대로 사용
  if (s.length <= 15) return s;
  // 마지막 단어 (스페이스 기준)
  const tokens = s.split(/\s+/);
  if (tokens.length > 0) return tokens[tokens.length - 1].trim();
  return s;
}

// 키워드 자동 생성 — 이름에서 토큰 분리
function autoKeywords(name) {
  const out = new Set();
  if (!name) return [];
  out.add(name);
  // 공백/괄호 제거 버전
  out.add(name.replace(/\s+/g, ''));
  // 첫 단어
  const firstToken = name.split(/[\s\(]/)[0];
  if (firstToken && firstToken !== name) out.add(firstToken);
  return [...out].filter(k => k && k.length >= 2);
}

// 블록 type 추측
function guessBlockType(activity) {
  const a = String(activity || '');
  if (/마사지|발마사지|전신마사지|spa/i.test(a)) return 'massage';
  if (/쇼핑|면세|토산|기념품/.test(a)) return 'shopping';
  if (/야시장|야경|불야성|night/i.test(a)) return 'night';
  if (/식|중식|석식|조식|레스토랑/.test(a)) return 'meal';
  if (/공항|체크인|체크아웃|출발|도착/.test(a)) return 'transfer';
  return 'sightseeing';
}

// 점수 추정 (간단)
function guessScore(type) {
  if (type === 'shopping') return -1.0;
  if (type === 'night') return 1.5;
  if (type === 'massage') return 1.0;
  if (type === 'sightseeing') return 1.5;
  return 0;
}

function slugify(region, destCode) {
  if (destCode) return destCode.toLowerCase();
  return region.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function main() {
  const args = parseArgs();
  if (!args.region || !args.destCode) {
    console.error('사용: node db/auto_bootstrap_assembler.js --region=<지역명> --dest-code=<XYZ> [--slug=<slug>] [--out=<path>] [--min=3]');
    console.error('예: node db/auto_bootstrap_assembler.js --region=장가계 --dest-code=DYG');
    process.exit(2);
  }

  const slug = args.slug || slugify(args.region, args.destCode);
  const outPath = args.outPath || path.resolve(__dirname, `assembler_${slug}.stub.js`);
  const finalPath = path.resolve(__dirname, `assembler_${slug}.js`);

  // 이미 어셈블러 존재 시 거부
  if (fs.existsSync(finalPath)) {
    console.error(`❌ 이미 어셈블러가 존재합니다: ${path.relative(process.cwd(), finalPath)}`);
    console.error('   기존 어셈블러를 보완하려면 직접 편집하세요.');
    process.exit(1);
  }

  const env = loadEnv();
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // 해당 지역 상품 조회
  const { data, error } = await sb
    .from('travel_packages')
    .select('id, short_code, title, destination, country, nights, duration, departure_airport, airline, accommodations, inclusions, excludes, itinerary_data, product_type, status')
    .or(`destination.ilike.%${args.region}%,short_code.ilike.${args.destCode}-%`)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ DB 조회 실패:', error.message);
    process.exit(1);
  }

  const pkgs = (data || []).filter(p => p.status !== 'archived');
  console.log(`\n📦 ${args.region} (${args.destCode}) 등록 상품: ${pkgs.length}건 (archived 제외)`);

  if (pkgs.length < args.minPackages) {
    console.error(`⚠️  상품 ${pkgs.length}건 < 임계값 ${args.minPackages}건. 부트스트랩 보류.`);
    console.error(`   N=3 이상이면 BLOCKS 패턴 추출 신뢰도가 확보됩니다.`);
    process.exit(0);
  }

  // ── 1. BLOCKS 추출 ──
  const blockMap = new Map(); // key: normalized name, value: { name, activities[], hits, type }

  for (const p of pkgs) {
    const days = Array.isArray(p.itinerary_data) ? p.itinerary_data : (p.itinerary_data?.days || []);
    for (const d of days) {
      for (const s of (d.schedule || [])) {
        if (!s.activity || s.type === 'flight') continue;
        // ▶ 마커가 붙은 활동 우선 (어셈블러 BLOCKS 의 표준)
        const isMarked = /^[▶◆●■★]/.test(s.activity.trim());
        if (!isMarked && s.type !== 'optional') continue;

        const name = extractAttractionName(s.activity);
        if (!name || name.length < 2) continue;

        const key = name.replace(/\s+/g, '').toLowerCase();
        if (!blockMap.has(key)) {
          blockMap.set(key, {
            name,
            activities: [],
            hits: 0,
            type: guessBlockType(s.activity),
            sample: s.activity,
          });
        }
        const b = blockMap.get(key);
        b.hits++;
        if (b.activities.length < 3) b.activities.push(s.activity);
      }
    }
  }

  const blocks = [...blockMap.values()]
    .filter(b => b.hits >= 1) // 최소 1회 등장
    .sort((a, b) => b.hits - a.hits);

  console.log(`✅ 추출된 BLOCKS 후보: ${blocks.length}개`);

  // ── 2. 호텔 풀 추출 ──
  const hotelSet = new Set();
  for (const p of pkgs) {
    for (const acc of (p.accommodations || [])) {
      if (typeof acc === 'string' && acc.length > 1 && acc.length < 50) hotelSet.add(acc.trim());
    }
  }
  const hotels = [...hotelSet];

  // ── 3. inclusions / excludes 공통 패턴 추출 ──
  const inclusionFreq = new Map();
  const excludeFreq = new Map();
  for (const p of pkgs) {
    for (const inc of (p.inclusions || [])) {
      if (typeof inc === 'string') inclusionFreq.set(inc, (inclusionFreq.get(inc) || 0) + 1);
    }
    for (const ex of (p.excludes || [])) {
      if (typeof ex === 'string') excludeFreq.set(ex, (excludeFreq.get(ex) || 0) + 1);
    }
  }
  const commonInclusions = [...inclusionFreq.entries()].filter(([_, c]) => c >= Math.ceil(pkgs.length / 2)).map(([k]) => k);
  const commonExcludes = [...excludeFreq.entries()].filter(([_, c]) => c >= Math.ceil(pkgs.length / 2)).map(([k]) => k);

  // ── 4. 항공사 ──
  const airlineSet = new Set();
  const airportSet = new Set();
  for (const p of pkgs) {
    if (p.airline) airlineSet.add(p.airline);
    if (p.departure_airport) airportSet.add(p.departure_airport);
  }

  // ── 5. 상품 타입 ──
  const productTypeSet = new Set();
  for (const p of pkgs) {
    if (p.product_type) productTypeSet.add(p.product_type);
  }

  const country = pkgs[0]?.country || '미상';

  // ── 6. 코드 생성 ──
  const code = `/**
 * ${args.region} (${args.destCode}) 어셈블러 v0 — auto-bootstrapped @ ${new Date().toISOString().slice(0, 10)}
 *
 * 자동 생성 출처: ${pkgs.length}개 등록 상품 (${pkgs.map(p => p.short_code).join(', ')})
 *
 * ⚠️  이 파일은 STUB 입니다. 다음 작업 필요:
 *   1) BLOCKS 의 keywords 정제 (자동 추출은 단순 토큰만)
 *   2) BLOCKS 의 short_desc / score 검토
 *   3) DESTINATION.notices 작성 (현재는 placeholder)
 *   4) TEMPLATES 작성 (현재 비어있음 — 상품 유형별 BLOCK 조합 필요)
 *   5) parseRawText() / buildProduct() / insertToDB() 는 칭다오·서안·다낭 어셈블러를 참고해 작성
 *   6) 검수 후 db/assembler_${slug}.js 로 rename
 *
 * 사용법 (작성 완료 후):
 *   node db/assembler_${slug}.js <raw.txt> --operator <랜드사> --commission <N> --deadline <YYYY-MM-DD> --dry-run
 *   node db/assembler_${slug}.js <raw.txt> ... --insert
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { findDuplicate, isSamePriceDates, isSameDeadline } = require('./templates/insert-template');

const N = (time, activity) => ({ time, activity, type: 'normal', transport: null, note: null });
const F = (time, activity, transport) => ({ time, activity, type: 'flight', transport, note: null });
const T = (time, activity) => ({ time, activity, type: 'normal', transport: '전용차량', note: null });
const O = (time, activity) => ({ time, activity, type: 'optional', transport: null, note: null });

// ══════════════════════════════════════════════════════════════
// 1. ${args.region} 항공편 (자동 추출)
// ══════════════════════════════════════════════════════════════

const AIRLINES = {
${[...airlineSet].slice(0, 4).map(al => {
  const code = al.match(/[A-Z]{2}/)?.[0] || al.slice(0, 2).toUpperCase();
  const port = [...airportSet][0] || '인천';
  return `  ${code}: { code: '${code}', name: '${al.replace(/'/g, "\\'")}', airport: '${port}', flight_out: '${code}???', flight_in: '${code}???', flight_out_time: '00:00', arrival_time: '00:00', return_departure_time: '00:00', flight_in_time: '00:00' },`;
}).join('\n')}
};

const DESTINATION = {
  name: '${args.region}', country: '${country}', region_code: '${args.destCode}',
  hotel_pool: [
    // TODO: 호텔 등급별로 분류
${hotels.slice(0, 6).map(h => `    { grade: '?성', names: ['${h.replace(/'/g, "\\'")}'], score: 2 },`).join('\n')}
  ],
  notices: [
    { type: 'CRITICAL', title: '필수 확인', text: '• 여권 유효기간 출발일 기준 6개월 이상' },
    { type: 'PAYMENT', title: '취소 규정', text: '• 등록 상품의 notices_parsed 참고하여 작성 필요' },
    { type: 'INFO', title: '안내', text: '• 상기 일정은 현지 사정에 의해 변경될 수 있습니다' },
  ],
};

// ══════════════════════════════════════════════════════════════
// 2. BLOCKS — 자동 추출됨 (총 ${blocks.length}개, 등장 빈도순)
// ══════════════════════════════════════════════════════════════

const BLOCKS = [
${blocks.map((b, i) => {
  const codePrefix = args.destCode + '-' + (b.type === 'sightseeing' ? 'B' : b.type === 'massage' ? 'M' : b.type === 'shopping' ? 'SH' : b.type === 'night' ? 'N' : 'X');
  const seq = String(i + 1).padStart(3, '0');
  const kws = autoKeywords(b.name);
  const dur = b.type === 'shopping' || b.type === 'massage' ? 'half' : 'half';
  return `  {
    code: '${codePrefix}${seq}', name: ${JSON.stringify(b.name)}, type: '${b.type}', duration: '${dur}',
    schedule: [N(null, ${JSON.stringify(b.sample)})],
    keywords: ${JSON.stringify(kws)}, // TODO: 정제 필요 (등장 ${b.hits}회)
    score: ${guessScore(b.type)},
  },`;
}).join('\n')}
];

// ══════════════════════════════════════════════════════════════
// 3. 코스 템플릿 — TODO: 상품 유형별 작성
// ══════════════════════════════════════════════════════════════

const TEMPLATES = [
  // 상품 유형 (자동 추출): ${[...productTypeSet].join(', ') || '(unknown)'}
  // 예시:
  // {
  //   code: '${args.destCode}-실속-2N', name: '${args.region} 실속 2박3일', type: '실속', nights: 2, days: 3,
  //   signature_blocks: ['${args.destCode}-B001', '${args.destCode}-B002'],
  //   excludes_blocks: [],
  //   inclusions: [...],
  //   excludes: [...],
  // },
];

// ══════════════════════════════════════════════════════════════
// 4. 공통 inclusions / excludes (등록 상품 ${Math.ceil(pkgs.length / 2)}개 이상에 등장)
// ══════════════════════════════════════════════════════════════

const COMMON_INCLUSIONS = ${JSON.stringify(commonInclusions, null, 2).split('\n').join('\n')};
const COMMON_EXCLUDES = ${JSON.stringify(commonExcludes, null, 2).split('\n').join('\n')};

// ══════════════════════════════════════════════════════════════
// 5. parseRawText / buildProduct / insertToDB
// ══════════════════════════════════════════════════════════════
// TODO: 칭다오·서안·다낭 어셈블러 (db/assembler_qingdao.js 등) 를 참고해 작성
//
// 핵심 함수:
//   - parseRawText(text) → 일자별 텍스트, 가격, 포함/불포함 등 파싱
//   - matchBlocks(parsed)  → BLOCKS 키워드 매칭
//   - detectTemplate(matched, parsed)  → TEMPLATES 중 가장 적합한 것 선택
//   - buildProduct(parsed, template, blocks) → travel_packages INSERT 객체 조립
//   - insertToDB(products, options) → 중복 검사 + INSERT
//
// printReport / main 도 동일 패턴

if (require.main === module) {
  console.error('⚠️  이 어셈블러는 STUB 상태입니다. parseRawText / buildProduct 등을 구현하세요.');
  console.error('   참고: db/assembler_qingdao.js, db/assembler_xian.js, db/assembler_danang.js');
  process.exit(2);
}

module.exports = { BLOCKS, TEMPLATES, AIRLINES, DESTINATION, COMMON_INCLUSIONS, COMMON_EXCLUDES };
`;

  fs.writeFileSync(outPath, code);
  console.log(`\n✅ 부트스트랩 완료: ${path.relative(process.cwd(), outPath)}`);
  console.log(`   ├ BLOCKS: ${blocks.length}개`);
  console.log(`   ├ 호텔: ${hotels.length}개`);
  console.log(`   ├ 항공사: ${airlineSet.size}개`);
  console.log(`   ├ 공통 inclusions: ${commonInclusions.length}개`);
  console.log(`   └ 공통 excludes: ${commonExcludes.length}개`);
  console.log(`\n다음 단계:`);
  console.log(`  1) ${path.relative(process.cwd(), outPath)} 검토 (BLOCKS keywords/score, TEMPLATES 작성)`);
  console.log(`  2) parseRawText/buildProduct/insertToDB 구현 (assembler_qingdao.js 참고)`);
  console.log(`  3) db/assembler_${slug}.js 로 rename`);
  console.log(`  4) /register 다음 호출부터 어셈블러 자동 사용`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
