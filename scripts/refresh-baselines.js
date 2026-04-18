#!/usr/bin/env node
/**
 * @file scripts/refresh-baselines.js
 * @description Visual regression baseline 재생성 큐 처리기
 *
 * 흐름:
 *   1. travel_packages 에서 baseline 갱신 필요한 상품 조회
 *      (baseline_requested_at > baseline_created_at OR baseline_created_at IS NULL)
 *   2. fixtures.json 에 해당 상품 추가/갱신
 *   3. Playwright --update-snapshots 실행하여 baseline 생성
 *   4. 성공 시 baseline_created_at 업데이트
 *
 * 사용:
 *   node scripts/refresh-baselines.js              # dev server 자동 사용
 *   BASE_URL=https://yeosonam.com node scripts/refresh-baselines.js  # 프로덕션
 *   node scripts/refresh-baselines.js --dry-run    # 어떤 상품 처리할지만 표시
 */

const { createClient } = require('@supabase/supabase-js');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DRY_RUN = process.argv.includes('--dry-run');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

(async () => {
  console.log(`🔄 Baseline Queue Processor (BASE_URL=${BASE_URL}${DRY_RUN ? ' [DRY-RUN]' : ''})\n`);

  // 1. 큐 조회
  // baseline_requested_at이 있고, baseline_created_at 이 null이거나 더 오래된 것
  const { data: pending, error } = await sb
    .from('travel_packages')
    .select('id, title, short_code, status, baseline_requested_at, baseline_created_at')
    .not('baseline_requested_at', 'is', null)
    .in('status', ['approved', 'active', 'pending', 'pending_review'])
    .order('baseline_requested_at', { ascending: true });

  if (error) { console.error(error); process.exit(1); }

  const toProcess = (pending || []).filter(p =>
    !p.baseline_created_at || new Date(p.baseline_created_at) < new Date(p.baseline_requested_at)
  );

  if (toProcess.length === 0) {
    console.log('✅ 처리할 baseline 없음. 큐가 비어있습니다.');
    return;
  }

  console.log(`📋 큐에 ${toProcess.length}건 있음:\n`);
  for (const p of toProcess) {
    console.log(`  - [${p.status}] ${p.short_code || '—'} | ${p.title}`);
    console.log(`    requested: ${p.baseline_requested_at} / last_baseline: ${p.baseline_created_at || '(없음)'}`);
  }

  // 2. fixtures.json 업데이트
  const fxPath = path.join(__dirname, '..', 'tests', 'visual', 'fixtures.json');
  let fixtures = fs.existsSync(fxPath) ? JSON.parse(fs.readFileSync(fxPath, 'utf8')) : [];
  const existingIds = new Set(fixtures.map(f => f.id));
  for (const p of toProcess) {
    if (!existingIds.has(p.id)) {
      const slug = (p.short_code || p.id.slice(0, 8)).toLowerCase().replace(/[^a-z0-9]/g, '-');
      fixtures.push({ id: p.id, title: p.title, product: slug });
    }
  }
  if (!DRY_RUN) {
    fs.writeFileSync(fxPath, JSON.stringify(fixtures, null, 2));
    console.log(`\n📝 fixtures.json 업데이트 (총 ${fixtures.length}건)`);
  }

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] --dry-run 제거하면 실제 Playwright 실행됨');
    return;
  }

  // 3. Playwright 실행 (--update-snapshots 로 baseline 재생성)
  console.log('\n🎭 Playwright --update-snapshots 실행 중...\n');
  const env = { ...process.env, UPDATE_BASELINE: '1', VISUAL_TEST_URL: BASE_URL };
  const result = spawnSync('npx', ['playwright', 'test', 'tests/visual', '--update-snapshots'], {
    stdio: 'inherit',
    env,
    shell: true,
  });

  if (result.status !== 0) {
    console.error(`\n❌ Playwright 실행 실패 (exit ${result.status})`);
    process.exit(1);
  }

  // 4. baseline_created_at 업데이트
  const now = new Date().toISOString();
  const ids = toProcess.map(p => p.id);
  const { error: upErr } = await sb
    .from('travel_packages')
    .update({ baseline_created_at: now })
    .in('id', ids);

  if (upErr) {
    console.error(`⚠️  baseline_created_at 업데이트 실패: ${upErr.message}`);
  } else {
    console.log(`\n✅ ${ids.length}건 baseline 생성 + DB 업데이트 완료`);
  }
})().catch(e => { console.error(e); process.exit(1); });
