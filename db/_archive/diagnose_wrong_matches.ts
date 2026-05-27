import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const PKG = '31c2a38b-8481-4674-a055-b11c96a7f948';

  const { data: pkg } = await supa.from('travel_packages').select('itinerary_data').eq('id', PKG).single();
  const days = (pkg as { itinerary_data?: { days?: Array<{ day: number; schedule?: Array<{ activity: string; attraction_ids?: string[] }> }> } })?.itinerary_data?.days ?? [];

  // 1) DAY 별 line + attraction_ids + name 확인
  console.log('=== DAY 1~5 attraction_ids → name 매핑 ===\n');
  for (const d of days) {
    console.log(`\n━━━ DAY ${d.day} ━━━`);
    for (const item of d.schedule ?? []) {
      const ids = item.attraction_ids ?? [];
      if (ids.length === 0) {
        console.log(`  [ ] ${item.activity.slice(0, 70)}`);
        continue;
      }
      // 각 ID 이름 조회
      const names: string[] = [];
      for (const id of ids) {
        const { data: a } = await supa.from('attractions').select('name').eq('id', id).maybeSingle();
        names.push(a?.name ? (a.name as string) : `❌${id.slice(0,8)}orphan`);
      }
      console.log(`  [${ids.length}] ${item.activity.slice(0, 70)}`);
      console.log(`      → ${names.join(' | ')}`);
    }
  }

  // 2) "전신마사지" / "동인대협곡" 라는 이름의 attractions 검색 — name fallback 진단
  console.log('\n\n=== "전신마사지" attractions ===');
  const { data: mas } = await supa.from('attractions').select('id, name, country').or('name.ilike.%마사지%,name.ilike.%전신%');
  for (const m of mas ?? []) console.log(`  ${(m.name as string).padEnd(40)} (${m.country}) id=${(m.id as string).slice(0,8)}`);

  console.log('\n=== "동인" attractions (substring fallback 위험) ===');
  const { data: dong } = await supa.from('attractions').select('id, name, country').ilike('name', '%동인%');
  for (const m of dong ?? []) console.log(`  ${(m.name as string).padEnd(40)} (${m.country}) id=${(m.id as string).slice(0,8)}`);

})().catch(e => { console.error(e); process.exit(1); });
