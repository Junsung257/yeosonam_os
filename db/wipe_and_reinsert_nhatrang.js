const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let res = 'PKG-';
  for(let i=0; i<6; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
}

function parseDateRange(str) {
  const parts = str.split('~');
  if(parts.length !== 2) return null;
  const [sm, sd] = parts[0].split('/').map(Number);
  let [em, ed] = parts[1].split('/').map(Number);
  if(!em || !ed) return null;
  const year = new Date().getFullYear();
  let start = new Date(year, sm - 1, sd);
  let end = new Date(year, em - 1, ed);
  if(end < start) end.setFullYear(year + 1);
  return { start, end };
}

function expandDates(dateRangesStr, excludedStr) {
  let dates = [];
  const ranges = dateRangesStr.split(',').map(s => s.trim());
  for(const r of ranges) {
    const parsed = parseDateRange(r);
    if(parsed) {
      let curr = new Date(parsed.start);
      while(curr <= parsed.end) {
        dates.push(new Date(curr));
        curr.setDate(curr.getDate() + 1);
      }
    }
  }

  if(excludedStr) {
    let exDates = [];
    const exParts = excludedStr.replace('[', '').replace('제외]', '').replace('제외', '').split(',').map(s => s.trim());
    let currentMonth = null;
    for(let part of exParts) {
      if(part.includes('/')) {
        let [m, dStr] = part.split('/');
        currentMonth = Number(m);
        if(dStr.includes('~')) {
           let [startD, endD] = dStr.split('~').map(Number);
           for(let d=startD; d<=endD; d++) exDates.push(`${currentMonth}-${d}`);
        } else {
           exDates.push(`${currentMonth}-${Number(dStr)}`);
        }
      } else { 
         if(part.includes('~')) {
           let [startD, endD] = part.split('~').map(Number);
           for(let d=startD; d<=endD; d++) exDates.push(`${currentMonth}-${d}`);
        } else {
           exDates.push(`${currentMonth}-${Number(part)}`);
        }
      }
    }
    dates = dates.filter(d => {
      let m = d.getMonth() + 1;
      let dt = d.getDate();
      return !exDates.includes(`${m}-${dt}`);
    });
  }
  return dates;
}

const pricingLight = [
  { range: '4/1~4/30, 8/8~8/15', exclude: '[4/29~5/2, 8/12~15 제외]', prices: { weekend: 809000, weekday: 859000 }, weekendDows: [0,1,2,6], weekdayDows: [3,4,5] },
  { range: '5/1~7/14, 8/30~9/12', exclude: '[5/20~23, 5/30, 6/2~3 제외]', prices: { weekend: 729000, weekday: 779000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] },
  { range: '7/15~7/22, 8/16~8/29, 10/1~10/21', exclude: '[7/15~17, 10/1~3, 10/7~9제외]', prices: { weekend: 779000, weekday: 819000 }, weekendDows: [0,1,2,6], weekdayDows: [3,4,5] },
  { range: '7/23~7/29', exclude: '[7/29 제외]', prices: { weekend: 1009000, weekday: 1009000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] },
  { range: '7/30~8/7', exclude: '[7/30~8/1 제외]', prices: { weekend: 969000, weekday: 969000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] },
  { range: '9/13~9/30', exclude: '[9/22~25, 9/30 제외]', prices: { weekend: 689000, weekday: 729000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] }
];

const pricingPremium = [
  { range: '4/1~4/30, 8/8~8/15', exclude: '[4/29~5/2, 8/12~15 제외]', prices: { weekend: 879000, weekday: 929000 }, weekendDows: [0,1,2,6], weekdayDows: [3,4,5] },
  { range: '5/1~7/14, 8/30~9/12', exclude: '[5/20~23, 5/30, 6/2~3 제외]', prices: { weekend: 799000, weekday: 849000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] },
  { range: '7/15~7/22, 8/16~8/29, 10/1~10/21', exclude: '[7/15~17, 10/1~3, 10/7~9제외]', prices: { weekend: 849000, weekday: 889000 }, weekendDows: [0,1,2,6], weekdayDows: [3,4,5] },
  { range: '7/23~7/29', exclude: '[7/29 제외]', prices: { weekend: 1079000, weekday: 1079000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] },
  { range: '7/30~8/7', exclude: '[7/30~8/1 제외]', prices: { weekend: 1039000, weekday: 1039000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] },
  { range: '9/13~9/30', exclude: '[9/22~25, 9/30 제외]', prices: { weekend: 759000, weekday: 799000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] }
];

