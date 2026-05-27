/**
 * 기존 상품 display_title / hero_tagline 일괄 재생성
 *
 * 변경 (2026-04-29):
 *  - display_title  → 짧은 헤드라인 (8~14자) — "+ 잇기" 제거
 *  - hero_tagline   → 한 줄 후킹 (≤40자) — 신규 컬럼
 *
 * 실행: node db/backfill_hero.js
 *      node db/backfill_hero.js --dry         (DB 쓰기 없이 미리보기)
 *      node db/backfill_hero.js --id <uuid>   (특정 상품만)
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { generateDisplayTitle, generateHeroTagline } = require('./templates/insert-template');

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const idFilterIdx = args.indexOf('--id');
const idFilter = idFilterIdx >= 0 ? args[idFilterIdx + 1] : null;

(async () => {
  let q = sb
    .from('travel_packages')
    .select('id, title, destination, product_type, product_highlights, duration, nights, display_title, hero_tagline')
    .in('status', ['approved', 'active', 'pending']);
  if (idFilter) q = q.eq('id', idFilter);

  const { data: pkgs, error } = await q;
  if (error) { console.error('조회 실패:', error.message); process.exit(1); }

  let updated = 0, skipped = 0;
  for (const pkg of (pkgs || [])) {
    const newTitle = generateDisplayTitle(pkg);
    const newTagline = generateHeroTagline(pkg);
    const titleChanged = newTitle && newTitle !== pkg.display_title;
    const taglineChanged = newTagline !== pkg.hero_tagline;

    if (!titleChanged && !taglineChanged) { skipped++; continue; }

    console.log(`\n● ${pkg.title}`);
    if (titleChanged)   console.log(`  display_title: "${pkg.display_title || '(없음)'}"\n              → "${newTitle}"`);
    if (taglineChanged) console.log(`  hero_tagline : "${pkg.hero_tagline || '(없음)'}"\n              → "${newTagline || '(null)'}"`);

    if (DRY) { updated++; continue; }

    const patch = {};
    if (titleChanged) patch.display_title = newTitle;
    if (taglineChanged) patch.hero_tagline = newTagline;
    const { error: uErr } = await sb.from('travel_packages').update(patch).eq('id', pkg.id);
    if (uErr) console.error(`  ✗ ${uErr.message}`);
    else updated++;
  }

  console.log(`\n${DRY ? '[DRY] ' : ''}완료: ${updated}개 ${DRY ? '예상 ' : ''}업데이트, ${skipped}개 스킵 (총 ${(pkgs || []).length}개)`);
})();
