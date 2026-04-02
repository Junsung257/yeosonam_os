/**
 * ══════════════════════════════════════════════════════════
 * 관광지 Pexels 사진 일괄 생성 스크립트
 * ══════════════════════════════════════════════════════════
 * Phase 1: Gemini로 영문 검색 키워드 배치 생성
 * Phase 2: Pexels API로 사진 검색 (품질 필터링)
 * Phase 3: Supabase UPDATE
 *
 * 실행:
 *   node db/batch_pexels_photos.js            # 전체 (사진 없는 것만)
 *   node db/batch_pexels_photos.js --force     # 기존 덮어쓰기
 *   node db/batch_pexels_photos.js --limit 10  # 테스트 10개만
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── 환경변수 로드 ──────────────────────────────────────────

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const PEXELS_KEY = env.PEXELS_API_KEY;
const GEMINI_KEY = env.GOOGLE_AI_API_KEY;

// ── CLI 옵션 ───────────────────────────────────────────────

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 10 : 99999;

// ── 사진 품질 필터 ─────────────────────────────────────────

function scorePhoto(photo) {
  if (photo.width < 800 || photo.height < 600) return false;
  if (photo.height > photo.width * 1.2) return false;
  return true;
}

// ── Phase 1: Gemini 영문 키워드 배치 생성 ──────────────────

async function generateKeywordsBatch(attractions) {
  if (!GEMINI_KEY) {
    console.log('⚠ GOOGLE_AI_API_KEY 없음 — fallback 키워드 사용');
    return attractions.map(a => ({
      id: a.id,
      keywords: [`${a.region || a.country} ${a.category || 'landmark'} tourism`],
    }));
  }

  const genAI = new GoogleGenerativeAI(GEMINI_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.3 },
  });

  const BATCH_SIZE = 50;
  const allResults = [];

  for (let i = 0; i < attractions.length; i += BATCH_SIZE) {
    const batch = attractions.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(attractions.length / BATCH_SIZE);
    console.log(`\n[Phase 1] Gemini 키워드 생성 배치 ${batchNum}/${totalBatches} (${batch.length}건)`);

    const inputList = batch.map((a, idx) => {
      const desc = [a.short_desc, (a.long_desc || '').slice(0, 120)].filter(Boolean).join('. ');
      return `${idx}|${a.name}|${desc}|${a.country}/${a.region}|${a.category}`;
    }).join('\n');

    const prompt = `You must output ONLY valid JSON array. No markdown, no explanation, no code blocks.

아래 한국어 관광지 목록을 보고, 각 관광지의 시각적 특징을 영문 Pexels 검색 키워드 2개로 변환하세요.

## 핵심 규칙 (반드시 준수)
1. **도시명/지역명 필수 포함**: 동명 관광지 구분을 위해 키워드에 반드시 해당 도시/지역/국가 영문명을 포함할 것
   - ✅ "St Paul Church ruins Malacca Malaysia"
   - ❌ "St Paul Church ruins historic" (어느 나라인지 모름)
   - ✅ "Dotonbori neon street Osaka night"
   - ❌ "neon shopping street night" (어느 도시인지 모름)
2. 각 키워드: 영문 4-6단어 (지역명 포함이므로 1-2단어 더 허용)
3. 구체적 시각 장면 묘사 (예: "blue thermal hot spring Beppu", "zen garden autumn bridge Kanazawa")
4. 추상적 단어 금지: "beautiful", "amazing", "travel", "tourism", "famous"
5. 가로 방향 사진에 적합한 키워드 (풍경, 파노라마, 건축물 외관)

입력 형식: index|이름|설명|나라/지역|카테고리

${inputList}

출력 (JSON 배열만):
[{"idx":0,"kw":["keyword1 with city","keyword2 with city"]},{"idx":1,"kw":["keyword1 with city","keyword2 with city"]}]`;

    try {
      const result = await model.generateContent(prompt);
      let text = result.response.text();
      // JSON 추출
      const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlock) text = codeBlock[1].trim();
      else {
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) text = jsonMatch[0];
        else text = text.trim();
      }

      const parsed = JSON.parse(text);

      for (const item of parsed) {
        const attraction = batch[item.idx];
        if (attraction) {
          allResults.push({
            id: attraction.id,
            keywords: item.kw || [`${attraction.region} landmark`],
          });
        }
      }
    } catch (err) {
      console.warn(`  ⚠ Gemini 배치 ${batchNum} 실패:`, err.message);
      // fallback: 기본 키워드
      for (const a of batch) {
        allResults.push({
          id: a.id,
          keywords: [`${a.region || a.country} ${a.category || 'sightseeing'} landmark`],
        });
      }
    }

    // 배치 간 1초 대기
    if (i + BATCH_SIZE < attractions.length) {
      await sleep(1000);
    }
  }

  return allResults;
}

// ── Phase 2: Pexels 사진 검색 ──────────────────────────────

async function searchPexels(keyword, perPage = 15) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&per_page=${perPage}&orientation=landscape`;
  const res = await fetch(url, {
    headers: { Authorization: PEXELS_KEY },
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error('RATE_LIMIT');
    throw new Error(`Pexels ${res.status}`);
  }

  const data = await res.json();
  return (data.photos || []).filter(scorePhoto);
}

async function findPhotosForAttraction(attractionName, keywords, region, category) {
  const MIN_PHOTOS = 3;

  // 1차: keywords[0]
  if (keywords[0]) {
    try {
      const photos = await searchPexels(keywords[0]);
      if (photos.length >= MIN_PHOTOS) {
        return { photos: photos.slice(0, 5), source: 'kw0' };
      }
    } catch (e) {
      if (e.message === 'RATE_LIMIT') throw e;
    }
    await sleep(1100);
  }

  // 2차: keywords[1]
  if (keywords[1]) {
    try {
      const photos = await searchPexels(keywords[1]);
      if (photos.length >= MIN_PHOTOS) {
        return { photos: photos.slice(0, 5), source: 'kw1' };
      }
    } catch (e) {
      if (e.message === 'RATE_LIMIT') throw e;
    }
    await sleep(1100);
  }

  // 3차: fallback
  const fallbackKw = `${region || ''} ${category || 'landmark'} scenic`.trim();
  try {
    const photos = await searchPexels(fallbackKw);
    if (photos.length > 0) {
      return { photos: photos.slice(0, 5), source: 'fallback' };
    }
  } catch (e) {
    if (e.message === 'RATE_LIMIT') throw e;
  }

  return { photos: [], source: 'none' };
}

// ── Phase 3: DB 저장 ───────────────────────────────────────

async function savePhotos(attractionId, photos) {
  const photoData = photos.map(p => ({
    pexels_id: p.id,
    src_medium: p.src.medium,
    src_large: p.src.large2x,
    photographer: p.photographer,
    alt: '',
  }));

  const { error } = await sb
    .from('attractions')
    .update({ photos: photoData })
    .eq('id', attractionId);

  if (error) throw new Error(`DB 저장 실패: ${error.message}`);
  return photoData.length;
}

// ── 유틸 ───────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 메인 ───────────────────────────────────────────────────

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log('  관광지 Pexels 사진 일괄 생성');
  console.log(`  옵션: ${FORCE ? '--force (덮어쓰기)' : '사진 없는 것만'} / limit: ${LIMIT === 99999 ? '전체' : LIMIT}`);
  console.log('══════════════════════════════════════════════\n');

  if (!PEXELS_KEY) {
    console.error('❌ PEXELS_API_KEY 미설정');
    process.exit(1);
  }

  // 관광지 조회
  let query = sb
    .from('attractions')
    .select('id, name, short_desc, long_desc, country, region, category, photos')
    .order('name');

  if (!FORCE) {
    query = query.or('photos.is.null,photos.eq.[]');
  }

  const { data: attractions, error: fetchErr } = await query.limit(LIMIT);

  if (fetchErr) {
    console.error('❌ 관광지 조회 실패:', fetchErr.message);
    process.exit(1);
  }

  console.log(`📋 처리 대상: ${attractions.length}개 관광지\n`);

  if (attractions.length === 0) {
    console.log('✅ 모든 관광지에 사진이 있습니다.');
    return;
  }

  // Phase 1: Gemini 키워드 생성
  const keywordMap = await generateKeywordsBatch(attractions);
  const keywordById = new Map(keywordMap.map(k => [k.id, k.keywords]));

  console.log(`\n✅ Phase 1 완료: ${keywordMap.length}개 키워드 생성\n`);

  // Phase 2 + 3: Pexels 검색 + DB 저장
  const failed = [];
  let successCount = 0;
  let totalPhotos = 0;

  for (let i = 0; i < attractions.length; i++) {
    const a = attractions[i];
    const keywords = keywordById.get(a.id) || [`${a.region} landmark`];
    const progress = `[${i + 1}/${attractions.length}]`;

    try {
      const { photos, source } = await findPhotosForAttraction(
        a.name, keywords, a.region, a.category
      );

      if (photos.length === 0) {
        console.log(`${progress} ${a.name} ✗ 0장`);
        failed.push({ id: a.id, name: a.name, country: a.country, region: a.region, keywords });
      } else {
        const saved = await savePhotos(a.id, photos);
        totalPhotos += saved;
        successCount++;
        console.log(`${progress} ${a.name} ✓ ${saved}장 (${source})`);
      }
    } catch (err) {
      if (err.message === 'RATE_LIMIT') {
        console.log('\n⏳ Rate limit — 60초 대기...');
        await sleep(60000);
        i--; // 재시도
        continue;
      }
      console.log(`${progress} ${a.name} ✗ 오류: ${err.message}`);
      failed.push({ id: a.id, name: a.name, error: err.message });
    }

    // 1초 간격
    await sleep(1100);
  }

  // 결과 요약
  console.log('\n══════════════════════════════════════════════');
  console.log(`  완료: ${successCount}/${attractions.length} 성공`);
  console.log(`  총 사진: ${totalPhotos}장`);
  console.log(`  실패: ${failed.length}건`);
  console.log('══════════════════════════════════════════════');

  if (failed.length > 0) {
    fs.writeFileSync('db/failed_attractions.json', JSON.stringify(failed, null, 2));
    console.log(`\n📄 실패 목록 저장: db/failed_attractions.json`);
  }

  // 최종 확인
  const { count: noPhoto } = await sb
    .from('attractions')
    .select('*', { count: 'exact', head: true })
    .or('photos.is.null,photos.eq.[]');
  console.log(`\n📊 사진 없는 관광지: ${noPhoto}개 남음`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
