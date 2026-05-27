/**
 * Auto-Archive 후보 미리보기 CLI
 *
 * 사용법: node db/preview_archive_candidates.js
 *
 * 다음 cron 실행 (매일 새벽 1시 UTC / KST 10시) 시 archive 될 상품을 미리 확인.
 *
 * 정책 (사장님 2026-04-27):
 *   조건 1: 발권기한 < today
 *   조건 2: 등록 후 30일 경과 (created_at + 30d < today)
 *   조건 3: 모든 출발일이 today 이전
 *
 * 옵션:
 *   --dry-run (기본)  : 미리보기만, archive 안 함
 *   --execute         : 실제 archive 실행 (cron 수동 트리거)
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const args = process.argv.slice(2);
const DO_EXECUTE = args.includes('--execute');

const envPath = path.resolve(__dirname, '..', '.env.local');
const envFile = fs.readFileSync(envPath, 'utf-8');
const env = {};
envFile.split('\n').forEach(l => {
  const [k, ...v] = l.split('=');
  if (k) env[k.trim()] = v.join('=').trim();
});
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const today = new Date().toISOString().split('T')[0];
  const { data: pkgs, error } = await sb
    .from('travel_packages')
    .select('id, short_code, title, status, ticketing_deadline, created_at, price_dates, price_tiers, destination')
    .in('status', ['approved', 'active', 'pending', 'pending_review', 'draft']);
  if (error) { console.error(error); process.exit(1); }

  const candidates = [];
  for (const p of pkgs) {
    const reasons = [];
    if (p.ticketing_deadline && p.ticketing_deadline < today) {
      reasons.push(`발권기한 만료 (${p.ticketing_deadline})`);
    }
    if (p.created_at) {
      const created = new Date(p.created_at);
      const expiry = new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);
      if (expiry.toISOString().split('T')[0] < today) {
        const days = Math.floor((Date.now() - created.getTime()) / 86400000);
        reasons.push(`등록 후 ${days}일 (정책: 30일)`);
      }
    }
    {
      const pd = (p.price_dates || []).map(d => d.date).filter(Boolean).sort();
      let latest = pd[pd.length - 1];
      if (!latest && Array.isArray(p.price_tiers)) {
        const all = p.price_tiers
          .flatMap(t => [...(t.departure_dates || []), t.date_range?.end])
          .filter(Boolean).sort();
        latest = all[all.length - 1];
      }
      if (latest && latest < today) {
        reasons.push(`출발일 종료 (마지막 ${latest})`);
      }
    }
    if (reasons.length) candidates.push({ ...p, reasons });
  }

  console.log(`🗓️  Today: ${today}`);
  console.log(`📦 활성 상품 총: ${pkgs.length}건`);
  console.log(`🗑️  Archive 후보: ${candidates.length}건`);
  console.log('');

  if (candidates.length === 0) {
    console.log('✅ archive 대상 없음');
    return;
  }

  // 등록일 오름차순 정렬 (오래된 것부터)
  candidates.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  candidates.forEach((p, i) => {
    console.log(`${String(i + 1).padStart(3)}. ${p.short_code} | ${p.destination || '-'} | ${(p.title || '').slice(0, 50)}`);
    console.log(`     사유: ${p.reasons.join(' · ')}`);
  });
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!DO_EXECUTE) {
    console.log('');
    console.log('ℹ️  실제 archive 하려면:  node db/preview_archive_candidates.js --execute');
    console.log('   (또는 매일 새벽 1시 UTC cron 자동 실행 대기)');
    return;
  }

  console.log('');
  console.log('⚠️  --execute 모드 — 위 ' + candidates.length + '건을 status=archived 로 업데이트합니다...');
  const ids = candidates.map(p => p.id);
  const { error: updErr } = await sb
    .from('travel_packages')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .in('id', ids);
  if (updErr) { console.error('❌ archive 실패:', updErr); process.exit(1); }
  console.log(`✅ ${candidates.length}건 archive 완료`);
})();
