/**
 * ══════════════════════════════════════════════════════════
 * 관광지 Pexels 사진 일괄 생성 스크립트 v2
 * ══════════════════════════════════════════════════════════
 * 개선: 나라+도시+관광지명 기반 정밀 검색
 *       카테고리별 검색 전략 분리
 *       3단계 Fallback 체계
 *
 * 실행:
 *   node db/batch_pexels_photos_v2.js            # 사진 없는 것만
 *   node db/batch_pexels_photos_v2.js --limit 10  # 테스트 10개
 *   node db/batch_pexels_photos_v2.js --force     # 덮어쓰기
 *   node db/batch_pexels_photos_v2.js --country 일본  # 특정 국가만
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── 환경변수 ──────────────────────────────────────────────
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k && k.trim()) env[k.trim()] = v.join('=').trim(); });

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const PEXELS_KEY = env.PEXELS_API_KEY;
const GEMINI_KEY = env.GOOGLE_AI_API_KEY;

// ── CLI 옵션 ──────────────────────────────────────────────
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 10 : 99999;
const countryIdx = args.indexOf('--country');
const COUNTRY_FILTER = countryIdx >= 0 ? args[countryIdx + 1] : null;

// ── 국가/도시 영문 매핑 ───────────────────────────────────
const COUNTRY_EN = {
  '일본': 'Japan', '중국': 'China', '이탈리아': 'Italy', '스위스': 'Switzerland',
  '오스트리아': 'Austria', '크로아티아': 'Croatia', '체코': 'Czech Republic',
  '프랑스': 'France', '헝가리': 'Hungary', '홍콩': 'Hong Kong', '마카오': 'Macau',
  '몽골': 'Mongolia', '슬로베니아': 'Slovenia', '독일': 'Germany',
  '베트남': 'Vietnam', '태국': 'Thailand', '나트랑/달랏': 'Vietnam',
  '방콕/파타야': 'Thailand',
};

const REGION_EN = {
  // 일본
  '가가와': 'Kagawa', '간사이': 'Kansai', '고베': 'Kobe', '교토': 'Kyoto',
  '구마모토': 'Kumamoto', '기후': 'Gifu', '나가노': 'Nagano', '나가사키': 'Nagasaki',
  '나고야': 'Nagoya', '나라': 'Nara', '도야마': 'Toyama', '도쿄': 'Tokyo',
  '미야코지마': 'Miyakojima', '미에': 'Mie', '벳부': 'Beppu', '사사구리': 'Sasaguri',
  '사이타마': 'Saitama', '시가': 'Shiga', '시라카와': 'Shirakawa',
  '쓰시마': 'Tsushima', '아소': 'Aso', '야마나시': 'Yamanashi',
  '에히메': 'Ehime', '오고리': 'Ogori', '오사카': 'Osaka', '오카야마': 'Okayama',
  '오키나와': 'Okinawa', '유후인': 'Yufuin', '이시카와': 'Ishikawa',
  '주부': 'Chubu', '치바': 'Chiba', '쿠로가와': 'Kurokawa',
  '큐슈': 'Kyushu', '타카야마': 'Takayama', '토야마': 'Toyama',
  '하코네': 'Hakone', '홋카이도': 'Hokkaido', '효고': 'Hyogo',
  '후쿠오카': 'Fukuoka', '후쿠이': 'Fukui',
  // 중국
  '내몽골': 'Inner Mongolia', '무한': 'Wuhan', '백두산': 'Changbai Mountain',
  '북경': 'Beijing', '산동': 'Shandong', '상해': 'Shanghai', '서안': 'Xian',
  '심천': 'Shenzhen', '연변': 'Yanbian', '연태': 'Yantai', '위해': 'Weihai',
  '장가계': 'Zhangjiajie', '청도': 'Qingdao',
  // 유럽
  '부다페스트': 'Budapest', '비엔나': 'Vienna', '인스부르크': 'Innsbruck',
  '잘츠부르크': 'Salzburg', '잘츠카머구트': 'Salzkammergut',
  '루체른': 'Lucerne', '몽트뢰': 'Montreux', '발레': 'Valais',
  '베른': 'Bern', '샤프하우젠': 'Schaffhausen', '인터라켄': 'Interlaken',
  '체르마트': 'Zermatt', '취리히': 'Zurich',
  '가르다호수': 'Lake Garda', '나폴리': 'Naples', '로마': 'Rome',
  '베네치아': 'Venice', '베로나': 'Verona', '아말피': 'Amalfi',
  '움브리아': 'Umbria', '토스카나': 'Tuscany', '피렌체': 'Florence',
  '류블랴나': 'Ljubljana', '블레드': 'Bled',
  '두브로브니크': 'Dubrovnik', '스플리트': 'Split', '자그레브': 'Zagreb',
  '자다르': 'Zadar', '트로기르': 'Trogir', '플리트비체': 'Plitvice',
  '브르노': 'Brno', '체스키크룸로프': 'Cesky Krumlov', '프라하': 'Prague',
  '알자스': 'Alsace', '파리': 'Paris',
  '하이델베르크': 'Heidelberg',
  // 아시아
  '마카오': 'Macau', '홍콩': 'Hong Kong', '울란바토르': 'Ulaanbaatar',
  '테를지': 'Terelj', '방콕': 'Bangkok', '나트랑': 'Nha Trang', '달랏': 'Dalat',
};

// ── 카테고리별 검색 전략 ──────────────────────────────────
const CATEGORY_SEARCH_SUFFIX = {
  'meal': 'food dish cuisine',
  'hotel': 'hotel resort exterior',
  'onsen': 'hot spring onsen bath',
  'shopping': 'shopping street market',
  'entertainment': 'attraction entertainment',
  'activity': 'outdoor activity adventure',
  'wellness': 'spa massage wellness',
  'temple': 'temple shrine',
  'palace': 'castle palace',
  'museum': 'museum gallery',
  'park': 'park garden green',
  'nature': 'nature landscape scenic',
  'beach': 'beach coast ocean',
  'sightseeing': 'landmark sightseeing',
  'cultural': 'cultural heritage historic',
  'service': 'airport lounge vip',
};

// ── 카테고리별 직접 키워드 생성 (Gemini 불필요한 항목) ─────
function generateDirectKeywords(attraction) {
  const countryEn = COUNTRY_EN[attraction.country] || attraction.country;
  const regionEn = REGION_EN[attraction.region] || attraction.region || '';
  const catSuffix = CATEGORY_SEARCH_SUFFIX[attraction.category] || 'landmark';
  const badge = attraction.badge_type;

  // 호텔: 도시 호텔로 검색 (특정 호텔명은 Pexels에 없음)
  if (badge === 'hotel' || attraction.category === 'hotel') {
    return [
      `${regionEn} ${countryEn} hotel luxury`,
      `${regionEn} resort hotel room`,
    ];
  }

  // 음식: 요리명 + 국가 요리
  if (badge === 'meal' || badge === 'restaurant' || attraction.category === 'meal') {
    const foodMap = {
      '에그타르트': 'egg tart pastry Portuguese',
      '매캐니즈식': 'Macanese food African chicken',
      '허르헉': 'Mongolian barbecue meat stones',
      '굴라쉬': 'goulash soup Hungarian Budapest',
      '슈니첼': 'wiener schnitzel Vienna Austrian',
      '호이리게': 'heuriger wine tavern Vienna',
      '스비치코바': 'svickova Czech beef cream sauce',
      '베프조바제브리카': 'cevapi Balkan grilled meat',
      '피오렌티나스테이크': 'Florentine steak T-bone Florence',
      '해물튀김': 'fritto misto seafood Italian',
      '에스까르고': 'escargot French snail butter',
      '치즈퐁듀': 'cheese fondue Swiss alpine',
      '브라트부르스트': 'bratwurst roesti Swiss sausage',
      '사누키우동': 'sanuki udon noodle Kagawa',
      '스키야키': 'sukiyaki Japanese beef hot pot',
      '고베명물스테이크': 'Kobe beef steak teppanyaki',
      '유두부정식': 'yudofu tofu Kyoto Japanese',
      '덴푸라': 'tempura udon Japanese food',
      '샤브샤브': 'shabu shabu Japanese hot pot',
      '철판스테이크': 'teppanyaki steak Okinawa',
      '아구샤브샤브': 'agu pork shabu Okinawa',
      '대게뷔페': 'snow crab buffet Japanese',
      '규스키야키': 'wagyu sukiyaki Kyushu',
      '야키니쿠': 'yakiniku Japanese grilled meat',
      '소바': 'soba buckwheat noodle Japanese',
      '북경오리구이': 'Peking duck Beijing roasted',
      '양꼬치': 'lamb skewer Chinese kebab Qingdao beer',
      '삼겹살': 'Korean BBQ pork belly grilled',
      '냉면': 'cold noodle Korean Yanbian',
      '산동요리': 'Shandong cuisine Chinese food',
      '사천요리': 'Sichuan spicy Chinese food',
      '광동식': 'Cantonese food Hong Kong dim sum',
      '얌차식': 'yum cha dim sum Hong Kong tea',
      '타이메시': 'tai meshi sea bream rice Ehime',
      '가마메시': 'kamameshi rice pot Nagoya',
      '바베큐': 'Japanese BBQ seafood grill',
      '카츠나베': 'katsu nabe pork cutlet hot pot',
      '와규카레': 'wagyu beef curry Japanese',
      '토반야끼': 'toban yaki grilled fish Japanese',
      '홋케': 'hokke grilled fish Hokkaido',
      '뷔페': 'hotel buffet Japanese food spread',
      '스시우동': 'sushi udon set meal Osaka',
    };

    // 이름에서 매칭 키워드 찾기
    for (const [kr, en] of Object.entries(foodMap)) {
      if (attraction.name.includes(kr)) {
        return [en, `${regionEn} ${countryEn} local food cuisine`];
      }
    }
    return [
      `${regionEn} ${countryEn} local food cuisine`,
      `${countryEn} traditional food dish`,
    ];
  }

  // 온천
  if (badge === 'onsen' || attraction.category === 'onsen') {
    return [
      `${regionEn} ${countryEn} onsen hot spring outdoor`,
      `Japanese onsen bath steam ${regionEn}`,
    ];
  }

  // 쇼핑
  if (badge === 'shopping') {
    return [
      `${regionEn} shopping street ${countryEn}`,
      `${regionEn} outlet mall shopping`,
    ];
  }

  // 마사지/웰니스
  if (attraction.category === 'wellness') {
    return [
      `spa massage relaxation ${countryEn}`,
      `${regionEn} spa wellness treatment`,
    ];
  }

  // 서비스 (VIP라운지 등)
  if (attraction.category === 'service') {
    return [
      `airport VIP lounge luxury`,
      `airport first class lounge`,
    ];
  }

  // 나머지는 null → Gemini 키워드 생성 대상
  return null;
}

// ── Pexels 검색 ───────────────────────────────────────────
function scorePhoto(photo) {
  if (photo.width < 800 || photo.height < 600) return false;
  if (photo.height > photo.width * 1.2) return false; // 세로 사진 제외
  return true;
}

async function searchPexels(keyword, perPage = 15) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&per_page=${perPage}&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: PEXELS_KEY } });

  if (!res.ok) {
    if (res.status === 429) throw new Error('RATE_LIMIT');
    throw new Error(`Pexels ${res.status}`);
  }

  const data = await res.json();
  return (data.photos || []).filter(scorePhoto);
}

// ── 3단계 Fallback 검색 ──────────────────────────────────
async function findPhotos(attraction, keywords) {
  const MIN = 2;

  // 1차: 첫번째 키워드
  if (keywords[0]) {
    try {
      const photos = await searchPexels(keywords[0]);
      if (photos.length >= MIN) return { photos: photos.slice(0, 5), source: 'kw1' };
    } catch (e) { if (e.message === 'RATE_LIMIT') throw e; }
    await sleep(1100);
  }

  // 2차: 두번째 키워드
  if (keywords[1]) {
    try {
      const photos = await searchPexels(keywords[1]);
      if (photos.length >= MIN) return { photos: photos.slice(0, 5), source: 'kw2' };
    } catch (e) { if (e.message === 'RATE_LIMIT') throw e; }
    await sleep(1100);
  }

  // 3차: 도시+국가+카테고리 Fallback
  const countryEn = COUNTRY_EN[attraction.country] || attraction.country;
  const regionEn = REGION_EN[attraction.region] || attraction.region || '';
  const catSuffix = CATEGORY_SEARCH_SUFFIX[attraction.category] || 'landmark scenic';
  const fallback = `${regionEn} ${countryEn} ${catSuffix}`.trim();

  try {
    const photos = await searchPexels(fallback);
    if (photos.length > 0) return { photos: photos.slice(0, 5), source: 'fallback' };
  } catch (e) { if (e.message === 'RATE_LIMIT') throw e; }

  return { photos: [], source: 'none' };
}

// ── Gemini 배치 키워드 생성 (관광지/문화/자연 전용) ────────
async function generateKeywordsBatch(attractions) {
  if (!GEMINI_KEY || attractions.length === 0) {
    return attractions.map(a => ({
      id: a.id,
      keywords: [`${REGION_EN[a.region] || a.region || ''} ${COUNTRY_EN[a.country] || a.country} landmark`],
    }));
  }

  const genAI = new GoogleGenerativeAI(GEMINI_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.2 },
  });

  const BATCH = 40;
  const results = [];

  for (let i = 0; i < attractions.length; i += BATCH) {
    const batch = attractions.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH) + 1;
    const totalBatches = Math.ceil(attractions.length / BATCH);
    console.log(`  [Gemini] 배치 ${batchNum}/${totalBatches} (${batch.length}건)`);

    const inputList = batch.map((a, idx) => {
      const countryEn = COUNTRY_EN[a.country] || a.country;
      const regionEn = REGION_EN[a.region] || a.region || '';
      const desc = [a.short_desc, (a.long_desc || '').slice(0, 100)].filter(Boolean).join('. ');
      return `${idx}|${a.name}|${desc}|${countryEn}/${regionEn}|${a.category}`;
    }).join('\n');

    const prompt = `You must output ONLY valid JSON array. No markdown, no explanation.

아래 한국어 관광지 목록을 보고, Pexels 검색용 영문 키워드 2개를 생성하세요.

## 규칙 (필수)
1. **도시+국가 영문명 반드시 포함** (동명 관광지 구분 필수)
   ✅ "Fushimi Inari shrine Kyoto Japan torii gates"
   ❌ "red shrine torii gates"
   ✅ "Charles Bridge Prague Czech sunrise statues"
   ❌ "old stone bridge river"
2. 키워드 5-7 영단어, 시각적 장면 묘사 (건축, 풍경, 자연)
3. 금지어: beautiful, amazing, famous, travel, tourism, best, wonderful
4. 가로 풍경 사진에 적합한 키워드
5. 사원/성당은 외관 + 내부 각 1개씩
6. 자연은 계절감 있는 풍경

입력: index|이름|설명|Country/City|category

${inputList}

출력 (JSON만):
[{"idx":0,"kw":["keyword with city country","keyword with city country"]}]`;

    try {
      const result = await model.generateContent(prompt);
      let text = result.response.text();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) text = jsonMatch[0];
      const parsed = JSON.parse(text);

      for (const item of parsed) {
        const a = batch[item.idx];
        if (a && item.kw && item.kw.length > 0) {
          results.push({ id: a.id, keywords: item.kw });
        }
      }
    } catch (err) {
      console.warn(`  ⚠ Gemini 배치 ${batchNum} 실패: ${err.message}`);
      for (const a of batch) {
        const cEn = COUNTRY_EN[a.country] || a.country;
        const rEn = REGION_EN[a.region] || a.region || '';
        results.push({ id: a.id, keywords: [`${rEn} ${cEn} ${a.category || 'landmark'}`] });
      }
    }

    if (i + BATCH < attractions.length) await sleep(1500);
  }

  return results;
}

// ── DB 저장 ───────────────────────────────────────────────
async function savePhotos(id, photos) {
  const data = photos.map(p => ({
    pexels_id: p.id,
    src_medium: p.src.medium,
    src_large: p.src.large2x,
    photographer: p.photographer,
    alt: '',
  }));
  const { error } = await sb.from('attractions').update({ photos: data }).eq('id', id);
  if (error) throw new Error(`DB: ${error.message}`);
  return data.length;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 메인 ──────────────────────────────────────────────────
async function main() {
  console.log('══════════════════════════════════════════════');
  console.log('  관광지 Pexels 사진 일괄 생성 v2');
  console.log(`  옵션: ${FORCE ? '--force' : '사진없는것만'} | limit: ${LIMIT === 99999 ? '전체' : LIMIT}${COUNTRY_FILTER ? ' | country: ' + COUNTRY_FILTER : ''}`);
  console.log('══════════════════════════════════════════════\n');

  if (!PEXELS_KEY) { console.error('❌ PEXELS_API_KEY 미설정'); process.exit(1); }

  // ── 관광지 조회 ─────────────────────────────────────────
  let query = sb.from('attractions')
    .select('id, name, short_desc, long_desc, country, region, category, badge_type, photos')
    .order('country').order('region').order('name');

  if (!FORCE) query = query.or('photos.is.null,photos.eq.[]');
  if (COUNTRY_FILTER) query = query.eq('country', COUNTRY_FILTER);

  const { data: attractions, error: fetchErr } = await query.limit(LIMIT);
  if (fetchErr) { console.error('❌ 조회 실패:', fetchErr.message); process.exit(1); }

  console.log(`📋 대상: ${attractions.length}개\n`);
  if (attractions.length === 0) { console.log('✅ 모두 사진 있음'); return; }

  // ── Phase 1: 카테고리별 분류 ────────────────────────────
  const directItems = [];  // Gemini 불필요 (호텔/음식/온천/쇼핑/마사지)
  const geminiItems = [];  // Gemini 필요 (관광지/문화/자연/사원 등)

  for (const a of attractions) {
    const directKw = generateDirectKeywords(a);
    if (directKw) {
      directItems.push({ ...a, keywords: directKw });
    } else {
      geminiItems.push(a);
    }
  }

  console.log(`📌 직접 키워드: ${directItems.length}개 (호텔/음식/온천/쇼핑/웰니스)`);
  console.log(`📌 Gemini 키워드: ${geminiItems.length}개 (관광지/문화/자연/사원)\n`);

  // ── Phase 2: Gemini 키워드 생성 ─────────────────────────
  let geminiKeywords = [];
  if (geminiItems.length > 0) {
    console.log('🤖 Phase 2: Gemini 키워드 생성...');
    geminiKeywords = await generateKeywordsBatch(geminiItems);
    console.log(`  ✅ ${geminiKeywords.length}개 키워드 생성 완료\n`);
  }

  // 키워드 맵 합치기
  const keywordMap = new Map();
  for (const item of directItems) keywordMap.set(item.id, item.keywords);
  for (const item of geminiKeywords) keywordMap.set(item.id, item.keywords);

  // ── Phase 3: Pexels 검색 + DB 저장 ─────────────────────
  console.log('📷 Phase 3: Pexels 검색 + DB 저장...\n');

  const failed = [];
  let success = 0, totalPhotos = 0;

  for (let i = 0; i < attractions.length; i++) {
    const a = attractions[i];
    const keywords = keywordMap.get(a.id) || [`${REGION_EN[a.region] || ''} ${COUNTRY_EN[a.country] || ''} landmark`];
    const tag = `[${i + 1}/${attractions.length}]`;

    try {
      const { photos, source } = await findPhotos(a, keywords);

      if (photos.length === 0) {
        console.log(`${tag} ✗ ${a.country}/${a.region} ${a.name} — 0장 (kw: ${keywords[0]})`);
        failed.push({ id: a.id, name: a.name, country: a.country, region: a.region, keywords });
      } else {
        const saved = await savePhotos(a.id, photos);
        totalPhotos += saved;
        success++;
        console.log(`${tag} ✓ ${a.country}/${a.region} ${a.name} — ${saved}장 (${source})`);
      }
    } catch (err) {
      if (err.message === 'RATE_LIMIT') {
        console.log('\n⏳ Rate limit — 60초 대기...');
        await sleep(60000);
        i--; continue;
      }
      console.log(`${tag} ✗ ${a.name} — 오류: ${err.message}`);
      failed.push({ id: a.id, name: a.name, error: err.message });
    }

    await sleep(1100);
  }

  // ── 결과 ────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════');
  console.log(`  완료: ${success}/${attractions.length} 성공`);
  console.log(`  총 사진: ${totalPhotos}장`);
  console.log(`  실패: ${failed.length}건`);
  console.log('══════════════════════════════════════════════');

  if (failed.length > 0) {
    fs.writeFileSync('db/failed_photos_v2.json', JSON.stringify(failed, null, 2));
    console.log(`\n📄 실패 목록: db/failed_photos_v2.json`);
  }

  const { count } = await sb.from('attractions')
    .select('*', { count: 'exact', head: true })
    .or('photos.is.null,photos.eq.[]');
  console.log(`\n📊 사진 없는 관광지: ${count}개 남음`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
