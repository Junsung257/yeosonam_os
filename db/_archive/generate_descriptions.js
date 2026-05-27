/**
 * attractions short_desc + long_desc 일괄 생성 스크립트
 * Gemini 2.5 Flash 사용, 배치 20개씩 처리
 * 정확한 사실 기반 생성 (hallucination 방지 프롬프트)
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

const BATCH_SIZE = 20;
const DELAY_MS = 2000; // rate limit 방지

const SYSTEM_PROMPT = `당신은 전문 여행 가이드 작가입니다. 관광지 설명을 생성합니다.

## 규칙
1. **정확한 사실만 작성**: 확실하지 않은 정보(연도, 높이, 크기 등)는 생략. 틀린 정보보다 없는 정보가 낫다.
2. **short_desc**: 15~25자 내외의 한 줄 캐치프레이즈. 감성적이되 사실 기반.
3. **long_desc**: 3~5문장. 위치, 특징, 하이라이트를 포함. 여행자에게 유용한 정보 중심.
4. **badge_type 반영**:
   - tour/sightseeing: 관광지 매력 포인트
   - special: 특별 체험의 핵심 포인트
   - shopping: 주요 브랜드/품목, 면세 혜택
   - meal: 대표 메뉴, 맛 특징
   - golf: 코스 특징, 난이도
   - hotel: 등급, 위치, 시설 하이라이트
   - onsen: 수질, 효능, 분위기
   - activity: 체험 내용, 소요시간
5. **금지**: 가격 정보, 예약 권유, 과장된 최상급 표현("최고의", "세계 최대" 등은 사실인 경우만)
6. 모르는 관광지는 name, country, region, category 정보만으로 일반적인 설명 작성. 추측하지 말 것.

## 출력 형식
반드시 JSON 배열로만 응답. 다른 텍스트 없이.
[
  { "id": "uuid", "short_desc": "...", "long_desc": "..." },
  ...
]`;

async function fetchNullAttractions() {
  const all = [];
  let from = 0;
  const PAGE = 500;

  while (true) {
    const { data, error } = await supabase
      .from('attractions')
      .select('id, name, country, region, category, badge_type, emoji')
      .or('short_desc.is.null,long_desc.is.null')
      .range(from, from + PAGE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return all;
}

async function generateBatch(batch, retryCount = 0) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.3, // 낮은 temperature = 더 사실적
      responseMimeType: 'application/json',
    }
  });

  const userPrompt = `다음 관광지들의 short_desc와 long_desc를 생성해주세요:\n\n${JSON.stringify(batch, null, 2)}`;

  try {
    const result = await model.generateContent([
      { role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + userPrompt }] }
    ]);
    const text = result.response.text();

    // JSON 파싱
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) throw new Error('Response is not an array');
    return parsed;
  } catch (err) {
    if (retryCount < 2) {
      console.log(`  ⚠️ 배치 재시도 (${retryCount + 1}/2): ${err.message}`);
      await sleep(3000);
      return generateBatch(batch, retryCount + 1);
    }
    console.error(`  ❌ 배치 실패 (스킵):`, err.message);
    return null;
  }
}

async function updateDB(results) {
  let updated = 0;
  for (const item of results) {
    if (!item.id || !item.short_desc) continue;

    const { error } = await supabase
      .from('attractions')
      .update({
        short_desc: item.short_desc,
        long_desc: item.long_desc
      })
      .eq('id', item.id);

    if (error) {
      console.error(`  DB 에러 (${item.id}):`, error.message);
    } else {
      updated++;
    }
  }
  return updated;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🔍 null 설명 관광지 조회 중...');
  const attractions = await fetchNullAttractions();
  console.log(`📊 총 ${attractions.length}개 관광지 처리 대상\n`);

  if (attractions.length === 0) {
    console.log('✅ 처리할 항목 없음');
    return;
  }

  let totalUpdated = 0;
  let totalBatches = Math.ceil(attractions.length / BATCH_SIZE);

  for (let i = 0; i < attractions.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = attractions.slice(i, i + BATCH_SIZE);

    console.log(`[${batchNum}/${totalBatches}] ${batch.length}개 생성 중... (${batch[0].country} ${batch[0].name} ~)`);

    const results = await generateBatch(batch);

    if (results) {
      const updated = await updateDB(results);
      totalUpdated += updated;
      console.log(`  ✅ ${updated}개 DB 업데이트 완료`);
    }

    // Rate limit 방지
    if (i + BATCH_SIZE < attractions.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n🎉 완료! 총 ${totalUpdated}/${attractions.length}개 업데이트`);
}

main().catch(console.error);
