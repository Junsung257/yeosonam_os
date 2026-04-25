/**
 * 북해도 실속BA팩 3박4일 (투어폰) 상품 등록
 * 랜드사: 투어폰 | 마진율: 9% | 발권기한: 2026-04-24 (5·6월 선발권조건)
 * 생성일: 2026-04-21
 *
 * 실행법:
 *   node db/insert_tourphone_hokkaido_20260421.js            # dry-run (검증만)
 *   node db/insert_tourphone_hokkaido_20260421.js --insert   # DB 등록
 */

const crypto = require('crypto');
const { createInserter, validatePackage } = require('./templates/insert-template');

const inserter = createInserter({
  landOperator: '투어폰',
  commissionRate: 9,
  ticketingDeadline: '2026-04-24',
  destCode: 'CTS',
});

const { helpers: { flight, normal, optional, shopping, meal } } = inserter;

// ── 원문 보존 (Rule Zero: sha256 동반) ─────────────────────────
const RAW_TEXT = ` 북해도 실속BA팩 3박4일
비에이ㆍ오타루ㆍ도야ㆍ노보리베츠 (4/30~7월)
출발확정
5/7, 5/14, 5/21, 6/4, 6/11,
 7/2, 7/7, 7/9, 7/10, 7/12
4월
4/30
1,599,000원
5월
▶4/24까지
선발권조건
♥초특가♥ 5/14, 21
1,169,000원
♥초특가♥ 5/7
1,149,000원
5/28
1,229,000원
5/31
1,169,000원
6월
▶4/24까지
선발권조건

6/28, 30
1,169,000원
6/29
1,229,000원
6/4, 11, 18
1,349,000원
6/25
1,429,000원
7월
♥특가♥ 7/7
1,169,000원
7/1, 6, 12, 14
1,249,000원
7/3, 4, 8, 13, 15
1,349,000원
7/10, 11
1,369,000원
7/2, 19, 21
1,429,000원
7/9
1,499,000원
7/20, 22
1,529,000원
7/17, 18, 24, 25
1,649,000원
7/23, 26, 28
1,729,000원
7/27, 29
1,799,000원
7/30, 31
1,929,000원
7/5, 16
마감


 북해도 실속BA팩 3박4일
비에이ㆍ오타루ㆍ도야ㆍ노보리베츠 (4/30~7월)

포함사항
왕복항공료+TAX, 전일정 호텔(2인 1실), 기본관광지 입장료, 식사, 전용차량, 여행자보험
불포함사항
유류세(4월 150,800원), 가이드경비(4만원 성인/아동 동일), 싱글차지, 기타 개인경비
비 고
* 최소출발인원 10명부터입니다. 성인/아동 요금 동일합니다.
* 전 일정 3박 싱글차지 28만원/인입니다. (시내 2박 싱글차지 18만원/인)
* 3인실 요청조건으로 불가시 싱글차지 발생될 수 있습니다. (트윈OR더블베드+엑스트라베드)
* 면세점쇼핑 1곳 방문 조건이며, 호텔 만실 시 동급 호텔로 변경될 수 있습니다.
* 호텔 룸배정(3인실, 화실/양실, 베드타입, 옆방배정 등)은 개런티 불가합니다.


일자
지 역
교통편
시 간
주   요   일   정
식 사
1일
부산

치토세
무로란

노보리베츠

도야

BX182

전용
차량
06:30
09:05
11:40
 부산 김해국제공항 국제선 집결
김해 국제공항 출발
신치토세 국제공항 도착 및 입국 수속
무로란 이동
 ▶태평양을 한 눈에 담는 파노라마 절경 지큐미사키
 노보리베츠 이동
 ▶노보리베츠 지옥계곡
 도야 이동
 호텔 체크인 후 및 휴식, ♨온천욕
 ★도야 불꽃놀이 : 4/28~10/31 (20:45 경부터 20분간 // 개별자유)
   ※ 기상 여건에 따라 변동될 수 있습니다
중:현지식

석:호텔식
 HOTEL : 도야 썬팔레스, 만세각 호텔 또는 동급
2일
도야


오타루

삿포로
전용
차량

 호텔 조식 후
 ▶사이로 전망대, 쇼와신산
 ▶홋카이도 최대 규모의 호수 도야호수 유람선 탑승
 오타루 이동
 ▶오타루운하, 오르골당, 키타이치가라스관 (자율관광)
 삿포로 이동
 ▶오오도리 공원
 호텔 체크인 후 및 휴식

조:호텔식

중:현지식

석:현지식
(야키니쿠 뷔페)
 HOTEL : 삿포로 트라벨롯지, 렘브란트 호텔 또는 동급
3일
삿포로
비에이



후라노

삿포로
전용
차량

호텔 조식 후
비에이 이동
 ▶패치워크로드 (차창관광)
 ▶흰수염폭포, 청의 호수, 켄과 메리 나무
 ▶사계채의 언덕
 후라노 이동
 ▶팜도미타 ♥ 라벤더 아이스크림 1인 1개씩 제공 ♥
 삿포로 이동
 ▶스스키노 거리 관광
 호텔 체크인 후 및 휴식
조:호텔식

중:현지식

석:현지식
(1대게뷔페
+샤브샤브
+노미호다이)
 HOTEL : 삿포로 트라벨롯지, 렘브란트 호텔 또는 동급
4일
삿포로

치토세

부산
전용
차량

BX181




12:40
15:30
호텔 조식 후
▶면세 1곳 방문 ♥ 마유크림+마유비누 1인 1개씩 제공 ♥
신치토세공항으로 이동
신치토세 국제공항 출발
김해 국제공항 도착
조:호텔식
상기 일정은 현지 사정 및 항공에 따라 변경될 수 있습니다.


투어폰 9%
등록완료후 결과도출`;

