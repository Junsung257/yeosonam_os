import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: pkgs } = await supa.from('travel_packages')
    .select('id, title, destination, status, audit_status, display_title, hero_tagline, product_summary, price_dates, inclusions, excludes, notices_parsed, itinerary_data')
    .in('status', ['approved', 'pending_review'])
    .not('raw_text', 'is', null);

  type PkgRow = { id: string; title: string; destination: string; status: string; audit_status: string | null; display_title: string | null; hero_tagline: string | null; product_summary: string | null; price_dates: unknown; inclusions: unknown; excludes: unknown; notices_parsed: unknown; itinerary_data: { days?: Array<{ schedule?: Array<{ activity?: string; attraction_ids?: string[]; type?: string }> }> } };

  console.log('\n========== 사장님 시선 최종 검증 ==========\n');
  for (const p of (pkgs ?? []) as PkgRow[]) {
    let totalAttr = 0, matched = 0;
    const unmatchedLines: string[] = [];
    for (const d of (p.itinerary_data?.days ?? [])) {
      for (const s of (d.schedule ?? [])) {
        if (!s.activity) continue;
        const t = s.type;
        if (t === 'flight' || t === 'hotel' || t === 'shopping') continue;
        if (/^(공항|출국|입국|수속|이동|체크인|체크아웃|투숙|휴식|미팅|조식|중식|석식|호텔)/.test(s.activity.trim())) continue;
        if (/(타워|신사|관광|숲|호수|공원|박물관|마을|해변|광장|폭포|전망대|온천|거리|시장|성|동굴|폭|숲|연못|로프웨이|케이블카|쇼핑몰|면세|체험|투어)/.test(s.activity)) {
          totalAttr++;
          if (Array.isArray(s.attraction_ids) && s.attraction_ids.length > 0) matched++;
          else unmatchedLines.push(s.activity.slice(0, 40));
        }
      }
    }
    const pct = totalAttr > 0 ? Math.round((matched / totalAttr) * 100) : 0;
    const visible = p.status === 'approved' ? '✅ 노출' : '⏳ pending_review (404)';

    // 프로덕션 페이지에 실제 사진 카드 카운트
    let prodCards = '?';
    try {
      const r = await fetch(`https://yeosonam.com/packages/${p.id}`, { cache: 'no-store' });
      const html = await r.text();
      const pexelsCount = (html.match(/images\.pexels\.com\/photos\/\d+/g) || []).length;
      prodCards = String(pexelsCount);
    } catch { prodCards = 'fetch-fail'; }

    console.log(`[${visible}] ${p.id.slice(0,8)} ${p.destination}`);
    console.log(`  display_title: ${p.display_title ? '✅' : '❌'}  hero_tagline: ${p.hero_tagline ? '✅' : '❌'}`);
    const pdLen = Array.isArray(p.price_dates) ? p.price_dates.length : 0;
    const incLen = Array.isArray(p.inclusions) ? p.inclusions.length : 0;
    const excLen = Array.isArray(p.excludes) ? p.excludes.length : 0;
    const noticesLen = Array.isArray(p.notices_parsed) ? p.notices_parsed.length : 0;
    console.log(`  price_dates: ${pdLen}건  inclusions: ${incLen}  excludes: ${excLen}  notices: ${noticesLen}`);
    console.log(`  attractions: ${matched}/${totalAttr} (${pct}%)  prod 사진: ${prodCards}장`);
    if (unmatchedLines.length > 0) {
      console.log(`  ❌ 미매칭 ${unmatchedLines.length}건:`);
      for (const u of unmatchedLines.slice(0, 6)) console.log(`     - ${u}`);
    }
    console.log('');
  }
})().catch(e => { console.error(e); process.exit(1); });