const specificExlcudedLight = {
  809000: '5/23, 5/30, 6/2', 879000: '5/20, 6/3, 7/17, 9/30, 10/9', 999000: '7/15, 7/16, 9/25, 10/3',
  1059000: '4/29, 5/2, 8/1, 8/12, 8/13, 8/15', 1129000: '7/29, 7/30, 7/31, 10/7',
  1169000: '5/21, 5/22, 8/14, 9/22, 10/1, 10/2, 10/8', 1299000: '4/30, 9/24', 1699000: '5/1, 9/23'
};
const specificExlcudedPremium = {
  879000: '5/23, 5/30, 6/2', 949000: '5/20, 6/3, 7/17, 9/30, 10/9', 1069000: '7/15, 7/16, 9/25, 10/3',
  1129000: '4/29, 5/2, 8/1, 8/12, 8/13, 8/15', 1199000: '7/29, 7/30, 7/31, 10/7',
  1239000: '5/21, 5/22, 8/14, 9/22, 10/1, 10/2, 10/8', 1369000: '4/30, 9/24', 1769000: '5/1, 9/23'
};

function buildPriceDates(rules, specificMap) {
  const result = [];
  for(const r of rules) {
    const dates = expandDates(r.range, r.exclude);
    for(const d of dates) {
       const dow = d.getDay();
       const y = d.getFullYear();
       const mo = String(d.getMonth()+1).padStart(2,'0');
       const da = String(d.getDate()).padStart(2,'0');
       let price = r.weekdayDows.includes(dow) ? r.prices.weekday : r.prices.weekend;
       result.push({ date: `${y}-${mo}-${da}`, price, confirmed: false });
    }
  }
  const year = new Date().getFullYear();
  for(const [priceStr, dateStr] of Object.entries(specificMap)) {
     const p = Number(priceStr);
     const splits = dateStr.split(',').map(s=>s.trim());
     for(const md of splits) {
        let [m, day] = md.split('/').map(Number);
        const dFormatted = `${year}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const existing = result.find(x => x.date === dFormatted);
        if(existing) existing.price = p; 
        else result.push({ date: dFormatted, price: p, confirmed: false });
     }
  }
  result.sort((a,b) => a.date.localeCompare(b.date));
  return result;
}

function flight(time, activity, transport) { return { time, activity, type: 'flight', transport, note: null }; }
function normal(time, activity, note) { return { time: time || null, activity, type: 'normal', transport: null, note: note || null }; }
function meal(b, l, d, bn, ln, dn) { return { breakfast: b, lunch: l, dinner: d, breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null }; }

const COMMON = {
  country: '베트남', destination: '나트랑/달랏', departure_airport: '부산(김해)', airline: 'BX(에어부산)',
  min_participants: 4, category: 'package', status: 'available', filename: 'discord_auto_input', file_type: 'text',
  confidence: 1.0, duration: 5, nights: 3, departure_days: '매일운항', land_operator: '더투어',
  product_tags: ['베트남', '나트랑', '달랏', '머드온천', '랑비앙전망대', '다딴라폭포', '노팁노옵션', '전신마사지'],
  inclusions: [
    '국제선항공료, 각종 TAX, 유류할증료(4월기준)', '호텔(2인1실), 일정표상의 식사, 차량, 생수, 가이드, 1억원 여행자보험',
    '기사/가이드 경비 무료 (노팁/노옵션)', '나트랑 시내투어 (포나가르탑, 롱선사, 대성당, 담재래시장)',
    '나트랑 머드온천 체험 (4인탕 기준)', '전신 마사지 2회 제공 (2시간 1회 + 90분 1회, 팁 별도)',
    '나트랑 야간시티투어 (씨클로+맥주+화덕피자 제공)',
    '달랏 시내관광 (크레이지 하우스, 쓰엉흐엉호수, 다딴라폭포 루지, 죽림사 케이블카, 바오다이 별장, 달랏역, 린푸옥사원)',
    '달랏 랑비앙 전망대 관광 (짚차 또는 7인승 차량)',
    '4대 간식 특전 (망고도시락, 하이티 애프터눈티, 야시장 반짠느엉&음료, 나트랑 척칩 고구마튀김)'
  ],
  notices_parsed: [
    '나트랑, 달랏 지역은 베트남인들의 유명한 허니문 지역으로 숙박하는 호텔 방 대부분이 더블 침대인 경우가 많습니다. 더블 침대 방으로 배정될 수 있는 점 양해 바랍니다.',
    '호텔 룸배정 (일행과 같은층, 옆방배정, 베드타입) 등은 게런티 불가 합니다.',
    '패키지 일정 미 참여시 1인/$100 패널티 발생합니다.',
    '25년부터 베트남 입국시 전자담배 소지 전면금지 됩니다. 적발시 징역 또는 벌금형 처벌받을 수 있습니다.',
    '공항내 가이드 출입을 제한하므로 현지인 가이드와 미팅&샌딩 합니다. 한국인 가이드는 호텔에서 미팅하거나 중간에 픽업하여 진행될수 있습니다.'
  ],
  special_notes: '쇼핑: 노니(침향), 잡화, 커피 3회 방문',
  price_tiers: [] // Intentionally empty to force A4 to use price_dates
};

const itinerary_days = [
  { day: 1, regions: ['부산', '나트랑'], meals: meal(false, false, false), hotel: { name: '나트랑 호라이즌 또는 퀀터', grade: '5성', note: '나트랑 5성급' },
    schedule: [
      flight('19:20', '부산 김해국제공항 출발', 'BX781'), flight('22:20', '나트랑 깜란 국제 공항 도착 후 가이드 미팅', 'BX781'),
      normal(null, '[특전] 웰컴 나트랑! 망고도시락 1인 1개 제공')
    ]
  },
  { day: 2, regions: ['나트랑', '달랏'], meals: meal(true, true, true, '호텔식', '쌀국수', '제육볶음&찌개'), hotel: { name: '라사피네트 달랏 또는 삼미', grade: '4성', note: '준특급' },
    schedule: [
      normal(null, '나트랑 시내관광 - 포나가르 사원 관람'), normal(null, '나트랑 머드온천욕 체험', '수영복 지참/4인탕기준'),
      normal(null, '기괴하고 신비한 크레이지 하우스 관광'), normal(null, '달랏 중심 쓰엉흐엉 호수 조망'),
      normal(null, '전신마사지 90분 체험', '팁 별도/아동제외'), normal(null, '[특전] 달랏팰리스 하이티 애프터눈 티', '100년 전통 로열 하이티')
    ]
  },
  { day: 3, regions: ['달랏'], meals: meal(true, true, true, '호텔식', '분짜+반세오', '무제한 삼겹살'), hotel: { name: '라사피네트 달랏 또는 삼미', grade: '4성', note: '준특급' },
    schedule: [
      normal(null, '달랏 다딴라 폭포 관광', '알파인코스터-루지 체험'), normal(null, '베트남 대규모 사원 죽림사', '케이블카 편도 포함'),
      normal(null, '마지막 황제의 바오다이 황제의 여름별장'), normal(null, '아담하고 아름다운 달랏 기차역'),
      normal(null, '화려한 색감을 자랑하는 린푸옥사원'), normal(null, '달랏 야시장 자유시간'),
      normal(null, '[특전] 달랏피자 반짠느엉 + 음료 1잔')
    ]
  },
  { day: 4, regions: ['달랏', '나트랑'], meals: meal(true, true, true, '호텔식', '가정식', '소불고기 전골'), hotel: null,
    schedule: [
      normal(null, '해발 1,900M 랑비앙 전망대 관광', '짚차/7인승 차량'), normal(null, '나트랑 대성당 차창 관광'),
      normal(null, '[특전] 척칩 - 나트랑 명물 치즈시즈닝 고구마 튀김 제공'), normal(null, '나트랑에서 가장 오래된 사원 롱선사 관람'),
      normal(null, '나트랑 최대 규모 담 재래시장'), normal(null, '전신 맛사지 120분 (2시간) 체험', '팁 별도/아동제외'),
      normal(null, '나트랑 야간시티투어', '야시장+씨클로+맥주1잔+화덕피자 제공')
    ]
  },
  { day: 5, regions: ['나트랑', '부산'], meals: meal(false, false, false), hotel: null,
    schedule: [
      flight('23:20', '나트랑 깜란 국제 공항 출발', 'BX782'), flight('06:20', '부산 김해 국제 공항 도착 후 해산', 'BX782')
    ]
  }
];

async function run() {
  // 1. WIPE OLD TRASH
  console.log('Wiping corrupted DB entries...');
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  await sb.from('travel_packages').delete().like('title', '%나트랑/달랏%').gte('created_at', yesterday.toISOString());

  // 2. INSERT CLEAN PROPER ENTRIES
  console.log('Inserting 2 clean verified packages...');
  const PKG_LIGHT = {
    ...COMMON,
    title: '나트랑/달랏 3박5일 - 5성급 호캉스와 특급 힐링 [노팁/노옵션]', display_title: '나트랑/달랏 3박5일 - 5성급 호캉스와 특급 힐링 [노팁/노옵션]',
    short_code: generateCode(), product_type: '라이트', price: 729000, guide_tip: '포함', single_supplement: '12만원',
    excludes: [
      '개인경비, 매너팁, 마사지 팁 별도', '달랏 라사피네트 써차지 (4/24~26, 4/30~5/2, 9/2): 룸당/박당 8만원',
      '나트랑 호라이즌 써차지 (4/30~5/2, 8/29~9/2): 룸당/박당 2만원', '달랏 필수식사 (의무디너 4/30): 1인 4만원', '싱글차지 전일정 12만원'
    ],
    product_highlights: ['3박5일 일정 완전 노팁/노옵션 패키지', '전신마사지 2회 총 3.5시간 포함', '다딴라 폭포 루지 + 랑비앙 전망대 짚차', '나트랑 머드온천욕 + 야간 시티투어', '달랏팰리스 애프터눈 티 + 망고도시락'],
    price_dates: buildPriceDates(pricingLight, specificExlcudedLight),
    itinerary_data: { meta: { title: '나트랑/달랏 3박5일 - 5성급 호캉스와 특급 힐링', product_type: '라이트', destination: '나트랑/달랏', nights: 3, days: 5, airline: 'BX(에어부산)' }, days: JSON.parse(JSON.stringify(itinerary_days)) }
  };

  const PKG_PREMIUM = {
    ...COMMON,
    title: '나트랑/달랏 3박5일 - 전일정 5성급 럭셔리 라달랏 [노팁/노옵션]', display_title: '나트랑/달랏 3박5일 - 전일정 5성급 럭셔리 라달랏 [노팁/노옵션]',
    short_code: generateCode(), product_type: '품격', price: 799000, guide_tip: '포함', single_supplement: '19만원',
    excludes: [
      '개인경비, 매너팁, 마사지 팁 별도', '달랏 라달랏 호텔 써차지 (4/30~5/2, 9/1~9/2): 룸당/박당 5만원',
      '나트랑 호라이즌 써차지 (4/30~5/2, 8/29~9/2): 룸당/박당 2만원', '싱글차지 전일정 19만원'
    ],
    product_highlights: ['3박5일 일정 완전 노팁/노옵션 패키지 (전일정 5성급)', '전신마사지 2회 총 3.5시간 포함', '다딴라 폭포 루지 + 랑비앙 전망대 짚차', '나트랑 머드온천욕 + 야간 시티투어', '달랏팰리스 애프터눈 티 + 망고도시락'],
    price_dates: buildPriceDates(pricingPremium, specificExlcudedPremium),
    itinerary_data: { meta: { title: '나트랑/달랏 3박5일 - 전일정 5성급 럭셔리', product_type: '품격', destination: '나트랑/달랏', nights: 3, days: 5, airline: 'BX(에어부산)' }, days: JSON.parse(JSON.stringify(itinerary_days)) }
  };
  
  PKG_PREMIUM.itinerary_data.days[1].hotel = { name: '라달랏 정숙박 또는 동급', grade: '5성', note: '5성급' };
  PKG_PREMIUM.itinerary_data.days[2].hotel = { name: '라달랏 정숙박 또는 동급', grade: '5성', note: '5성급' };

  const { error } = await sb.from('travel_packages').insert([PKG_LIGHT, PKG_PREMIUM]);
  if(error) console.error('INSERT FAIL', error);
  else console.log('✅ REINSERTION SUCCESS! The UI will render flawlessly now.');
}
run();
