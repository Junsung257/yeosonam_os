const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createHash } = require('crypto');

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k,...v] = l.split('='); if(k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const PRODUCT_ID = 'd30abb93-25d9-4ff0-a411-23791c7f6543';

const PARSE_PROMPT = `당신은 여행 상품 데이터 파서입니다.
아래 원문을 분석해 JSON으로만 출력하세요. 다른 텍스트 절대 금지.

=== 원문 ===
{RAW_TEXT}

=== 출력 스키마 ===
{
  "destination": "나트랑/달랏",
  "country": "베트남",
  "nights": 3,
  "days": 5,
  "departure_date": "4/20",
  "deadline": "3/30",
  "seats_left": 2,
  "base_price": 489000,
  "min_people": 6,
  "hotel_stars": 5,
  "hotels": ["호라이즌", "멀펄 달랏"],
  "no_tip": true,
  "no_option": true,
  "special_gifts": ["과일도시락 1팩/룸"],
  "meals": {
    "korean": ["제육쌈밥", "무한대삼겹이", "소부고기전골"],
    "local": ["분짜", "반쎄오", "스프링롤"]
  },
  "highlights": [
    { "name": "달빗산 전망대", "hook": "해발 1900m 직행", "day": 3, "visual_score": 9 }
  ],
  "itinerary": [
    { "day": 2, "regions": ["나트랑","달랏"], "key_points": ["포나가르탑","침향탑사"] }
  ],
  "urgency_level": "high",
  "destination_type": "동남아단거리",
  "price_range": "50만미만"
}

urgency_level: high=잔여3석이하또는마감7일이내, mid=4-10석또는8-14일, low=그외
destination_type: 동남아+5박이하=동남아단거리, 동남아+6박이상=동남아장거리, 일본=일본, 유럽=유럽
price_range: <50만=50만미만, 50-100만=50-100만, >=100만=100만이상
visual_score: 이미지 임팩트 1~10`;

async function test() {
  const { data: pkg } = await sb.from('travel_packages')
    .select('id, title, destination, price, duration, itinerary, inclusions, excludes, product_highlights, product_summary, special_notes, product_type, airline, departure_airport')
    .eq('id', PRODUCT_ID)
    .single();

  if (!pkg) { console.error('상품 없음'); return; }

  const parts = [];
  if (pkg.title) parts.push('상품명: ' + pkg.title);
  if (pkg.destination) parts.push('목적지: ' + pkg.destination);
  if (pkg.price) parts.push('가격: ' + pkg.price + '원');
  if (pkg.duration) parts.push('기간: ' + pkg.duration + '일');
  if (pkg.airline) parts.push('항공사: ' + pkg.airline);
  if (pkg.departure_airport) parts.push('출발공항: ' + pkg.departure_airport);
  if (pkg.product_type) parts.push('상품유형: ' + pkg.product_type);
  if (pkg.product_summary) parts.push('요약: ' + pkg.product_summary);
  if (pkg.special_notes) parts.push('특이사항: ' + pkg.special_notes);
  if (pkg.inclusions && pkg.inclusions.length) parts.push('포함사항: ' + pkg.inclusions.join(', '));
  if (pkg.excludes && pkg.excludes.length) parts.push('불포함: ' + pkg.excludes.join(', '));
  if (pkg.product_highlights && pkg.product_highlights.length) parts.push('하이라이트: ' + pkg.product_highlights.join(', '));
  if (pkg.itinerary && pkg.itinerary.length) parts.push('일정: ' + pkg.itinerary.join(' / '));

  const rawText = parts.join('\n');
  console.log('=== 원문 (' + rawText.length + '자) ===');
  console.log(rawText.substring(0, 600) + '...\n');

  const apiKey = env.GOOGLE_AI_API_KEY;
  if (!apiKey) { console.error('GOOGLE_AI_API_KEY 없음'); return; }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0.2 } });

  const prompt = PARSE_PROMPT.replace('{RAW_TEXT}', rawText);
  console.log('Gemini 호출 중...');
  const result = await model.generateContent(prompt);
  let text = result.response.text();
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  const parsed = JSON.parse(text);
  console.log('=== 파싱 결과 JSON ===');
  console.log(JSON.stringify(parsed, null, 2));

  // DB 저장
  const hash = createHash('sha256').update(rawText).digest('hex').slice(0, 16);
  const { error: updateErr } = await sb.from('travel_packages').update({
    parsed_data: parsed,
    parsed_at: new Date().toISOString(),
    raw_text_hash: hash,
    country: parsed.country || null,
    nights: parsed.nights || null,
  }).eq('id', PRODUCT_ID);

  if (updateErr) console.error('DB 저장 실패:', updateErr.message);
  else console.log('\n=== DB 저장 완료 (parsed_data + country + nights) ===');
}

test().catch(e => console.error('Fatal:', e.message));
