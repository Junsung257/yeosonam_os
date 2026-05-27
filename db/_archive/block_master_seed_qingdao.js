/**
 * 블록 마스터 시딩 — 칭다오(Qingdao/청도)
 * destination_masters 1건, tour_blocks 22건, course_templates 4건
 *
 * 실행: node db/block_master_seed_qingdao.js
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const N = (time, activity) => ({ time, activity, type: 'normal' });
const F = (time, activity, transport) => ({ time, activity, type: 'flight', transport });

async function run() {
  console.log('🚀 칭다오 블록 마스터 시딩 시작...\n');

  // ═══════════════════════════════════════════
  // STEP 1: 지역 마스터
  // ═══════════════════════════════════════════
  const destination = {
    name: '칭다오', country: '중국', region_code: 'TAO',
    default_airline: 'BX', default_flight_out: 'BX321', default_flight_in: 'BX322',
    default_departure_airport: '부산(김해)',
    flight_out_time: '10:30', arrival_time: '11:35',
    return_departure_time: '12:35', flight_in_time: '15:35',
    hotel_pool: [
      { grade: '5성', names: ['풀만호텔', '이스트포포인츠쉐라톤'], score: 3 },
      { grade: '준5성', names: ['지모힐튼호텔', '하이탠엑스포칭다오호텔', '이스트쉐라톤호텔'], score: 2 },
    ],
    meal_pool: [
      { slot: 'day1_lunch', default: '산동요리' },
      { slot: 'day1_dinner', variants: ['양꼬치무제한+맥주1병', '삼겹살무제한', '샤브샤브무제한'] },
      { slot: 'day2_lunch', variants: ['삼겹살무제한', '현지식', '산동요리'] },
      { slot: 'day2_dinner', variants: ['샤브샤브무제한', '삼겹살무제한'] },
    ],
    common_notices: [
      { type: 'CRITICAL', title: '필수 확인', text: '• 여권 유효기간 출발일기준 6개월이상\n• 일정 미참여시 1인 $150 패널티 (개별행동 금지)' },
      { type: 'PAYMENT', title: '취소 규정', text: '• 예약 후 취소: 1인 10만원 공제\n• 출발 19~7일전: 30% 공제\n• 출발 6일~당일: 환불불가' },
      { type: 'INFO', title: '안내', text: '• 상기 일정은 현지 사정에 의해 변경될 수 있습니다' },
    ],
    keywords: ['칭다오', '청도', '맥주박물관', '잔교', '노산', '팔대관', '5.4광장', '올림픽요트', '천주교당'],
  };

  const { data: destData, error: destErr } = await sb
    .from('destination_masters')
    .upsert([destination], { onConflict: 'name' })
    .select('id, name');
  if (destErr) { console.error('❌ 지역:', destErr.message); return; }
  const taoId = destData[0].id;
  console.log(`✅ 지역: ${destData[0].name} (${taoId})`);

  // ═══════════════════════════════════════════
  // STEP 2: 관광 블록 — 칭다오 (22건)
  // ═══════════════════════════════════════════
  const blocks = [
    // ── Transfer (4건: BX 부산 + SC 인천) ──
    {
      block_code: 'TAO-ARR-BX', name: '청도 도착 (부산/에어부산)',
      block_type: 'transfer', duration: 'half',
      schedule: [
        F('10:30', '김해 국제공항 출발', 'BX321'),
        F('11:35', '청도 국제공항 도착 / 가이드 미팅', 'BX321'),
      ],
      keywords: ['BX321', '김해.*출발', '부산.*출발'],
      quality_score: 0, typical_day_position: 'day1',
    },
    {
      block_code: 'TAO-DEP-BX', name: '청도 출발 (부산/에어부산)',
      block_type: 'transfer', duration: 'half',
      schedule: [
        F('12:35', '청도 국제공항 출발', 'BX322'),
        F('15:35', '김해 국제공항 도착', 'BX322'),
      ],
      keywords: ['BX322', '김해.*도착', '부산.*도착'],
      quality_score: 0, typical_day_position: 'last',
    },
    {
      block_code: 'TAO-ARR-SC', name: '청도 도착 (인천/산동항공)',
      block_type: 'transfer', duration: 'half',
      schedule: [
        F('12:15', '인천 국제공항 출발', 'SC4610'),
        F('13:05', '청도 국제공항 도착 / 가이드 미팅', 'SC4610'),
      ],
      keywords: ['SC4610', '인천.*출발'],
      quality_score: 0, typical_day_position: 'day1',
    },
    {
      block_code: 'TAO-DEP-SC', name: '청도 출발 (인천/산동항공)',
      block_type: 'transfer', duration: 'half',
      schedule: [
        F('19:30', '청도 국제공항 출발', 'SC4619'),
        F('21:55', '인천 국제공항 도착', 'SC4619'),
      ],
      keywords: ['SC4619', '인천.*도착'],
      quality_score: 0, typical_day_position: 'last',
    },

    // ── Sightseeing (14건) ──
    {
      block_code: 'TAO-B001', name: '천주교당',
      block_type: 'sightseeing', duration: 'half',
      schedule: [N(null, '▶1943년 완공된 높이56m의 아름다운 독일식 건축 성당 천주교당')],
      keywords: ['천주교당', '독일식.*성당', '고딕양식'],
      quality_score: 1.5,
    },
    {
      block_code: 'TAO-B002', name: '잔교',
      block_type: 'sightseeing', duration: 'half',
      schedule: [N(null, '▶중국 청도 10경으로 꼽히는 잔교')],
      keywords: ['잔교'],
      quality_score: 2.0,
    },
    {
      block_code: 'TAO-B003', name: '5.4광장',
      block_type: 'sightseeing', duration: 'half',
      schedule: [N(null, '▶5월의 바람이 자리한 역사적인 명소 5.4광장')],
      keywords: ['5\\.4광장', '5\\.4운동', '54광장'],
      quality_score: 1.5,
    },
    {
      block_code: 'TAO-B004', name: '올림픽요트경기장',
      block_type: 'sightseeing', duration: 'half',
      schedule: [N(null, '▶2008년 베이징올림픽 요트경기를 치렀던 올림픽요트경기장')],
      keywords: ['올림픽요트', '요트경기장', '올림픽.*요트'],
      quality_score: 1.5,
    },
    {
      block_code: 'TAO-B005', name: '팔대관',
      block_type: 'sightseeing', duration: 'half',
      schedule: [N(null, '▶매력적인 건축물로 "만국건축박물관"로 불리는 팔대관')],
      keywords: ['팔대관', '만국건축박물관'],
      quality_score: 2.0,
    },
    {
      block_code: 'TAO-B006', name: '맥주박물관',
      block_type: 'sightseeing', duration: 'half',
      schedule: [N(null, '▶100년 청도 맥주의 역사를 볼 수 있는 맥주박물관 (칭따오 맥주원액1잔+생맥1잔+땅콩안주 증정)')],
      keywords: ['맥주박물관', '칭따오.*맥주'],
      quality_score: 2.5,
    },
    {
      block_code: 'TAO-B007', name: '찌모루시장',
      block_type: 'sightseeing', duration: 'half',
      schedule: [N(null, '▶중국 3대 짝퉁시장, 세계 명품이 한눈에 찌모루시장')],
      keywords: ['찌모루', '지모루', '짝퉁시장'],
      quality_score: 1.0,
    },
    {
      block_code: 'TAO-B008', name: '지모고성',
      block_type: 'sightseeing', duration: 'half',
      schedule: [N(null, '▶춘추전국시대부터 이어져온 1400년 역사의 지모고성')],
      keywords: ['지모고성', '지묵고성', '지모.*고성', '고대도시'],
      quality_score: 1.5,
    },
    {
      block_code: 'TAO-B009', name: '따보도 문화거리',
      block_type: 'sightseeing', duration: 'half',
      schedule: [N(null, '▶유럽감성거리를 청도에서! 따보도 문화거리')],
      keywords: ['따보도', '대복도', '따바오다오', '유럽감성거리'],
      quality_score: 1.0,
    },
    {
      block_code: 'TAO-B010', name: '피차이웬',
      block_type: 'sightseeing', duration: 'half',
      schedule: [N(null, '▶120년 전통의 현지식 먹자골목 피차이웬')],
      keywords: ['피차이웬', '피차이위엔', '먹자골목'],
      quality_score: 1.0,
    },
    {
      block_code: 'TAO-B011', name: '신호산전망대',
      block_type: 'sightseeing', duration: 'half',
      schedule: [N(null, '▶해발 110M에 위치해 청도 전체가 보이는 신호산전망대')],
      keywords: ['신호산', '전망대.*신호'],
      quality_score: 1.5,
    },
    {
      block_code: 'TAO-B012', name: '해천뷰전망대',
      block_type: 'sightseeing', duration: 'half',
      schedule: [N(null, '▶369M 고공에서 느껴보는 칭다오의 전경 해천뷰전망대(81층)')],
      keywords: ['해천뷰', '운상해천', '전망대.*369', '81층'],
      quality_score: 2.0, is_optional: true, option_price_usd: 50,
    },
    {
      block_code: 'TAO-B013', name: '노산 거봉 (케이블카)',
      block_type: 'sightseeing', duration: 'full',
      schedule: [
        N(null, '노산으로 이동 (약 1시간)'),
        N(null, '▶노산 거봉 관광 (케이블카 왕복 포함)'),
        N(null, '청도 이동 (약 1시간)'),
      ],
      keywords: ['노산', '거봉', '케이블카.*노산', '노산.*케이블카'],
      quality_score: 3.0, is_optional: true, option_price_usd: 100,
    },
    {
      block_code: 'TAO-B014', name: '세기공원',
      block_type: 'sightseeing', duration: 'half',
      schedule: [N(null, '▶숲과 호수가 어우러진 휴식의 공간 세기공원')],
      keywords: ['세기공원'],
      quality_score: 0.5,
    },

    // ── Night (2건) ──
    {
      block_code: 'TAO-B015', name: '명월산해간 불야성',
      block_type: 'night', duration: 'night',
      schedule: [N(null, '▶칭다오의 떠오르는 야경명소 명월산해간 불야성')],
      keywords: ['불야성', '명월산해간'],
      quality_score: 1.5, is_optional: true, option_price_usd: 50,
    },
    {
      block_code: 'TAO-B016', name: '청양야시장',
      block_type: 'night', duration: 'night',
      schedule: [N(null, '▶청도의 핵심 도시 청양의 활발한 시장 청양야시장')],
      keywords: ['청양야시장', '청양.*야시장', '청양.*시장'],
      quality_score: 1.0,
    },

    // ── Service (2건) ──
    {
      block_code: 'TAO-M001', name: '발마사지 60분',
      block_type: 'massage', duration: 'half',
      schedule: [N(null, '▶여행의 피로를 녹여주는 발마사지 60분')],
      keywords: ['발마사지.*60', '마사지.*60분'],
      quality_score: 1.0,
    },
    {
      block_code: 'TAO-M002', name: '발+전신마사지 90분',
      block_type: 'massage', duration: 'half',
      schedule: [N(null, '▶여행의 피로를 풀어주는 발+전신마사지 90분')],
      keywords: ['전신마사지.*90', '마사지.*90분', '발.*전신.*90'],
      quality_score: 2.0,
    },

    // ── Shopping (1건) ──
    {
      block_code: 'TAO-SH01', name: '쇼핑 (라텍스+침향+찻집)',
      block_type: 'shopping', duration: 'half',
      schedule: [N(null, '쇼핑: 라텍스, 침향, 찻집 등 (2~3회)')],
      keywords: ['라텍스', '침향', '찻집', '쇼핑.*회'],
      quality_score: -1.0,
    },
  ];

  const allBlocks = blocks.map(b => ({ ...b, destination_id: taoId }));
  for (const b of allBlocks) {
    const { data, error } = await sb.from('tour_blocks').upsert([b], { onConflict: 'block_code' }).select('id, block_code, name');
    if (error) { console.error(`❌ 블록 ${b.block_code}:`, error.message); continue; }
    console.log(`  📦 ${data[0].block_code}: ${data[0].name}`);
  }

  // ═══════════════════════════════════════════
  // STEP 3: 코스 템플릿 — 칭다오 (4건)
  // ═══════════════════════════════════════════
  const templates = [
    {
      destination_id: taoId,
      template_code: 'TAO-실속-2N', name: '칭다오 실속 2박3일',
      course_type: 'package', nights: 2, days: 3,
      day_blocks: [
        { day: 1, blocks: ['TAO-ARR-*', 'TAO-B001', 'TAO-B002', 'TAO-B009', 'TAO-B010', 'TAO-B007'], fixed: false, slots: ['TAO-B006', 'TAO-B012'] },
        { day: 2, blocks: ['TAO-B003', 'TAO-B004', 'TAO-B005'], fixed: true, slots: ['TAO-B013', 'TAO-B015', 'TAO-B016', 'TAO-M002'] },
        { day: 3, blocks: ['TAO-DEP-*'], fixed: true, slots: ['TAO-B008', 'TAO-B007'] },
      ],
      default_inclusions: ['왕복 항공료 및 텍스', '유류할증료', '호텔', '차량', '관광지입장료', '식사', '여행자보험'],
      default_excludes: ['기사/가이드경비', '매너팁', '개인경비', '유류변동분'],
      default_tags: ['칭다오', '실속', '2박3일'],
    },
    {
      destination_id: taoId,
      template_code: 'TAO-노팁-2N', name: '칭다오 노팁노옵션 2박3일',
      course_type: 'package', nights: 2, days: 3,
      day_blocks: [
        { day: 1, blocks: ['TAO-ARR-*', 'TAO-B001', 'TAO-B002', 'TAO-B007', 'TAO-B010', 'TAO-M001'], fixed: false },
        { day: 2, blocks: ['TAO-B003', 'TAO-B004', 'TAO-B012', 'TAO-B005', 'TAO-B006', 'TAO-B015'], fixed: false },
        { day: 3, blocks: ['TAO-DEP-*'], fixed: true },
      ],
      default_inclusions: ['왕복항공료', '숙박료', '식사', '관광지입장료', '전용차량', '기사/가이드', '여행자보험'],
      default_excludes: ['유류할증료변동분', '개인경비', '매너팁'],
      default_tags: ['칭다오', '노팁노옵션', '2박3일'],
    },
    {
      destination_id: taoId,
      template_code: 'TAO-노산-2N', name: '칭다오 노산 2박3일',
      course_type: 'package', nights: 2, days: 3,
      day_blocks: [
        { day: 1, blocks: ['TAO-ARR-*', 'TAO-B006', 'TAO-B002', 'TAO-B009', 'TAO-B001', 'TAO-B007'], fixed: false },
        { day: 2, blocks: ['TAO-B013', 'TAO-B005', 'TAO-B003', 'TAO-B004', 'TAO-B008'], fixed: true },
        { day: 3, blocks: ['TAO-DEP-*'], fixed: true },
      ],
      default_inclusions: ['왕복 항공료 및 텍스', '유류할증료', '호텔', '차량', '관광지입장료', '식사', '여행자보험', '기사/가이드경비'],
      default_excludes: ['매너팁', '개인경비', '유류변동분'],
      default_tags: ['칭다오', '노산', '2박3일'],
    },
    {
      destination_id: taoId,
      template_code: 'TAO-품격-2N', name: '칭다오 품격 노팁노옵션노쇼핑 2박3일',
      course_type: 'package', nights: 2, days: 3,
      day_blocks: [
        { day: 1, blocks: ['TAO-ARR-*', 'TAO-B001', 'TAO-B011', 'TAO-B007', 'TAO-B006', 'TAO-B015'], fixed: false },
        { day: 2, blocks: ['TAO-B005', 'TAO-B003', 'TAO-B004', 'TAO-B014', 'TAO-B012', 'TAO-B016', 'TAO-M002'], fixed: false },
        { day: 3, blocks: ['TAO-B002', 'TAO-B009', 'TAO-DEP-*'], fixed: false },
      ],
      default_inclusions: ['왕복 항공료 및 텍스', '유류할증료', '호텔', '차량', '관광지입장료', '식사', '여행자보험', '기사/가이드경비'],
      default_excludes: ['매너팁', '개인경비', '유류변동분'],
      default_tags: ['칭다오', '품격', '노팁노옵션노쇼핑', '2박3일'],
    },
  ];

  for (const t of templates) {
    const { data, error } = await sb.from('course_templates').upsert([t], { onConflict: 'template_code' }).select('id, template_code, name');
    if (error) { console.error(`❌ 템플릿 ${t.template_code}:`, error.message); continue; }
    console.log(`  📋 ${data[0].template_code}: ${data[0].name}`);
  }

  console.log('\n🏁 칭다오 블록 마스터 시딩 완료!');
  console.log(`  블록: ${allBlocks.length}개`);
  console.log(`  코스: ${templates.length}개`);
}

run().catch(console.error);