const RAW_TEXT_HASH = crypto.createHash('sha256').update(RAW_TEXT).digest('hex');

// ── 가격 (원문 1:1 매핑) ──────────────────────────────────────
// 출발확정일 (원문 "출발확정" 섹션)
const CONFIRMED_SET = new Set([
  '2026-05-07', '2026-05-14', '2026-05-21', '2026-06-04', '2026-06-11',
  '2026-07-02', '2026-07-07', '2026-07-09', '2026-07-10', '2026-07-12',
]);

function d(m, day, price) {
  const date = `2026-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { date, price, confirmed: CONFIRMED_SET.has(date) };
}

const PRICE_DATES = [
  // 4월
  d(4, 30, 1599000),
  // 5월
  d(5, 7, 1149000),
  d(5, 14, 1169000), d(5, 21, 1169000),
  d(5, 28, 1229000),
  d(5, 31, 1169000),
  // 6월
  d(6, 4, 1349000), d(6, 11, 1349000), d(6, 18, 1349000),
  d(6, 25, 1429000),
  d(6, 28, 1169000), d(6, 30, 1169000),
  d(6, 29, 1229000),
  // 7월
  d(7, 1, 1249000), d(7, 6, 1249000), d(7, 12, 1249000), d(7, 14, 1249000),
  d(7, 2, 1429000), d(7, 19, 1429000), d(7, 21, 1429000),
  d(7, 3, 1349000), d(7, 4, 1349000), d(7, 8, 1349000), d(7, 13, 1349000), d(7, 15, 1349000),
  d(7, 7, 1169000),
  d(7, 9, 1499000),
  d(7, 10, 1369000), d(7, 11, 1369000),
  d(7, 17, 1649000), d(7, 18, 1649000), d(7, 24, 1649000), d(7, 25, 1649000),
  d(7, 20, 1529000), d(7, 22, 1529000),
  d(7, 23, 1729000), d(7, 26, 1729000), d(7, 28, 1729000),
  d(7, 27, 1799000), d(7, 29, 1799000),
  d(7, 30, 1929000), d(7, 31, 1929000),
].sort((a, b) => a.date.localeCompare(b.date));

// 7/5, 7/16 은 마감 → price_dates에서 제외 + excluded_dates에 기록
const EXCLUDED_DATES = ['2026-07-05', '2026-07-16'];

const MIN_PRICE = Math.min(...PRICE_DATES.map(p => p.price));

// ── 일정 (원문 1:1 매핑) ──────────────────────────────────────
const PKG1 = {
  title: '북해도 실속BA팩 3박4일 (비에이·오타루·도야·노보리베츠)',
  destination: '북해도',
  country: '일본',
  category: 'package',
  product_type: '실속',
  trip_style: '3박4일',
  duration: 4,
  nights: 3,
  departure_airport: '부산(김해)',
  departure_days: null, // 원문에 고정 요일 없음 (다양한 날짜)
  airline: 'BX(에어부산)',
  min_participants: 10, // 원문: "최소출발인원 10명부터" (ERR-20260418-01 방지)
  status: 'pending',
  price: MIN_PRICE,

  // 가이드경비 — 원문 "4만원 성인/아동 동일"
  guide_tip: '4만원/인 (성인/아동 동일, 현지지불)',

  // 싱글차지 — 원문 "전 일정 3박 싱글차지 28만원/인 (시내 2박 18만원/인)"
  single_supplement: '전 일정 3박 28만원/인 (시내 2박 18만원/인)',
  small_group_surcharge: null,

  // 날짜 기반 추가요금 없음 (유류세/가이드경비는 별도 필드)
  surcharges: [],
  excluded_dates: EXCLUDED_DATES,

  price_tiers: [],
  price_dates: PRICE_DATES,

  // ── 포함/불포함 (원문 그대로 — 금액 주입 금지, ERR-FUK-insurance-injection) ──
  inclusions: [
    '왕복항공료+TAX',
    '전일정 호텔(2인 1실)',
    '기본관광지 입장료',
    '식사',
    '전용차량',
    '여행자보험',
  ],
  excludes: [
    '유류세 (4월 150,800원)',
    '가이드경비 4만원/인 (성인/아동 동일)',
    '싱글차지',
    '기타 개인경비',
  ],

  // ── 숙소 ──
  accommodations: [
    '도야 썬팔레스 또는 만세각 호텔 (또는 동급) × 1박',
    '삿포로 트라벨롯지 또는 렘브란트 호텔 (또는 동급) × 2박',
  ],

  // ── 셀링포인트 (고객 어필용, 운영 정보 금지) ──
  product_highlights: [
    '도야 온천욕 + 불꽃놀이 관람',
    '1대게 뷔페 + 샤브샤브 + 노미호다이',
    '비에이 청의 호수 & 사계채의 언덕',
    '팜도미타 라벤더 아이스크림 + 마유크림 증정',
  ],

  product_summary: '부산에서 출발해 도야 온천과 삿포로 시내까지 돌아보는 3박4일 북해도 여행이에요. 노보리베츠 지옥계곡, 오타루 운하, 비에이 청의 호수 같은 북해도 대표 명소를 도야 불꽃놀이와 라벤더 아이스크림 체험과 함께 담았습니다. 1대게 뷔페와 야키니쿠 만찬도 빠지지 않아요.',

  product_tags: ['북해도', '홋카이도', '비에이', '오타루', '도야', '노보리베츠', '삿포로', '부산출발', '에어부산', '실속', '온천', '대게뷔페'],

  optional_tours: [],

  // ── 유의사항 (원문 비고 축약 금지, ERR-20260418-02) ──
  notices_parsed: [
    {
      type: 'CRITICAL',
      title: '최소출발인원',
      text: '최소출발인원 10명부터입니다. 성인/아동 요금 동일합니다.',
    },
    {
      type: 'PAYMENT',
      title: '싱글차지 / 객실 안내',
      text: '• 전 일정 3박 싱글차지 28만원/인 (시내 2박 싱글차지 18만원/인)\n• 3인실 요청조건으로 불가시 싱글차지가 발생될 수 있습니다. (트윈 OR 더블베드 + 엑스트라베드)\n• 호텔 룸배정(3인실, 화실/양실, 베드타입, 옆방배정 등)은 개런티 불가합니다.',
    },
    {
      type: 'INFO',
      title: '쇼핑 / 호텔 / 일정 변경',
      text: '• 면세점쇼핑 1곳 방문 조건이며, 호텔 만실 시 동급 호텔로 변경될 수 있습니다.\n• 상기 일정은 현지 사정 및 항공에 따라 변경될 수 있습니다.',
    },
    {
      type: 'OPTIONAL',
      title: '도야 불꽃놀이 (개별자유)',
      text: '도야 불꽃놀이 : 4/28~10/31 (20:45 경부터 20분간 / 개별자유). 기상 여건에 따라 변동될 수 있습니다.',
    },
  ],

  // 내부 운영 메모 금지 (ERR-FUK-customer-leaks / W21)
  special_notes: null,

  // ── 일정표 ──
  itinerary_data: {
    meta: {
      title: '북해도 실속BA팩 3박4일 (비에이·오타루·도야·노보리베츠)',
      product_type: '실속',
      destination: '북해도',
      nights: 3,
      days: 4,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX182',
      flight_in: 'BX181',
      departure_days: null,
      min_participants: 10,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-24',
      hashtags: ['#북해도', '#홋카이도', '#도야불꽃놀이', '#비에이', '#오타루', '#부산출발'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복항공료+TAX',
        '전일정 호텔(2인 1실)',
        '기본관광지 입장료',
        '식사',
        '전용차량',
        '여행자보험',
      ],
      excludes: [
        '유류세 (4월 150,800원)',
        '가이드경비 4만원/인 (성인/아동 동일)',
        '싱글차지',
        '기타 개인경비',
      ],
      shopping: '면세점 1곳 방문 (마유크림 + 마유비누 1인 1개씩 제공)',
      remarks: [
        '최소출발인원 10명부터 (성인/아동 요금 동일)',
        '전 일정 3박 싱글차지 28만원/인 (시내 2박 18만원/인)',
        '3인실 요청조건으로 불가시 싱글차지 발생 가능',
        '호텔 만실 시 동급 호텔 변경 가능',
        '도야 불꽃놀이는 기상 여건에 따라 변동 가능 (개별자유)',
        '상기 일정은 현지 사정 및 항공에 따라 변경될 수 있습니다',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '치토세', '무로란', '노보리베츠', '도야'],
        meals: meal(false, true, true, null, '현지식', '호텔식'),
        schedule: [
          flight('06:30', 'BX182 부산(김해) 출발 → 신치토세 09:05 도착', 'BX182'),
          normal(null, '입국 수속 후 무로란 이동 (11:40)'),
          normal(null, '▶지큐미사키 (태평양을 한 눈에 담는 파노라마 절경)'),
          normal(null, '노보리베츠 이동'),
          normal(null, '▶노보리베츠 지옥계곡'),
          normal(null, '도야 이동 / 호텔 체크인 및 휴식'),
          normal(null, '♨ 온천욕'),
          optional(null, '★ 도야 불꽃놀이 (4/28~10/31, 20:45경 20분간 / 개별자유)', '기상 여건에 따라 변동 가능'),
          { time: null, activity: '도야 썬팔레스 또는 만세각 호텔 (또는 동급) 투숙', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '도야 썬팔레스 또는 만세각 호텔 (또는 동급)', grade: null, note: null },
      },
      {
        day: 2,
        regions: ['도야', '오타루', '삿포로'],
        meals: meal(true, true, true, '호텔식', '현지식', '야키니쿠 뷔페'),
        schedule: [
          normal(null, '호텔 조식 후 출발'),
          normal(null, '▶사이로 전망대'),
          normal(null, '▶쇼와신산'),
          normal(null, '▶도야호수 유람선 (홋카이도 최대 규모의 호수)'),
          normal(null, '오타루 이동'),
          normal(null, '▶오타루운하'),
          normal(null, '▶오르골당'),
          normal(null, '▶키타이치가라스관 (자율관광)'),
          normal(null, '삿포로 이동'),
          normal(null, '▶오오도리 공원'),
          normal(null, '호텔 체크인 및 휴식'),
          { time: null, activity: '삿포로 트라벨롯지 또는 렘브란트 호텔 (또는 동급) 투숙', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '삿포로 트라벨롯지 또는 렘브란트 호텔 (또는 동급)', grade: null, note: null },
      },
      {
        day: 3,
        regions: ['삿포로', '비에이', '후라노', '삿포로'],
        meals: meal(true, true, true, '호텔식', '현지식', '1대게 뷔페 + 샤브샤브 + 노미호다이'),
        schedule: [
          normal(null, '호텔 조식 후 비에이 이동'),
          normal(null, '▶패치워크로드 (차창관광)'),
          normal(null, '▶흰수염폭포'),
          normal(null, '▶청의 호수'),
          normal(null, '▶켄과 메리 나무'),
          normal(null, '▶사계채의 언덕'),
          normal(null, '후라노 이동'),
          normal(null, '▶팜도미타 (라벤더 아이스크림 1인 1개씩 제공 ♥)'),
          normal(null, '삿포로 이동'),
          normal(null, '▶스스키노 거리 관광'),
          normal(null, '호텔 체크인 및 휴식'),
          { time: null, activity: '삿포로 트라벨롯지 또는 렘브란트 호텔 (또는 동급) 투숙', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '삿포로 트라벨롯지 또는 렘브란트 호텔 (또는 동급)', grade: null, note: null },
      },
      {
        day: 4,
        regions: ['삿포로', '치토세', '부산'],
        meals: meal(true, false, false, '호텔식', null, null),
        schedule: [
          normal(null, '호텔 조식 후 출발'),
          shopping(null, '▶면세점 1곳 방문 (마유크림 + 마유비누 1인 1개씩 제공 ♥)'),
          normal(null, '신치토세공항으로 이동'),
          flight('12:40', 'BX181 신치토세 출발 → 부산(김해) 15:30 도착', 'BX181'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [],
  },

  itinerary: [
    '제1일: 부산(BX182 06:30) → 치토세(09:05) → 무로란 → 지큐미사키 → 노보리베츠 지옥계곡 → 도야 (온천욕 / 도야 불꽃놀이 개별자유)',
    '제2일: 도야 → 사이로 전망대, 쇼와신산, 도야호수 유람선 → 오타루 (운하, 오르골당, 키타이치가라스관) → 삿포로 오오도리 공원',
    '제3일: 삿포로 → 비에이 (패치워크로드, 흰수염폭포, 청의 호수, 켄과 메리 나무, 사계채의 언덕) → 후라노 팜도미타 → 삿포로 스스키노',
    '제4일: 삿포로 → 면세점 방문 → 치토세(BX181 12:40) → 부산(15:30)',
  ],

  raw_text: RAW_TEXT,
  raw_text_hash: RAW_TEXT_HASH,
  filename: 'manual_input_20260421_hokkaido',
  file_type: 'manual',
  confidence: 1.0,
};

// ── dry-run 검증 ──────────────────────────────────────────────
function dryRun() {
  console.log('\n=== dry-run 검증 ===\n');
  const { errors, warnings } = validatePackage(PKG1);

  if (warnings.length > 0) {
    console.log(`경고 (${PKG1.title}):`);
    warnings.forEach(w => console.log(`   W: ${w}`));
  }

  if (errors.length > 0) {
    console.error(`\n검증 실패 (${errors.length}건):`);
    errors.forEach(e => console.error(`   E: ${e}`));
    console.error('\n→ 위 오류를 수정한 후 --insert를 실행하세요.');
    process.exit(1);
  } else {
    console.log('검증 통과 — 모든 필수 필드 정상\n');
    console.log(`title:           ${PKG1.title}`);
    console.log(`destination:     ${PKG1.destination}`);
    console.log(`duration:        ${PKG1.nights}박 ${PKG1.duration}일`);
    console.log(`airline:         ${PKG1.airline}`);
    console.log(`min_participants:${PKG1.min_participants}`);
    console.log(`price_dates:     ${PKG1.price_dates.length}건 (${MIN_PRICE.toLocaleString()}원 ~ ${Math.max(...PKG1.price_dates.map(p => p.price)).toLocaleString()}원)`);
    console.log(`excluded_dates:  ${PKG1.excluded_dates.length}건 (${PKG1.excluded_dates.join(', ')})`);
    console.log(`confirmed:       ${PKG1.price_dates.filter(p => p.confirmed).length}건`);
    console.log(`inclusions:      ${PKG1.inclusions.length}건`);
    console.log(`excludes:        ${PKG1.excludes.length}건`);
    console.log(`highlights:      ${PKG1.product_highlights.join(' / ')}`);
    console.log(`itinerary:       ${PKG1.itinerary_data.days.length}일`);
    console.log(`notices_parsed:  ${PKG1.notices_parsed.length}건`);
    console.log(`raw_text_hash:   ${RAW_TEXT_HASH.slice(0, 16)}... (${RAW_TEXT.length}자)`);
    if (warnings.length === 0) console.log('\n경고 없음 — 바로 등록 가능\n');
  }
}

// ── 실행 분기 ────────────────────────────────────────────────
const ALL_PACKAGES = [PKG1];
const doInsert = process.argv.includes('--insert');

if (doInsert) {
  inserter.run(ALL_PACKAGES);
} else {
  dryRun();
  console.log('\n→ 실제 등록하려면:  node db/insert_tourphone_hokkaido_20260421.js --insert');
}
