/**
 * 사장님 옵션 A — SSOT 한번 풀어 17~18건 자동 INSERT + Pexels 사진 + 매칭 + 승인.
 * 정책 박제 (manage-attractions.md): 본 스크립트는 사장님 명시 동의 1회용.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const PEXELS_KEY = process.env.PEXELS_API_KEY!;
const REVAL = process.env.REVALIDATE_SECRET!;

interface NewAttr {
  name: string;
  region: string;
  country: string;
  short_desc: string;
  long_desc: string;
  emoji: string;
  badge_type: 'tour' | 'shopping' | 'optional' | 'special';
  pexels_keyword: string;
  package_ids: string[];  // 어느 패키지에 속함
}

const NEW_ATTRACTIONS: NewAttr[] = [
  // ── 후쿠오카 / 큐슈 (6건) ──
  { name: '미야지다케 신사', region: '후쿠오카', country: 'JP', short_desc: '큐슈 3대 신사 중 하나, 황금 빛의 길로 유명', long_desc: '큐슈 3대 신사 중 하나로 짚으로 엮은 거대 금줄(길이 13.5m, 무게 15t)과 종, 북으로 유명합니다. 아라시 광고촬영지로 알려진 빛의 길(히카리노미찌) 선셋이 일품.', emoji: '⛩️', badge_type: 'tour', pexels_keyword: 'Miyajidake Shrine Fukuoka', package_ids: ['1e82f388-5cca-4d9a-8f53-10f4b0bb17b1'] },
  { name: '큐다이숲', region: '사사구리', country: 'JP', short_desc: '모노노케히메 시시가미 숲과 닮은 신비로운 삼림욕 명소', long_desc: '약 2KM 산책로를 따라 연못을 일주하는 사사구리정 숲. 물속에서 뻗은 낙우송(누마스기)의 신비한 모습과 삼림세라피로 인정된 삼림욕을 즐길 수 있습니다.', emoji: '🌳', badge_type: 'tour', pexels_keyword: 'Kyudai Forest Sasaguri Japan', package_ids: ['1e82f388-5cca-4d9a-8f53-10f4b0bb17b1'] },
  { name: '후쿠오카 타워', region: '후쿠오카', country: 'JP', short_desc: '하카타만 전망 234m 후쿠오카 랜드마크', long_desc: '하카타만 모모치 해변 옆 234m 후쿠오카 시 랜드마크. 외관 관광 + 모모치 인공 해변 산책 코스로 인기.', emoji: '🗼', badge_type: 'tour', pexels_keyword: 'Fukuoka Tower Momochi Beach', package_ids: ['1e82f388-5cca-4d9a-8f53-10f4b0bb17b1'] },
  { name: '모모치 인공 해변', region: '후쿠오카', country: 'JP', short_desc: '후쿠오카 타워 옆 인공 해변, 도심 휴식 명소', long_desc: '후쿠오카 타워 인근 인공 해변. 도심 속에서 바다 풍경을 즐길 수 있는 산책·휴식 공간.', emoji: '🏖️', badge_type: 'tour', pexels_keyword: 'Momochi Seaside Park Fukuoka', package_ids: ['1e82f388-5cca-4d9a-8f53-10f4b0bb17b1'] },
  { name: '라라포트 후쿠오카', region: '후쿠오카', country: 'JP', short_desc: '2022년 오픈한 종합 쇼핑몰', long_desc: '2022년 4월 25일 오픈한 후쿠오카 신규 종합쇼핑몰 \'라라포트(lala Port)\'. 쇼핑·식사·엔터테인먼트 통합.', emoji: '🛍️', badge_type: 'shopping', pexels_keyword: 'LaLaport Fukuoka shopping mall', package_ids: ['1e82f388-5cca-4d9a-8f53-10f4b0bb17b1'] },
  { name: '뇨이린지', region: '후쿠오카', country: 'JP', short_desc: '개구리절로 유명한 사찰', long_desc: '경내 곳곳에 개구리 조각이 가득해 \'개구리절\'로 불리는 사찰. 행운과 무사 귀환을 비는 명소.', emoji: '🐸', badge_type: 'tour', pexels_keyword: 'Nyoirinji Temple frog Fukuoka', package_ids: ['1e82f388-5cca-4d9a-8f53-10f4b0bb17b1'] },

  // ── 청도 (12건) ──
  { name: '잔교', region: '청도', country: 'CN', short_desc: '청도 상징 바다 위 부두', long_desc: '1892년 건립된 청도 상징 부두. 바다 위 440m 부두 끝에 자리한 회란각(回澜阁)이 청도 도시 상징.', emoji: '🌊', badge_type: 'tour', pexels_keyword: 'Zhanqiao Pier Qingdao', package_ids: ['174e159b-5e8f-4579-935b-9370cd89da67'] },
  { name: '따바오다오 먹자거리', region: '청도', country: 'CN', short_desc: '청도의 유럽감성 먹자거리', long_desc: '청도 구시가지의 유럽풍 거리. 다양한 현지·외국 음식과 카페가 모인 야시·먹자 명소.', emoji: '🍢', badge_type: 'tour', pexels_keyword: 'Dabaodao Food Street Qingdao', package_ids: ['174e159b-5e8f-4579-935b-9370cd89da67'] },
  { name: '천주교당', region: '청도', country: 'CN', short_desc: '1943년 완공 56m 독일식 건축 성당', long_desc: '1943년 완공된 높이 56m의 독일식 가톨릭 성당. 청도 구시가지의 대표 건축물.', emoji: '⛪', badge_type: 'tour', pexels_keyword: 'St Michael Cathedral Qingdao', package_ids: ['174e159b-5e8f-4579-935b-9370cd89da67'] },
  { name: '맥주박물관', region: '청도', country: 'CN', short_desc: '100년 청도 맥주 역사관', long_desc: '청도 맥주 100년 역사를 보여주는 박물관. 맥주원액 1잔 + 생맥 1잔 + 땅콩안주 증정 체험.', emoji: '🍺', badge_type: 'optional', pexels_keyword: 'Tsingtao Beer Museum Qingdao', package_ids: ['174e159b-5e8f-4579-935b-9370cd89da67'] },
  { name: '해천뷰전망대', region: '청도', country: 'CN', short_desc: '81층 369m 청도 전체 조망 전망대', long_desc: '81층 369m 높이에서 청도 시가지와 바다를 한눈에 조망. 선택관광.', emoji: '🏙️', badge_type: 'optional', pexels_keyword: 'Qingdao TV Tower viewpoint', package_ids: ['174e159b-5e8f-4579-935b-9370cd89da67'] },
  { name: '팔대관', region: '청도', country: 'CN', short_desc: '만국건축박물관, 유럽풍 별장 거리', long_desc: '8개의 도로 양쪽에 20여 국가 양식의 건축물이 있어 \'만국건축박물관\'으로 불립니다. 유럽풍 별장과 가로수가 어우러진 산책 명소.', emoji: '🏛️', badge_type: 'tour', pexels_keyword: 'Badaguan Qingdao buildings', package_ids: ['174e159b-5e8f-4579-935b-9370cd89da67'] },
  { name: '5.4광장', region: '청도', country: 'CN', short_desc: '5.4운동 기념 붉은 횃불 광장', long_desc: '1919년 5.4운동을 기념하는 청도 랜드마크 광장. 거대한 붉은 횃불 조형물 \'오월의 바람\'으로 유명.', emoji: '🔥', badge_type: 'tour', pexels_keyword: 'May Fourth Square Qingdao', package_ids: ['174e159b-5e8f-4579-935b-9370cd89da67'] },
  { name: '올림픽요트경기장', region: '청도', country: 'CN', short_desc: '2008 북경올림픽 요트경기장', long_desc: '2008년 베이징 올림픽 요트 경기가 열린 청도 마리나. 산책로와 바다 풍경이 인기.', emoji: '⛵', badge_type: 'tour', pexels_keyword: 'Qingdao Olympic Sailing Center', package_ids: ['174e159b-5e8f-4579-935b-9370cd89da67'] },
  { name: '청양 야시장', region: '청도', country: 'CN', short_desc: '청양 활발한 현지 야시장', long_desc: '청도 청양 지역의 활발한 현지 야시장. 다양한 길거리 음식과 잡화 쇼핑.', emoji: '🌃', badge_type: 'tour', pexels_keyword: 'Qingyang Night Market Qingdao', package_ids: ['174e159b-5e8f-4579-935b-9370cd89da67'] },
  { name: '지모고성', region: '청도', country: 'CN', short_desc: '1400년 역사 고대도시', long_desc: '1400년의 역사와 전통을 간직한 고대도시. 청도 인근 지모(即墨) 지역의 옛 성벽과 거리를 보존.', emoji: '🏯', badge_type: 'tour', pexels_keyword: 'Jimo Ancient City Qingdao', package_ids: ['174e159b-5e8f-4579-935b-9370cd89da67'] },
  { name: '찌모루시장', region: '청도', country: 'CN', short_desc: '중국 3대 짝퉁시장, 명품 한눈에', long_desc: '중국 3대 짝퉁시장으로 불리는 청도의 대형 도매시장. 세계 명품 모조품·잡화가 모인 쇼핑 명소.', emoji: '🏬', badge_type: 'shopping', pexels_keyword: 'Jimo Lu Market Qingdao', package_ids: ['174e159b-5e8f-4579-935b-9370cd89da67'] },
  { name: '신호산', region: '청도', country: 'CN', short_desc: '110m 청도 전체 조망', long_desc: '해발 110m에 위치해 청도 시가지 전체를 조망할 수 있는 작은 산. 등반 산책로와 전망대.', emoji: '⛰️', badge_type: 'tour', pexels_keyword: 'Xinhao Hill Qingdao', package_ids: ['174e159b-5e8f-4579-935b-9370cd89da67'] },
  { name: '명월산해간 불야성', region: '청도', country: 'CN', short_desc: '청도 야경 명소', long_desc: '청도 떠오르는 야경 명소 \'명월산해간 불야성\'. 화려한 조명과 바다 풍경이 어우러진 야간 산책 코스.', emoji: '🌃', badge_type: 'tour', pexels_keyword: 'Mingyue Shanhai Qingdao night', package_ids: ['174e159b-5e8f-4579-935b-9370cd89da67'] },
  { name: '세기공원', region: '청도', country: 'CN', short_desc: '숲과 호수의 휴식 공원', long_desc: '청도의 숲과 호수가 어우러진 휴식 공간. 산책·러닝·자전거 코스가 잘 갖춰진 도심 공원.', emoji: '🌳', badge_type: 'tour', pexels_keyword: 'Century Park Qingdao', package_ids: ['174e159b-5e8f-4579-935b-9370cd89da67'] },
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

  const affectedPackages = new Set<string>();
  const insertedIds: string[] = [];

  for (const a of NEW_ATTRACTIONS) {
    // 중복 체크 (name 동일)
    const { data: existing } = await supa.from('attractions').select('id').eq('name', a.name).limit(1);
    if (existing && existing.length > 0) {
      console.log(`⊘ skip (중복): ${a.name}`);
      continue;
    }
    // Pexels 사진
    const photos = await pexelsFetch(a.pexels_keyword);
    // INSERT
    const { data: created, error } = await supa.from('attractions').insert({
      name: a.name,
      short_desc: a.short_desc,
      long_desc: a.long_desc,
      aliases: [],
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
    insertedIds.push(created.id);
    console.log(`✓ ${a.name} (${a.region}) → ${photos.length} photos`);

    // unmatched_activities update
    const variations = [a.name, a.pexels_keyword.split(' ')[0]];
    for (const v of variations) {
      await supa.from('unmatched_activities').update({
        status: 'added',
        resolved_at: new Date().toISOString(),
        resolved_kind: 'owner-bulk-resolve',
        resolved_attraction_id: created.id,
        resolved_by: 'owner_bulk',
      }).ilike('activity', `%${v}%`).in('status', ['pending']);
    }

    for (const pkgId of a.package_ids) affectedPackages.add(pkgId);
    await new Promise(r => setTimeout(r, 300));  // rate limit
  }

  console.log(`\n📊 INSERT 완료: ${insertedIds.length}건. 영향 패키지: ${affectedPackages.size}건.\n`);

  // reEnrichAffectedPackages — 각 attraction id로 영향받는 패키지 재매칭
  if (insertedIds.length > 0) {
    const { reEnrichAffectedPackages } = await import('../src/lib/package-reenrich-on-attraction-change');
    const r = await reEnrichAffectedPackages(insertedIds, { maxPackages: 50 });
    console.log(`🔄 reEnrich: scanned=${r.scanned_packages} updated=${r.updated_packages} revalidated=${r.revalidated_paths}`);
  }

  // 청도/계림 pending_review → approved
  console.log('\n📤 pending_review → approved');
  const toApprove = ['174e159b-5e8f-4579-935b-9370cd89da67', '3a136d76-79c0-44f2-aa1a-8e8d4cbdb12a', 'f54cc782-9f13-46dd-ba0b-97c05f2086be'];
  for (const id of toApprove) {
    const { error } = await supa.from('travel_packages').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', id);
    if (error) console.log(`  ✗ ${id.slice(0,8)}: ${error.message}`); else console.log(`  ✓ ${id.slice(0,8)} approved`);
  }

  // prod revalidate
  console.log('\n🔄 prod revalidate');
  const allPkgs = [...affectedPackages, ...toApprove];
  const paths = allPkgs.flatMap(id => [`/packages/${id}`, `/m/packages/${id}`]);
  try {
    const r = await fetch('https://yeosonam.com/api/revalidate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({paths, secret: REVAL}) });
    console.log('  prod:', (await r.text()).slice(0, 100));
  } catch (e) { console.log('  prod fail:', (e as Error).message); }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
