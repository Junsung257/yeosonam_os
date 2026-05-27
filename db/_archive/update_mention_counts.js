/**
 * 관광지 mention_count + source_packages 자동 갱신
 * 전체 상품 스캔 → 관광지별 등장 횟수 + 등장 상품 ID 추적
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // 전체 관광지
  const { data: attractions } = await sb.from('attractions').select('id, name, aliases');
  // 전체 상품 (itinerary_data 있는 것만)
  const { data: pkgs } = await sb.from('travel_packages').select('id, title, itinerary_data').not('itinerary_data', 'is', null);

  console.log('관광지:', attractions.length, '개');
  console.log('상품:', pkgs.length, '개\n');

  // 관광지별 카운트 + 상품ID 수집
  const counts = new Map(); // attraction_id → { count, packageIds }
  for (const a of attractions) {
    counts.set(a.id, { count: 0, packageIds: new Set() });
  }

  const skipPattern = /^(호텔|리조트)?\s*(조식|투숙|체크|휴식|이동|출발|도착|귀환|수속|공항|탑승|기내|자유|석식|중식|면세|쇼핑|가이드|미팅|CHECK|향발|해산|경유|송영|김해|부산)/;

  for (const pkg of pkgs) {
    const days = Array.isArray(pkg.itinerary_data) ? pkg.itinerary_data : (pkg.itinerary_data?.days || []);
    const matched = new Set(); // 같은 상품에서 같은 관광지 중복 카운트 방지

    for (const day of days) {
      for (const item of (day.schedule || [])) {
        if (item.type === 'flight' || item.type === 'hotel' || item.type === 'shopping') continue;
        if (skipPattern.test(item.activity)) continue;

        const activity = item.activity.replace(/^[▶❥☞★■♥●▷\s\[특전\]]+/, '').trim();
        if (!activity || activity.length < 2) continue;

        for (const a of attractions) {
          const names = [a.name, ...(a.aliases || [])];
          const isMatch = names.some(n => activity.includes(n) || n.includes(activity.slice(0, Math.min(8, activity.length))));
          if (isMatch && !matched.has(a.id)) {
            matched.add(a.id);
            const entry = counts.get(a.id);
            entry.count++;
            entry.packageIds.add(pkg.id);
          }
        }
      }
    }
  }

  // DB UPDATE
  let updated = 0;
  for (const [attrId, { count, packageIds }] of counts) {
    if (count === 0) continue;
    const updateData = {
      mention_count: count,
      source_packages: [...packageIds],
    };
    const { error } = await sb.from('attractions').update(updateData).eq('id', attrId);
    if (error) {
      // source_packages 컬럼 없으면 mention_count만
      await sb.from('attractions').update({ mention_count: count }).eq('id', attrId);
    }
    updated++;
  }

  console.log('갱신 완료:', updated, '개 관광지\n');

  // TOP 10 출력
  const { data: top } = await sb.from('attractions')
    .select('name, mention_count, source_packages')
    .order('mention_count', { ascending: false })
    .limit(10);

  console.log('=== 등장 횟수 TOP 10 ===');
  top?.forEach((a, i) => {
    const pkgCount = Array.isArray(a.source_packages) ? a.source_packages.length : 0;
    console.log(`${i + 1}. ${a.name} — ${a.mention_count}회 (${pkgCount}개 상품)`);
  });
}

main().catch(e => console.error(e.message));
