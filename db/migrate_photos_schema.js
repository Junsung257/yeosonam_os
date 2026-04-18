/**
 * @file migrate_photos_schema.js
 * @description attractions.photos 필드의 구형식({url,thumb,credit,pexels_id})을
 *              신형식({src_medium,src_large,photographer,pexels_id,alt})으로 일괄 마이그레이션
 *
 * 대상 버그: 쿠알라 상품 모바일 랜딩에서 사진 미표시 (렌더러는 src_medium/src_large만 참조)
 *
 * 매핑:
 *   url    → src_large
 *   thumb  → src_medium
 *   credit → photographer
 *   alt    → attraction name (fallback)
 *
 * 사용법:
 *   node db/migrate_photos_schema.js              # dry-run
 *   node db/migrate_photos_schema.js --apply      # 실제 UPDATE
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const APPLY = process.argv.includes('--apply');

function isLegacyFormat(photo) {
  if (!photo || typeof photo !== 'object') return false;
  // 신형식에 있는 필드가 없고 구형식 필드만 있는 경우
  const hasNew = 'src_medium' in photo || 'src_large' in photo;
  const hasLegacy = 'url' in photo || 'thumb' in photo;
  return !hasNew && hasLegacy;
}

function migratePhoto(photo, fallbackAlt) {
  if (!isLegacyFormat(photo)) return photo; // 이미 신형식
  return {
    src_medium: photo.thumb || photo.url || '',
    src_large: photo.url || photo.thumb || '',
    photographer: photo.credit || '',
    pexels_id: photo.pexels_id || 0,
    alt: photo.alt || fallbackAlt || '',
  };
}

(async () => {
  console.log(`🔍 ${APPLY ? '[APPLY]' : '[DRY-RUN]'} attractions.photos 스키마 마이그레이션\n`);

  // 페이지네이션으로 전체 순회 (Supabase 기본 1000 리밋 대응)
  const attrs = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from('attractions')
      .select('id, name, photos')
      .not('photos', 'is', null)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    attrs.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`총 ${attrs.length}건 관광지 스캔\n`);

  const updates = [];
  for (const a of attrs) {
    if (!Array.isArray(a.photos) || a.photos.length === 0) continue;
    const legacyCount = a.photos.filter(isLegacyFormat).length;
    if (legacyCount === 0) continue;
    const migrated = a.photos.map(p => migratePhoto(p, a.name));
    updates.push({ id: a.id, name: a.name, before: a.photos.length, legacy: legacyCount, migrated });
  }

  if (!updates.length) {
    console.log('✅ 구형식 photos 없음. 마이그레이션 불필요.');
    return;
  }

  console.log(`대상 ${updates.length}건:\n`);
  for (const u of updates) {
    console.log(`  ${u.name} — photos: ${u.before}개 중 ${u.legacy}개 구형식 → 신형식 변환`);
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] --apply 플래그로 실제 반영.');
    console.log('\n예시 변환 (첫 항목):');
    const sample = updates[0];
    const oldP = attrs.find(a => a.id === sample.id).photos[0];
    console.log('  before:', JSON.stringify(oldP, null, 2));
    console.log('  after :', JSON.stringify(sample.migrated[0], null, 2));
    return;
  }

  let ok = 0, fail = 0;
  for (const u of updates) {
    const { error: uErr } = await sb.from('attractions').update({ photos: u.migrated }).eq('id', u.id);
    if (uErr) { console.error(`  ❌ ${u.name}:`, uErr.message); fail++; }
    else ok++;
  }
  console.log(`\n✅ UPDATE ${ok}/${updates.length}건 완료 (실패 ${fail})`);
})().catch(e => { console.error(e); process.exit(1); });
