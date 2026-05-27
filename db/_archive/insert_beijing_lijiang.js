/**
 * 북경-여강 (호도협객잔+샹그릴라+옥룡설산) 4박5일 패키지 등록
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── 헬퍼 ──
function flight(time, activity, transport) { return { time, activity, type: 'flight', transport, note: null }; }
function normal(time, activity, note) { return { time: time || null, activity, type: 'normal', transport: null, note: note || null }; }
function optional(time, activity, note) { return { time: time || null, activity, type: 'optional', transport: null, note: note || null }; }
function shopping(time, activity) { return { time: time || null, activity, type: 'shopping', transport: null, note: null }; }

const pkg = {
  title: '북경, 여강 (호도협객잔숙박+샹그릴라+옥룡설산) 4박 5일',
  destination: '북경/여강',
  country: '중국',
  category: 'package',
  product_type: null,
  trip_style: '4박5일',
  duration: 5,
  nights: 4,
  departure_airport: '부산(김해)',
  airline: 'CA(중국국제항공)',
  min_participants: 8,
  status: 'pending',
  price: 1399000,
  guide_tip: '$50/인(여강지불)',
  single_supplement: '130,000원',

  // ── 요금표 ──
  price_tiers: [
    {
      period_label: '5월 24,27,29일 / 6월 10,24일 / 9월 2,9,16일 / 10월 14,21,28일',
      departure_dates: [
        '2026-05-24', '2026-05-27', '2026-05-29',
        '2026-06-10', '2026-06-24',
        '2026-09-02', '2026-09-09', '2026-09-16',
        '2026-10-14', '2026-10-21', '2026-10-28',
      ],
      adult_price: 1399000,
      child_price: 1399000,
      status: 'available',
    },
    {
      period_label: '4월 13,20일',
      departure_dates: ['2026-04-13', '2026-04-20'],
      adult_price: 1449000,
      child_price: 1449000,
      status: 'available',
    },
  ],

  // ── 포함/불포함 ──
  inclusions: [
    '항공료', 'TAX', '유류비', '호텔', '차량', '가이드',
    '관광지입장료', '식사', '여행자보험',
  ],
  excludes: [
    '기사/가이드 경비 $50(여강지불)',
    '유류세 변동분',
    '기타개인경비',
  ],

  // ── 선택관광 ──
  optional_tours: [
    { name: '빙천케이블카', price_usd: 50, price_krw: null, note: '옥룡설산 최대 높이까지 등반' },
    { name: '인상여강쇼', price_usd: 30, price_krw: null, note: '옥룡설산 배경 마방들의 삶과 애환' },
    { name: '전신마사지', price_usd: 40, price_krw: null, note: null },
    { name: '여강고성나이트투어', price_usd: 30, price_krw: null, note: null },
  ],

  // ── 주의사항 ──
  notices_parsed: [
    '본 상품은 5억원 배상책임보험에 가입되어 있습니다.',
    '싱글차지는 13만원입니다.',
    '호도협객잔 숙박시 호도협전용차량(미니봉고)로 이동하므로, 1박숙박시 필요한 용품은 배낭에 준비하셔야합니다.',
    '송찬린사 입장시 짧은 반바지 치마, 민소매 불가합니다.',
    '여권유효기간은 6개월이상 반드시 남아 있어야 하며, 개인비자 소지시 사전에 안내바랍니다.',
  ],

  special_notes: '쇼핑: 보이차 또는 침향 쇼핑1회\n싱글차지 13만원\n호도협객잔 숙박시 미니봉고 이동, 배낭 준비 필수\n송찬린사 입장시 반바지/치마/민소매 불가\n여권유효기간 6개월 이상 필수',

  product_highlights: [
    '세계 3대 트레킹코스 호도협 객잔 숙박',
    '티벳문화 샹그릴라 고성 + 송찬린사',
    '옥룡설산 + 흑룡담공원 + 여강고성',
    '이화원(서태후 여름별궁) 관광',
    '북경 오리구이 석식',
  ],

  product_summary: '북경 이화원과 여강 옥룡설산, 호도협 객잔숙박, 샹그릴라 고성을 아우르는 4박5일 코스. 세계 3대 트레킹 호도협과 나시족 문화의 여강고성, 티벳문화의 송찬린사까지 중국 서남부 핵심 관광지를 모두 포함.',

  product_tags: ['호도협', '샹그릴라', '옥룡설산', '여강고성', '이화원', '트레킹', '객잔숙박'],

  // ── 일정표 (itinerary_data) ──
  itinerary_data: {
    meta: {
      title: '북경, 여강 (호도협객잔숙박+샹그릴라+옥룡설산) 4박 5일',
      product_type: null,
      destination: '북경/여강',
      nights: 4,
      days: 5,
      departure_airport: '부산(김해)',
      airline: 'CA(중국국제항공)',
      flight_out: 'CA130',
      flight_in: 'CA129',
      departure_days: null,
      min_participants: 8,
      room_type: '2인 1실',
      ticketing_deadline: null,
      hashtags: ['#호도협객잔', '#샹그릴라', '#옥룡설산', '#이화원', '#여강고성', '#흑룡담공원'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '항공료, TAX, 유류비, 호텔, 차량, 가이드, 관광지입장료, 식사, 여행자보험',
      ],
      excludes: [
        '기사/가이드 경비 $50(여강지불)',
        '유류세 변동분',
        '기타개인경비',
      ],
      shopping: '보이차 또는 침향 쇼핑1회',
      remarks: [
        '본 상품은 5억원 배상책임보험에 가입되어 있습니다.',
        '싱글차지는 13만원입니다.',
        '호도협객잔 숙박시 호도협전용차량(미니봉고)로 이동하므로, 1박숙박시 필요한 용품은 배낭에 준비하셔야합니다.',
        '송찬린사 입장시 짧은 반바지 치마, 민소매 불가합니다.',
        '여권유효기간은 6개월이상 반드시 남아 있어야 하며, 개인비자 소지시 사전에 안내바랍니다.',
        '상기 일정은 항공 및 현지 사정에 의하여 변동될 수 있습니다.',
      ],
    },
    days: [
      // ── DAY 1: 부산 → 북경 ──
      {
        day: 1,
        regions: ['부산', '북경'],
        meals: {
          breakfast: false, lunch: false, dinner: true,
          breakfast_note: null, lunch_note: null, dinner_note: '오리구이',
        },
        schedule: [
          flight('12:45', '부산 김해국제공항 출발', 'CA130'),
          flight('14:10', '북경 수도국제공항 도착 후 가이드 미팅', 'CA130'),
          normal(null, '중국 황실의 여름 별궁이자 서태후 여름 별장인 이화원 관광'),
          normal(null, '석식 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '복영국제호텔 / 로얄호텔 / 국문데이즈 또는 동급', grade: '준5성', note: null },
      },
      // ── DAY 2: 북경 → 여강 → 호도협 ──
      {
        day: 2,
        regions: ['북경', '여강', '호도협'],
        meals: {
          breakfast: true, lunch: true, dinner: true,
          breakfast_note: '도시락', lunch_note: '현지식', dinner_note: '현지식',
        },
        schedule: [
          normal(null, '호텔 체크아웃 후 공항으로 이동'),
          flight('07:00', '북경 출발', 'CA1469'),
          flight('10:50', '여강 도착 후 가이드 미팅', 'CA1469'),
          normal(null, '중식 후 호도협으로 이동 (약 2시간)'),
          normal(null, '세계 3대 트레킹코스로 손꼽히는 호도협 매력을 느낄 수 있는 호도협전망대'),
          normal(null, '호도협전용버스(봉고)로 이동'),
          normal(null, '중도객잔-차마객잔 트래킹 (약 2시간)'),
          normal(null, '석식 후 객잔 휴식'),
        ],
        hotel: { name: '호도협 객잔', grade: null, note: '숙박' },
      },
      // ── DAY 3: 호도협 → 샹그릴라 → 여강 ──
      {
        day: 3,
        regions: ['호도협', '샹그릴라', '여강'],
        meals: {
          breakfast: true, lunch: true, dinner: true,
          breakfast_note: '객잔식', lunch_note: '현지식', dinner_note: '현지식',
        },
        schedule: [
          normal(null, '객잔 조식 후 호도협전용버스(봉고)로 주차장 이동'),
          normal(null, '샹그릴라(중전)으로 이동 (약 2시간)'),
          normal(null, '티벳문화가 고스란히 베여있는 샹그릴라 고성'),
          normal(null, '1679년 건립된 역사깊은 사원 송찬린사'),
          normal(null, '소수민족 장족의 문화를 체험해볼 수 있는 장족민가 (수유차, 칭커빵 시식)'),
          normal(null, '4면이 산으로 둘러쌓인 호수 나파해'),
          normal(null, '여강으로 이동'),
          normal(null, '옥룡설산의 만년설이 흘러내려 만들어진 호수 흑룡담공원'),
          normal(null, '여강고성 관광'),
          normal(null, '석식 후 호텔 투숙'),
        ],
        hotel: { name: '여강관방호텔화원별장 또는 동급', grade: '준5성', note: null },
      },
      // ── DAY 4: 여강 → 북경 ──
      {
        day: 4,
        regions: ['여강', '북경'],
        meals: {
          breakfast: true, lunch: true, dinner: true,
          breakfast_note: '호텔식', lunch_note: '설산 현지식', dinner_note: '한식',
        },
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '아름다운 산세가 마치 옥으로 용을 깎아 놓은 듯한 옥룡설산'),
          optional(null, '★ 빙천세계 케이블카 $50 - 옥룡설산 최대 높이까지 올라가는 빙천세계케이블카', '강력추천옵션'),
          normal(null, '만년설이 녹아 만든 에메랄드빛 호수 람월곡'),
          normal(null, '나시족전통문화를 볼 수 있는 옥수채'),
          optional(null, '★ 인상여강쇼 $30 - 옥룡설산을 배경으로 한 마방들의 삶과 애환을 표현한 인상여강쇼', '강력추천옵션'),
          normal(null, '석식 후 공항으로 이동'),
          flight('21:30', '여강 출발', 'CA1460'),
          flight('01:10', '북경 도착 (익일)', 'CA1460'),
        ],
        hotel: { name: '복영국제호텔 / 로얄호텔 / 국문데이즈 또는 동급', grade: '준5성', note: null },
      },
      // ── DAY 5: 북경 → 부산 ──
      {
        day: 5,
        regions: ['북경', '부산'],
        meals: {
          breakfast: true, lunch: false, dinner: false,
          breakfast_note: '호텔식(도시락)', lunch_note: null, dinner_note: null,
        },
        schedule: [
          normal(null, '호텔 조식(도시락) 후 공항으로 이동'),
          flight('08:25', '북경 수도국제공항 출발', 'CA129'),
          flight('11:45', '부산 김해국제공항 도착', 'CA129'),
        ],
        hotel: null,
      },
    ],
    optional_tours: [
      { name: '빙천케이블카', price_usd: 50, price_krw: null, note: '옥룡설산 최대 높이까지 등반' },
      { name: '인상여강쇼', price_usd: 30, price_krw: null, note: '옥룡설산 배경 마방들의 삶과 애환' },
      { name: '전신마사지', price_usd: 40, price_krw: null, note: null },
      { name: '여강고성나이트투어', price_usd: 30, price_krw: null, note: null },
    ],
  },

  // ── 레거시 일정 텍스트 ──
  itinerary: [
    'DAY1: 부산→북경 | CA130 12:45-14:10 | 이화원 | 석식(오리구이) | 복영국제호텔/로얄호텔/국문데이즈(준5성)',
    'DAY2: 북경→여강→호도협 | CA1469 07:00-10:50 | 호도협전망대 | 중도객잔-차마객잔 트래킹(2시간) | 호도협객잔',
    'DAY3: 호도협→샹그릴라→여강 | 샹그릴라고성, 송찬린사, 장족민가, 나파해 | 흑룡담공원, 여강고성 | 여강관방호텔화원별장(준5성)',
    'DAY4: 여강→북경 | 옥룡설산, 람월곡, 옥수채 | CA1460 21:30-01:10+1 | 복영국제호텔/로얄호텔/국문데이즈(준5성)',
    'DAY5: 북경→부산 | CA129 08:25-11:45',
  ],

  accommodations: [
    '복영국제호텔 / 로얄호텔 / 국문데이즈 또는 동급 (준5성)',
    '호도협 객잔',
    '여강관방호텔화원별장 또는 동급 (준5성)',
  ],

  // ── 원문 보존 ──
  raw_text: `북경, 여강 (호도협객잔숙박+샹그릴라+옥룡설산) 4박 5일 PKG
출발일자: 26년 4월 ~ 10월
인원: 성인 8명이상 출발
판매가:
5월 24일(일), 27일(수), 29(금) ￦1,399,000/인
6월 10,24일(수) / 9월 2,9,16일(수) / 10월 14,21,28일(수) ￦1,399,000/인
4월 13일(월), 20일(월) ￦1,449,000/인
포함사항: 항공료, TAX, 유류비, 호텔, 차량, 가이드, 관광지입장료, 식사, 여행자보험
불포함사항: 기사/가이드 경비$50(여강지불), 유류세 변동분, 기타개인경비
쇼핑: 보이차 또는 침향 쇼핑1회
선택관광: 빙천케이블카$50, 인상여강쇼$30, 전신마사지$40, 여강고성나이트투어$30
기타사항:
- 본 상품은 5억원 배상책임보험에 가입되어 있습니다.
- 싱글차지는 13만원입니다.
- 호도협객잔 숙박시 호도협전용차량(미니봉고)로 이동하므로, 1박숙박시 필요한 용품은 배낭에 준비하셔야합니다.
- 송찬린사 입장시 짧은 반바지 치마, 민소매 불가합니다.
- 여권유효기간은 6개월이상 반드시 남아 있어야 하며, 개인비자 소지시 사전에 안내바랍니다.`,

  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
};

async function main() {
  console.log('📦 북경-여강 4박5일 패키지 등록 시작...');

  const { data, error } = await sb
    .from('travel_packages')
    .insert([{
      title: pkg.title,
      destination: pkg.destination,
      country: pkg.country,
      category: pkg.category,
      product_type: pkg.product_type,
      trip_style: pkg.trip_style,
      duration: pkg.duration,
      nights: pkg.nights,
      departure_airport: pkg.departure_airport,
      airline: pkg.airline,
      min_participants: pkg.min_participants,
      status: pkg.status,
      price: pkg.price,
      guide_tip: pkg.guide_tip,
      single_supplement: pkg.single_supplement,
      price_tiers: pkg.price_tiers,
      inclusions: pkg.inclusions,
      excludes: pkg.excludes,
      optional_tours: pkg.optional_tours,
      notices_parsed: pkg.notices_parsed,
      special_notes: pkg.special_notes,
      product_highlights: pkg.product_highlights,
      product_summary: pkg.product_summary,
      product_tags: pkg.product_tags,
      itinerary_data: pkg.itinerary_data,
      itinerary: pkg.itinerary,
      accommodations: pkg.accommodations,
      raw_text: pkg.raw_text,
      filename: pkg.filename,
      file_type: pkg.file_type,
      confidence: pkg.confidence,
    }])
    .select('id, title, status');

  if (error) {
    console.error('❌ 등록 실패:', error.message);
    process.exit(1);
  }

  console.log('✅ 등록 완료!');
  console.log('   ID:', data[0].id);
  console.log('   제목:', data[0].title);
  console.log('   상태:', data[0].status);
}

main();
