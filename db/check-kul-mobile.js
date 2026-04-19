/**
 * 모바일 랜딩 관련 상태 확인: optional_tours + 관광지 photos
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

(async () => {
  // 1. optional_tours 실제 DB 값
  console.log('═══ optional_tours DB 값 ═══\n');
  const { data: pkgs } = await sb
    .from('travel_packages')
    .select('title, duration, optional_tours')
    .ilike('destination', '%쿠알라%');
  for (const pkg of pkgs || []) {
    console.log(`[${pkg.duration}일] ${pkg.title}`);
    for (const t of (pkg.optional_tours || [])) {
      console.log(`  - name: ${JSON.stringify(t.name)} / region: ${JSON.stringify(t.region)} / price: ${JSON.stringify(t.price)}`);
    }
    console.log();
  }

  // 2. 모바일 렌더에 쓰이는 관광지 photos 상태
  console.log('\n═══ 쿠알라 관련 attractions photos 상태 ═══\n');
  const { data: attrs } = await sb
    .from('attractions')
    .select('name, country, region, photos')
    .or('region.ilike.%쿠알라%,region.ilike.%싱가포르%,region.ilike.%말라카%,country.eq.말레이시아,country.eq.싱가포르');
  for (const a of attrs || []) {
    const photoCount = Array.isArray(a.photos) ? a.photos.length : 0;
    const firstPhoto = Array.isArray(a.photos) && a.photos[0] ? Object.keys(a.photos[0]).join(',') : 'N/A';
    console.log(`  ${a.name.padEnd(25)} | ${(a.country || '-').padEnd(8)} | ${(a.region || '-').padEnd(12)} | photos: ${photoCount}개 (${firstPhoto})`);
  }
})().catch(e => { console.error(e); process.exit(1); });
