/**
 * ══════════════════════════════════════════════════════════
 * 관광지 사진 검증 + 불일치 교체 스크립트
 * ══════════════════════════════════════════════════════════
 * Phase 1: Pexels API로 사진 alt 텍스트 가져와서 관광지 위치와 비교
 * Phase 2: 불일치 관광지만 재검색 (강화 키워드)
 * Phase 3: 결과 보고서 출력
 *
 * 실행: node db/verify_photos.js
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const PEXELS_KEY = env.PEXELS_API_KEY;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 국가/지역 → 영문 매핑 ─────────────────────────────────

const COUNTRY_EN = {
  '일본': ['japan', 'japanese'], '중국': ['china', 'chinese'], '베트남': ['vietnam', 'vietnamese'],
  '태국': ['thailand', 'thai', 'bangkok'], '말레이시아': ['malaysia', 'malaysian', 'malacca', 'melaka', 'kuala lumpur'],
  '싱가포르': ['singapore'], '인도네시아': ['indonesia', 'indonesian', 'bali', 'balinese'],
  '필리핀': ['philippines', 'filipino', 'cebu', 'bohol'], '캄보디아': ['cambodia', 'cambodian', 'siem reap', 'angkor'],
  '대만': ['taiwan', 'taiwanese', 'taipei'], '몽골': ['mongolia', 'mongolian'],
  '라오스': ['laos', 'lao', 'vientiane'], '괌': ['guam'], '사이판': ['saipan'],
  '키르기스스탄': ['kyrgyzstan'], '홍콩': ['hong kong'],
};

const REGION_EN = {
  '오사카': ['osaka'], '도쿄': ['tokyo', 'shinjuku', 'shibuya', 'asakusa'], '후쿠오카': ['fukuoka', 'hakata'],
  '삿포로': ['sapporo', 'hokkaido'], '교토': ['kyoto'], '나라': ['nara'], '오키나와': ['okinawa'],
  '가나자와': ['kanazawa'], '벳부': ['beppu'], '나고야': ['nagoya'],
  '방콕': ['bangkok'], '파타야': ['pattaya'], '치앙마이': ['chiang mai'], '푸켓': ['phuket'],
  '다낭': ['da nang', 'danang'], '호이안': ['hoi an', 'hoian'], '나트랑': ['nha trang', 'nhatrang'],
  '하노이': ['hanoi'], '하롱': ['halong', 'ha long'], '달랏': ['dalat', 'da lat'],
  '장가계': ['zhangjiajie'], '청도': ['qingdao'], '상해': ['shanghai'], '북경': ['beijing', 'peking'],
  '서안': ['xian', "xi'an"], '연길': ['yanji'], '하얼빈': ['harbin'],
  '세부': ['cebu'], '보홀': ['bohol'], '발리': ['bali', 'ubud'],
  '말라카': ['malacca', 'melaka'], '코타키나발루': ['kota kinabalu'], '겐팅': ['genting'],
  '씨엠립': ['siem reap'], '타이페이': ['taipei'], '타이중': ['taichung'],
  '울란바토르': ['ulaanbaatar'], '테를지': ['terelj'],
  '싱가포르': ['singapore', 'sentosa', 'marina bay'],
};

// ── Phase 1: Pexels 사진 alt 텍스트로 검증 ─────────────────

async function fetchPhotoAlt(pexelsId) {
  const res = await fetch(`https://api.pexels.com/v1/photos/${pexelsId}`, {
    headers: { Authorization: PEXELS_KEY },
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error('RATE_LIMIT');
    return null;
  }
  const data = await res.json();
  return {
    alt: (data.alt || '').toLowerCase(),
    url: data.url || '',
    photographer: data.photographer || '',
  };
}

function isLocationMatch(alt, photoUrl, country, region) {
  const text = (alt + ' ' + photoUrl).toLowerCase();

  // 국가 매칭
  const countryTerms = COUNTRY_EN[country] || [country.toLowerCase()];
  const countryMatch = countryTerms.some(t => text.includes(t));

  // 지역 매칭
  const regionTerms = REGION_EN[region] || [region?.toLowerCase()].filter(Boolean);
  const regionMatch = regionTerms.some(t => text.includes(t));

  return countryMatch || regionMatch;
}

// ── Phase 2: 불일치 재검색 ─────────────────────────────────

function scorePhoto(photo) {
  if (photo.width < 800 || photo.height < 600) return false;
  if (photo.height > photo.width * 1.2) return false;
  return true;
}

async function reSearchPhotos(attraction, genAI) {
  // Gemini로 더 구체적인 키워드 생성
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0.3 } });

  const regionEN = Object.entries(REGION_EN).find(([k]) => k === attraction.region)?.[1]?.[0] || attraction.region;
  const countryEN = Object.entries(COUNTRY_EN).find(([k]) => k === attraction.country)?.[1]?.[0] || attraction.country;

  const prompt = `You must output ONLY valid JSON. No markdown.

이 관광지의 Pexels 검색 키워드 3개를 만들어주세요.
매우 중요: 반드시 지역명 "${regionEN}" 또는 국가명 "${countryEN}"을 포함하세요.

관광지: ${attraction.name}
설명: ${attraction.short_desc}. ${(attraction.long_desc || '').slice(0, 150)}
국가/지역: ${attraction.country}/${attraction.region}

키워드 규칙:
- 영문 4-6단어
- 반드시 도시명/국가명 포함
- 그 관광지의 가장 특징적인 시각적 요소 포함
- 동명 장소와 구별될 수 있는 구체적 키워드

출력: {"kw":["keyword1","keyword2","keyword3"]}`;

  let keywords = [`${regionEN} ${attraction.category || 'landmark'}`, `${countryEN} ${attraction.category || 'sightseeing'}`];

  try {
    const result = await model.generateContent(prompt);
    let text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      keywords = parsed.kw || keywords;
    }
  } catch { /* use fallback keywords */ }

  // 3개 키워드 순차 시도
  for (const kw of keywords) {
    try {
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(kw)}&per_page=15&orientation=landscape`, {
        headers: { Authorization: PEXELS_KEY },
      });
      if (res.status === 429) { await sleep(60000); continue; }
      if (!res.ok) continue;

      const data = await res.json();
      const filtered = (data.photos || []).filter(scorePhoto);

      // alt 텍스트에 위치 포함된 사진만 우선 선택
      const locationMatched = filtered.filter(p => {
        const alt = (p.alt || '').toLowerCase();
        const countryTerms = COUNTRY_EN[attraction.country] || [];
        const regionTerms = REGION_EN[attraction.region] || [];
        return [...countryTerms, ...regionTerms].some(t => alt.includes(t));
      });

      if (locationMatched.length >= 3) {
        return { photos: locationMatched.slice(0, 5), source: 'location_verified' };
      }
      if (filtered.length >= 3) {
        return { photos: filtered.slice(0, 5), source: 'keyword_match' };
      }
    } catch { /* continue */ }
    await sleep(1100);
  }

  return { photos: [], source: 'none' };
}

// ── 메인 ───────────────────────────────────────────────────

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log('  관광지 사진 검증 + 불일치 교체');
  console.log('══════════════════════════════════════════════\n');

  // 전체 관광지 조회
  const { data: attractions } = await sb
    .from('attractions')
    .select('id, name, short_desc, long_desc, country, region, category, photos')
    .not('photos', 'is', null)
    .order('name');

  console.log(`📋 검증 대상: ${attractions.length}개 관광지\n`);

  // ── Phase 1: 검증 ────────────────────────────────────────
  console.log('[Phase 1] 사진-관광지 위치 검증 중...\n');

  const verified = [];
  const mismatched = [];
  const uncertain = [];
  let rateLimitHits = 0;

  for (let i = 0; i < attractions.length; i++) {
    const a = attractions[i];
    const firstPhoto = a.photos?.[0];
    if (!firstPhoto?.pexels_id) { uncertain.push(a); continue; }

    try {
      const photoInfo = await fetchPhotoAlt(firstPhoto.pexels_id);
      if (!photoInfo) { uncertain.push(a); continue; }

      const match = isLocationMatch(photoInfo.alt, photoInfo.url, a.country, a.region);

      if (match) {
        verified.push(a);
        if ((i + 1) % 50 === 0) console.log(`  [${i + 1}/${attractions.length}] 검증 중... (✓${verified.length} ✗${mismatched.length} ?${uncertain.length})`);
      } else {
        mismatched.push({ ...a, photo_alt: photoInfo.alt });
        console.log(`  ✗ ${a.name} (${a.country}/${a.region}) — alt: "${photoInfo.alt.slice(0, 60)}"`);
      }
    } catch (e) {
      if (e.message === 'RATE_LIMIT') {
        rateLimitHits++;
        console.log('  ⏳ Rate limit — 60초 대기...');
        await sleep(60000);
        i--; continue;
      }
      uncertain.push(a);
    }

    await sleep(350); // Pexels photo endpoint는 rate limit이 더 느슨
  }

  console.log(`\n[Phase 1 결과]`);
  console.log(`  ✓ 검증 통과: ${verified.length}개`);
  console.log(`  ✗ 불일치:    ${mismatched.length}개`);
  console.log(`  ? 미확인:    ${uncertain.length}개`);
  console.log(`  Rate limit:  ${rateLimitHits}회\n`);

  // ── Phase 2: 불일치 재검색 ────────────────────────────────
  if (mismatched.length > 0) {
    console.log(`[Phase 2] 불일치 ${mismatched.length}개 재검색 중...\n`);

    const genAI = new GoogleGenerativeAI(env.GOOGLE_AI_API_KEY);
    let fixed = 0;
    const stillBroken = [];

    for (let i = 0; i < mismatched.length; i++) {
      const a = mismatched[i];
      console.log(`  [${i + 1}/${mismatched.length}] ${a.name} (${a.country}/${a.region})`);

      try {
        const { photos, source } = await reSearchPhotos(a, genAI);

        if (photos.length >= 3) {
          const photoData = photos.map(p => ({
            pexels_id: p.id,
            src_medium: p.src.medium,
            src_large: p.src.large2x,
            photographer: p.photographer,
            alt: (p.alt || '').slice(0, 100),
          }));

          await sb.from('attractions').update({ photos: photoData }).eq('id', a.id);
          fixed++;
          console.log(`    → ✓ 교체 완료 (${source}, ${photos.length}장)`);
        } else {
          stillBroken.push({ id: a.id, name: a.name, country: a.country, region: a.region });
          console.log(`    → ✗ 대체 사진 없음`);
        }
      } catch (e) {
        if (e.message === 'RATE_LIMIT') {
          console.log('    ⏳ Rate limit — 60초 대기...');
          await sleep(60000);
          i--; continue;
        }
        stillBroken.push({ id: a.id, name: a.name, country: a.country, region: a.region, error: e.message });
        console.log(`    → ✗ 오류: ${e.message}`);
      }

      await sleep(1500);
    }

    console.log(`\n[Phase 2 결과]`);
    console.log(`  ✓ 교체 완료: ${fixed}개`);
    console.log(`  ✗ 교체 불가: ${stillBroken.length}개`);

    if (stillBroken.length > 0) {
      fs.writeFileSync('db/manual_review_photos.json', JSON.stringify(stillBroken, null, 2));
      console.log(`  📄 수동 확인 목록: db/manual_review_photos.json`);
    }
  }

  // ── Phase 3: 최종 보고 ────────────────────────────────────
  console.log('\n══════════════════════════════════════════════');
  console.log(`  최종 결과`);
  console.log(`  검증 통과:   ${verified.length}개`);
  console.log(`  교체 완료:   ${mismatched.length - (mismatched.length)}개`);
  console.log(`  수동 확인:   ${uncertain.length}개`);
  console.log('══════════════════════════════════════════════');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
