/**
 * 8종 일괄 등록 (2026.04)
 * 상품 1-2: 나트랑/달랏 라이트+품격 (투어폰 9%)
 * 상품 3-4: 장가계 노노특가 3박+4박 (더투어 10%)
 * 상품 5-8: 장가계 품격/고품격 3박+4박 (더투어 9%)
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const F = (time, act, tr) => ({ time, activity: act, type: 'flight', transport: tr });
const N = (time, act) => ({ time, activity: act, type: 'normal' });

// ═══════════════════════════════════════════
// 요금표 공통 데이터
// ═══════════════════════════════════════════

// 나트랑 라이트/품격 공통 요금표 [기간, 요일, 라이트, 품격]
const NHA_PRICE_ROWS = [
  ['4/1~4/30 수목금', '수,목,금', 849000, 969000, {start:'2026-04-01',end:'2026-04-30'}],
  ['4/1~4/30 토일월화', '토,일,월,화', 799000, 919000, {start:'2026-04-01',end:'2026-04-30'}],
  ['5/1~6/30 월~금', '월,화,수,목,금', 699000, 809000, {start:'2026-05-01',end:'2026-06-30'}],
  ['5/1~6/30 토일', '토,일', 669000, 779000, {start:'2026-05-01',end:'2026-06-30'}],
  ['7/1~7/14,8/30~9/12 월~금', '월,화,수,목,금', 739000, 819000, {start:'2026-07-01',end:'2026-07-14'}],
  ['7/1~7/14,8/30~9/12 토일', '토,일', 689000, 769000, {start:'2026-07-01',end:'2026-07-14'}],
  ['7/15~7/22 등 수목금', '수,목,금', 779000, 859000, {start:'2026-07-15',end:'2026-07-22'}],
  ['7/15~7/22 등 토일월화', '토,일,월,화', 729000, 809000, {start:'2026-07-15',end:'2026-07-22'}],
  ['8/8~8/15 수목금', '수,목,금', 829000, 909000, {start:'2026-08-08',end:'2026-08-15'}],
  ['8/8~8/15 토일월화', '토,일,월,화', 769000, 849000, {start:'2026-08-08',end:'2026-08-15'}],
  ['9/13~9/30 월~금', '월,화,수,목,금', 689000, 769000, {start:'2026-09-13',end:'2026-09-30'}],
  ['9/13~9/30 토일', '토,일', 649000, 729000, {start:'2026-09-13',end:'2026-09-30'}],
  ['7/30~8/7 매일', null, 929000, 1009000, {start:'2026-07-30',end:'2026-08-07'}],
  ['7/23~7/29 매일', null, 969000, 1049000, {start:'2026-07-23',end:'2026-07-29'}],
];
const NHA_SPECIAL_DATES = [
  ['5/23,5/30,6/2', ['2026-05-23','2026-05-30','2026-06-02'], 749000, 869000],
  ['5/20,6/3,7/17,9/30,10/9', ['2026-05-20','2026-06-03','2026-07-17','2026-09-30','2026-10-09'], 849000, 969000],
  ['7/15,7/16,9/25,10/3', ['2026-07-15','2026-07-16','2026-09-25','2026-10-03'], 949000, 1069000],
  ['4/29,5/2,8/1,8/12,8/13,8/15', ['2026-04-29','2026-05-02','2026-08-01','2026-08-12','2026-08-13','2026-08-15'], 999000, 1119000],
  ['7/29,30,31,10/7', ['2026-07-29','2026-07-30','2026-07-31','2026-10-07'], 1069000, 1189000],
  ['5/21,5/22,8/14,9/22,10/1,10/2,10/8', ['2026-05-21','2026-05-22','2026-08-14','2026-09-22','2026-10-01','2026-10-02','2026-10-08'], 1129000, 1249000],
  ['4/30,9/24', ['2026-04-30','2026-09-24'], 1269000, 1389000],
  ['5/1,9/23', ['2026-05-01','2026-09-23'], 1599000, 1719000],
];

function buildNhaPriceTiers(gradeIdx) { // 0=라이트, 1=품격
  const tiers = [];
  for (const r of NHA_PRICE_ROWS) {
    const t = { period_label: r[0], adult_price: r[2 + gradeIdx], status: 'available', date_range: r[4] };
    if (r[1]) t.departure_day_of_week = r[1];
    tiers.push(t);
  }
  for (const s of NHA_SPECIAL_DATES) {
    tiers.push({ period_label: '★' + s[0], departure_dates: s[1], adult_price: s[2 + gradeIdx], status: 'available', note: '특정일' });
  }
  return tiers;
}

// 더투어 노노특가 요금표 (3박=기본, 4박은 5/12~만)
const ZJJ_NONO_3N = [
  ['4월 월', null, 899000, ['월']], ['4월 화', null, 899000, ['화']], ['4월 수', null, 969000, ['수']],
  ['4월 목', null, 1049000, ['목']], ['4월 금', null, 1049000, ['금']], ['4월 토', null, 989000, ['토']], ['4월 일', null, 919000, ['일']],
  ['4/12 일', ['2026-04-12'], 899000], ['4/16 목', ['2026-04-16'], 999000], ['4/18 토', ['2026-04-18'], 949000], ['4/30 목', ['2026-04-30'], 1099000],
  ['5/1,2', ['2026-05-01','2026-05-02'], 1499000], ['5/3', ['2026-05-03'], 899000], ['5/4', ['2026-05-04'], 869000],
  ['5/5', ['2026-05-05'], 849000], ['5/7,11', ['2026-05-07','2026-05-11'], 969000], ['5/6,8,9,10', ['2026-05-06','2026-05-08','2026-05-09','2026-05-10'], 849000],
  // 5/12~이후 3박(토일월)
  ['5/12~31 토', null, 1229000, ['토']], ['5/12~31 일', null, 1099000, ['일']], ['5/12~31 월', null, 999000, ['월']],
  ['5/18 월', ['2026-05-18'], 1169000], ['5/23 토', ['2026-05-23'], 1549000],
  ['6/1~15 토', null, 1069000, ['토']], ['6/1~15 일', null, 919000, ['일']], ['6/1~15 월', null, 919000, ['월']],
  ['6/6 토', ['2026-06-06'], 1249000],
  ['6/16~23 토', null, 1029000, ['토']], ['6/16~23 일', null, 899000, ['일']], ['6/16~23 월', null, 869000, ['월']],
];
const ZJJ_NONO_4N = [
  ['5/12~31 화', null, 1099000, ['화']], ['5/12~31 수', null, 1199000, ['수']], ['5/12~31 목', null, 1249000, ['목']],
  ['5/12 화', ['2026-05-12'], 1199000], ['5/21 목', ['2026-05-21'], 1399000], ['5/28 목', ['2026-05-28'], 1199000],
  ['6/1~15 화', null, 999000, ['화']], ['6/1~15 수', null, 1099000, ['수']], ['6/1~15 목', null, 1099000, ['목']],
  ['6/2 화', ['2026-06-02'], 1199000], ['6/3 수', ['2026-06-03'], 1599000],
  ['6/16~23 화', null, 969000, ['화']], ['6/16~23 수', null, 999000, ['수']], ['6/16~23 목', null, 1029000, ['목']],
];

function buildZjjNonoPriceTiers(type) { // '3n' or '4n'
  const rows = type === '3n' ? ZJJ_NONO_3N : ZJJ_NONO_4N;
  return rows.map(r => {
    const t = { period_label: r[0], adult_price: r[2], status: 'available' };
    if (r[1]) t.departure_dates = r[1];
    if (r[3]) t.departure_day_of_week = r[3].join(',');
    return t;
  });
}

// 더투어 품격/고품격 요금표
const ZJJ_PG_ROWS = [
  // 4/1~4/30
  ['4월 월', null, 1119000, 1429000, '3박', ['월']], ['4월 화', null, 1129000, 1499000, '3박', ['화']],
  ['4월 수', null, 1099000, 1499000, '3박', ['수']], ['4월 목', null, 1469000, 1549000, '3박', ['목']],
  ['4월 금', null, 1399000, 1549000, '3박', ['금']], ['4월 토', null, 1339000, 1499000, '3박', ['토']],
  ['4월 일', null, 1199000, 1549000, '3박', ['일']],
  ['4/19 일', ['2026-04-19'], 1099000, 1399000, '3박'], ['4/20,27 월', ['2026-04-20','2026-04-27'], 1049000, 1499000, '3박'],
  ['4/22 수', ['2026-04-22'], 1269000, 1779000, '3박'], ['4/23 목', ['2026-04-23'], 1469000, 1779000, '3박'],
  ['4/25 토', ['2026-04-25'], 1099000, 1499000, '3박'], ['4/29 수', ['2026-04-29'], 1119000, 1499000, '3박'],
  // 5/1~5/11
  ['5/1 금', ['2026-05-01'], 1749000, 2099000, '3박'], ['5/2 토', ['2026-05-02'], 1799000, 2069000, '3박'],
  ['5/3 일', ['2026-05-03'], 1099000, 1449000, '3박'], ['5/4 월', ['2026-05-04'], 1049000, 1399000, '3박'],
  ['5/5 화', ['2026-05-05'], 1029000, 1369000, '3박'], ['5/6 수', ['2026-05-06'], 1029000, 1399000, '3박'],
  ['5/7 목', ['2026-05-07'], 1399000, 1499000, '3박'], ['5/8 금', ['2026-05-08'], 1399000, 1399000, '3박'],
  ['5/9 토', ['2026-05-09'], 1049000, 1399000, '3박'], ['5/10 일', ['2026-05-10'], 1199000, 1399000, '3박'],
  ['5/11 월', ['2026-05-11'], 1149000, 1499000, '3박'],
  // 5/12~5/31 4박
  ['5/12~31 화 4박', null, 1219000, 1699000, '4박', ['화']], ['5/12~31 수 4박', null, 1299000, 1799000, '4박', ['수']],
  ['5/12~31 목 4박', null, 1369000, 1849000, '4박', ['목']],
  ['5/12 화', ['2026-05-12'], 1349000, 1799000, '4박'], ['5/21 목', ['2026-05-21'], 1529000, 1999000, '4박'],
  ['5/28 목', ['2026-05-28'], 1299000, 1799000, '4박'],
  ['5/12~31 토 3박', null, 1349000, 1699000, '3박', ['토']], ['5/12~31 일 3박', null, 1219000, 1549000, '3박', ['일']],
  ['5/12~31 월 3박', null, 1099000, 1449000, '3박', ['월']],
  ['5/18 월', ['2026-05-18'], 1269000, 1599000, '3박'], ['5/23 토', ['2026-05-23'], 1629000, 1999000, '3박'],
  // 6/1~6/15
  ['6/1~15 화 4박', null, 1169000, 1649000, '4박', ['화']], ['6/1~15 수 4박', null, 1199000, 1699000, '4박', ['수']],
  ['6/1~15 목 4박', null, 1199000, 1699000, '4박', ['목']],
  ['6/2 화', ['2026-06-02'], 1329000, 1799000, '4박'], ['6/3 수', ['2026-06-03'], 1699000, 2169000, '4박'],
  ['6/1~15 토 3박', null, 1199000, 1549000, '3박', ['토']], ['6/1~15 일 3박', null, 1029000, 1399000, '3박', ['일']],
  ['6/1~15 월 3박', null, 1029000, 1399000, '3박', ['월']], ['6/6 토', ['2026-06-06'], 1369000, 1699000, '3박'],
  // 6/16~6/24
  ['6/16~24 화 4박', null, 1099000, 1569000, '4박', ['화']], ['6/16~24 수 4박', null, 1149000, 1619000, '4박', ['수']],
  ['6/16~24 목 4박', null, 1169000, 1649000, '4박', ['목']],
  ['6/16~24 토 3박', null, 1149000, 1499000, '3박', ['토']], ['6/16~24 일 3박', null, 999000, 1349000, '3박', ['일']],
  ['6/16~24 월 3박', null, 969000, 1329000, '3박', ['월']],
  // 6/28~8/23
  ['6/28~8/23 목 3박', null, 1029000, 1429000, '3박', ['목']], ['6/28~8/23 일 4박', null, 1049000, 1569000, '4박', ['일']],
  // 8/27~9/28
  ['8/27~9/28 화 4박', null, 1249000, 1749000, '4박', ['화']], ['8/27~9/28 수 4박', null, 1269000, 1799000, '4박', ['수']],
  ['8/27~9/28 목 4박', null, 1299000, 1849000, '4박', ['목']],
  ['7/16 목', ['2026-07-16'], 1369000, 1899000, '3박'], ['8/13 목', ['2026-08-13'], 1399000, 1929000, '3박'],
  ['9/22 화', ['2026-09-22'], 1899000, 2449000, '4박'], ['9/23 수', ['2026-09-23'], 2199000, 2699000, '4박'],
  ['9/24 목', ['2026-09-24'], 2249000, 2749000, '4박'],
  ['8/27~9/28 토 3박', null, 1299000, 1699000, '3박', ['토']], ['8/27~9/28 일 3박', null, 1129000, 1529000, '3박', ['일']],
  ['8/27~9/28 월 3박', null, 1099000, 1479000, '3박', ['월']],
  ['9/21 월', ['2026-09-21'], 1249000, 1599000, '3박'], ['8/16 일', ['2026-08-16'], 1149000, 1549000, '3박'],
  // 9/29~10/21
  ['9/29~10/21 월 3박', null, 1199000, 1599000, '3박', ['월']], ['9/29~10/21 화 3박', null, 1299000, 1649000, '3박', ['화']],
  ['9/29~10/21 수 3박', null, 1329000, 1749000, '3박', ['수']], ['9/29~10/21 목 3박', null, 1399000, 1799000, '3박', ['목']],
  ['9/29~10/21 금 3박', null, 1399000, 1799000, '3박', ['금']], ['9/29~10/21 토 3박', null, 1399000, 1799000, '3박', ['토']],
  ['9/29~10/21 일 3박', null, 1269000, 1699000, '3박', ['일']],
  ['10/1 목', ['2026-10-01'], 1529000, 1999000, '3박'], ['10/2 금', ['2026-10-02'], 1699000, 1999000, '3박'],
  ['10/3 토', ['2026-10-03'], 1669000, 2149000, '3박'], ['10/4 일', ['2026-10-04'], 1429000, 1849000, '3박'],
  ['10/5 월', ['2026-10-05'], 1269000, 1699000, '3박'], ['10/6 화', ['2026-10-06'], 1299000, 1699000, '3박'],
  ['10/7 수', ['2026-10-07'], 1799000, 2169000, '3박'], ['10/8 목', ['2026-10-08'], 2019000, 2429000, '3박'],
];

function buildZjjPgPriceTiers(gradeIdx, nightsFilter) { // gradeIdx: 0=품격, 1=고품격
  return ZJJ_PG_ROWS
    .filter(r => !nightsFilter || r[4] === nightsFilter)
    .map(r => {
      const t = { period_label: r[0], adult_price: r[2 + gradeIdx], status: 'available' };
      if (r[1]) t.departure_dates = r[1];
      if (r[5]) t.departure_day_of_week = r[5].join(',');
      if (r[4]) t.note = r[4];
      return t;
    });
}

// ═══════════════════════════════════════════
// 일정 데이터
// ═══════════════════════════════════════════

// 나트랑 라이트 일정
const NHA_LIGHT_DAYS = [
  { day: 1, regions: ['부산','나트랑'], meals: { breakfast: false, lunch: false, dinner: false }, schedule: [
    F('19:20','김해 국제공항 출발','BX781'), N('22:20','나트랑 깜란 국제공항 도착 후 가이드 미팅'), N(null,'호텔 투숙 *과일도시락')],
    hotel: { name: '호라이즌 또는 동급', grade: '5', note: '★★★★★' } },
  { day: 2, regions: ['나트랑','달랏'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(분짜+반쎄오)', dinner: true, dinner_note: '한식(제육쌈밥) 혹은 5성호텔식' }, schedule: [
    N(null,'호텔 조식 후 가이드 미팅'), N(null,'▶참파 유적지 중 가장 오래된 포나가르탑'), N(null,'▶나트랑의 랜드마크 침향타워&나트랑비치'),
    N(null,'▶피로를 풀어주는 전통마사지 60분(팁별도$3)'), N(null,'달랏으로 이동(약 3시간30분)'), N(null,'▶크레이지 하우스'), N(null,'▶달랏 야시장투어(자유시간)')],
    hotel: { name: '멀펄 또는 동급', grade: '5', note: '★★★★★' } },
  { day: 3, regions: ['달랏'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(샤브샤브/닭구이)', dinner: true, dinner_note: '한식(무제한삼겹살)' }, schedule: [
    N(null,'▶랑비앙 전망대(지프차왕복)'), N(null,'▶달랏기차역'), N(null,'▶도멘 드 마리 성당'), N(null,'▶죽림사(케이블카)'), N(null,'▶다딴라 폭포(레일바이크 탑승)')],
    hotel: { name: '멀펄 또는 동급', grade: '5', note: '★★★★★' } },
  { day: 4, regions: ['달랏','나트랑'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(세트메뉴)', dinner: true, dinner_note: '한식(소불고기전골)' }, schedule: [
    N(null,'▶쑤언흐엉호수 커피1잔(위즐/코코넛)'), N(null,'쇼핑관광 3회'), N(null,'▶린푸억사원'), N(null,'나트랑으로 이동(약 3시간30분)'),
    N(null,'▶롱선사'), N(null,'▶나트랑대성당(차창관광)'), N(null,'▶나트랑 야간시티투어(야시장)'), F('23:20','나트랑 깜란 국제공항 출발','BX782')],
    hotel: null },
  { day: 5, regions: ['부산'], meals: { breakfast: false, lunch: false, dinner: false }, schedule: [N('06:20','김해 국제공항 도착')], hotel: null },
];

// 나트랑 품격 일정
const NHA_PUMG_DAYS = [
  { day: 1, regions: ['부산','나트랑'], meals: { breakfast: false, lunch: false, dinner: false }, schedule: [
    F('19:20','김해 국제공항 출발','BX781'), N('22:20','나트랑 깜란 국제공항 도착 후 가이드 미팅'), N(null,'호텔 투숙 *과일도시락')],
    hotel: { name: '호라이즌 또는 동급', grade: '5', note: '★★★★★' } },
  { day: 2, regions: ['나트랑','달랏'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(분짜+반쎄오)', dinner: true, dinner_note: '한식(제육쌈밥) 혹은 5성호텔식' }, schedule: [
    N(null,'▶포나가르탑'), N(null,'▶무제한 과일뷔페'), N(null,'▶나트랑 머드스파'), N(null,'▶전통마사지 90분(팁별도$7)'),
    N(null,'달랏으로 이동(약 3시간30분)'), N(null,'▶바오다이 별장'), N(null,'▶크레이지 하우스'), N(null,'▶달랏 야시장투어(음료/맥주 1잔)')],
    hotel: { name: '멀펄 또는 동급', grade: '5', note: '★★★★★' } },
  { day: 3, regions: ['달랏'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(샤브샤브/닭구이)', dinner: true, dinner_note: '한식(무제한삼겹살)' }, schedule: [
    N(null,'▶랑비앙 전망대(지프차왕복)'), N(null,'▶도멘 드 마리 성당'), N(null,'▶달랏기차역'), N(null,'▶린푸억사원'),
    N(null,'▶죽림사(케이블카)'), N(null,'▶다딴라 폭포(레일바이크 탑승)'), N(null,'▶달랏 천국의 계단(음료 1잔)')],
    hotel: { name: '멀펄 또는 동급', grade: '5', note: '★★★★★' } },
  { day: 4, regions: ['달랏','나트랑'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(세트메뉴)', dinner: true, dinner_note: '한식(소불고기전골)' }, schedule: [
    N(null,'쇼핑관광 3회'), N(null,'▶쑤언흐엉호수 커피1잔(위즐/코코넛)'), N(null,'▶플라워가든'),
    N(null,'나트랑으로 이동(약 3시간)'), N(null,'▶롱선사'), N(null,'▶나트랑대성당(차창관광)'), N(null,'▶나트랑 야간시티투어(야시장+씨클로+맥주+피자)'),
    F('23:20','나트랑 깜란 국제공항 출발','BX782')],
    hotel: null },
  { day: 5, regions: ['부산'], meals: { breakfast: false, lunch: false, dinner: false }, schedule: [N('06:20','김해 국제공항 도착')], hotel: null },
];

// 더투어 장가계 3박 노노특가 일정
const ZJJ_NONO_3N_DAYS = [
  { day: 1, regions: ['부산','장가계'], meals: { breakfast: false, lunch: true, lunch_note: '누룽지백숙', dinner: true, dinner_note: '철판왕삼겹구이(무제한)' }, schedule: [
    F('09:00','부산 김해국제공항 출발','BX371'), N('11:20','장가계 국제공항 도착'),
    N(null,'-장가계에서 가장 먼저 역사서에 기록된 명산 천문산(케이블카편도)'), N(null,'-세계에서 가장 높은곳에 위치한 천연종유동 천문동'),
    N(null,'-천문산사+귀곡잔도+유리잔도+동선 관광 후 천문산 하산(케이블카편도)'), N(null,'-장가계 72기루(차창)'),
    N(null,'-천문호선쇼 관람 *우천/동계시즌 휴업시 매력상서쇼 대체')],
    hotel: { name: '블루베이호텔 또는 데이즈호텔', grade: '4.5', note: '또는 동급(준5성)' } },
  { day: 2, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '보쌈정식', dinner: true, dinner_note: '호텔식' }, schedule: [
    N(null,'-인공호수 보봉호수 유람선 VIP'), N(null,'-천자산(케이블카편도) : 하룡공원, 어필봉, 선녀헌화, 천대서해'),
    N(null,'-원가계(백룡엘레베이터편도) : 미혼대, 천하제일교'), N(null,'-십리화랑(모노레일왕복)'), N(null,'-금편계곡')],
    hotel: { name: '블루베이호텔 또는 데이즈호텔', grade: '4.5', note: '또는 동급(준5성)' } },
  { day: 3, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '산채비빔밥', dinner: true, dinner_note: '소불고기' }, schedule: [
    N(null,'-황룡동굴 VIP'), N(null,'-장가계대협곡(유리다리+엘리베이터+유람선+봅슬레이+4D VR)'),
    N(null,'-발 마사지(50분) *매너팁별도'), N(null,'-무릉원 야경투어')],
    hotel: { name: '블루베이호텔 또는 데이즈호텔', grade: '4.5', note: '또는 동급(준5성)' } },
  { day: 4, regions: ['장가계','부산'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '도시락', dinner: false }, schedule: [
    N(null,'-군성사석화박물관'), F('12:20','장가계 국제공항 출발','BX372'), N('16:35','부산 김해국제공항 도착')], hotel: null },
];

// 더투어 장가계 4박 노노특가 일정
const ZJJ_NONO_4N_DAYS = [
  { day: 1, regions: ['부산','장가계'], meals: { breakfast: false, lunch: true, lunch_note: '누룽지백숙', dinner: true, dinner_note: '철판왕삼겹구이(무제한)' }, schedule: [
    F('09:00','부산 김해국제공항 출발','BX371'), N('11:20','장가계 국제공항 도착'),
    N(null,'-장가계대협곡(유리다리+엘리베이터+유람선+봅슬레이+4D VR)')],
    hotel: { name: '블루베이호텔 또는 데이즈호텔', grade: '4.5', note: '또는 동급(준5성)' } },
  { day: 2, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '보쌈정식', dinner: true, dinner_note: '호텔식' }, schedule: [
    N(null,'-토가족풍정원'), N(null,'-천문산(케이블카편도) : 천문동, 천문산사+귀곡잔도+유리잔도+동선'),
    N(null,'-72기루(차창)'), N(null,'-천문호선쇼 *우천/동계시즌 매력상서쇼 대체')],
    hotel: { name: '블루베이호텔 또는 데이즈호텔', grade: '4.5', note: '또는 동급(준5성)' } },
  { day: 3, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '산채비빔밥', dinner: true, dinner_note: '소불고기' }, schedule: [
    N(null,'-천자산(케이블카편도) : 하룡공원, 어필봉, 선녀헌화, 천대서해'),
    N(null,'-원가계(백룡엘레베이터편도) : 미혼대, 천하제일교'), N(null,'-십리화랑(모노레일왕복)'), N(null,'-금편계곡')],
    hotel: { name: '블루베이호텔 또는 데이즈호텔', grade: '4.5', note: '또는 동급(준5성)' } },
  { day: 4, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '버섯전골', dinner: true, dinner_note: '제육쌈밥' }, schedule: [
    N(null,'-보봉호수 유람선 VIP'), N(null,'-황룡동굴 VIP'), N(null,'-발 마사지(50분) *매너팁별도'), N(null,'-무릉원 야경투어')],
    hotel: { name: '블루베이호텔 또는 데이즈호텔', grade: '4.5', note: '또는 동급(준5성)' } },
  { day: 5, regions: ['장가계','부산'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '도시락', dinner: false }, schedule: [
    N(null,'-군성사석화박물관'), F('12:20','장가계 국제공항 출발','BX372'), N('16:35','부산 김해국제공항 도착')], hotel: null },
];

// 더투어 품격 3박 일정
const ZJJ_PG3_DAYS = [
  { day: 1, regions: ['부산','장가계'], meals: { breakfast: false, lunch: true, lunch_note: '누룽지백숙', dinner: true, dinner_note: '철판왕삼겹구이(무제한)' }, schedule: [
    F('09:20','부산 김해국제공항 출발','BX371'), N('11:55','장가계 국제공항 도착'),
    N(null,'-천문산(케이블카편도) : 천문동, 천문산사+귀곡잔도+유리잔도+동선'),
    N(null,'-72기루(내부) 관광'), N(null,'-천문호선쇼 *우천/동계시즌 매력상서쇼 대체')],
    hotel: { name: '풀만호텔 또는 렌조이본관', grade: '5', note: '동급(정5성)' } },
  { day: 2, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '보쌈정식', dinner: true, dinner_note: '호텔식' }, schedule: [
    N(null,'-보봉호수 유람선 VIP'), N(null,'-천자산(케이블카편도) : 하룡공원, 어필봉, 선녀헌화, 천대서해'),
    N(null,'-원가계(백룡엘레베이터편도) : 미혼대, 천하제일교'), N(null,'-십리화랑(모노레일왕복)'), N(null,'-금편계곡')],
    hotel: { name: '풀만호텔 또는 렌조이본관', grade: '5', note: '동급(정5성)' } },
  { day: 3, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '산채비빔밥', dinner: true, dinner_note: '소고기모듬구이' }, schedule: [
    N(null,'-황룡동굴 VIP'), N(null,'-장가계대협곡(유리다리+엘리베이터+유람선+봅슬레이+4D VR)'),
    N(null,'-발+전신마사지(90분) *매너팁별도'), N(null,'-무릉원 야경투어')],
    hotel: { name: '풀만호텔 또는 렌조이본관', grade: '5', note: '동급(정5성)' } },
  { day: 4, regions: ['장가계','부산'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '도시락', dinner: false }, schedule: [
    N(null,'-군성사석화박물관'), F('12:55','장가계 국제공항 출발','BX372'), N('17:00','부산 김해국제공항 도착')], hotel: null },
];

// 더투어 고품격 3박 일정
const ZJJ_GP3_DAYS = [
  { day: 1, regions: ['부산','장가계'], meals: { breakfast: false, lunch: true, lunch_note: '누룽지백숙', dinner: true, dinner_note: '현지식' }, schedule: [
    F('09:20','부산 김해국제공항 출발','BX371'), N('11:55','장가계 국제공항 도착'),
    N(null,'-장가계대협곡(유리다리+엘리베이터+유람선+봅슬레이+4D VR)'), N(null,'-발+전신마사지(90분) *매너팁별도')],
    hotel: { name: '하워드존슨 ★디럭스룸 업글★ 또는 무릉원 힐튼가든', grade: '5', note: '동급(정5성)' } },
  { day: 2, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '소불고기', dinner: true, dinner_note: '철판왕삼겹구이(무제한)' }, schedule: [
    N(null,'-황룡동굴 VIP'), N(null,'-천자산(케이블카편도) : 하룡공원, 어필봉, 선녀헌화, 천대서해'),
    N(null,'-원가계(백룡엘레베이터편도) : 미혼대, 천하제일교'), N(null,'-십리화랑(모노레일왕복)'), N(null,'-금편계곡'), N(null,'-매력상서쇼 관람')],
    hotel: { name: '하워드존슨 또는 무릉원 힐튼가든', grade: '5', note: '동급(정5성)' } },
  { day: 3, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '산채비빔밥', dinner: true, dinner_note: '소고기모듬구이' }, schedule: [
    N(null,'-칠성산(왕복케이블카+루지편도+유리잔도+유리전망대)'),
    N(null,'-천문산(케이블카편도) : 천문동, 천문산사+귀곡잔도+유리잔도+동선'),
    N(null,'-72기루(내부) 관광'), N(null,'-발+전신마사지(90분) *매너팁별도'), N(null,'-무릉원 야경투어')],
    hotel: { name: '하워드존슨 또는 무릉원 힐튼가든', grade: '5', note: '동급(정5성)' } },
  { day: 4, regions: ['장가계','부산'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '도시락', dinner: false }, schedule: [
    N(null,'-보봉호수 유람선 VIP'), F('12:55','장가계 국제공항 출발','BX372'), N('17:00','부산 김해국제공항 도착')], hotel: null },
];

// 더투어 품격 4박 일정
const ZJJ_PG4_DAYS = [
  { day: 1, regions: ['부산','장가계'], meals: { breakfast: false, lunch: true, lunch_note: '누룽지백숙', dinner: true, dinner_note: '철판왕삼겹구이(무제한)' }, schedule: [
    F('09:20','부산 김해국제공항 출발','BX371'), N('11:55','장가계 국제공항 도착'),
    N(null,'-장가계대협곡(유리다리+엘리베이터+유람선+봅슬레이+4D VR)')],
    hotel: { name: '풀만호텔 또는 렌조이본관', grade: '5', note: '동급(정5성)' } },
  { day: 2, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '보쌈정식', dinner: true, dinner_note: '호텔식' }, schedule: [
    N(null,'-토가족풍정원'), N(null,'-천문산(케이블카편도) : 천문동, 천문산사+귀곡잔도+유리잔도+동선'),
    N(null,'-72기루(내부) 관광'), N(null,'-천문호선쇼 *우천/동계시즌 매력상서쇼 대체')],
    hotel: { name: '풀만호텔 또는 렌조이본관', grade: '5', note: '동급(정5성)' } },
  { day: 3, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '산채비빔밥', dinner: true, dinner_note: '소불고기' }, schedule: [
    N(null,'-천자산(케이블카편도) : 하룡공원, 어필봉, 선녀헌화, 천대서해'),
    N(null,'-원가계(백룡엘레베이터편도) : 미혼대, 천하제일교'), N(null,'-십리화랑(모노레일왕복)'), N(null,'-금편계곡')],
    hotel: { name: '풀만호텔 또는 렌조이본관', grade: '5', note: '동급(정5성)' } },
  { day: 4, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '버섯전골', dinner: true, dinner_note: '소고기모듬구이' }, schedule: [
    N(null,'-보봉호수 유람선 VIP'), N(null,'-황룡동굴 VIP'), N(null,'-발+전신마사지(90분) *매너팁별도'), N(null,'-무릉원 야경투어')],
    hotel: { name: '풀만호텔 또는 렌조이본관', grade: '5', note: '동급(정5성)' } },
  { day: 5, regions: ['장가계','부산'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '도시락', dinner: false }, schedule: [
    N(null,'-군성사석화박물관'), F('12:55','장가계 국제공항 출발','BX372'), N('17:00','부산 김해국제공항 도착')], hotel: null },
];

// 더투어 고품격 4박 일정
const ZJJ_GP4_DAYS = [
  { day: 1, regions: ['부산','장가계'], meals: { breakfast: false, lunch: true, lunch_note: '누룽지백숙', dinner: true, dinner_note: '소불고기' }, schedule: [
    F('09:20','부산 김해국제공항 출발','BX371'), N('11:55','장가계 국제공항 도착'),
    N(null,'-칠성산(왕복케이블카+루지편도+유리잔도+유리전망대)'), N(null,'-72기루(내부) 관광')],
    hotel: { name: '하워드존슨 ★디럭스룸 업글★ 또는 무릉원 힐튼가든', grade: '5', note: '동급(정5성)' } },
  { day: 2, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '산채비빔밥', dinner: true, dinner_note: '현지식(폭포뷰)' }, schedule: [
    N(null,'-보봉호수 유람선 VIP'), N(null,'-천문산(케이블카편도) : 천문동, 천문산사+귀곡잔도+유리잔도+동선'),
    N(null,'-부용진 골목투어')],
    hotel: { name: '하워드존슨 또는 무릉원 힐튼가든', grade: '5', note: '동급(정5성)' } },
  { day: 3, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '철판왕삼겹구이(무제한)', dinner: true, dinner_note: '현지식' }, schedule: [
    N(null,'-천자산(케이블카편도) : 하룡공원, 어필봉, 선녀헌화, 천대서해'),
    N(null,'-원가계(백룡엘레베이터편도) : 미혼대, 천하제일교'), N(null,'-십리화랑(모노레일왕복)'), N(null,'-금편계곡'),
    N(null,'-발+전신마사지(90분) *매너팁별도')],
    hotel: { name: '하워드존슨 또는 무릉원 힐튼가든', grade: '5', note: '동급(정5성)' } },
  { day: 4, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '동태매운탕', dinner: true, dinner_note: '소고기모듬구이' }, schedule: [
    N(null,'-장가계대협곡(유리다리+엘리베이터+유람선+봅슬레이+4D VR)'), N(null,'-황룡동굴 VIP'),
    N(null,'-매력상서쇼 관람'), N(null,'-발+전신마사지(90분) *매너팁별도'), N(null,'-무릉원 야경투어')],
    hotel: { name: '하워드존슨 또는 무릉원 힐튼가든', grade: '5', note: '동급(정5성)' } },
  { day: 5, regions: ['장가계','부산'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '도시락', dinner: false }, schedule: [
    N(null,'-군성사석화박물관'), F('12:55','장가계 국제공항 출발','BX372'), N('17:00','부산 김해국제공항 도착')], hotel: null },
];

// ═══════════════════════════════════════════
// 상품 8종 정의
// ═══════════════════════════════════════════

const PRODUCTS = [
  // 1. 나트랑/달랏 라이트
  { title: '나트랑/달랏 노팁노옵션 라이트 3박5일 #마사지60분 #레일바이크 #달랏야시장 #나트랑야시장',
    destination: '나트랑/달랏', category: '패키지', product_type: '노팁노옵션|라이트', trip_style: '관광',
    airline: 'BX', min_participants: 6, country: '베트남', duration: 5, nights: 3, price: 649000,
    land_operator: '투어폰', commission_rate: 9, ticketing_deadline: '2026-04-27',
    summary: '나트랑/달랏 라이트 3박5일. 649,000원~. 호라이즌+멀펄5성. 마사지60분, 레일바이크, 케이블카, 달랏+나트랑 야시장. 쇼핑3회.',
    tags: ['노팁','노옵션','라이트','마사지60분','레일바이크','달랏야시장','나트랑','베트남'],
    highlights: ['노팁노옵션','호라이즌+멀펄 5성','마사지 60분','레일바이크','달랏+나트랑 야시장'],
    price_tiers: buildNhaPriceTiers(0),
    inclusions: ['항공료 및 TAX, 유류비','여행자보험','호텔(2인1실)','차량','가이드','입장료','가이드&기사 TIP'],
    excludes: ['매너팁','유류비변동분','호텔써차지','싱글차지','써차지(미정)'],
    accommodations: ['호라이즌 또는 동급(5성)','멀펄 또는 동급(5성)'],
    special_notes: '노팁노옵션. 쇼핑3회. 과일도시락 특전. 5/20~6/20 수요일 3박5일 증편(BX7517/7527). 마사지팁 나트랑60분$3/달랏60분$4. 베트남 전자담배 반입금지.',
    notices: [
      { type: 'CRITICAL', title: '필수', text: '• 여권 6개월이상\n• 베트남 전자담배 금지(25.1.1~)\n• 공항 현지가이드 미팅' },
      { type: 'PAYMENT', title: '비용', text: '• 마사지팁 나트랑60분$3/달랏60분$4\n• 싱글차지 별도' },
    ],
    days: NHA_LIGHT_DAYS, flight_out: 'BX781', flight_in: 'BX782' },

  // 2. 나트랑/달랏 품격
  { title: '나트랑/달랏 노팁노옵션 품격 3박5일 #머드스파 #마사지90분 #과일뷔페 #씨클로 #천국의계단',
    destination: '나트랑/달랏', category: '패키지', product_type: '노팁노옵션|품격', trip_style: '관광',
    airline: 'BX', min_participants: 6, country: '베트남', duration: 5, nights: 3, price: 729000,
    land_operator: '투어폰', commission_rate: 9, ticketing_deadline: '2026-04-27',
    summary: '나트랑/달랏 품격 3박5일. 729,000원~. 머드스파+과일뷔페+마사지90분+천국의계단+씨클로. 호라이즌+멀펄5성. 쇼핑3회.',
    tags: ['노팁','노옵션','품격','머드스파','마사지90분','과일뷔페','씨클로','천국의계단','나트랑','베트남'],
    highlights: ['머드스파','무제한 과일뷔페','마사지 90분','달랏 천국의계단','나트랑 시티투어+씨클로'],
    price_tiers: buildNhaPriceTiers(1),
    inclusions: ['항공료 및 TAX, 유류비','여행자보험','호텔(2인1실)','차량','가이드','입장료','가이드&기사 TIP'],
    excludes: ['매너팁','유류비변동분','호텔써차지','싱글차지','써차지(미정)'],
    accommodations: ['호라이즌 또는 동급(5성)','멀펄 또는 동급(5성)'],
    special_notes: '노팁노옵션. 쇼핑3회. 과일도시락 특전. 마사지팁 나트랑90분$4/달랏90분$5. 베트남 전자담배 반입금지.',
    notices: [
      { type: 'CRITICAL', title: '필수', text: '• 여권 6개월이상\n• 베트남 전자담배 금지(25.1.1~)\n• 공항 현지가이드 미팅' },
      { type: 'PAYMENT', title: '비용', text: '• 마사지팁 나트랑90분$4/달랏90분$5\n• 싱글차지 별도' },
    ],
    days: NHA_PUMG_DAYS, flight_out: 'BX781', flight_in: 'BX782' },

  // 3. 장가계 노노특가 3박
  { title: '장가계 3박4일 노노특가 #노팁노옵션 #준5성 #대협곡4DVR #무릉원야경 #리무진 #쿨토시',
    destination: '장가계', category: '패키지', product_type: '노팁노옵션|특가', trip_style: '관광',
    airline: 'BX', min_participants: 4, country: '중국', duration: 4, nights: 3, price: 849000,
    land_operator: '더투어', commission_rate: 10, ticketing_deadline: '2026-04-15',
    summary: '장가계 노노특가 3박4일. 849,000원~. 준5성 블루베이/데이즈. 대협곡4DVR, 황룡동굴VIP, 무릉원야경, 보봉호VIP. 쇼핑3회.',
    tags: ['노팁','노옵션','특가','준5성','대협곡','4DVR','무릉원야경','리무진','쿨토시','장가계','중국'],
    highlights: ['노팁노옵션','대협곡 4D VR','황룡동굴 VIP','보봉호 VIP','무릉원 야경'],
    price_tiers: buildZjjNonoPriceTiers('3n'),
    inclusions: ['왕복항공료','유류할증료(4월)','TAX','호텔(2인1실)','식사','전용차량(6명↑리무진)','기사','가이드','입장료','여행자보험','기사/가이드팁'],
    excludes: ['유류변동분','싱글차지($80/인/전일정)','개인경비 및 매너팁'],
    accommodations: ['블루베이호텔 또는 데이즈호텔 또는 동급(준5성)'],
    special_notes: '노옵션. 쇼핑3회(라텍스필수,침향,동인당,게르마늄,차). 쿨토시 증정. 인솔자 미동행. 무비자(2026.12.31까지).',
    notices: [
      { type: 'CRITICAL', title: '필수', text: '• 여권 6개월이상\n• 단수/긴급/관용여권 무비자 불가 가능\n• 무비자 2026.12.31까지' },
    ],
    days: ZJJ_NONO_3N_DAYS, flight_out: 'BX371', flight_in: 'BX372' },

  // 4. 장가계 노노특가 4박
  { title: '장가계 4박5일 노노특가 #노팁노옵션 #준5성 #대협곡4DVR #무릉원야경 #리무진 #쿨토시',
    destination: '장가계', category: '패키지', product_type: '노팁노옵션|특가', trip_style: '관광',
    airline: 'BX', min_participants: 4, country: '중국', duration: 5, nights: 4, price: 969000,
    land_operator: '더투어', commission_rate: 10, ticketing_deadline: '2026-04-15',
    summary: '장가계 노노특가 4박5일. 969,000원~. 준5성. 대협곡4DVR, 황룡동굴VIP, 무릉원야경, 토가풍정원, 보봉호VIP. 쇼핑3회.',
    tags: ['노팁','노옵션','특가','준5성','대협곡','4DVR','무릉원야경','리무진','쿨토시','장가계','중국','4박5일'],
    highlights: ['노팁노옵션','대협곡 4D VR','황룡동굴 VIP','보봉호 VIP','무릉원 야경','토가풍정원'],
    price_tiers: buildZjjNonoPriceTiers('4n'),
    inclusions: ['왕복항공료','유류할증료(4월)','TAX','호텔(2인1실)','식사','전용차량(6명↑리무진)','기사','가이드','입장료','여행자보험','기사/가이드팁'],
    excludes: ['유류변동분','싱글차지($110/인/전일정)','개인경비 및 매너팁'],
    accommodations: ['블루베이호텔 또는 데이즈호텔 또는 동급(준5성)'],
    special_notes: '노옵션. 쇼핑3회. 쿨토시 증정. 인솔자 미동행. 5/11~6/24 화수목 4박.',
    notices: [
      { type: 'CRITICAL', title: '필수', text: '• 여권 6개월이상\n• 무비자 2026.12.31까지' },
    ],
    days: ZJJ_NONO_4N_DAYS, flight_out: 'BX371', flight_in: 'BX372' },

  // 5. 장가계 품격 3박
  { title: '장가계 3박4일 품격 #노팁노옵션 #정5성 #72기루내부 #대협곡4DVR #마사지90분 #쿨토시',
    destination: '장가계', category: '패키지', product_type: '품격|노팁노옵션', trip_style: '관광',
    airline: 'BX', min_participants: 4, country: '중국', duration: 4, nights: 3, price: 969000,
    land_operator: '더투어', commission_rate: 9, ticketing_deadline: '2026-04-15',
    summary: '장가계 품격 3박4일. 969,000원~. 정5성 풀만/렌조이. 72기루내부, 대협곡4DVR, 마사지90분, 무릉원야경, 보봉호VIP. 쇼핑3회.',
    tags: ['노팁','노옵션','품격','정5성','72기루내부','대협곡','마사지90분','무릉원야경','쿨토시','장가계','중국'],
    highlights: ['정5성 풀만/렌조이','72기루 내부관광','대협곡 4D VR','발+전신마사지 90분','무릉원 야경'],
    price_tiers: buildZjjPgPriceTiers(0, '3박'),
    inclusions: ['왕복항공료','유류할증료(4월)','TAX','호텔(2인1실)','식사','전용차량(6명↑리무진)','기사','가이드','입장료','여행자보험','기사/가이드팁','쿨토시 증정'],
    excludes: ['유류변동분','싱글차지($100/인/전일정 *노동절별도)','개인경비 및 매너팁'],
    accommodations: ['풀만호텔 또는 렌조이본관 동급(정5성)'],
    special_notes: '노옵션. 쇼핑3회. 쿨토시 증정. 인솔자 미동행.',
    notices: [{ type: 'CRITICAL', title: '필수', text: '• 여권 6개월이상\n• 무비자 2026.12.31까지' }],
    days: ZJJ_PG3_DAYS, flight_out: 'BX371', flight_in: 'BX372' },

  // 6. 장가계 고품격 3박
  { title: '장가계 3박4일 고품격 #노노노 #정5성 #칠성산루지 #72기루내부 #대협곡4DVR #마사지90분×2 #쿨토시',
    destination: '장가계', category: '패키지', product_type: '고품격|노팁노옵션|노쇼핑', trip_style: '관광',
    airline: 'BX', min_participants: 8, country: '중국', duration: 4, nights: 3, price: 1329000,
    land_operator: '더투어', commission_rate: 9, ticketing_deadline: '2026-04-15',
    summary: '장가계 고품격 3박4일. 1,329,000원~. 정5성 하워드존슨/힐튼가든 디럭스. 노쇼핑. 칠성산루지, 72기루내부, 대협곡4DVR, 마사지90분×2, 부용진. 리무진.',
    tags: ['노팁','노옵션','노쇼핑','고품격','정5성','칠성산','루지','72기루내부','대협곡','마사지90분','장가계','중국'],
    highlights: ['노쇼핑','정5성 하워드존슨 디럭스','칠성산+루지','마사지 90분×2회','72기루 내부','대협곡 4D VR'],
    price_tiers: buildZjjPgPriceTiers(1, '3박'),
    inclusions: ['왕복항공료','유류할증료(4월)','TAX','호텔(2인1실)','식사','리무진버스','기사','가이드','입장료','여행자보험','기사/가이드팁','쿨토시 증정'],
    excludes: ['유류변동분','싱글차지($130/인/전일정 *노동절별도)','개인경비 및 매너팁'],
    accommodations: ['하워드존슨 ★디럭스룸 업글★ 또는 무릉원 힐튼가든 동급(정5성)'],
    special_notes: '노쇼핑. 8명이상 출발. 칠성산 루지 65세이상 탑승불가. 쿨토시 증정.',
    notices: [{ type: 'CRITICAL', title: '필수', text: '• 여권 6개월이상\n• 칠성산 루지 65세이상 불가\n• 8명이상 출발' }],
    days: ZJJ_GP3_DAYS, flight_out: 'BX371', flight_in: 'BX372' },

  // 7. 장가계 품격 4박
  { title: '장가계 4박5일 품격 #노팁노옵션 #정5성 #72기루내부 #대협곡4DVR #마사지90분 #쿨토시',
    destination: '장가계', category: '패키지', product_type: '품격|노팁노옵션', trip_style: '관광',
    airline: 'BX', min_participants: 4, country: '중국', duration: 5, nights: 4, price: 1049000,
    land_operator: '더투어', commission_rate: 9, ticketing_deadline: '2026-04-15',
    summary: '장가계 품격 4박5일. 1,049,000원~. 정5성 풀만/렌조이. 72기루내부, 대협곡4DVR, 마사지90분, 토가풍정원, 무릉원야경, 보봉호VIP. 쇼핑3회.',
    tags: ['노팁','노옵션','품격','정5성','72기루내부','대협곡','마사지90분','무릉원야경','쿨토시','장가계','중국','4박5일'],
    highlights: ['정5성 풀만/렌조이','72기루 내부','대협곡 4D VR','마사지 90분','무릉원 야경','토가풍정원'],
    price_tiers: buildZjjPgPriceTiers(0, '4박'),
    inclusions: ['왕복항공료','유류할증료(4월)','TAX','호텔(2인1실)','식사','전용차량(6명↑리무진)','기사','가이드','입장료','여행자보험','기사/가이드팁','쿨토시 증정'],
    excludes: ['유류변동분','싱글차지($130/인/전일정 *노동절별도)','개인경비 및 매너팁'],
    accommodations: ['풀만호텔 또는 렌조이본관 동급(정5성)'],
    special_notes: '노옵션. 쇼핑3회. 쿨토시 증정. 5/11~6/24 화수목 4박.',
    notices: [{ type: 'CRITICAL', title: '필수', text: '• 여권 6개월이상\n• 무비자 2026.12.31까지' }],
    days: ZJJ_PG4_DAYS, flight_out: 'BX371', flight_in: 'BX372' },

  // 8. 장가계 고품격 4박
  { title: '장가계 4박5일 고품격 #노노노 #정5성 #칠성산루지 #부용진 #72기루내부 #대협곡4DVR #마사지90분×2 #쿨토시',
    destination: '장가계', category: '패키지', product_type: '고품격|노팁노옵션|노쇼핑', trip_style: '관광',
    airline: 'BX', min_participants: 8, country: '중국', duration: 5, nights: 4, price: 1399000,
    land_operator: '더투어', commission_rate: 9, ticketing_deadline: '2026-04-15',
    summary: '장가계 고품격 4박5일. 1,399,000원~. 정5성 하워드존슨/힐튼가든 디럭스. 노쇼핑. 칠성산루지, 부용진, 72기루내부, 대협곡4DVR, 마사지90분×2. 리무진.',
    tags: ['노팁','노옵션','노쇼핑','고품격','정5성','칠성산','루지','부용진','72기루내부','대협곡','마사지90분','장가계','중국','4박5일'],
    highlights: ['노쇼핑','정5성 하워드존슨 디럭스','칠성산+루지','부용진 골목투어','마사지 90분×2회','72기루 내부'],
    price_tiers: buildZjjPgPriceTiers(1, '4박'),
    inclusions: ['왕복항공료','유류할증료(4월)','TAX','호텔(2인1실)','식사','리무진버스','기사','가이드','입장료','여행자보험','기사/가이드팁','쿨토시 증정'],
    excludes: ['유류변동분','싱글차지($170/인/전일정 *노동절별도)','개인경비 및 매너팁'],
    accommodations: ['하워드존슨 ★디럭스룸 업글★ 또는 무릉원 힐튼가든 동급(정5성)'],
    special_notes: '노쇼핑. 8명이상 출발. 칠성산 루지 65세이상 불가. 쿨토시 증정. 5/11~6/24 화수목 4박.',
    notices: [{ type: 'CRITICAL', title: '필수', text: '• 여권 6개월이상\n• 칠성산 루지 65세이상 불가\n• 8명이상 출발' }],
    days: ZJJ_GP4_DAYS, flight_out: 'BX371', flight_in: 'BX372' },
];

// ═══════════════════════════════════════════
// 실행
// ═══════════════════════════════════════════
async function run() {
  console.log(`\n🚀 8종 일괄 등록 시작...\n`);

  for (const p of PRODUCTS) {
    const { data, error } = await sb.from('travel_packages').insert([{
      title: p.title, destination: p.destination, category: p.category, product_type: p.product_type,
      trip_style: p.trip_style, departure_airport: '김해공항', airline: p.airline,
      min_participants: p.min_participants, status: 'approved', country: p.country,
      duration: p.duration, nights: p.nights, price: p.price,
      land_operator: p.land_operator, commission_rate: p.commission_rate,
      ticketing_deadline: p.ticketing_deadline,
      product_summary: p.summary, product_tags: p.tags, product_highlights: p.highlights,
      price_tiers: p.price_tiers, inclusions: p.inclusions, excludes: p.excludes,
      accommodations: p.accommodations, special_notes: p.special_notes, notices_parsed: p.notices,
      itinerary_data: {
        meta: { title: p.title.substring(0, 80), destination: p.destination, nights: p.nights, days: p.duration,
          airline: p.airline, flight_out: p.flight_out, flight_in: p.flight_in, departure_airport: '김해공항' },
        days: p.days,
      },
      filename: `batch-${p.land_operator}-${p.destination}-${p.nights}N-${Date.now()}`,
      file_type: 'manual', confidence: 1.0,
    }]).select('id, title');

    if (error) console.error(`❌ ${p.title.substring(0,40)}:`, error.message);
    else console.log(`✅ ${data[0].title.substring(0,60)} (${data[0].id.substring(0,8)})`);
  }

  console.log(`\n🏁 완료! ${PRODUCTS.length}종\n`);
}

run().catch(console.error);
