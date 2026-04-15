/**
 * 기존 상품 display_title 일괄 생성
 * 실행: node db/backfill_display_titles.js
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function generateDisplayTitle(pkg) {
  const type = (pkg.product_type || '').toLowerCase();
  let prefix = '';
  if (type.includes('노쇼핑') && type.includes('노팁') && type.includes('노옵션'))
    prefix = '추가비용 없는';
  else if (type.includes('노팁') && type.includes('노옵션'))
    prefix = '팁·옵션 걱정없는';
  else if (type.includes('고품격'))
    prefix = '프리미엄';
  else if (type.includes('품격'))
    prefix = '5성급 검증된';
  else if (type.includes('실속'))
    prefix = '핵심만 담은';

  const skipWords = ['노쇼핑', '노팁', '노옵션', '노팁노옵션'];
  const points = (pkg.product_highlights || [])
    .filter(h => !skipWords.some(w => h.includes(w)))
    .slice(0, 3);

  const nights = pkg.nights || (pkg.duration ? pkg.duration - 1 : 0);
  const days = pkg.duration || (nights ? nights + 1 : 0);
  const base = [prefix, pkg.destination, nights && days ? `${nights}박${days}일` : ''].filter(Boolean).join(' ');
  return points.length ? `${base} — ${points.join(' + ')}` : base;
}

(async () => {
  const { data: pkgs, error } = await sb
    .from('travel_packages')
    .select('id, title, destination, product_type, product_highlights, duration, nights, display_title')
    .in('status', ['approved', 'active', 'pending']);

  if (error) { console.error('조회 실패:', error.message); process.exit(1); }

  let updated = 0;
  let skipped = 0;

  for (const pkg of (pkgs || [])) {
    const newTitle = generateDisplayTitle(pkg);
    if (!newTitle || newTitle === pkg.display_title) {
      skipped++;
      continue;
    }

    const { error: uErr } = await sb
      .from('travel_packages')
      .update({ display_title: newTitle })
      .eq('id', pkg.id);

    if (uErr) {
      console.error(`  ✗ ${pkg.title}: ${uErr.message}`);
    } else {
      console.log(`  ✓ ${pkg.title}`);
      console.log(`    → ${newTitle}`);
      updated++;
    }
  }

  console.log(`\n완료: ${updated}개 업데이트, ${skipped}개 스킵 (총 ${(pkgs || []).length}개)`);
})();
