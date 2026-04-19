/**
 * @file post_register_audit.js
 * @description 상품 등록 직후 자동 감사 (Step 7 통합 실행)
 *   1. DB에서 해당 상품 로드
 *   2. validatePackage (W1~W19) 실행
 *   3. dev server 감지 → audit_render_vs_source 실행
 *   4. 최종 리포트 출력
 *
 * 사용: node db/post_register_audit.js <id1> <id2> ...
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

const ids = process.argv.slice(2);
if (ids.length === 0) { console.error('사용: node db/post_register_audit.js <id1> [<id2> ...]'); process.exit(1); }

// insert-template의 validatePackage 재사용
const { validatePackage } = require('./templates/insert-template.js');

async function checkServer(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    return r.status < 500;
  } catch { return false; }
}

async function auditOne(pkg, baseUrl) {
  const result = { id: pkg.id, title: pkg.title, short_code: pkg.short_code };

  // 1. validatePackage (W1~W19)
  const v = validatePackage(pkg);
  result.errors = v.errors;
  result.warnings = v.warnings;

  // 2. Zod 검증 (loose)
  try {
    const { validatePackageLoose, formatZodErrors } = require('../dist-check-stub'); // fallback
  } catch {
    // Zod는 TS 파일에만 있어서 runtime에 바로 못 씀. 일단 skip.
  }

  // 3. 렌더 페이지 audit (서버 있으면)
  if (baseUrl) {
    const renderUrl = `${baseUrl}/packages/${pkg.id}`;
    try {
      const r = await fetch(renderUrl, { signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const html = await r.text();
        // HTML → text
        const renderedText = html
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ').trim();

        // 핵심 엔터티 검증: 최저가 / 항공편 / 호텔 / 핵심 관광지
        const priceOk = pkg.price && renderedText.includes(pkg.price.toLocaleString());
        const hotelOk = pkg.itinerary_data?.days?.some(d => d.hotel?.name && renderedText.includes(d.hotel.name.split(' ')[0]));
        const flightOk = pkg.itinerary_data?.days?.[0]?.schedule?.some(s => s.transport && renderedText.includes(s.transport));

        result.render = {
          url: renderUrl,
          status: r.status,
          length: renderedText.length,
          price_found: priceOk,
          hotel_found: hotelOk,
          flight_found: flightOk,
        };
      } else {
        result.render = { url: renderUrl, status: r.status, error: 'non-200' };
      }
    } catch (e) {
      result.render = { url: renderUrl, error: e.message };
    }
  } else {
    result.render = { skipped: 'dev server not reachable, production may not have ISR yet' };
  }

  return result;
}

(async () => {
  console.log('🔍 Post-Register Audit 시작\n');

  const baseUrls = ['http://localhost:3000', 'https://yeosonam.com'];
  let activeUrl = null;
  for (const u of baseUrls) {
    if (await checkServer(u)) { activeUrl = u; console.log(`✓ Server 감지: ${u}`); break; }
  }
  if (!activeUrl) console.log('⚠️  서버 미감지 — 렌더 audit 생략, DB 검증만 수행');
  console.log('');

  const results = [];
  for (const id of ids) {
    const { data: pkg, error } = await sb.from('travel_packages')
      .select('*').eq('id', id).maybeSingle();
    if (error || !pkg) { console.log(`❌ ${id} 조회 실패`); continue; }
    results.push(await auditOne(pkg, activeUrl));
  }

  // 🆕 Visual Regression fixtures.json 자동 등록 (ERR-FUK 재발 방지)
  try {
    const fxPath = path.join(__dirname, '..', 'tests', 'visual', 'fixtures.json');
    if (fs.existsSync(fxPath)) {
      const fixtures = JSON.parse(fs.readFileSync(fxPath, 'utf8'));
      const existingIds = new Set(fixtures.map(f => f.id));
      let added = 0;
      for (const r of results) {
        if (r.skipped || existingIds.has(r.id)) continue;
        // short_code 기반 product slug 생성
        const slug = (r.short_code || r.id.slice(0, 8)).toLowerCase().replace(/[^a-z0-9]/g, '-');
        fixtures.push({ id: r.id, title: r.title, product: slug });
        added++;
      }
      if (added > 0) {
        fs.writeFileSync(fxPath, JSON.stringify(fixtures, null, 2));
        console.log(`\n📸 Visual fixtures에 ${added}건 추가 → tests/visual/fixtures.json`);
        console.log(`   다음 실행 필요: npm run test:visual:update`);
        console.log(`   (베이스라인 1회 생성 후 모든 변경이 자동 탐지됨)`);
      }
    }
  } catch (e) {
    console.log(`⚠️  fixtures.json 업데이트 실패: ${e.message}`);
  }

  // ISR revalidation 시도 (서버 있을 때만)
  if (activeUrl && process.env.REVALIDATE_SECRET) {
    try {
      const paths = ids.map(id => `/packages/${id}`).concat(['/packages']);
      const r = await fetch(`${activeUrl}/api/revalidate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, secret: process.env.REVALIDATE_SECRET }),
        signal: AbortSignal.timeout(10000),
      });
      console.log(`\n🔄 ISR revalidate: ${r.status}`);
    } catch (e) { console.log(`\n⚠️  ISR revalidate 실패: ${e.message}`); }
  } else if (activeUrl) {
    console.log(`\n⚠️  REVALIDATE_SECRET 미설정 — ISR 무효화 생략 (첫 고객 요청 시 자동 빌드)`);
  }

  // 리포트 출력
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  📊 감사 결과 리포트');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const r of results) {
    console.log(`📦 ${r.short_code || '(no code)'} | ${r.title}`);
    console.log(`   ID: ${r.id}`);

    // W1-W19 결과
    if (r.errors.length === 0 && r.warnings.length === 0) {
      console.log(`   ✅ W1~W19 전체 통과`);
    } else {
      if (r.errors.length > 0) {
        console.log(`   ❌ 에러 ${r.errors.length}건 (INSERT 차단 사유)`);
        r.errors.forEach(e => console.log(`      - ${e}`));
      }
      if (r.warnings.length > 0) {
        console.log(`   ⚠️  경고 ${r.warnings.length}건`);
        r.warnings.forEach(w => console.log(`      - ${w}`));
      }
    }

    // 렌더 audit
    if (r.render.skipped) {
      console.log(`   ⏭️  렌더 audit 스킵: ${r.render.skipped}`);
    } else if (r.render.error) {
      console.log(`   ⚠️  렌더 audit 실패: ${r.render.error}`);
    } else if (r.render.status === 200) {
      const checks = [
        r.render.price_found ? '✅' : '❌',
        r.render.hotel_found ? '✅' : '❌',
        r.render.flight_found ? '✅' : '❌',
      ];
      console.log(`   🔍 렌더 검증 (${r.render.url}):`);
      console.log(`      ${checks[0]} 최저가 표시  ${checks[1]} 호텔명 표시  ${checks[2]} 항공편 표시`);
      console.log(`      HTML 길이: ${r.render.length} bytes`);
    } else {
      console.log(`   ⚠️  렌더 응답: ${r.render.status}`);
    }

    console.log(`   🔗 ${activeUrl || 'https://yeosonam.com'}/packages/${r.id}\n`);
  }

  // 종합 판정
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
  const totalWarnings = results.reduce((s, r) => s + r.warnings.length, 0);
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log('🎉 전체 통과 — 바로 어드민에서 status 변경하여 고객 노출 가능');
  } else if (totalErrors === 0) {
    console.log(`⚠️  경고 ${totalWarnings}건 — 검토 후 필요 시 수정 / status는 변경 가능`);
  } else {
    console.log(`❌ 에러 ${totalErrors}건 — DB 수정 필요`);
  }

  console.log('\n어드민 승인 후 고객 노출: /admin/packages?status=pending');
})().catch(e => { console.error(e); process.exit(1); });
