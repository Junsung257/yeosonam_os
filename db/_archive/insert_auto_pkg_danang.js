const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── 헬퍼 ──
function flight(time, activity, transport) { return { time, activity, type: 'flight', transport, note: null }; }
function normal(time, activity, note) { return { time: time || null, activity, type: 'normal', transport: null, note: note || null }; }
function meal(b, l, d, bn, ln, dn) {
  return { breakfast: b, lunch: l, dinner: d, breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null };
}

const COMMON = {
  country: '베트남',
  destination: '다낭/호이안',
  departure_airport: '부산(김해)',
  airline: 'BX(에어부산)',
  min_participants: 4,
  category: 'package',
  status: 'pending',
  filename: 'discord_auto_input',
  file_type: 'text',
  confidence: 1.0,
  duration: 5, 
  nights: 3,
  departure_days: '매일운항',
};

const PKG_LIGHT = {
  ...COMMON,
  title: '[BX] 다낭/호이안 노팁/노옵션 3박5일 라이트 (더투어)',
  product_type: '라이트',
  trip_style: '3박5일',
  price: 729000,
  guide_tip: '포함 (노팁)',
  single_supplement: '13만원',
  inclusions: [
    '국제선항공료, 각종 TAX, 유류할증료(4월)',
    '호텔(2인1실), 일정표상의 식사, 차량, 생수, 1억원 여행자보험',
    '기사/가이드 경비 (노팁/노옵션)',
    '호이안 구시가지, 코코넛 빌리지 바구니배(망고도시락, 콩까페)',
    '호이안 야경투어(소원등,쪽배), 바나산 케이블카+골든브릿지',
    '다낭 시내관광 (대성당, 링엄사, 마블마운틴), 한강유람선 야경',
    '전신마사지 120분 체험(팁별도)',
    '바나산 정산 뷔페, 씨푸드세트식(랍스터 1/2 포함)'
  ],
  excludes: [
    '개인경비, 매너팁',
    '베트남 공휴일(4/26~5/1, 9/1~9/2) 룸당박당 3만원',
    '불꽃놀이기간(5/30~7/11 간헐적) 써차지 박당룸당 3만원',
    '마사지 팁 별도',
    '싱글차지 전일정 13만원'
  ],
  special_notes: '쇼핑: 노니&침향, 잡화, 커피 3곳 방문\n싱글차지 13만원\n전자담배 반입 불가능',
  product_highlights: [
    '다낭/호이안 3박5일 노팁/노옵션',
    '바나산 국립공원+골든브릿지',
    '호이안 바구니배 + 야경투어(소원등)',
    '전신마사지 120분 포함',
    '바나산 뷔페 + 랍스터 씨푸드 세트',
  ],
  product_summary: '에어부산 직항 다낭/호이안 3박5일 라이트 패키지. 노팁/노옵션으로 부담 없는 여행. 특급 호텔 숙박 및 바나산 국립공원, 호이안 야경투어 완벽 포함. 전신마사지 120분과 랍스터 씨푸드 식사 제공.',
  product_tags: ['베트남', '다낭', '호이안', '바나산', '골든브릿지', '다낭대성당', '마사지', '노팁노옵션', '에어부산'],
  accommodations: ['알란씨 또는 나로드 동급 [준5성급]'],
  notices_parsed: [
    '전자담배 반입 불가능합니다. [위반시 벌금부과]',
    '패키지 일정 미참여시 패널티 인당 하루 $100 발생합니다.',
  ],
  price_tiers: [
    { period_label: '5/1~7/14', departure_day_of_week: '일,월,화,토', adult_price: 729000, status: 'available' },
    { period_label: '5/1~7/14', departure_day_of_week: '수,목,금', adult_price: 779000, status: 'available' },
  ],
  itinerary: [
    'DAY1: 부산→다낭 | BX773 20:50-23:50 | 호텔 휴식 | 알란씨(준5성)',
    'DAY2: 다낭→호이안 | 마블마운틴, 바구니배, 호이안 구시가지, 야경투어(소원등) | 알란씨(준5성)',
    'DAY3: 다낭 | 다낭대성당, 바나산 국립공원(골든브릿지), 바나산 뷔페 | 알란씨(준5성)',
    'DAY4: 다낭 | 쇼핑, 링엄사, 전신마사지120분, 한강유람선, 씨푸드(랍스터)',
    'DAY5: 다낭→부산 | BX774 00:45-07:20 | 공항 해산',
  ],
  itinerary_data: {
    meta: {
      title: '[BX] 다낭/호이안 노팁/노옵션 3박5일 라이트 (더투어)',
      product_type: '라이트', destination: '다낭/호이안',
      nights: 3, days: 5, departure_airport: '부산(김해)',
      airline: 'BX(에어부산)', flight_out: 'BX773', flight_in: 'BX774',
      departure_days: '매일', min_participants: 4, room_type: '2인 1실', brand: '여소남',
    },
    days: [
      {
        day: 1, regions: ['부산', '다낭'], meals: meal(false, false, false),
        schedule: [
          flight('20:50', '부산 김해국제공항 출발', 'BX773'),
          flight('23:50', '다낭 국제 공항 도착 후 입국수속 및 가이드 미팅', 'BX773'),
          normal(null, '호텔 체크인 및 휴식')
        ],
        hotel: { name: '알란씨 또는 나로드 동급', grade: '준5성', note: null }
      },
      {
        day: 2, regions: ['다낭', '호이안', '다낭'], meals: meal(true, true, true, '호텔식', '쌀국수+반세오', '호이안 전통식'),
        schedule: [
          normal(null, '호텔 조식 후 마블 마운틴(대리석산) 관광'),
          normal(null, '코코넛 빌리지 바구니배 체험', '팁별도, 망고도시락 제공'),
          normal(null, '호이안 올드타운 구시가지 관광', '풍흥의 집, 안호이교 등'),
          normal(null, '호이안 올드타운 내 자유시간', '콩까페 코코넛 커피 제공'),
          normal(null, '호이안 야경투어 탐방, 소원등 & 쪽배 탑승 포함'),
          normal(null, '석식 후 다낭 귀환 및 휴식')
        ],
        hotel: { name: '알란씨 또는 나로드 동급', grade: '준5성', note: null }
      },
      {
        day: 3, regions: ['다낭'], meals: meal(true, true, true, '호텔식', '현지식', '바나힐 비어플라자(뷔페식)'),
        schedule: [
          normal(null, '호텔 조식 후 다낭대성당(핑크성당) 관광'),
          normal(null, '바나산 국립공원 관광', '케이블카+골든브릿지'),
          normal(null, '바나산 정상 레스토랑에서 저녁식사'),
          normal(null, '하산하여 라낭 귀환 후 휴식')
        ],
        hotel: { name: '알란씨 또는 나로드 동급', grade: '준5성', note: null }
      },
      {
        day: 4, regions: ['다낭'], meals: meal(true, true, true, '호텔식', '샤브샤브', '씨푸드세트(랍스터1/2)'),
        schedule: [
          normal(null, '호텔 조식 및 쇼핑 센터 방문'),
          normal(null, '비밀의 사원 쓰여진 링엄사 (해수관음상) 관광'),
          normal(null, '전신맛사지 120분 체험', '팁별도'),
          normal(null, '다낭의 야경을 감상하는 한강유람선 탑승'),
          normal(null, '석식 후 다낭 국제공항으로 이동')
        ],
        hotel: null
      },
      {
        day: 5, regions: ['다낭', '부산'], meals: meal(false, false, false),
        schedule: [
          flight('00:45', '다낭 국제공항 출발', 'BX774'),
          flight('07:20', '부산 김해 국제 공항 도착 후 해산', 'BX774')
        ],
        hotel: null
      }
    ]
  }
};

