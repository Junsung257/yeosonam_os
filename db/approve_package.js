#!/usr/bin/env node
/**
 * @file db/approve_package.js
 * @description audit_status=clean 인 상품을 status='active' 로 승격 (CLI).
 *
 * 용도: post_register_audit 이후 Agent 가 호출. /api/packages/[id]/approve 와 동일 로직이지만
 *        dev 서버가 죽어도 작동 (Supabase 직접 UPDATE).
 *
 * 사용:
 *   node db/approve_package.js <id1> <id2> ...          # clean 만 자동 승인
 *   node db/approve_package.js --force <id1> <id2> ...  # warnings 도 강제 승인
 *
 * 종료 코드:
 *   0 — 전체 성공
 *   1 — 최소 1개 이상 실패 또는 gate (blocked / warnings without --force)
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const envFile = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf-8');
  const env = {};
  envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
  return env;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const ids = args.filter(a => !a.startsWith('--'));

  if (ids.length === 0) {
    console.error('사용: node db/approve_package.js [--force] <id1> <id2> ...');
    process.exit(2);
  }

  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  let failures = 0;
  const promoted = [];

  for (const id of ids) {
    const { data, error } = await sb
      .from('travel_packages')
      .select('id, short_code, title, audit_status, status, internal_code')
      .eq('id', id)
      .limit(1);
    if (error || !data?.[0]) {
      console.log(`❌ ${id}: fetch 실패 — ${error?.message || '상품 없음'}`);
      failures++;
      continue;
    }
    const p = data[0];

    if (p.audit_status === 'blocked') {
      console.log(`❌ ${p.short_code}: blocked — 수정 후 post_register_audit 재실행 필요`);
      failures++;
      continue;
    }
    // P0 #2 (2026-04-27): info 는 자동 승인 (안내성 W-code 만 존재). warnings 는 force 필요.
    if (p.audit_status === 'warnings' && !force) {
      console.log(`⚠️  ${p.short_code}: warnings — --force 필요`);
      failures++;
      continue;
    }
    if (p.status === 'active') {
      console.log(`ℹ️  ${p.short_code}: 이미 active (skip)`);
      continue;
    }

    const { error: updErr } = await sb
      .from('travel_packages')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updErr) {
      console.log(`❌ ${p.short_code}: UPDATE 실패 ${updErr.message}`);
      failures++;
      continue;
    }
    if (p.internal_code) {
      await sb.from('products').update({ status: 'active', updated_at: new Date().toISOString() }).eq('internal_code', p.internal_code);
    }
    console.log(`✅ ${p.short_code}: ${p.audit_status ?? 'null'} → active`);
    promoted.push(id);
  }

  // P1 #6 (2026-04-27): ISR 캐시 즉시 무효화 (best-effort, 실패해도 진행).
  if (promoted.length > 0 && !process.env.SKIP_REVALIDATE) {
    try {
      const { revalidatePackages } = require('./_revalidate');
      const result = await revalidatePackages(promoted);
      if (result.skipped) console.log(`ℹ️  ISR 무효화 스킵: ${result.skipped}`);
    } catch (e) {
      console.log(`ℹ️  ISR 무효화 헬퍼 로드 실패 (무시): ${e.message}`);
    }
  }

  // ERR-process-violation-dump-after-approve@2026-04-22:
  // active 승격 직후 판매 필드 풀덤프 자동 실행. approve 와 dump 가 분리돼 있어
  // Agent 가 force approve 후 재덤프를 매번 놓쳤던 사고 재발 방지.
  if (promoted.length > 0 && !process.env.SKIP_DUMP_RESULT) {
    const { spawnSync } = require('child_process');
    const dumpScript = path.resolve(__dirname, 'dump_package_result.js');
    if (fs.existsSync(dumpScript)) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`  📋 승격 후 자동 덤프 (${promoted.length}건 — active 상태)`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      spawnSync('node', [dumpScript, ...promoted], { stdio: 'inherit' });
    }
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
