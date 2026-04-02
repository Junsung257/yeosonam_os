/**
 * 상품 원문 텍스트 → AI 파서(parser.ts 로직)로 재파싱
 * 사용법: node db/reparse_with_ai.js "상품ID" "원문텍스트파일"
 * 또는: echo "원문" | node db/reparse_with_ai.js <product_id> -
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// parser.ts의 ITINERARY_PROMPT를 재현
const ITINERARY_PROMPT = `당신은 한국 여행사 패키지 상품의 일정표를 정밀 파싱하는 전문가입니다.
아래 원문을 분석하여 TravelItinerary JSON을 반환하세요. JSON만 출력. 다른 텍스트 절대 금지.

## 파싱 규칙
1. 각 "제N일" 또는 "N일" 블록을 하나의 day로 분리
2. schedule 항목: ▶ 또는 ❥ 기호로 시작하는 관광지/활동을 추출
3. type 분류: flight(항공편), golf(골프), shopping(쇼핑), optional(선택관광), normal(일반)
4. transport: BX, 7C 등 항공편 코드 추출
5. meals: 조:, 중:, 석: 패턴으로 식사 파싱. 불포함이면 false, 포함이면 true + note
6. hotel: "HOTEL:" 또는 "호텔:" 패턴으로 호텔명+등급 추출
7. 비고/주의사항: notices_parsed로 4카테고리 분류 (CRITICAL/PAYMENT/POLICY/INFO)
8. 원문 텍스트를 절대 변형하지 말 것. 있는 그대로 파싱.
9. 원문에 없는 정보를 추가하지 말 것.

## 출력 스키마
{
  "meta": {
    "title": "상품명",
    "product_type": "품격|노팁노옵션",
    "destination": "토야마",
    "nights": 3,
    "days": 4,
    "departure_airport": "김해공항",
    "airline": "BX",
    "flight_out": "BX1625",
    "flight_in": "BX1615"
  },
  "highlights": {
    "inclusions": ["포함사항1", "포함사항2"],
    "excludes": ["불포함1"],
    "shopping": null,
    "remarks": ["비고사항1"]
  },
  "days": [
    {
      "day": 1,
      "regions": ["부산", "토야마"],
      "meals": {
        "breakfast": false,
        "lunch": true,
        "lunch_note": "현지식",
        "dinner": true,
        "dinner_note": "호텔식"
      },
      "schedule": [
        { "time": "09:00", "activity": "김해국제공항 출발", "type": "flight", "transport": "BX1625", "note": null, "badge": null },
        { "time": "10:30", "activity": "토야마공항 도착", "type": "normal", "transport": null, "note": null, "badge": null }
      ],
      "hotel": { "name": "타오야와쿠라 호텔", "grade": "4", "note": "2인1실" }
    }
  ],
  "optional_tours": []
}

식사 규칙:
- "조:호텔식" → breakfast: true, breakfast_note: "호텔식"
- "중:불포함" → lunch: false
- "석:호텔식" → dinner: true, dinner_note: "호텔식" (원문 그대로, 임의 추가 금지)
- 원문에 조식 언급 없으면 breakfast 필드 자체를 false로

호텔 규칙:
- "HOTEL: 타오야와쿠라 호텔 (2인1실)" → name: "타오야와쿠라 호텔", note: "2인1실"
- 호텔 혜택(오션뷰, 노미호다이 등)은 note에 포함
- "상동" → 이전 DAY의 호텔명 복사`;

/**
 * notices_parsed 4카테고리 자동 분류
 * CRITICAL: 여권, 비자, 건강 관련
 * PAYMENT: 결제, 입금, 잔금, 환불
 * POLICY: 취소, 변경, 약관, 수수료
 * INFO: 기타 안내사항
 */
function classifyNotices(remarks) {
  if (!Array.isArray(remarks) || remarks.length === 0) return [];

  const CRITICAL_KEYWORDS = ['여권', '비자', 'visa', '만료일', '예방접종', '건강', '임산부', '약물', '심장', '고혈압', '지병'];
  const PAYMENT_KEYWORDS = ['입금', '잔금', '결제', '계좌', '송금', '환불', '보증금', '예약금', '카드'];
  const POLICY_KEYWORDS = ['취소', '변경', '수수료', '위약금', '약관', '패널티', '환불규정', '불참'];

  const notices = [];
  for (const text of remarks) {
    if (!text || typeof text !== 'string') continue;
    const lower = text.toLowerCase();

    let type = 'INFO';
    if (CRITICAL_KEYWORDS.some(kw => lower.includes(kw))) {
      type = 'CRITICAL';
    } else if (PAYMENT_KEYWORDS.some(kw => lower.includes(kw))) {
      type = 'PAYMENT';
    } else if (POLICY_KEYWORDS.some(kw => lower.includes(kw))) {
      type = 'POLICY';
    }

    // 제목 자동 생성: 첫 20자 또는 첫 문장
    const title = text.length <= 30
      ? text
      : text.split(/[.。!\n]/)[0].slice(0, 30) + '…';

    notices.push({ type, title, text });
  }
  return notices;
}

