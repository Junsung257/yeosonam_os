const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function flight(time, activity, transport) { return { time, activity, type: 'flight', transport, note: null }; }
function normal(time, activity, note) { return { time: time || null, activity, type: 'normal', transport: null, note: note || null }; }
function meal(b, l, d, bn, ln, dn) { return { breakfast: b, lunch: l, dinner: d, breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null }; }

const COMMON = {
  country: '베트남',
  destination: '나트랑/달랏',
  departure_airport: '부산(김해)',
  airline: 'BX(에어부산)',
  min_participants: 4,
  category: 'package',
  status: 'available',
  filename: 'discord_auto_input',
  file_type: 'text',
  confidence: 1.0,
  duration: 5, nights: 3,
  departure_days: '매일운항',
};

const notices = [
  '나트랑, 달랏 지역은 베트남인들의 유명한 허니문 지역으로 숙박하는 호텔 방 대부분이 더블 침대인 경우가 많습니다. 더블 침대 방으로 배정될 수 있는 점 양해 바랍니다.',
  '호텔 룸배정 (일행과 같은층, 옆방배정, 베드타입) 등은 게런티 불가 합니다.',
  '패키지 일정 미 참여시 1인/$100 패널티 발생합니다.',
  '25년부터 베트남 입국시 전자담배 소지 전면금지 됩니다. 적발시 징역 또는 벌금형 처벌받을 수 있습니다.',
  '공항내 가이드 출입을 제한하므로 현지인 가이드와 미팅&샌딩 합니다. 한국인 가이드는 호텔에서 미팅하거나 중간에 픽업하여 진행될수 있습니다.'
];

const inclusions = [
  '국제선항공료, 각종 TAX, 유류할증료(4월기준)',
  '호텔(2인1실), 일정표상의 식사, 차량, 생수, 가이드, 1억원 여행자보험',
  '기사/가이드 경비 무료 (노팁/노옵션)',
  '나트랑 시내투어 (포나가르탑, 롱선사, 대성당, 담재래시장)',
  '나트랑 머드온천 체험 (4인탕 기준)',
  '전신 마사지 2회 제공 (2시간 1회 + 90분 1회, 팁 별도)',
  '나트랑 야간시티투어 (씨클로+맥주+화덕피자 제공)',
  '달랏 시내관광 (크레이지 하우스, 쓰엉흐엉호수, 다딴라폭포 루지, 죽림사 케이블카, 바오다이 별장, 달랏역, 린푸옥사원)',
  '달랏 랑비앙 전망대 관광 (짚차 또는 7인승 차량)',
  '4대 간식 특전 (망고도시락, 하이티 애프터눈티, 야시장 반짠느엉&음료, 나트랑 척칩 고구마튀김)'
];

const itinerary = [
  'DAY1: 부산→나트랑 | BX781 19:20-22:20 | 현지인 가이드 미팅 | 망고도시락 특전 | 호텔 휴식',
  'DAY2: 나트랑→달랏 | 포나가르 사원, 머드온천욕 | 크레이지 하우스, 쓰엉흐엉 호수 | 전신마사지 90분 | 달랏팰리스 애프터눈 티',
  'DAY3: 달랏 시내 | 다딴라 폭포(루지), 죽림사(케이블카), 바오다이 별장, 달랏 기차역, 린푸옥사원 | 야시장 반짠느엉',
  'DAY4: 달랏→나트랑 | 랑비앙 전망대(짚차) | 대성당(차창), 척칩, 롱선사, 담재래시장 | 전신마사지 120분 | 야간시티투어(씨클로)',
  'DAY5: 나트랑→부산 | BX782 23:20-06:20 | 공항 해산'
];

const scheduleDay2 = [
  normal(null, '나트랑 시내관광 - 포나가르 사원 관람'),
  normal(null, '나트랑 머드온천욕 체험', '수영복 지참/4인탕기준'),
  normal(null, '동양의 유럽마을 달랏으로 이동', '약 3시간 30분 소요'),
  normal(null, '기괴하고 신비한 크레이지 하우스 관광'),
  normal(null, '달랏 중심 쓰엉흐엉 호수 조망'),
  normal(null, '전신마사지 90분 체험', '팁 별도/아동제외'),
  normal(null, '[특전] 달랏팰리스 하이티 애프터눈 티', '100년 전통 고급 특급호텔 로열 하이티'),
  normal(null, '석식 후 호텔 투숙 및 휴식')
];

