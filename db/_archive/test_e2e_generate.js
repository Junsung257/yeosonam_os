/**
 * E2E 테스트: 소재 생성 파이프라인
 * 미들웨어 없이 직접 라이브러리 호출
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k,...v] = l.split('='); if(k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const PRODUCT_ID = 'd30abb93-25d9-4ff0-a411-23791c7f6543';

async function test() {
  console.log('=== E2E 테스트: 나트랑/달랏 소재 생성 ===\n');

  // 1. parsed_data 가져오기
  const { data: pkg, error: pkgErr } = await sb.from('travel_packages')
    .select('id, title, destination, price, duration, parsed_data, country, nights, product_summary, product_type, inclusions, product_highlights, itinerary, special_notes, airline, departure_airport, excludes')
    .eq('id', PRODUCT_ID).single();

  if (pkgErr) { console.error('쿼리 에러:', pkgErr.message); return; }

  if (!pkg) { console.error('상품 없음'); return; }

  let parsedData = pkg.parsed_data;
  if (!parsedData) {
    console.log('parsed_data 없음 — fallback 사용');
    parsedData = {
      destination: pkg.destination || '나트랑/달랏',
      country: pkg.country || '베트남',
      nights: pkg.nights || 3,
      days: (pkg.nights || 3) + 2,
      departure_date: null, deadline: null, seats_left: null,
      base_price: pkg.price || 489000,
      min_people: 6, hotel_stars: null, hotels: [],
      no_tip: true, no_option: true,
      special_gifts: ['과일도시락 1팩/룸당'],
      meals: { korean: [], local: [] },
      highlights: (pkg.product_highlights || []).map((h, i) => ({ name: h.slice(0,20), hook: h, day: i+2, visual_score: 7 })),
      itinerary: [],
      urgency_level: 'low',
      destination_type: '동남아단거리',
      price_range: '50만미만',
    };
  }
  parsedData.product_id = PRODUCT_ID;

  console.log('1. 파싱 데이터 확인:', parsedData.destination, parsedData.country, parsedData.base_price + '원');

  // 2. 슬라이드 설계
  const slideCount = Math.min(Math.max(4, (parsedData.highlights || []).length + 3), 8);
  console.log('2. 슬라이드 수:', slideCount);

  // 3. 캐러셀 카피 생성 (1종만 — benefit 타입)
  console.log('3. 캐러셀 카피 생성 중 (benefit hook)...');

  const hookType = 'benefit';
  const genAI = new GoogleGenerativeAI(env.GOOGLE_AI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0.8 } });

  const slideRoles = [
    { type: 'hook', hookType: 'benefit' },
    { type: 'benefit' },
    { type: 'cta' },
  ];

  const SYSTEM = '당신은 한국 패키지 여행 카드뉴스 카피라이터입니다.\n타겟: 40~60대 한국 중장년\n클리셰 금지: 파격, 놓치세요, 함께해요\n\n출력 JSON만:\n{"headline":"...","body":"...","pexels_keyword":"..."}';

  const rolePrompts = {
    hook: `[훅 슬라이드] 스크롤 멈추게 하는 첫 문장
훅 타입: benefit
노팁·노옵션·5성급 혜택 중심
headline 최대 20자 / body 최대 40자
pexels_keyword: 구체적 영문 3-5단어`,
    benefit: `[혜택 슬라이드] 명사/숫자 나열
노팁=${parsedData.no_tip} / 노옵션=${parsedData.no_option}
특전: ${parsedData.special_gifts?.join(', ') || '없음'}
headline: "노팁 · 노옵션 · 완벽 포함" 형태
body: 구체적 포함사항
pexels_keyword: "luxury hotel pool vietnam"`,
    cta: `[CTA 슬라이드] 긴급감
반드시 포함: ${parsedData.base_price.toLocaleString()}원
headline: 마감+가격 최대 20자
body: 포함사항 요약 최대 40자
pexels_keyword: "travel booking couple"`,
  };

  const copies = [];
  for (const role of slideRoles) {
    const prompt = SYSTEM + '\n\n' + rolePrompts[role.type];
    let success = false;
    for (let attempt = 0; attempt < 2 && !success; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
        const result = await model.generateContent(prompt);
        let text = result.response.text();
        text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        copies.push(JSON.parse(text));
        success = true;
      } catch (err) {
        if (attempt === 1) {
          console.warn('  카피 생성 실패:', role.type, err.message);
          copies.push({ headline: parsedData.destination, body: parsedData.base_price.toLocaleString() + '원~', pexels_keyword: 'nha trang beach sunset' });
        }
      }
    }
  }

  console.log('\n=== 생성된 카피 ===');
  copies.forEach((c, i) => {
    console.log(`  슬라이드 ${i+1} (${slideRoles[i].type}):`);
    console.log(`    headline: "${c.headline}"`);
    console.log(`    body: "${c.body}"`);
    console.log(`    pexels_keyword: "${c.pexels_keyword}"`);
  });

  // 4. ad_creatives에 저장
  console.log('\n4. ad_creatives에 저장 중...');

  const { data: inserted, error: insertErr } = await sb.from('ad_creatives').insert({
    product_id: PRODUCT_ID,
    creative_type: 'carousel',
    channel: 'meta',
    variant_index: 0,
    hook_type: 'benefit',
    tone: 'trust',
    key_selling_point: 'notip',
    target_segment: 'middle_age',
    slides: copies.map((c, i) => ({
      index: i,
      role: slideRoles[i].type,
      headline: c.headline,
      body: c.body,
      image_url: null,
      pexels_keyword: c.pexels_keyword,
    })),
    status: 'draft',
  }).select('id').single();

  if (insertErr) {
    console.error('INSERT 실패:', insertErr.message);
  } else {
    console.log('INSERT 성공! creative_id:', inserted.id);

    // 5. 검증: 읽어보기
    const { data: verify } = await sb.from('ad_creatives')
      .select('id, creative_type, channel, hook_type, slides, status')
      .eq('id', inserted.id).single();

    console.log('\n=== DB 검증 ===');
    console.log('  id:', verify.id);
    console.log('  type:', verify.creative_type, '/', verify.channel);
    console.log('  hook:', verify.hook_type);
    console.log('  status:', verify.status);
    console.log('  slides:', verify.slides.length, '장');
    verify.slides.forEach((s, i) => {
      console.log(`  [${i}] ${s.role}: "${s.headline}" / "${s.body}"`);
    });
  }

  // 총 ad_creatives 수 확인
  const { count } = await sb.from('ad_creatives').select('*', { count: 'exact', head: true });
  console.log('\n총 ad_creatives 수:', count);

  console.log('\n=== E2E 테스트 완료 ===');
}

test().catch(e => console.error('Fatal:', e.message));
