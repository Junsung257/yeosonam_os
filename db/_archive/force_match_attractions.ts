import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const TARGETS: Array<{ pkg: string; matches: Array<{ keyword: string; attraction_name: string }> }> = [
    {
      pkg: '1e82f388-5cca-4d9a-8f53-10f4b0bb17b1', // 후쿠오카
      matches: [
        { keyword: '뇨이린지', attraction_name: '뇨이린지' },
        { keyword: '미야지다케 신사 관광', attraction_name: '미야지다케 신사' },
        { keyword: '큐다이숲', attraction_name: '큐다이숲' },
        { keyword: '후쿠오카 타워 외관', attraction_name: '후쿠오카 타워' },
        { keyword: '모모치 인공 해변', attraction_name: '모모치 인공 해변' },
        { keyword: '라라포트', attraction_name: '라라포트 후쿠오카' },
      ],
    },
    {
      pkg: '174e159b-5e8f-4579-935b-9370cd89da67', // 청도
      matches: [
        { keyword: '잔교', attraction_name: '잔교' },
        { keyword: '따바오다오', attraction_name: '따바오다오 먹자거리' },
        { keyword: '천주교당', attraction_name: '천주교당' },
        { keyword: '맥주박물관', attraction_name: '맥주박물관' },
        { keyword: '해천뷰전망대', attraction_name: '해천뷰전망대' },
        { keyword: '팔대관', attraction_name: '팔대관' },
        { keyword: '5.4광장', attraction_name: '5.4광장' },
        { keyword: '올림픽요트경기장', attraction_name: '올림픽요트경기장' },
        { keyword: '청양 야시장', attraction_name: '청양 야시장' },
        { keyword: '지모고성', attraction_name: '지모고성' },
        { keyword: '찌모루시장', attraction_name: '찌모루시장' },
        { keyword: '신호산', attraction_name: '신호산' },
        { keyword: '명월산해간', attraction_name: '명월산해간 불야성' },
        { keyword: '세기공원', attraction_name: '세기공원' },
      ],
    },
  ];

  for (const t of TARGETS) {
    // name → id 조회
    const names = t.matches.map(m => m.attraction_name);
    const { data: attrs } = await supa.from('attractions').select('id, name').in('name', names);
    const idByName = new Map<string, string>();
    for (const a of (attrs ?? []) as Array<{ id: string; name: string }>) idByName.set(a.name, a.id);

    // 패키지 itinerary fetch
    const { data: pkgs } = await supa.from('travel_packages').select('itinerary_data').eq('id', t.pkg).limit(1);
    if (!pkgs || pkgs.length === 0) continue;
    const itin = JSON.parse(JSON.stringify((pkgs[0] as { itinerary_data: { days?: Array<{ day?: number; schedule?: Array<{ activity?: string; attraction_ids?: string[] }> }> } }).itinerary_data));

    let updated = 0;
    for (const d of (itin.days ?? [])) {
      for (const s of (d.schedule ?? [])) {
        if (!s.activity) continue;
        const existing = new Set<string>(Array.isArray(s.attraction_ids) ? s.attraction_ids : []);
        const before = existing.size;
        for (const m of t.matches) {
          if (s.activity.includes(m.keyword)) {
            const id = idByName.get(m.attraction_name);
            if (id) existing.add(id);
          }
        }
        if (existing.size > before) {
          s.attraction_ids = [...existing];
          updated++;
        }
      }
    }

    if (updated > 0) {
      const { error } = await supa.from('travel_packages').update({ itinerary_data: itin, updated_at: new Date().toISOString() }).eq('id', t.pkg);
      if (error) console.log(`✗ ${t.pkg.slice(0,8)}: ${error.message}`);
      else console.log(`✓ ${t.pkg.slice(0,8)} (${t.pkg === TARGETS[0].pkg ? '후쿠오카' : '청도'}): ${updated} schedule items 매칭`);
    } else {
      console.log(`⊘ ${t.pkg.slice(0,8)}: 추가 매칭 0건`);
    }
  }

  // prod revalidate
  const paths = TARGETS.flatMap(t => [`/packages/${t.pkg}`, `/m/packages/${t.pkg}`]);
  const r = await fetch('https://yeosonam.com/api/revalidate', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({paths, secret: process.env.REVALIDATE_SECRET}) });
  console.log('\nprod revalidate:', (await r.text()).slice(0, 150));
})().catch(e => { console.error(e); process.exit(1); });