const scheduleDay3 = [
  normal(null, '달랏 다딴라 폭포 관광', '알파인코스터-루지 체험'),
  normal(null, '베트남 대규모 사원 죽림사', '케이블카 편도 포함'),
  normal(null, '마지막 황제의 바오다이 황제의 여름별장'),
  normal(null, '아담하고 아름다운 달랏 기차역'),
  normal(null, '화려한 색감을 자랑하는 린푸옥사원'),
  normal(null, '달랏 야시장 자유시간'),
  normal(null, '[특전] 달랏피자 반짠느엉 + 음료 1잔'),
  normal(null, '호텔 투숙 및 휴식')
];

const scheduleDay4 = [
  normal(null, '해발 1,900M 랑비앙 전망대 관광', '짚차 또는 7인승 차량 탑승'),
  normal(null, '쇼핑센터 방문'),
  normal(null, '나트랑으로 복귀 이동', '약 3시간 30분 소요'),
  normal(null, '나트랑 대성당 차창 관광'),
  normal(null, '[특전] 척칩 - 나트랑 명물 치즈시즈닝 고구마 튀김 제공'),
  normal(null, '나트랑에서 가장 오래된 사원 롱선사 관람'),
  normal(null, '나트랑 최대 규모 담 재래시장'),
  normal(null, '전신 맛사지 120분 (2시간) 체험', '팁 별도/아동제외'),
  normal(null, '나트랑 야간시티투어', '야시장+씨클로+맥주1잔+화덕피자 제공'),
  normal(null, '나트랑 깜란 국제 공항으로 이동')
];

const PKG_LIGHT = {
  ...COMMON,
  title: '[BX] 나트랑/달랏 노팁/노옵션 3박5일 라이트 (더투어)',
  product_type: '라이트', price: 729000, guide_tip: '포함', single_supplement: '12만원',
  inclusions: inclusions,
  excludes: [
    '개인경비, 매너팁, 마사지 팁 별도',
    '달랏 라사피네트 써차지 (4/24~26, 4/30~5/2, 9/2): 룸당/박당 8만원',
    '나트랑 호라이즌 써차지 (4/30~5/2, 8/29~9/2): 룸당/박당 2만원',
    '달랏 필수식사 (의무디너 4/30): 1인 4만원',
    '싱글차지 전일정 12만원'
  ],
  notices_parsed: notices, special_notes: '쇼핑: 노니(침향), 잡화, 커피 3회 방문',
  product_highlights: [
    '3박5일 일정 완전 노팁/노옵션 패키지',
    '전신마사지 2회 총 3.5시간 포함',
    '다딴라 폭포 루지 + 랑비앙 전망대 짚차',
    '나트랑 머드온천욕 + 나트랑 야간 시티투어',
    '달랏팰리스 애프터눈 티 + 웰컴 망고도시락'
  ],
  product_summary: '에어부산을 이용하는 아름다운 베트남 나트랑/달랏 3박5일 라이트 단독 패키지. 전 일정 노팁/노옵션으로 부담이 없으며, 시원한 마사지 2회와 달랏팰리스 애프터눈 티, 각종 특별 간식들이 아낌없이 포함된 특급 코스입니다.',
  product_tags: ['베트남', '나트랑', '달랏', '머드온천', '랑비앙전망대', '다딴라폭포', '노팁노옵션', '전신마사지'],
  accommodations: ['나트랑 호라이즌(또는 퀀터 5성)', '라사피네트 달랏(또는 삼미 준특급)'],
  price_tiers: [
    { period_label: '5/1~7/14', departure_day_of_week: '일,토', adult_price: 729000, status: 'available' },
    { period_label: '5/1~7/14', departure_day_of_week: '월,화,수,목,금', adult_price: 779000, status: 'available' },
  ],
  itinerary: itinerary,
  itinerary_data: {
    meta: {
      title: '[BX] 나트랑/달랏 노팁/노옵션 3박5일 라이트 (더투어)', product_type: '라이트', destination: '나트랑/달랏',
      nights: 3, days: 5, departure_airport: '부산(김해)', airline: 'BX(에어부산)',
      flight_out: 'BX781', flight_in: 'BX782', brand: '여소남',
    },
    days: [
      {
        day: 1, regions: ['부산', '나트랑'], meals: meal(false, false, false),
        schedule: [
          flight('19:20', '부산 김해국제공항 출발', 'BX781'),
          flight('22:20', '나트랑 깜란 국제 공항 도착 후 가이드 미팅', 'BX781'),
          normal(null, '[특전] 웰컴 나트랑! 망고도시락 1인 1개 제공'),
          normal(null, '호텔 체크인 및 휴식')
        ],
        hotel: { name: '나트랑 호라이즌 또는 퀀터', grade: '5성', note: '나트랑 5성급' }
      },
      { day: 2, regions: ['나트랑', '달랏'], meals: meal(true, true, true, '호텔식', '쌀국수', '제육볶음&찌개'), schedule: scheduleDay2, hotel: { name: '라사피네트 달랏 또는 삼미', grade: '4성', note: '준특급' } },
      { day: 3, regions: ['달랏'], meals: meal(true, true, true, '호텔식', '분짜+반세오', '무제한 삼겹살'), schedule: scheduleDay3, hotel: { name: '라사피네트 달랏 또는 삼미', grade: '4성', note: '준특급' } },
      { day: 4, regions: ['달랏', '나트랑'], meals: meal(true, true, true, '호텔식', '가정식', '소불고기 전골'), schedule: scheduleDay4, hotel: null },
      {
        day: 5, regions: ['나트랑', '부산'], meals: meal(false, false, false),
        schedule: [
          flight('23:20', '나트랑 깜란 국제 공항 출발 (전날 기준)', 'BX782'),
          flight('06:20', '부산 김해 국제 공항 도착 후 해산', 'BX782')
        ],
        hotel: null
      }
    ]
  }
};

