/**
 * Phase 1.5-γ — 레거시 pkg → IR 역변환 감사
 *
 * 목적:
 *   1. 기존 362개 활성 상품을 pkg → IR 로 역변환
 *   2. NormalizedIntakeSchema Zod 검증 통과율 측정 (lossless 근접도 지표)
 *   3. 필드별 누락·이상 통계 → 어느 부분이 IR 스키마와 정렬 안 되는지 파악
 *
 * 사용:
 *   node db/audit_legacy_pkg_to_ir.js [--limit=N] [--verbose]
 *
 * 출력:
 *   - scratch/legacy_ir_audit_<timestamp>.json (전체 결과)
 *   - 콘솔 요약: 통과율·상위 실패 필드
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { limit: null, verbose: false };
  for (const a of args) {
    if (a.startsWith('--limit=')) out.limit = Number(a.slice('--limit='.length));
    else if (a === '--verbose') out.verbose = true;
  }
  return out;
}

async function main() {
  const args = parseArgs();

  const envFile = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf-8');
  const env = {};
  envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // API route 로 역변환 호출 (TS 모듈 런타임 실행 위해)
  const base = env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const url = `${base}/api/audit-pkg-to-ir`;

  // pkg 조회
  let q = sb
    .from('travel_packages')
    .select('id, short_code, title, destination, country, product_type, trip_style, duration, nights, departure_airport, departure_days, airline, min_participants, ticketing_deadline, price, surcharges, optional_tours, price_tiers, price_dates, inclusions, excludes, notices_parsed, accommodations, itinerary_data, raw_text, commission_rate, land_operator_id, status')
    .in('status', ['active', 'pending', 'approved', 'published'])
    .order('created_at', { ascending: false });
  if (args.limit) q = q.limit(args.limit);

  const { data: pkgs, error } = await q;
  if (error) {
    console.error('❌ pkg 조회 실패:', error.message);
    process.exit(1);
  }
  console.log(`📦 ${pkgs.length}개 활성 상품 조회 완료`);
  console.log(`🔬 pkg → IR 역변환 감사 시작...\n`);

  const results = [];
  let passCount = 0;
  let failCount = 0;
  const fieldErrors = {};
  const warningCounts = {};

  for (let i = 0; i < pkgs.length; i++) {
    const pkg = pkgs[i];
    try {
      const secret = process.env.CRON_SECRET;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        },
        body: JSON.stringify({ pkg }),
      });
      const json = await res.json();
      const entry = {
        id: pkg.id,
        short_code: pkg.short_code,
        title: pkg.title,
        pass: Boolean(json.ok && json.validated),
        warnings: json.warnings || [],
        errors: json.errors || [],
      };
      if (entry.pass) passCount++;
      else failCount++;
      for (const e of entry.errors) {
        const fld = e.split(']')[0].replace(/^\[/, '');
        fieldErrors[fld] = (fieldErrors[fld] || 0) + 1;
      }
      for (const w of entry.warnings) {
        warningCounts[w] = (warningCounts[w] || 0) + 1;
      }
      results.push(entry);
      if (args.verbose || (i + 1) % 25 === 0) {
        console.log(`   [${i + 1}/${pkgs.length}] ${pkg.short_code} — ${entry.pass ? '✅' : '❌'} (warn ${entry.warnings.length}, err ${entry.errors.length})`);
      }
    } catch (err) {
      failCount++;
      results.push({ id: pkg.id, short_code: pkg.short_code, title: pkg.title, pass: false, errors: [err.message], warnings: [] });
    }
  }

  const reportPath = path.join(__dirname, '..', 'scratch', `legacy_ir_audit_${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ totalScanned: pkgs.length, passCount, failCount, fieldErrors, warningCounts, results }, null, 2));

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  📊 레거시 IR 역변환 감사 결과');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`총 ${pkgs.length}개 스캔`);
  console.log(`✅ Pass (Zod 통과): ${passCount} (${(passCount / pkgs.length * 100).toFixed(1)}%)`);
  console.log(`❌ Fail:             ${failCount} (${(failCount / pkgs.length * 100).toFixed(1)}%)`);

  console.log('\n📌 상위 에러 필드 Top 10:');
  const sortedErr = Object.entries(fieldErrors).sort((a, b) => b[1] - a[1]).slice(0, 10);
  sortedErr.forEach(([f, n]) => console.log(`   ${n.toString().padStart(4)}  ${f}`));

  console.log('\n📌 상위 경고 Top 10:');
  const sortedWarn = Object.entries(warningCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  sortedWarn.forEach(([w, n]) => console.log(`   ${n.toString().padStart(4)}  ${w}`));

  console.log(`\n📊 상세 JSON: ${reportPath}\n`);
  console.log(`해석:`);
  console.log(`  - Pass 율 80% 이상 → pkg-to-ir 구조 대체로 정상. 남은 20% 는 필드 보정으로 해결 가능`);
  console.log(`  - Pass 율 60% 미만 → pkg 스키마에 IR 로 변환 불가능한 이질 데이터 다량 존재. 마이그레이션 스크립트 필요`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
