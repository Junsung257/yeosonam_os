/**
 * 블록 마스터 시딩 v1
 * 장가계 + 나트랑 지역 마스터, 관광 블록, 코스 템플릿
 *
 * 실행 순서:
 * 1. block_master_v1.sql 먼저 실행 (테이블 생성)
 * 2. node block_master_seed_v1.js (데이터 시딩)
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── 헬퍼 ──
const N = (time, activity) => ({ time, activity, type: 'normal' });
const F = (time, activity, transport) => ({ time, activity, type: 'flight', transport });
const G = (time, activity) => ({ time, activity, type: 'golf' });
const S = (time, activity) => ({ time, activity, type: 'shopping' });

async function run() {
  console.log('🚀 블록 마스터 시딩 시작...\n');

  // ═══════════════════════════════════════════
  // STEP 1: 지역 마스터
  // ═══════════════════════════════════════════
  const destinations = [
    {
      name: '장가계', country: '중국', region_code: 'ZJJ',
      default_airline: 'BX', default_flight_out: 'BX371', default_flight_in: 'BX372',
      default_departure_airport: '김해공항',
      flight_out_time: '09:00', arrival_time: '11:20',
      return_departure_time: '12:20', flight_in_time: '16:35',
      hotel_pool: [
        { grade: '4성', names: ['장가계 국제호텔'], score: 1 },
        { grade: '준5성', names: ['블루베이', '베스트웨스턴호텔'], score: 2 },
        { grade: '정5성', names: ['선샤인호텔', '피닉스호텔', '청하금강호텔'], score: 3 },
        { grade: '특5성', names: ['풀만', '하워드존슨(하얏트)', '힐튼', '렌조이', '무릉원 힐튼가든'], score: 4 },
      ],
      meal_pool: [
        { slot: 'day1_lunch', default: '누룽지백숙' },
        { slot: 'day1_dinner', variants: ['호텔식', '호텔식(원탁)', '훠궈(하이디라오)', '철판왕삼겹'] },
        { slot: 'day2_lunch', default: '산채비빔밥', variants: ['비빔밥', '산채비빔밥'] },
        { slot: 'day2_dinner', default: '불고기', variants: ['불고기', '불고기정식', '소불고기', '한정식'] },
        { slot: 'day3_lunch', default: '버섯전골', variants: ['버섯전골', '현지식'] },
        { slot: 'day3_dinner', default: '삼겹살 무제한', variants: ['삼겹살 무제한', '양꼬치+맥주1병'] },
        { slot: 'last_lunch', default: '김밥 또는 도시락', variants: ['김밥도시락', '김밥+생수', '도시락+생수'] },
      ],
      common_notices: [
        { type: 'CRITICAL', title: '필수 확인', text: '• 여권 유효기간 출발일기준 6개월이상\n• 단수여권, 긴급여권, 관용여권 입국불가' },
        { type: 'INFO', title: '안내', text: '• 상기 일정은 현지 및 항공사 사정에 의해 변경될 수 있습니다' },
      ],
      keywords: ['장가계', '천문산', '천자산', '원가계', '백룡', '칠성산', '대협곡', '보봉호', '황룡동굴', '72기루', '부용진'],
    },
    {
      name: '나트랑', country: '베트남', region_code: 'NHA',
      default_airline: 'BX', default_flight_out: 'BX781', default_flight_in: 'BX782',
      default_departure_airport: '김해공항',
      flight_out_time: '19:30', arrival_time: '22:40',
      return_departure_time: '23:40', flight_in_time: '06:20',
      hotel_pool: [
        { grade: '5성', names: ['호라이즌호텔', '하바나호텔', '퀸터센트럴호텔'], score: 3 },
        { grade: '5성(달랏)', names: ['멀펄달랏호텔'], score: 3 },
        { grade: '골프텔', names: ['다이아몬드CC 골프텔 빌라'], score: 2.5 },
      ],
      meal_pool: [
        { slot: 'dalat_day1_lunch', default: '현지식(분짜+반쎄오)' },
        { slot: 'dalat_day1_dinner', default: '한식(제육쌈밥)', variants: ['제육쌈밥', '5성 호텔식'] },
        { slot: 'dalat_day2_lunch', default: '현지식(샤브샤브/닭구이)' },
        { slot: 'dalat_day2_dinner', default: '한식(무제한삼겹살)' },
        { slot: 'dalat_day3_lunch', default: '현지식(세트메뉴)' },
        { slot: 'dalat_day3_dinner', default: '한식(소불고기전골)' },
        { slot: 'hopping_day_lunch', default: '호핑식' },
        { slot: 'hopping_day_dinner', default: '김치전골' },
      ],
      common_notices: [
        { type: 'CRITICAL', title: '필수 확인', text: '• 여권 만료일 출발일 기준 6개월 이상\n• 2025.01.01부터 베트남 전자담배 금지\n• 만15세 미만 아동 가족관계증명서 영문본 필수' },
        { type: 'PAYMENT', title: '항공', text: '• 항공 GV2 기준, 2인 이상 발권 후 GV 깨질시 전체 취소수수료' },
      ],
      keywords: ['나트랑', '달랏', '판랑', '포나가르', '크레이지하우스', '랑비앙', '죽림사', '다딴라', '롱선사', '빈펄', '다이아몬드'],
    },
  ];

  // 지역 마스터 INSERT
  const destMap = {};
  for (const d of destinations) {
    const { data, error } = await sb.from('destination_masters').upsert([d], { onConflict: 'name' }).select('id, name');
    if (error) { console.error(`❌ 지역 ${d.name}:`, error.message); continue; }
    destMap[d.name] = data[0].id;
    console.log(`✅ 지역: ${d.name} (${data[0].id})`);
  }

  // ═══════════════════════════════════════════
  // STEP 2: 관광 블록 — 장가계
  // ═══════════════════════════════════════════
  const zjjId = destMap['장가계'];
  const zjjBlocks = [
    {
      block_code: 'ZJJ-ARR', name: '장가계 도착',
      block_type: 'transfer', duration: 'half',
      schedule: [
        F('09:00', '김해 국제공항 출발', 'BX371'),
        N('11:20', '장가계 도착 / 가이드 미팅 후 중식'),
      ],
      default_meals: { lunch: '누룽지백숙' },
      keywords: ['장가계 도착', 'BX371'],
      quality_score: 0, typical_day_position: 'day1',
    },
    {
      block_code: 'ZJJ-DEP', name: '장가계 출발 (귀국)',
      block_type: 'transfer', duration: 'morning',
      schedule: [
        N(null, '호텔 조식 후'),
        N(null, '▶군성사석화박물관'),
        F('12:20', '장가계 출발', 'BX372'),
        N('16:35', '부산 도착'),
      ],
      default_meals: { breakfast: '호텔식', lunch: '김밥 또는 도시락' },
      keywords: ['군성사석화', 'BX372', '부산 도착'],
      quality_score: 0, typical_day_position: 'last',
    },
    {
      block_code: 'ZJJ-B001', name: '천문산 등정',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶장가계의 혼이라 불리는 천문산 등정'),
        N(null, '신선이 만든 듯한 기기묘묘한 봉우리들의 절경 감상'),
        N(null, '999개의 계단위 하늘로 통하는 문 천문동'),
        N(null, '케이블카 상행-에스컬레이터-천문산사-귀곡잔도-유리잔도-천문산동선-케이블카 하행'),
      ],
      keywords: ['천문산', '천문동', '귀곡잔도', '유리잔도', '천문산 등정'],
      quality_score: 2, typical_day_position: 'day1',
    },
    {
      block_code: 'ZJJ-B002', name: '천자산 + 원가계 + 백룡엘리베이터',
      block_type: 'sightseeing', duration: 'full',
      schedule: [
        N(null, '▶천자산 풍경구로 이동'),
        N(null, '-2KM의 케이블카로 천자산 등정'),
        N(null, '-붓을 꽂아놓은 듯한 형상의 어필봉'),
        N(null, '-봉우리의 모양이 마치 선녀와 같은 선녀헌화'),
        N(null, '-중국의 10대 원수 하룡장군의 동상이 있는 하룡공원'),
        N(null, '▶원가계로 이동'),
        N(null, '-200M의 봉우리 2개가 연결되어 있는 천하제일교'),
        N(null, '-천태만상의 봉우리들의 향연 미혼대, 후화원'),
        N(null, '-중국 최장의 백룡엘리베이터(326M)로 하산'),
      ],
      keywords: ['천자산', '원가계', '백룡엘리베이터', '어필봉', '선녀헌화', '하룡공원', '천하제일교'],
      quality_score: 3, typical_day_position: 'day2',
    },
    {
      block_code: 'ZJJ-B003', name: '보봉호 유람',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶반자연, 반인공의 아름다운 보봉호 유람(VIP통로)'),
      ],
      keywords: ['보봉호'],
      quality_score: 1, typical_day_position: 'any',
    },
    {
      block_code: 'ZJJ-B004', name: '황룡동굴',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶상하 4층 크기의 대형 석회암동굴 황룡동굴'),
      ],
      keywords: ['황룡동굴', '황용동굴'],
      quality_score: 1, typical_day_position: 'any',
      is_optional: true, option_price_usd: 50,
    },
    {
      block_code: 'ZJJ-B004V', name: '황룡동굴 (VIP)',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶상하 4층 크기의 대형 석회암동굴 황룡동굴(VIP통로)'),
      ],
      keywords: ['황룡동굴VIP', '황룡동굴(VIP'],
      quality_score: 1.5, typical_day_position: 'any',
    },
    {
      block_code: 'ZJJ-B005', name: '칠성산 (케이블카+전망대)',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶7개의 봉우리가 북두칠성을 가리키는 칠성산'),
        N(null, '-왕복케이블카, 유리전망대'),
      ],
      keywords: ['칠성산', '북두칠성', '유리전망대'],
      quality_score: 1.5, typical_day_position: 'any',
    },
    {
      block_code: 'ZJJ-B005L', name: '칠성산 (케이블카+전망대+루지)',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶7개의 봉우리가 북두칠성을 가리키는 칠성산'),
        N(null, '-왕복케이블카, 유리전망대, 편도 루지'),
      ],
      keywords: ['칠성산', '루지'],
      quality_score: 2, typical_day_position: 'any',
    },
    {
      block_code: 'ZJJ-B006', name: '대협곡 유리다리',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶중국 최고의 협곡 장가계 대협곡'),
        N(null, '총길이 430M, 넓이 6M, 계곡에서의 높이 300M에 달하는 세계 최고의'),
        N(null, '스카이 워크 대협곡 유리다리+엘리베이터+봅슬레이+신천호유람'),
      ],
      keywords: ['대협곡', '유리다리', '봅슬레이', '신천호'],
      quality_score: 2.5, typical_day_position: 'any',
      is_optional: true, option_price_usd: 100,
    },
    {
      block_code: 'ZJJ-B007W', name: '72기루 (차창)',
      block_type: 'night', duration: 'night',
      schedule: [
        N(null, '▶장가계의 떠오르는 야경명소 72기루(차창)'),
      ],
      keywords: ['72기루', '차창'],
      quality_score: 0.5, typical_day_position: 'any',
      is_optional: true, option_price_usd: 20,
    },
    {
      block_code: 'ZJJ-B007I', name: '72기루 (내부관광)',
      block_type: 'night', duration: 'night',
      schedule: [
        N(null, '▶장가계의 떠오르는 야경명소 72기루(내부관광)'),
      ],
      keywords: ['72기루', '내부관광', '내부입장'],
      quality_score: 1.5, typical_day_position: 'any',
    },
    {
      block_code: 'ZJJ-B008', name: '부용진 야경',
      block_type: 'night', duration: 'night',
      schedule: [
        N(null, '▶폭포마을 부용진 마을 야경관광'),
      ],
      keywords: ['부용진', '폭포마을'],
      quality_score: 2, typical_day_position: 'any',
    },
    {
      block_code: 'ZJJ-B009', name: '십리화랑 + 금편계곡',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶한폭의 거대한 산수화 십리화랑(왕복 모노레일)'),
        N(null, '▶기봉과 괴석, 협곡의 대자연 금편계곡(도보산책)'),
      ],
      keywords: ['십리화랑', '금편계곡', '모노레일'],
      quality_score: 1.5, typical_day_position: 'day2',
    },
    {
      block_code: 'ZJJ-B010', name: '토가풍정원',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶토가족들의 생활을 엿볼 수 있는 토가풍정원'),
      ],
      keywords: ['토가풍정원', '토가족'],
      quality_score: 0.5, typical_day_position: 'any',
    },
    {
      block_code: 'ZJJ-M001', name: '발마사지 50분',
      block_type: 'massage', duration: 'night',
      schedule: [
        N(null, '▶여행의 피로를 풀어주는 발마사지(50분/매너팁별도)'),
      ],
      keywords: ['발마사지', '마사지50분', '마사지(50분'],
      quality_score: 1, typical_day_position: 'any',
    },
    {
      block_code: 'ZJJ-M002', name: '발+전신마사지 90분',
      block_type: 'massage', duration: 'night',
      schedule: [
        N(null, '▶여행의 피로를 풀어주는 발+전신마사지(90분/매너팁별도)'),
      ],
      keywords: ['전신마사지', '마사지90분', '마사지(90분'],
      quality_score: 2, typical_day_position: 'any',
    },
    {
      block_code: 'ZJJ-S001', name: '천문호선쇼',
      block_type: 'show', duration: 'night',
      schedule: [
        N(null, '▶천문산을 배경으로 펼쳐지는 대형오페라쇼 천문호선쇼 관람'),
      ],
      keywords: ['천문호선쇼', '호선쇼'],
      quality_score: 1, typical_day_position: 'day1',
      is_optional: true, option_price_usd: 60,
    },
    {
      block_code: 'ZJJ-S002', name: '매력상서쇼',
      block_type: 'show', duration: 'night',
      schedule: [
        N(null, '▶토가족의 문화를 재현한 뮤지컬쇼 매력상서쇼 관람'),
      ],
      keywords: ['매력상서쇼', '상서쇼'],
      quality_score: 1, typical_day_position: 'any',
    },
    {
      block_code: 'ZJJ-G001', name: '천문산CC 18홀 라운딩',
      block_type: 'golf', duration: 'full',
      schedule: [
        G(null, '천문산CC 18홀 라운딩'),
      ],
      keywords: ['천문산CC', '천문산골프', '라운딩'],
      quality_score: 2, typical_day_position: 'any',
    },
  ];

  // ═══════════════════════════════════════════
  // STEP 2b: 관광 블록 — 나트랑
  // ═══════════════════════════════════════════
  const nhaId = destMap['나트랑'];
  const nhaBlocks = [
    {
      block_code: 'NHA-ARR', name: '나트랑 도착',
      block_type: 'transfer', duration: 'night',
      schedule: [
        F('19:30', '김해 국제공항 출발', 'BX781'),
        N('22:40', '나트랑 깜란 국제공항 도착'),
        N(null, '현지가이드 미팅 후 호텔 이동'),
        N(null, '호텔 투숙 및 휴식'),
      ],
      keywords: ['나트랑 도착', 'BX781', '깜란'],
      quality_score: 0, typical_day_position: 'day1',
    },
    {
      block_code: 'NHA-DEP', name: '나트랑 출발 (귀국)',
      block_type: 'transfer', duration: 'night',
      schedule: [
        N(null, '나트랑 공항으로 이동'),
        F('23:40', '나트랑 깜란 국제공항 출발', 'BX782'),
      ],
      keywords: ['BX782', '공항 출발'],
      quality_score: 0, typical_day_position: 'last',
    },
    {
      block_code: 'NHA-DEPA', name: '부산 도착 (익일)',
      block_type: 'transfer', duration: 'morning',
      schedule: [
        N('06:20', '김해 국제공항 도착'),
      ],
      keywords: ['김해 도착', '부산 도착'],
      quality_score: 0, typical_day_position: 'last',
    },
    {
      block_code: 'NHA-B001', name: '포나가르탑',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶참파 유적지 중 가장 오래된 포나가르탑'),
      ],
      keywords: ['포나가르', '참파'],
      quality_score: 1, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-B002', name: '크레이지 하우스',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶기괴한 모양의 독특하고 신비한 크레이지 하우스'),
      ],
      keywords: ['크레이지하우스', '크레이지 하우스'],
      quality_score: 1, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-B003', name: '바오다이 별장',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶바오다이 황제의 여름별장'),
      ],
      keywords: ['바오다이'],
      quality_score: 0.5, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-B004', name: '랑비앙 전망대 (지프차)',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶달랏의 지붕 해발 1900M의 랑비앙 전망대(지프차왕복)'),
      ],
      keywords: ['랑비앙', '지프차'],
      quality_score: 1.5, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-B005', name: '달랏기차역 + 도멘드마리성당',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶달랏기차역'),
        N(null, '▶도멘 드 마리 성당'),
      ],
      keywords: ['달랏기차역', '기차역', '도멘', '마리 성당'],
      quality_score: 1, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-B006', name: '죽림사 (케이블카)',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶달랏에서 가장 큰 사원인 죽림사(케이블카)'),
      ],
      keywords: ['죽림사', '케이블카'],
      quality_score: 1.5, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-B007', name: '다딴라 폭포 (레일바이크)',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶베트남에서 가장 유명한 다딴라 폭포(레일바이크 탑승)'),
      ],
      keywords: ['다딴라', '레일바이크'],
      quality_score: 1.5, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-B008', name: '린푸억사원',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶화려한 색감을 자랑하는 린푸억사원'),
      ],
      keywords: ['린푸억'],
      quality_score: 1, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-B009', name: '쑤언흐엉호수 + 커피',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶쑤언흐엉호수 ▶커피 1잔(위즐/코코넛)'),
      ],
      keywords: ['쑤언흐엉', '위즐커피'],
      quality_score: 0.5, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-B010', name: '롱선사',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶나트랑에서 가장 오래된 사원 롱선사'),
      ],
      keywords: ['롱선사', '롱손사'],
      quality_score: 0.5, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-B011', name: '나트랑 대성당 (차창)',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶유럽풍 성당으로 순전히 돌로 지어진 나트랑 대성당(차창관광)'),
      ],
      keywords: ['나트랑 대성당', '대성당'],
      quality_score: 0.5, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-B012', name: '침향타워 + 나트랑비치',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶나트랑의 랜드마크 침향타워&나트랑비치'),
      ],
      keywords: ['침향타워', '나트랑비치'],
      quality_score: 0.5, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-B013', name: '달랏→나트랑 이동',
      block_type: 'transfer', duration: 'transfer',
      schedule: [
        N(null, '나트랑으로 이동(약 3시간30분)'),
      ],
      keywords: ['나트랑으로 이동', '3시간30분'],
      quality_score: 0, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-B014', name: '나트랑→달랏 이동',
      block_type: 'transfer', duration: 'transfer',
      schedule: [
        N(null, '달랏으로 이동(약 3시간30분)'),
      ],
      keywords: ['달랏으로 이동'],
      quality_score: 0, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-B015', name: '담시장',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶나트랑에서 가장 크고 오래된 담시장'),
      ],
      keywords: ['담시장'],
      quality_score: 0.5, typical_day_position: 'any',
    },
    // 판랑 블록
    {
      block_code: 'NHA-PL01', name: '판랑 사막투어 (지프차)',
      block_type: 'sightseeing', duration: 'full',
      schedule: [
        N(null, '호텔 조식 후 판랑으로 이동(약 2시간)'),
        N(null, '▶탄요리 몽골마을 관광'),
        N(null, '▶판랑 사막투어 지프차 A코스(화이트샌듄+옐로우샌듄)'),
        N(null, '▶닌투언성 염전관광'),
        N(null, '▶416광장'),
        N(null, '▶투롱선 사원 관광'),
      ],
      keywords: ['판랑', '사막투어', '몽골마을', '염전', '화이트샌듄'],
      quality_score: 2.5, typical_day_position: 'day2',
    },
    {
      block_code: 'NHA-HP01', name: '해적 호핑투어',
      block_type: 'sightseeing', duration: 'full',
      schedule: [
        N(null, '▶해적 호핑투어 진행'),
        N(null, '스피드보트→해적선 이동'),
        N(null, '스노클링, 워터슬라이드, 다이빙, 낚시 등'),
        N(null, '음료무제한(커피,맥주,보드카), 선상해물라면, 열대과일'),
        N(null, '러브아리랜드 도착 후 중식(호핑식)'),
      ],
      keywords: ['호핑투어', '해적', '스노클링', '워터슬라이드'],
      quality_score: 2.5, typical_day_position: 'day3',
    },
    // 야간/특전
    {
      block_code: 'NHA-N001', name: '달랏 야시장',
      block_type: 'night', duration: 'night',
      schedule: [
        N(null, '▶달랏의 명물 달랏 야시장투어(자유시간)'),
      ],
      keywords: ['달랏 야시장'],
      quality_score: 1, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-N002', name: '나트랑 야간시티투어 (야시장+씨클로+맥주+피자)',
      block_type: 'night', duration: 'night',
      schedule: [
        N(null, '▶나트랑 야간시티투어(야시장+해변바+씨클로+맥주+피자)'),
      ],
      keywords: ['야간시티투어', '씨클로', '야시장'],
      quality_score: 1.5, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-M001', name: '전통마사지 60분',
      block_type: 'massage', duration: 'night',
      schedule: [
        N(null, '▶전통마사지 60분(팁별도)'),
      ],
      keywords: ['마사지60분', '마사지 60분', '맛사지60분'],
      quality_score: 1.5, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-M002', name: '전통마사지 120분',
      block_type: 'massage', duration: 'night',
      schedule: [
        N(null, '▶전통마사지 120분(팁별도)'),
      ],
      keywords: ['마사지120분', '마사지 120분'],
      quality_score: 3, typical_day_position: 'any',
    },
    // 골프
    {
      block_code: 'NHA-G001', name: '3색골프 (빈펄/다이아몬드/KN)',
      block_type: 'golf', duration: 'full',
      schedule: [
        G(null, '★빈펄CC / 다이아몬드CC / KN CC 중 18홀 라운딩'),
      ],
      keywords: ['빈펄CC', '다이아몬드CC', 'KNCC', 'KN CC', '3색골프'],
      quality_score: 2, typical_day_position: 'any',
    },
    {
      block_code: 'NHA-G002', name: '다이아몬드CC 라운딩',
      block_type: 'golf', duration: 'full',
      schedule: [
        G(null, '★다이아몬드CC 18홀 라운딩'),
      ],
      keywords: ['다이아몬드CC', '다이아몬드베이'],
      quality_score: 2, typical_day_position: 'any',
    },
    // 나트랑 시내관광 (마지막날 패턴)
    {
      block_code: 'NHA-CITY', name: '나트랑 시내관광',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶롱선사'),
        N(null, '▶나트랑 대성당(차창관광)'),
      ],
      keywords: ['시내관광', '롱선사', '대성당'],
      quality_score: 1, typical_day_position: 'last',
    },
  ];

  // 블록 INSERT
  const allBlocks = [
    ...zjjBlocks.map(b => ({ ...b, destination_id: zjjId })),
    ...nhaBlocks.map(b => ({ ...b, destination_id: nhaId })),
  ];

  for (const b of allBlocks) {
    const { data, error } = await sb.from('tour_blocks').upsert([b], { onConflict: 'block_code' }).select('id, block_code, name');
    if (error) { console.error(`❌ 블록 ${b.block_code}:`, error.message); continue; }
    console.log(`  📦 ${data[0].block_code}: ${data[0].name}`);
  }

  // ═══════════════════════════════════════════
  // STEP 3: 코스 템플릿
  // ═══════════════════════════════════════════
  const templates = [
    // 장가계 관광 3박4일
    {
      destination_id: zjjId,
      template_code: 'ZJJ-PKG-3N', name: '장가계 관광 3박4일',
      course_type: 'package', nights: 3, days: 4,
      day_blocks: [
        { day: 1, blocks: ['ZJJ-ARR', 'ZJJ-B001'], fixed: true, slots: ['show_or_massage'] },
        { day: 2, blocks: ['ZJJ-B002'], fixed: true, slots: ['ZJJ-B009', 'ZJJ-B005/B005L', 'massage', 'ZJJ-B007W/B007I'] },
        { day: 3, blocks: ['ZJJ-B003', 'ZJJ-B004/B004V'], fixed: false, slots: ['ZJJ-B005/B005L', 'ZJJ-B006'] },
        { day: 4, blocks: ['ZJJ-DEP'], fixed: true },
      ],
      default_inclusions: ['왕복 항공료', '호텔(2인1실)', '차량', '가이드', '식사', '여행자보험', '기사/가이드경비'],
      default_excludes: ['매너팁 및 개인경비', '유류변동분'],
      default_tags: ['장가계', '3박4일'],
    },
    // 장가계 관광 4박5일
    {
      destination_id: zjjId,
      template_code: 'ZJJ-PKG-4N', name: '장가계 관광 4박5일',
      course_type: 'package', nights: 4, days: 5,
      day_blocks: [
        { day: 1, blocks: ['ZJJ-ARR', 'ZJJ-B001'], fixed: true, slots: ['show_or_massage'] },
        { day: 2, blocks: ['ZJJ-B002', 'ZJJ-B009'], fixed: true, slots: ['massage'] },
        { day: 3, blocks: ['ZJJ-B003', 'ZJJ-B010'], fixed: false, slots: ['ZJJ-B005/B005L', 'ZJJ-B007W/B007I'] },
        { day: 4, blocks: ['ZJJ-B004/B004V', 'ZJJ-B006'], fixed: false, slots: ['ZJJ-B008'] },
        { day: 5, blocks: ['ZJJ-DEP'], fixed: true },
      ],
      default_inclusions: ['왕복 항공료', '호텔(2인1실)', '차량', '가이드', '식사', '여행자보험', '기사/가이드경비'],
      default_excludes: ['매너팁 및 개인경비', '유류변동분'],
      default_tags: ['장가계', '4박5일'],
    },
    // 장가계 골프 3박4일
    {
      destination_id: zjjId,
      template_code: 'ZJJ-GOLF-3N', name: '장가계 골프 3박4일',
      course_type: 'golf', nights: 3, days: 4,
      day_blocks: [
        { day: 1, blocks: ['ZJJ-ARR', 'ZJJ-B005'], fixed: true },
        { day: 2, blocks: ['ZJJ-G001'], fixed: true, slots: ['massage'] },
        { day: 3, blocks: ['ZJJ-G001', 'ZJJ-B001'], fixed: true },
        { day: 4, blocks: ['ZJJ-DEP'], fixed: true },
      ],
      default_inclusions: ['왕복항공료', '숙박료', '식사', '관광지입장료', '전용차량', '여행자보험'],
      default_excludes: ['유류변동분', '매너팁', '기사/가이드팁', '캐디팁', '카트/캐디피'],
      default_tags: ['장가계', '골프', '천문산CC'],
    },
    // 장가계 골프 4박5일
    {
      destination_id: zjjId,
      template_code: 'ZJJ-GOLF-4N', name: '장가계 골프 4박5일',
      course_type: 'golf', nights: 4, days: 5,
      day_blocks: [
        { day: 1, blocks: ['ZJJ-ARR', 'ZJJ-B005'], fixed: true },
        { day: 2, blocks: ['ZJJ-G001'], fixed: true, slots: ['massage'] },
        { day: 3, blocks: ['ZJJ-G001', 'ZJJ-B001'], fixed: true },
        { day: 4, blocks: ['ZJJ-G001'], fixed: true },
        { day: 5, blocks: ['ZJJ-DEP'], fixed: true },
      ],
      default_inclusions: ['왕복항공료', '숙박료', '식사', '관광지입장료', '전용차량', '여행자보험'],
      default_excludes: ['유류변동분', '매너팁', '기사/가이드팁', '캐디팁', '카트/캐디피'],
      default_tags: ['장가계', '골프', '천문산CC', '4박5일'],
    },
    // 나트랑/달랏 관광 3박5일
    {
      destination_id: nhaId,
      template_code: 'NHA-DALAT-3N', name: '나트랑/달랏 관광 3박5일',
      course_type: 'package', nights: 3, days: 5,
      day_blocks: [
        { day: 1, blocks: ['NHA-ARR'], fixed: true },
        { day: 2, blocks: ['NHA-B001', 'NHA-B012', 'NHA-M001', 'NHA-B014', 'NHA-B002', 'NHA-N001'], fixed: false, slots: ['NHA-B003'] },
        { day: 3, blocks: ['NHA-B004', 'NHA-B005', 'NHA-B006', 'NHA-B007'], fixed: true },
        { day: 4, blocks: ['NHA-B009', 'NHA-B008', 'NHA-B013', 'NHA-B010', 'NHA-B011', 'NHA-N002', 'NHA-DEP'], fixed: false },
        { day: 5, blocks: ['NHA-DEPA'], fixed: true },
      ],
      default_inclusions: ['왕복항공료', '숙박료', '식사', '관광지입장료', '전용차량', '기사/가이드', '여행자보험'],
      default_excludes: ['유류변동분', '개인경비', '매너팁', '호텔써차지'],
      default_tags: ['나트랑', '달랏', '3박5일'],
    },
    // 나트랑/판랑 호핑 3박5일
    {
      destination_id: nhaId,
      template_code: 'NHA-PHANRANG-3N', name: '나트랑/판랑 호핑 3박5일',
      course_type: 'package', nights: 3, days: 5,
      day_blocks: [
        { day: 1, blocks: ['NHA-ARR'], fixed: true },
        { day: 2, blocks: ['NHA-PL01', 'NHA-M002'], fixed: true },
        { day: 3, blocks: ['NHA-HP01'], fixed: true },
        { day: 4, blocks: ['NHA-B015', 'NHA-B001', 'NHA-B010', 'NHA-B011', 'NHA-N002', 'NHA-DEP'], fixed: false },
        { day: 5, blocks: ['NHA-DEPA'], fixed: true },
      ],
      default_inclusions: ['왕복항공료', '숙박료', '식사', '관광지입장료', '전용차량', '기사/가이드', '여행자보험'],
      default_excludes: ['유류변동분', '개인경비', '매너팁', '호텔써차지'],
      default_tags: ['나트랑', '판랑', '호핑', '사막투어'],
    },
    // 나트랑 3색골프 3박5일
    {
      destination_id: nhaId,
      template_code: 'NHA-GOLF3-3N', name: '나트랑 3색골프 3박5일',
      course_type: 'golf', nights: 3, days: 5,
      day_blocks: [
        { day: 1, blocks: ['NHA-ARR'], fixed: true },
        { day: 2, blocks: ['NHA-G001'], fixed: true },
        { day: 3, blocks: ['NHA-G001'], fixed: true },
        { day: 4, blocks: ['NHA-G001', 'NHA-CITY', 'NHA-DEP'], fixed: true },
        { day: 5, blocks: ['NHA-DEPA'], fixed: true },
      ],
      default_inclusions: ['왕복항공료', '숙박료', '호텔조식', '관광지입장료', '전용차량', '가이드', '여행자보험'],
      default_excludes: ['유류변동분', '매너팁', '미팅/샌딩비', '카트피+캐디피', '캐디팁', '중식/석식'],
      default_tags: ['나트랑', '골프', '3색골프', '노쇼핑'],
    },
    // 나트랑 다이아몬드 골프텔 3박5일
    {
      destination_id: nhaId,
      template_code: 'NHA-DIAMOND-3N', name: '나트랑 다이아몬드베이 골프텔 3박5일',
      course_type: 'golf', nights: 3, days: 5,
      day_blocks: [
        { day: 1, blocks: ['NHA-ARR'], fixed: true },
        { day: 2, blocks: ['NHA-G002'], fixed: true },
        { day: 3, blocks: ['NHA-G002'], fixed: true },
        { day: 4, blocks: ['NHA-G002', 'NHA-DEP'], fixed: true },
        { day: 5, blocks: ['NHA-DEPA'], fixed: true },
      ],
      default_inclusions: ['왕복항공료', '숙박료', '호텔조식', '그린피+카트비', '여행자보험', '레이트체크아웃22시'],
      default_excludes: ['유류변동분', '매너팁', '공항미팅샌딩', '캐디팁', '중식/석식'],
      default_tags: ['나트랑', '골프텔', '다이아몬드CC'],
    },
  ];

  for (const t of templates) {
    const { data, error } = await sb.from('course_templates').upsert([t], { onConflict: 'template_code' }).select('id, template_code, name');
    if (error) { console.error(`❌ 템플릿 ${t.template_code}:`, error.message); continue; }
    console.log(`  📋 ${data[0].template_code}: ${data[0].name}`);
  }

  console.log('\n🏁 블록 마스터 시딩 완료!\n');
  console.log(`  지역: ${Object.keys(destMap).length}개`);
  console.log(`  블록: ${allBlocks.length}개 (장가계 ${zjjBlocks.length} + 나트랑 ${nhaBlocks.length})`);
  console.log(`  코스: ${templates.length}개`);
}

run().catch(console.error);
