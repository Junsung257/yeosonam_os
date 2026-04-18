/**
 * 전체 travel_packages 대상 Zod 검증 실행 — Plan A 완료 후 첫 전수 검증
 *
 * 실행:
 *   node db/validate_all_packages.js              # 요약
 *   node db/validate_all_packages.js --detail     # 실패 상품 목록
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DETAIL = process.argv.includes('--detail');

// Zod 스키마를 JS에서 사용하려면 컴파일된 TS가 필요. 여기서는 주요 field 직접 검증
// (실제 API에서는 src/lib/package-schema.ts의 Zod를 import)

function checkPackage(pkg) {
  const errors = [];

  // 필수 필드
  if (!pkg.title || pkg.title.length < 1) errors.push('title 누락');
  if (!pkg.destination) errors.push('destination 누락');

  // departure_days 포맷 (Loose 기준: JSON 배열만 거부)
  if (pkg.departure_days) {
    const dd = String(pkg.departure_days).trim();
    if (dd.startsWith('[') && dd.endsWith(']')) errors.push('departure_days JSON 배열 문자열');
  }

  // optional_tours 구조
  if (Array.isArray(pkg.optional_tours)) {
    for (const t of pkg.optional_tours) {
      if (!t.name) errors.push('optional_tours.name 누락');
    }
  }

  // price_tiers 또는 price_dates 최소 하나
  const hasTiers = Array.isArray(pkg.price_tiers) && pkg.price_tiers.length > 0;
  const hasDates = Array.isArray(pkg.price_dates) && pkg.price_dates.length > 0;
  if (!hasTiers && !hasDates) errors.push('price_tiers/price_dates 모두 비어있음');

  // duration vs itinerary_data.days.length
  if (pkg.duration && pkg.itinerary_data) {
    const days = Array.isArray(pkg.itinerary_data) ? pkg.itinerary_data : (pkg.itinerary_data.days || []);
    if (days.length > 0 && days.length !== pkg.duration) {
      errors.push(`일차 불일치: duration=${pkg.duration} vs days.length=${days.length}`);
    }
  }

  return errors;
}

(async () => {
  const all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb.from('travel_packages')
      .select('id, title, status, duration, destination, departure_days, optional_tours, price_tiers, price_dates, itinerary_data')
      .range(offset, offset + 999);
    if (error) { console.error(error); return; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  let pass = 0, fail = 0;
  const failures = [];
  const byStatus = {};
  for (const pkg of all) {
    const errors = checkPackage(pkg);
    byStatus[pkg.status || 'null'] = byStatus[pkg.status || 'null'] || { total: 0, pass: 0, fail: 0 };
    byStatus[pkg.status || 'null'].total++;
    if (errors.length === 0) { pass++; byStatus[pkg.status || 'null'].pass++; }
    else { fail++; byStatus[pkg.status || 'null'].fail++; failures.push({ id: pkg.id, title: pkg.title, status: pkg.status, errors }); }
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Zod-compat Package Validation (Pass 3)');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`총 ${all.length}건 검증`);
  console.log(`  ✅ PASS: ${pass}건 (${(pass/all.length*100).toFixed(1)}%)`);
  console.log(`  ❌ FAIL: ${fail}건 (${(fail/all.length*100).toFixed(1)}%)\n`);

  console.log('status별 분포:');
  for (const [k, v] of Object.entries(byStatus)) {
    console.log(`  ${k.padEnd(18)} total=${v.total.toString().padStart(3)}  pass=${v.pass.toString().padStart(3)}  fail=${v.fail.toString().padStart(3)}`);
  }

  // 실패 패턴 집계
  const patternCounts = {};
  for (const f of failures) {
    for (const e of f.errors) {
      const pattern = e.replace(/"[^"]+"/g, '"X"').replace(/\d+/g, 'N');
      patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
    }
  }
  console.log('\n실패 패턴:');
  for (const [p, c] of Object.entries(patternCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.toString().padStart(4)}건 — ${p}`);
  }

  if (DETAIL) {
    console.log('\n━━ 실패 상품 상세 (최대 30건) ━━');
    for (const f of failures.slice(0, 30)) {
      console.log(`  [${f.status}] ${f.title}`);
      f.errors.forEach(e => console.log(`    - ${e}`));
    }
    if (failures.length > 30) console.log(`  ... ${failures.length - 30}건 더 있음`);
  }

  // 리포트 JSON 덤프
  const dumpDir = path.join(__dirname, '..', 'scratch', 'audits');
  fs.mkdirSync(dumpDir, { recursive: true });
  const dumpPath = path.join(dumpDir, `validation_report_${new Date().toISOString().slice(0,10)}.json`);
  fs.writeFileSync(dumpPath, JSON.stringify({ summary: { pass, fail, total: all.length, byStatus, patternCounts }, failures }, null, 2));
  console.log(`\n📄 리포트: ${dumpPath}`);
})().catch(e => { console.error(e); process.exit(1); });
