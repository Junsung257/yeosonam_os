import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 1) 장가계 4박5일 패키지 찾기
  const { data: pkgs } = await supa
    .from('travel_packages')
    .select('id, title, display_title, destination, status, itinerary_data')
    .ilike('title', '%범정산%')
    .order('updated_at', { ascending: false })
    .limit(3);

  if (!pkgs || pkgs.length === 0) {
    console.log('범정산 패키지 없음. 장가계로 재검색.');
    const { data: alt } = await supa
      .from('travel_packages')
      .select('id, title, display_title, destination, status, itinerary_data')
      .ilike('title', '%장가계%')
      .order('updated_at', { ascending: false })
      .limit(3);
    console.log(JSON.stringify(alt?.map(p => ({ id: p.id, title: p.title, status: p.status })), null, 2));
    return;
  }

  for (const pkg of pkgs) {
    console.log(`\n==================== ${pkg.id} ====================`);
    console.log(`title: ${pkg.title}`);
    console.log(`display_title: ${pkg.display_title}`);
    console.log(`destination: ${pkg.destination}`);
    console.log(`status: ${pkg.status}`);

    const days = (pkg.itinerary_data as { days?: Array<{ day: number; schedule?: Array<{ activity: string; attraction_ids?: string[] }> }> })?.days ?? [];
    console.log(`\nDAYS: ${days.length}`);

    // 모든 라인 + attraction_ids 매핑 출력
    const allActIds = new Set<string>();
    const linesWithoutMatch: string[] = [];
    for (const d of days) {
      console.log(`\n--- DAY ${d.day} ---`);
      for (const item of d.schedule ?? []) {
        const ids = item.attraction_ids ?? [];
        const tag = ids.length > 0 ? `[${ids.length}]` : '[ ]';
        console.log(`  ${tag} ${item.activity.slice(0, 80)}`);
        for (const id of ids) allActIds.add(id);
        if (ids.length === 0 && item.activity.length > 8 && !/^(\d|식사|중식|석식|조식|호텔|투숙|이동|출발|도착|미팅|체크인|체크아웃|휴식|면세점|쇼핑|마사지|티켓|발+|전신|쇼관람|관광)/.test(item.activity)) {
          linesWithoutMatch.push(item.activity);
        }
      }
    }

    // 2) attraction 데이터 풍부도 체크
    console.log(`\n=== attractions DB lookup (${allActIds.size} unique IDs) ===`);
    if (allActIds.size > 0) {
      const { data: attrs } = await supa
        .from('attractions')
        .select('id, name, name_normalized, country, long_description, photos')
        .in('id', [...allActIds]);
      for (const a of attrs ?? []) {
        const longLen = (a.long_description as string | null)?.length ?? 0;
        const photosLen = ((a.photos as { url: string }[] | null) ?? []).length;
        const flag = longLen === 0 || photosLen === 0 ? '⚠️ ' : '✓  ';
        console.log(`${flag}${a.name.padEnd(30)} long=${longLen} photos=${photosLen} country=${a.country}`);
      }
    }

    // 3) destination 키워드 정확 매칭 (범정산/동인대협곡/봉황고성)
    const destKeywords = ['범정산', '동인대협곡', '봉황고성', '천문산', '장가계대협곡'];
    console.log(`\n=== destination 키워드 attractions DB 존재 여부 ===`);
    for (const kw of destKeywords) {
      const { data: found } = await supa
        .from('attractions')
        .select('id, name, country, long_description, photos')
        .ilike('name', `%${kw}%`)
        .limit(3);
      if (!found || found.length === 0) {
        console.log(`  ❌ ${kw}: attractions DB 없음`);
        const { data: alias } = await supa
          .from('attractions_aliases')
          .select('alias, attraction_id')
          .ilike('alias', `%${kw}%`)
          .limit(3);
        if (alias && alias.length > 0) {
          console.log(`     alias 매칭: ${alias.map(a => `${a.alias}→${a.attraction_id?.slice(0,8)}`).join(', ')}`);
        }
      } else {
        for (const f of found) {
          const longLen = (f.long_description as string | null)?.length ?? 0;
          const photosLen = ((f.photos as { url: string }[] | null) ?? []).length;
          console.log(`  ✓ ${f.name} (long=${longLen}, photos=${photosLen}, country=${f.country})`);
        }
      }
    }

    // 4) 매칭 안 된 라인 중 후보
    if (linesWithoutMatch.length > 0) {
      console.log(`\n=== 매칭 안 된 의미있는 라인 (${linesWithoutMatch.length}개) ===`);
      linesWithoutMatch.slice(0, 20).forEach(l => console.log(`  - ${l.slice(0, 120)}`));
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