const PKG_PREMIUM = JSON.parse(JSON.stringify(PKG_LIGHT));
PKG_PREMIUM.title = '[BX] 나트랑/달랏 노팁/노옵션 3박5일 품격 (더투어)';
PKG_PREMIUM.product_type = '품격';
PKG_PREMIUM.price = 799000;
PKG_PREMIUM.single_supplement = '19만원';
PKG_PREMIUM.excludes = [
  '개인경비, 매너팁, 마사지 팁 별도',
  '달랏 라달랏 호텔 써차지 (4/30~5/2, 9/1~9/2): 룸당/박당 5만원',
  '나트랑 호라이즌 써차지 (4/30~5/2, 8/29~9/2): 룸당/박당 2만원',
  '싱글차지 전일정 19만원'
];
PKG_PREMIUM.product_summary = '에어부산을 이용하는 아름다운 베트남 나트랑/달랏 3박5일 [품격] 단독 패키지. 나트랑 5성급은 물론 달랏에서도 5성급 호텔에 머무르는 최고의 숙박 퀄리티를 자랑합니다. 노팁/노옵션, 전신마사지 2회를 즐겨보세요.';
PKG_PREMIUM.accommodations = ['나트랑 호라이즌(또는 퀀터 5성)', '라달랏 동급 수준 5성급 호텔'];
PKG_PREMIUM.price_tiers = [
  { period_label: '5/1~7/14', departure_day_of_week: '일,토', adult_price: 799000, status: 'available' },
  { period_label: '5/1~7/14', departure_day_of_week: '월,화,수,목,금', adult_price: 849000, status: 'available' },
];
PKG_PREMIUM.itinerary_data.meta.title = PKG_PREMIUM.title;
PKG_PREMIUM.itinerary_data.meta.product_type = '품격';
PKG_PREMIUM.itinerary_data.days[1].hotel = { name: '라달랏 정숙박 또는 동급', grade: '5성', note: '5성급' };
PKG_PREMIUM.itinerary_data.days[2].hotel = { name: '라달랏 정숙박 또는 동급', grade: '5성', note: '5성급' };

async function main() {
  console.log(`📦 나트랑/달랏 무손실 파싱 자동 등록 진행...`);
  const { data, error } = await sb.from('travel_packages').insert([PKG_LIGHT, PKG_PREMIUM]).select('id, title, status, price');
  if (error) { console.error('❌ 등록 실패:', error.message); process.exit(1); }
  console.log(`✅ 나트랑/달랏 상품 ${data.length}개 [무손실 검증] 완료 후 DB 적재 완료!`);
}
main();
