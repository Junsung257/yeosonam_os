import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const PKG = '31c2a38b-8481-4674-a055-b11c96a7f948';

  const { data: pkg } = await supa.from('travel_packages').select('itinerary_data').eq('id', PKG).single();
  const days = (pkg as { itinerary_data?: { days?: Array<{ day: number; schedule?: Array<{ activity: string; attraction_ids?: string[] }> }> } })?.itinerary_data?.days ?? [];

  // 모든 attraction_ids 수집 + 첫 5개 ID 직접 검증
  const allIds: string[] = [];
  for (const d of days) for (const s of d.schedule ?? []) for (const id of s.attraction_ids ?? []) allIds.push(id);
  console.log('총 attraction_ids:', allIds.length);
  console.log('샘플 5개:', allIds.slice(0, 5));

  // 직접 SELECT 1개씩
  const uniq = [...new Set(allIds)];
  console.log('\n=== uniq IDs 직접 검증 ===');
  for (const id of uniq) {
    const { data: a } = await supa.from('attractions').select('id, name, country, long_description, photos').eq('id', id).maybeSingle();
    if (!a) {
      console.log(`  ❌ ${id.slice(0,8)} — attractions에 없음 (orphan!)`);
    } else {
      const longLen = (a.long_description as string | null)?.length ?? 0;
      const photosLen = ((a.photos as { url: string }[] | null) ?? []).length;
      console.log(`  ✓  ${id.slice(0,8)} ${(a.name as string).padEnd(25)} long=${longLen} ph=${photosLen} country=${a.country}`);
    }
  }

  // destination 키워드를 attractions에 직접 검색 — country='CN'만
  console.log('\n=== destination 키워드 attractions (country=CN) ===');
  for (const kw of ['범정산','동인대협곡','봉황고성','천문산','장가계대협곡','천자산','어필봉','선녀헌화','후화원']) {
    const { data } = await supa.from('attractions').select('id, name, country').ilike('name', `%${kw}%`);
    if (!data || data.length === 0) {
      console.log(`  ❌ ${kw}: 0건`);
    } else {
      console.log(`  ✓ ${kw}: ${data.map(d => `${d.name}(${d.country})`).join(' | ')}`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
