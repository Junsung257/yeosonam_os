/**
 * 사장님 옵션 A (2026-05-17) — 장가계 패키지 31c2a38b 누락 5개 자동 INSERT + Pexels + reEnrich + revalidate.
 * STRICT SSOT 정책 1회 해제 동의: 사장님 명시 ("장가계 5개도 자동으로 진행해").
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const PEXELS_KEY = process.env.PEXELS_API_KEY!;
const PKG_ID = '31c2a38b-8481-4674-a055-b11c96a7f948';

interface NewAttr {
  name: string;
  aliases: string[];
  region: string;
  country: string;
  short_desc: string;
  long_desc: string;
  emoji: string;
  badge_type: 'tour' | 'shopping' | 'optional' | 'special';
  pexels_keyword: string;
}

const NEW_ATTRACTIONS: NewAttr[] = [
  {
    name: '범정산',
    aliases: ['범정산', '판징산', 'Fanjingshan', 'Mount Fanjing', '范净山', '梵净山'],
    region: '동인',
    country: 'CN',
    short_desc: '중국 5대 불교명산 · 미륵보살 도장 · 해발 2,494m',
    long_desc: '중국 5대 불교명산 중 하나이며 해발 2,494m의 높이에 면적이 567만 평방미터에 달하는 중국 국가급 10대 자연보호구역입니다. 미륵보살의 도장으로 인정되는 범정산은 해마다 많은 신자들이 모여들며, 동시에 중국 서남부 지역의 생태왕국 및 동식물의 보고 역할을 하며 14억년에 걸쳐 형성된 기이한 바위와 지형이 수많은 볼거리를 제공합니다. 셔틀버스-케이블카-보도광장-마고석-노금정/홍운금정 코스로 관광.',
    emoji: '⛰️',
    badge_type: 'tour',
    pexels_keyword: 'Fanjingshan Mount Fanjing China',
  },
  {
    name: '동인대협곡',
    aliases: ['동인대협곡', '동인 대협곡', 'Tongren Grand Canyon', '铜仁大峡谷'],
    region: '동인',
    country: 'CN',
    short_desc: '동인시 카르스트 협곡 · 약 2km · 폭포·일선천·유천',
    long_desc: '동인시의 카르스트 지형 중 으뜸으로 꼽히며 폭포, 일선천, 유천 등이 아름다운 자태를 뽐내는 약 2km의 협곡입니다. 유람선으로 협곡 아래를 통과하며 양쪽 절벽의 장대한 풍경을 올려다볼 수 있는 체험이 가능합니다.',
    emoji: '🏞️',
    badge_type: 'tour',
    pexels_keyword: 'Tongren Grand Canyon Guizhou',
  },
  {
    name: '봉황고성',
    aliases: ['봉황고성', '펑황구청', 'Phoenix Ancient Town', 'Fenghuang', '凤凰古城'],
    region: '봉황',
    country: 'CN',
    short_desc: '중국 4대 고성 · 300년 청나라 · 타강 야경',
    long_desc: '중국 4대 고성 중 하나로 300년 전 청나라 시대에 건설되었으며 타강에 늘어선 목조 건물들은 전통미를 뽐내며 밤이 되면 황홀한 야경을 선사합니다. 석식 후 환상적인 고성의 야경 감상이 하이라이트.',
    emoji: '🏯',
    badge_type: 'tour',
    pexels_keyword: 'Fenghuang Ancient Town Phoenix Hunan',
  },
  {
    name: '선녀헌화',
    aliases: ['선녀헌화', '선녀헌화봉', 'Fairy Offering Flowers', '仙女献花'],
    region: '장가계',
    country: 'CN',
    short_desc: '천자산 봉우리 · 선녀가 꽃을 든 형상',
    long_desc: '장가계 천자산 풍경구의 사암 봉우리 명소. 봉우리의 모양이 마치 선녀가 꽃을 들고 있는 듯한 형상으로 \'선녀헌화\'라 불리며, 주변 봉림과 어우러진 절경을 감상할 수 있습니다.',
    emoji: '💐',
    badge_type: 'tour',
    pexels_keyword: 'Tianzi Mountain Zhangjiajie pillars',
  },
  {
    name: '후화원',
    aliases: ['후화원', '후화원경구', 'Back Garden Yuanjiajie', '后花园'],
    region: '장가계',
    country: 'CN',
    short_desc: '원가계 후화원 · 천태만상 봉우리 향연',
    long_desc: '장가계 원가계 경구 내에 자리한 후화원은 천태만상의 봉우리들이 향연을 펼치는 전망 구역입니다. 미혼대와 함께 원가계 핵심 코스로 꼽히며, 사석봉림이 펼쳐지는 파노라마를 감상할 수 있습니다.',
    emoji: '🌸',
    badge_type: 'tour',
    pexels_keyword: 'Yuanjiajie Zhangjiajie back garden',
  },
];

async function pexelsFetch(keyword: string): Promise<Array<{ pexels_id: number; src_medium: string; src_large: string; photographer: string; alt: string }>> {
  try {
    const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&per_page=3`, { headers: { Authorization: PEXELS_KEY } });
    if (!r.ok) return [];
    const j = await r.json() as { photos?: Array<{ id: number; src: { medium: string; large2x: string }; photographer: string; alt: string }> };
    return (j.photos ?? []).map(p => ({ pexels_id: p.id, src_medium: p.src.medium, src_large: p.src.large2x, photographer: p.photographer, alt: p.alt }));
  } catch { return []; }
}

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const insertedIds: string[] = [];

  for (const a of NEW_ATTRACTIONS) {
    const { data: existing } = await supa.from('attractions').select('id, name').eq('name', a.name).limit(1);
    if (existing && existing.length > 0) {
      console.log(`⊘ skip (중복): ${a.name}`);
      insertedIds.push(existing[0].id as string);
      continue;
    }
    const photos = await pexelsFetch(a.pexels_keyword);
    const { data: created, error } = await supa.from('attractions').insert({
      name: a.name,
      short_desc: a.short_desc,
      long_desc: a.long_desc,
      aliases: a.aliases,
      country: a.country,
      region: a.region,
      badge_type: a.badge_type,
      emoji: a.emoji,
      category: 'sightseeing',
      source: 'owner-bulk-resolve',
      confidence_score: 0.9,
      seeded_at: new Date().toISOString(),
      is_active: true,
      is_manual_override: true,
      last_owner_edited_at: new Date().toISOString(),
      photos,
    }).select('id, name').single();
    if (error || !created) { console.log(`✗ ${a.name}: ${error?.message}`); continue; }
    insertedIds.push(created.id as string);
    console.log(`✓ ${a.name} (${a.region}) → ${photos.length} photos, ${a.aliases.length} aliases`);

    // attractions_aliases 시드 (선택, name normalized 외 변형 시드)
    for (const al of a.aliases) {
      if (al === a.name) continue;
      const { error: aliasErr } = await supa.from('attractions_aliases').insert({
        attraction_id: created.id,
        alias: al,
        source: 'owner-bulk-resolve',
      });
      if (aliasErr && !/duplicate|unique/i.test(aliasErr.message)) {
        console.log(`     alias 시드 실패 (${al}): ${aliasErr.message.slice(0, 80)}`);
      }
    }

    // unmatched_activities 정리
    for (const v of [a.name, ...a.aliases.slice(0, 2)]) {
      await supa.from('unmatched_activities').update({
        status: 'added',
        resolved_at: new Date().toISOString(),
        resolved_kind: 'owner-bulk-resolve',
        resolved_attraction_id: created.id,
        resolved_by: 'owner_bulk',
      }).ilike('activity', `%${v}%`).in('status', ['pending']);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n📊 INSERT 완료: ${insertedIds.length}건.\n`);

  // 31c2a38b 패키지 backfillPackageAttractionsL3 재실행 (orphan UUID 12개 정정 + 신규 5개 매핑)
  console.log('🔄 backfillPackageAttractionsL3 (orphan 정정 + 신규 매칭)');
  const { backfillPackageAttractionsL3 } = await import('../src/lib/itinerary-llm-extractor');
  const result = await backfillPackageAttractionsL3(PKG_ID, { useLLMFallback: true });
  console.log(`   before=${((result.before ?? 0)*100).toFixed(0)}% after=${((result.after ?? 0)*100).toFixed(0)}% llmCalls=${result.llmCalls}`);

  // reEnrich (전체 검색)
  if (insertedIds.length > 0) {
    console.log('\n🔄 reEnrichAffectedPackages');
    const { reEnrichAffectedPackages } = await import('../src/lib/package-reenrich-on-attraction-change');
    const r = await reEnrichAffectedPackages(insertedIds, { maxPackages: 50 });
    console.log(`   scanned=${r.scanned_packages} updated=${r.updated_packages} revalidated=${r.revalidated_paths}`);
  }

  // 최종 prod + dev 동시 revalidate
  console.log('\n🔄 revalidatePackagePaths (prod + dev3001)');
  const { revalidatePackagePaths } = await import('../src/lib/revalidate-helper');
  const rev = await revalidatePackagePaths(PKG_ID);
  console.log(`   prod=${rev.prod.ok ? 'OK' : `FAIL(${rev.prod.error})`} dev=${rev.dev.ok ? 'OK' : `FAIL(${rev.dev.error})`}`);

  console.log('\n✅ 장가계 5개 자동 INSERT 종결');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
