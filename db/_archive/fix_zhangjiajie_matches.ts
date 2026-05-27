import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const PKG = '31c2a38b-8481-4674-a055-b11c96a7f948';

  const { data: pkg } = await supa.from('travel_packages').select('itinerary_data').eq('id', PKG).single();
  const it = (pkg as { itinerary_data?: { days?: Array<{ day: number; schedule?: Array<{ activity: string; attraction_ids?: string[] }> }> } })?.itinerary_data;
  if (!it?.days) { console.log('no itinerary'); return; }

  // 정정해야 할 라인: activity startsWith / contains 기준
  // 잘못된 attraction 이름 단위로 제거 (의미 매칭 우선)
  const WRONG: Array<{ day: number; activityContains: string; removeAttractionName: string[] }> = [
    // DAY 1
    { day: 1, activityContains: '장가계 도착', removeAttractionName: ['전신마사지60분(장가계)'] },
    { day: 1, activityContains: '동인으로 이동', removeAttractionName: ['동인대협곡'] },
    // DAY 2 — 동인시 본문에서 대협곡(유람선) 제거 (동인대협곡은 유지)
    { day: 2, activityContains: '동인시의 카르스트', removeAttractionName: ['대협곡(유람선)'] },
    // DAY 4 — 조식 라인 매칭 비우기, 총길이 라인에서 잘못 매칭된 2개 제거
    { day: 4, activityContains: '호텔 조식 후', removeAttractionName: ['장가계해외국제-[장가계]대협곡B코스(유리다리/VR/미끄럼/유람선)티켓'] },
    { day: 4, activityContains: '총길이 430M', removeAttractionName: ['대협곡(유람선)', '백룡엘리베이터탑승'] },
  ];

  // DAY 4 진짜 마사지 라인에 전신마사지(장가계) 매칭 추가
  const { data: masAttr } = await supa.from('attractions').select('id').eq('name', '전신마사지60분(장가계)').single();
  const masId = (masAttr as { id?: string } | null)?.id;

  // 이름 → id 매핑 사전 준비
  const allRemoveNames = [...new Set(WRONG.flatMap(w => w.removeAttractionName))];
  const { data: attrs } = await supa.from('attractions').select('id, name').in('name', allRemoveNames);
  const nameToId = new Map<string, string>();
  for (const a of attrs ?? []) nameToId.set(a.name as string, a.id as string);
  console.log('Resolved removal IDs:', [...nameToId.entries()].map(([n,i]) => `${n}=${i.slice(0,8)}`).join(', '));

  let changed = 0;
  for (const d of it.days) {
    for (const item of d.schedule ?? []) {
      // 제거 처리
      for (const w of WRONG) {
        if (d.day !== w.day) continue;
        if (!item.activity.includes(w.activityContains)) continue;
        const removeIds = w.removeAttractionName.map(n => nameToId.get(n)).filter((x): x is string => Boolean(x));
        const before = item.attraction_ids ?? [];
        const after = before.filter(id => !removeIds.includes(id));
        if (after.length !== before.length) {
          item.attraction_ids = after;
          changed++;
          console.log(`  ✓ DAY ${d.day} "${item.activity.slice(0, 40)}…" : removed ${before.length - after.length} (남은 ${after.length})`);
        }
      }
      // DAY 4 진짜 마사지 라인에 마사지 추가
      if (d.day === 4 && item.activity.includes('발+전신마사지') && masId) {
        const cur = item.attraction_ids ?? [];
        if (!cur.includes(masId)) {
          item.attraction_ids = [...cur, masId];
          changed++;
          console.log(`  ✓ DAY 4 "발+전신마사지" : 전신마사지60분(장가계) 추가`);
        }
      }
    }
  }

  console.log(`\n총 변경: ${changed}건`);
  if (changed === 0) { console.log('변경 없음'); return; }

  // UPDATE
  const { error } = await supa.from('travel_packages').update({ itinerary_data: it, updated_at: new Date().toISOString() }).eq('id', PKG);
  if (error) { console.log('UPDATE 실패:', error.message); return; }
  console.log('✓ DB UPDATE 완료');

  // revalidate prod + dev
  const { revalidatePackagePaths } = await import('../src/lib/revalidate-helper');
  const rev = await revalidatePackagePaths(PKG);
  console.log(`✓ revalidate: prod=${rev.prod.ok ? 'OK' : rev.prod.error} dev=${rev.dev.ok ? 'OK' : rev.dev.error}`);
})().catch(e => { console.error(e); process.exit(1); });