/**
 * JSON 안전 파싱: Gemini 응답에서 JSON 추출 + 유효성 검증
 */
function safeParseJson(text) {
  // 1. 코드블록에서 추출
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) text = codeBlock[1].trim();
  else {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) text = jsonMatch[0];
    else text = text.trim();
  }

  try {
    return JSON.parse(text);
  } catch (e1) {
    // 후행 쉼표 제거 후 재시도
    try {
      const cleaned = text.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(cleaned);
    } catch (e2) {
      // 닫는 괄호 보충 후 재시도
      try {
        let fixed = text;
        const opens = (fixed.match(/\{/g) || []).length;
        const closes = (fixed.match(/\}/g) || []).length;
        for (let i = 0; i < opens - closes; i++) fixed += '}';
        return JSON.parse(fixed);
      } catch (e3) {
        throw new Error(`JSON 파싱 실패: ${e1.message}\n원문 앞 200자: ${text.slice(0, 200)}`);
      }
    }
  }
}

async function reparseProduct(productId, rawText) {
  console.log('파싱 대상:', productId);
  console.log('원문 길이:', rawText.length, '자\n');

  const genAI = new GoogleGenerativeAI(env.GOOGLE_AI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.1 },
  });

  const prompt = ITINERARY_PROMPT + '\n\n=== 원문 ===\n' + rawText;

  console.log('Gemini 파싱 중...');
  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  // JSON 안전 파싱
  const parsed = safeParseJson(responseText);

  // itinerary_data가 배열이면 객체로 래핑 (정규화)
  let itineraryData = parsed;
  if (Array.isArray(parsed)) {
    console.warn('⚠ itinerary_data가 배열로 반환됨 → {days: [...]} 객체로 래핑');
    itineraryData = { meta: {}, highlights: {}, days: parsed, optional_tours: [] };
  }

  console.log('파싱 결과:');
  console.log('  days:', itineraryData.days?.length, '일');
  console.log('  meta:', JSON.stringify(itineraryData.meta || {}).slice(0, 100));

  // 식사 확인
  (itineraryData.days || []).forEach((d) => {
    const m = d.meals || {};
    console.log(`  DAY${d.day}: 조=${m.breakfast_note || (m.breakfast ? '포함' : '불포함')} | 중=${m.lunch_note || (m.lunch ? '포함' : '불포함')} | 석=${m.dinner_note || (m.dinner ? '포함' : '불포함')}`);
  });

  // notices_parsed 4카테고리 분류 생성
  const allRemarks = [
    ...(itineraryData.highlights?.remarks || []),
    ...(itineraryData.highlights?.inclusions || []).filter(s => typeof s === 'string' && s.includes('주의')),
  ];
  const noticesParsed = classifyNotices(allRemarks);
  console.log('  notices_parsed:', noticesParsed.length, '개 (CRITICAL:', noticesParsed.filter(n => n.type === 'CRITICAL').length, ')');

  // DB UPDATE
  const { error } = await sb.from('travel_packages').update({
    itinerary_data: itineraryData,
    raw_text: rawText,
    notices_parsed: noticesParsed,
    updated_at: new Date().toISOString(),
  }).eq('id', productId);

  if (error) {
    console.error('\nDB UPDATE 실패:', error.message);
  } else {
    console.log('\n✓ DB 업데이트 완료');
  }

  return itineraryData;
}

// 실행
const productId = process.argv[2];
const textFile = process.argv[3];

if (!productId) {
  console.log('사용법: node db/reparse_with_ai.js <product_id> <text_file>');
  console.log('  또는: echo "원문" | node db/reparse_with_ai.js <product_id> -');
  process.exit(1);
}

if (textFile === '-') {
  // stdin에서 읽기
  let input = '';
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => reparseProduct(productId, input).catch(e => {
    console.error('재파싱 실패:', e.message);
    process.exit(1);
  }));
} else if (textFile) {
  const rawText = fs.readFileSync(textFile, 'utf-8');
  reparseProduct(productId, rawText).catch(e => {
    console.error('재파싱 실패:', e.message);
    process.exit(1);
  });
} else {
  console.log('텍스트 파일 또는 stdin(-) 필수');
  process.exit(1);
}
