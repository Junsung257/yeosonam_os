/**
 * Visual baseline queue 마이그레이션 직접 적용
 * (Supabase Dashboard SQL Editor 대신 프로그램적으로 실행)
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260419000100_visual_baseline_queue.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('실행 SQL:\n', sql);
  // Supabase JS client는 DDL 직접 실행 안됨 — RPC 필요
  // 대안: 각 ALTER를 개별 RPC 호출로 (mcp__supabase__apply_migration 권장)
  // 여기서는 확인용 쿼리만
  const { data, error } = await sb.from('travel_packages').select('baseline_requested_at, baseline_created_at').limit(1);
  if (error && /baseline_requested_at/.test(error.message)) {
    console.log('\n⚠️  컬럼 미존재 — Supabase Dashboard SQL Editor에서 수동 실행 필요:');
    console.log('   https://supabase.com/dashboard → 프로젝트 → SQL Editor');
    console.log('   위 SQL 붙여넣기 후 Run');
    console.log('\n또는 MCP tool 사용 가능 시 자동 적용됨.');
  } else if (!error) {
    console.log('\n✅ 컬럼 이미 존재 — 마이그레이션 완료 상태');
  }
})().catch(e => { console.error(e); process.exit(1); });
