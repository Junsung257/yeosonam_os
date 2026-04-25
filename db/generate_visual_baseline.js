#!/usr/bin/env node
/**
 * @file db/generate_visual_baseline.js
 * @description 상품 등록 직후 해당 상품의 시각/텍스트 회귀 테스트 baseline 을 자동 생성.
 *
 * /register Step 7-D 로 호출됨. 흐름:
 *   1. travel_packages 에서 insertedIds 의 short_code, title 조회
 *   2. tests/visual/fixtures.json 에 upsert (product=short_code 기준 dedup)
 *   3. npx playwright test tests/visual --grep {short_code} --update-snapshots --workers=1
 *   4. 결과 요약 리포트
 *
 * 실패 시 상품 활성화 상태는 유지 (baseline 생성 실패가 등록 프로세스를 막지 않도록).
 * 그러나 콘솔에 경고 표시해 사장님이 수동 확인 가능하게 함.
 *
 * 사용:
 *   node db/generate_visual_baseline.js <uuid1> <uuid2> ...
 *   SKIP_VISUAL_BASELINE=1 로 건너뛰기 가능.
 *
 * 재발 방지: ERR-HET-* 렌더 오류 시리즈 — 수정 후 회귀 차단 인프라 부재.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const envFile = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf-8');
  const env = {};
  envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
  return env;
}

const FIXTURES = path.resolve(__dirname, '..', 'tests', 'visual', 'fixtures.json');

async function main() {
  const ids = process.argv.slice(2).filter(a => /^[0-9a-f-]{36}$/i.test(a));
  if (ids.length === 0) {
    console.log('ℹ️  generate_visual_baseline.js: 대상 UUID 없음 — skip');
    return;
  }

  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // 1) DB 조회
  const { data, error } = await sb
    .from('travel_packages')
    .select('id, title, short_code, status')
    .in('id', ids);
  if (error) {
    console.log(`⚠️  DB 조회 실패: ${error.message} — baseline 생성 생략`);
    return;
  }
  const rows = (data || []).filter(r => r.short_code);
  if (rows.length === 0) {
    console.log('ℹ️  short_code 가 있는 상품 없음 — baseline 생성 생략');
    return;
  }

  // 2) fixtures.json upsert
  let fixtures = [];
  try { fixtures = JSON.parse(fs.readFileSync(FIXTURES, 'utf8')); } catch { fixtures = []; }
  const byProduct = new Map(fixtures.map(f => [f.product, f]));
  for (const r of rows) {
    byProduct.set(r.short_code.toLowerCase(), {
      id: r.id,
      title: r.title,
      product: r.short_code.toLowerCase(),
    });
  }
  const updated = Array.from(byProduct.values());
  fs.mkdirSync(path.dirname(FIXTURES), { recursive: true });
  fs.writeFileSync(FIXTURES, JSON.stringify(updated, null, 2));
  console.log(`✅ fixtures.json 업데이트: 총 ${updated.length}건 (신규 처리: ${rows.length}건)`);

  // 3) playwright 실행 — grep 으로 방금 등록한 상품만
  const products = rows.map(r => r.short_code.toLowerCase());
  const grepPattern = products.join('|');
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  📸 Step 7-D: 시각 회귀 baseline 생성`);
  console.log(`  대상: ${products.join(', ')}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const result = spawnSync(
    'npx',
    ['playwright', 'test', 'tests/visual',
      '--grep', grepPattern,
      '--update-snapshots',
      '--workers=1',
      '--reporter=line'],
    {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, UPDATE_BASELINE: '1' },
      cwd: path.resolve(__dirname, '..'),
    },
  );

  if (result.status !== 0) {
    console.log(`\n⚠️  baseline 생성 일부/전체 실패 (exit ${result.status}).`);
    console.log(`   수동 재실행: UPDATE_BASELINE=1 npx playwright test tests/visual --grep "${grepPattern}" --update-snapshots --workers=1`);
    console.log(`   dev 서버가 localhost:3000 에서 응답 가능한지 확인 필요.`);
  } else {
    console.log(`\n✅ baseline 생성 완료 — 다음 코드 변경 시 자동 회귀 검증 작동.`);
  }
}

main().catch(err => {
  console.log(`⚠️  generate_visual_baseline.js 에러: ${err.message} — 등록 프로세스는 계속 진행`);
  process.exit(0);  // 절대 실패로 등록 프로세스 막지 않음
});