const PKG_PREMIUM = JSON.parse(JSON.stringify(PKG_LIGHT));
PKG_PREMIUM.title = '[BX] 다낭/호이안 노팁/노옵션 3박5일 품격 (더투어)';
PKG_PREMIUM.product_type = '품격';
PKG_PREMIUM.price = 789000;
PKG_PREMIUM.single_supplement = '18만원';
PKG_PREMIUM.accommodations = ['멜리아빈펄 또는 래디슨 동급 [5성]'];
PKG_PREMIUM.product_summary = '에어부산 직항 다낭/호이안 3박5일 품격 패키지. 노팁/노옵션에 정5성급 호텔 숙박. 120분 전신마사지에 발마사지 90분이 추가로 제공됩니다. 랍스터 씨푸드와 바나힐 필수 포함상품.';
PKG_PREMIUM.inclusions = [
 ...PKG_LIGHT.inclusions,
 '<품격특전> 객실당 과일바구니 1개, 발맛사지 90분 추가, 정5성 호텔'
];
PKG_PREMIUM.product_highlights = [
  '정5성급 호텔 숙박 (멜리아빈펄 등)',
  '발마사지 90분 + 전신마사지 120분',
  '바나산 국립공원+골든브릿지',
  '호이안 바구니배 + 야경투어',
  '바나산 뷔페 + 랍스터 씨푸드',
];
PKG_PREMIUM.itinerary_data.meta.title = PKG_PREMIUM.title;
PKG_PREMIUM.itinerary_data.meta.product_type = '품격';
PKG_PREMIUM.price_tiers = [
  { period_label: '5/1~7/14', departure_day_of_week: '일,월,화,토', adult_price: 789000, status: 'available' },
  { period_label: '5/1~7/14', departure_day_of_week: '수,목,금', adult_price: 839000, status: 'available' },
];

// Update Days Hotels for Premium
PKG_PREMIUM.itinerary_data.days[0].hotel = { name: '멜리아빈펄 또는 래디슨 동급', grade: '5성', note: null };
PKG_PREMIUM.itinerary_data.days[1].hotel = { name: '멜리아빈펄 또는 래디슨 동급', grade: '5성', note: null };
PKG_PREMIUM.itinerary_data.days[2].hotel = { name: '멜리아빈펄 또는 래디슨 동급', grade: '5성', note: null };
// Add Bal Massage to Day 3
PKG_PREMIUM.itinerary_data.days[2].schedule.unshift(normal(null, '발맛사지 90분 체험', '팁별도'));

const ALL_PACKAGES = [PKG_LIGHT, PKG_PREMIUM];

async function main() {
  console.log(`📦 다낭 자동 등록: ${ALL_PACKAGES.length}개 상품...`);
  const { data, error } = await sb.from('travel_packages').insert(ALL_PACKAGES).select('id, title, status, price');
  if (error) { console.error('❌ 등록 실패:', error.message); process.exit(1); }
  console.log(`✅ ${data.length}개 자동 등록 완벽 처리 완료!\n`);
}
main();
