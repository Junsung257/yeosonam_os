/**
 * 블록 마스터 시딩 — 서안(Xi'an)
 * destination_masters 1건, tour_blocks 25건, course_templates 4건
 *
 * 실행: node db/block_master_seed_xian.js
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
const T = (time, activity) => ({ time, activity, type: 'transport' });

async function run() {
  console.log('🚀 서안 블록 마스터 시딩 시작...\n');

  // ═══════════════════════════════════════════
  // STEP 1: 지역 마스터
  // ═══════════════════════════════════════════
  const destination = {
    name: '서안', country: '중국', region_code: 'XIY',
    default_airline: 'BX', default_flight_out: 'BX341', default_flight_in: 'BX342',
    default_departure_airport: '부산(김해)',
    flight_out_time: '21:55', arrival_time: '00:35',
    return_departure_time: '02:10', flight_in_time: '06:30',
    hotel_pool: [
      { grade: '4성', names: ['천익호텔', '홀리데이인익스프레호텔'], score: 1 },
      { grade: '5성', names: ['서안풀만호텔', '쉐라톤호텔'], score: 3 },
    ],
    meal_pool: [
      { slot: 'day2_dinner', default: '뺭뺭면', variants: ['덕발장 교자연'] },
      { slot: 'day3_dinner', default: '샤브샤브', variants: ['삼겹살 무제한', '사천요리'] },
      { slot: 'day4_dinner', default: '삼겹살', variants: ['샤브샤브무제한', '사천요리'] },
      { slot: 'day5_dinner', default: '사천요리', variants: ['샤브샤브'] },
    ],
    common_notices: [
      { type: 'CRITICAL', title: '필수 확인', text: '• 여권 유효기간 출발일기준 6개월이상\n• 단수여권, 긴급여권, 관용여권 중국 입국불가' },
      { type: 'INFO', title: '안내', text: '• 아래 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다' },
    ],
    keywords: ['서안', '병마용', '진시황', '화청지', '화산', '대명궁', '회족거리', '대안탑', '소안탑', '흥경궁', '종고루'],
  };

  const { data: destData, error: destErr } = await sb
    .from('destination_masters')
    .upsert([destination], { onConflict: 'name' })
    .select('id, name');
  if (destErr) { console.error('❌ 지역:', destErr.message); return; }
  const xanId = destData[0].id;
  console.log(`✅ 지역: ${destData[0].name} (${xanId})`);

  // ═══════════════════════════════════════════
  // STEP 2: 관광 블록 — 서안 (25건)
  // ═══════════════════════════════════════════
  const xanBlocks = [
    // ── Transfer blocks ──
    {
      block_code: 'XAN-ARR', name: '서안 도착',
      block_type: 'transfer', duration: 'half',
      schedule: [
        F('21:55', '부산(김해) 국제공항 출발', 'BX341'),
        N('00:35', '서안 국제공항 도착 / 가이드 미팅 후 호텔 이동'),
        N(null, '호텔 투숙 및 휴식'),
      ],
      keywords: ['서안 도착', 'BX341'],
      quality_score: 0, typical_day_position: 'day1',
    },
    {
      block_code: 'XAN-DEP', name: '서안 출발 (귀국)',
      block_type: 'transfer', duration: 'morning',
      schedule: [
        F('02:10', '서안 국제공항 출발', 'BX342'),
        N('06:30', '부산(김해) 국제공항 도착'),
      ],
      keywords: ['BX342', '부산 도착'],
      quality_score: 0, typical_day_position: 'last',
    },

    // ── Sightseeing blocks (17건) ──
    {
      block_code: 'XAN-B001', name: '진시황릉',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶37년에 걸쳐 만들어진 세계 최대의 능 진시황릉'),
      ],
      keywords: ['진시황릉', '진시황', '진시황제'],
      quality_score: 2.5, typical_day_position: 'any',
    },
    {
      block_code: 'XAN-B002', name: '병마용',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶세계 8대 불가사의 중 하나인 병마용'),
      ],
      keywords: ['병마용', '병마용박물원'],
      quality_score: 3.0, typical_day_position: 'any',
    },
    {
      block_code: 'XAN-B003', name: '화청지',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶당현종과 양귀비의 로맨스 장소이자 황제들의 온천휴양지 화청지'),
      ],
      keywords: ['화청지', '양귀비', '화청궁'],
      quality_score: 2.0, typical_day_position: 'any',
    },
    {
      block_code: 'XAN-B004', name: '소안탑 + 서안박물관',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶인도에서 가져온 경전을 보관한 소안탑 + 서안박물관 (화요일휴관)'),
      ],
      keywords: ['소안탑', '서안박물관'],
      quality_score: 1.5, typical_day_position: 'day2',
    },
    {
      block_code: 'XAN-B005', name: '흥경궁공원',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶당나라 3대 궁전 중의 하나인 흥경궁공원'),
      ],
      keywords: ['흥경궁', '흥경궁공원'],
      quality_score: 1.0, typical_day_position: 'day2',
    },
    {
      block_code: 'XAN-B006', name: '회족거리',
      block_type: 'night', duration: 'half',
      schedule: [
        N(null, '▶소수민족 회족의 전통을 엿볼 수 있는 회족거리'),
      ],
      keywords: ['회족거리', '실크로드 입문'],
      quality_score: 1.5, typical_day_position: 'any',
    },
    {
      block_code: 'XAN-B007', name: '종고루광장 야경',
      block_type: 'night', duration: 'half',
      schedule: [
        N(null, '▶종고루광장 야경 및 서안 야시장'),
      ],
      keywords: ['종고루', '종루', '야경', '야시장'],
      quality_score: 1.0, typical_day_position: 'any',
    },
    {
      block_code: 'XAN-B008', name: '대흥선사',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶밀종의 발원지 대흥선사'),
      ],
      keywords: ['대흥선사', '밀종'],
      quality_score: 1.0, typical_day_position: 'any',
    },
    {
      block_code: 'XAN-B009', name: '문서거리',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶중국의 인사동 거리라 불리는 문서거리(古文化街)'),
      ],
      keywords: ['문서거리', '古文化街', '고문화가'],
      quality_score: 0.5, typical_day_position: 'any',
    },
    {
      block_code: 'XAN-B010', name: '와룡사',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶한나라 건녕에 창건된 1,800년된 고찰 와룡사'),
      ],
      keywords: ['와룡사'],
      quality_score: 1.0, typical_day_position: 'any',
    },
    {
      block_code: 'XAN-B011', name: '곡강유적지공원',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶고대 황제와 문인들의 놀이터 곡강유적지공원'),
      ],
      keywords: ['곡강', '곡강유적지'],
      quality_score: 1.0, typical_day_position: 'any',
    },
    {
      block_code: 'XAN-B012', name: '대안탑 + 대안탑북광장',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶현장법사가 서역에서 가져온 불경을 보존한 대안탑(차창)'),
        N(null, '▶중국의 4대 명필가의 동상과 글씨를 장식해 놓은 대안탑북광장'),
      ],
      keywords: ['대안탑', '대안탑북광장', '현장법사'],
      quality_score: 1.5, typical_day_position: 'any',
    },
    {
      block_code: 'XAN-B013', name: '서안성벽 + 함광문유적지',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶중국 보존건축물 중 가장 완전한 서안성벽 + 함광문유적지박물관'),
      ],
      keywords: ['서안성벽', '함광문', '성벽'],
      quality_score: 2.0, typical_day_position: 'day2',
    },
    {
      block_code: 'XAN-B014', name: '화산 (북봉케이블카)',
      block_type: 'sightseeing', duration: 'full',
      schedule: [
        T(null, '화산으로 이동 (약 2시간 30분 소요)'),
        N(null, '▶화산 관광 (북봉 케이블카 왕복포함)'),
        T(null, '서안으로 귀환'),
      ],
      keywords: ['화산', '북봉', '케이블카'],
      quality_score: 3.0, typical_day_position: 'day3',
    },
    {
      block_code: 'XAN-B015', name: '팔로군 기념관',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶일본이 패망 후 건설된 전쟁기념관인 팔로군 기념관'),
      ],
      keywords: ['팔로군', '기념관'],
      quality_score: 0.5, typical_day_position: 'day2',
    },
    {
      block_code: 'XAN-B016', name: '고씨장원',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶고씨장원'),
      ],
      keywords: ['고씨장원'],
      quality_score: 0.5, typical_day_position: 'any',
    },
    {
      block_code: 'XAN-B017', name: '호혜묘',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶진2세 황제 호혜묘'),
      ],
      keywords: ['호혜묘', '진2세'],
      quality_score: 0.5, typical_day_position: 'any',
    },

    // ── Service / Entertainment blocks (5건) ──
    {
      block_code: 'XAN-M001', name: '발+전신 마사지 90분',
      block_type: 'massage', duration: 'half',
      schedule: [
        N(null, '▶여행의 피로를 풀어주는 발+전신 마사지(90분) 체험'),
      ],
      keywords: ['마사지', '전신마사지', '발마사지'],
      quality_score: 2.0, typical_day_position: 'any',
      is_optional: true, option_price_usd: 40,
    },
    {
      block_code: 'XAN-S001', name: '실크로드쇼',
      block_type: 'show', duration: 'night',
      schedule: [
        N(null, '▶실크로드쇼 관람'),
      ],
      keywords: ['실크로드쇼', '실크로드'],
      quality_score: 1.5, typical_day_position: 'any',
      is_optional: true, option_price_usd: 50,
    },
    {
      block_code: 'XAN-S002', name: '대당부용원 + 불야성 야경',
      block_type: 'night', duration: 'night',
      schedule: [
        N(null, '▶세계에서 가장 큰 당건축 테마파크 대당부용원 + 대당불야성 야경감상'),
      ],
      keywords: ['대당부용원', '불야성', '대당불야성'],
      quality_score: 1.5, typical_day_position: 'any',
      is_optional: true, option_price_usd: 50,
    },
    {
      block_code: 'XAN-S003', name: '대명궁유적지',
      block_type: 'show', duration: 'half',
      schedule: [
        N(null, '▶당나라 3대 궁전 중의 하나 대명궁유적지(전동차포함)'),
      ],
      keywords: ['대명궁'],
      quality_score: 1.0, typical_day_position: 'any',
      is_optional: true, option_price_usd: 40,
    },
    {
      block_code: 'XAN-O001', name: '명대성벽 + 비림박물관',
      block_type: 'sightseeing', duration: 'half',
      schedule: [
        N(null, '▶중국에서 가장 잘 보존된 중세방어 성벽인 명대 성벽'),
        N(null, '▶한나라 때부터 4,000여개의 비석을 전시/보관하고 있는 비림박물관'),
      ],
      keywords: ['명대', '비림', '비림박물관'],
      quality_score: 2.0, typical_day_position: 'any',
      is_optional: true, option_price_usd: 60,
    },

    // ── Shopping block (1건) ──
    {
      block_code: 'XAN-SH01', name: '쇼핑 (라텍스+찻집+침향)',
      block_type: 'shopping', duration: 'half',
      schedule: [
        N(null, '쇼핑: 라텍스, 찻집, 침향 (총3회) + 농산물'),
      ],
      keywords: ['라텍스', '찻집', '침향', '쇼핑'],
      quality_score: -1.0, typical_day_position: 'any',
    },
  ];

  const allBlocks = xanBlocks.map(b => ({ ...b, destination_id: xanId }));
  for (const b of allBlocks) {
    const { data, error } = await sb.from('tour_blocks').upsert([b], { onConflict: 'block_code' }).select('id, block_code, name');
    if (error) { console.error(`❌ 블록 ${b.block_code}:`, error.message); continue; }
    console.log(`  📦 ${data[0].block_code}: ${data[0].name}`);
  }

  // ═══════════════════════════════════════════
  // STEP 3: 코스 템플릿 — 서안 (4건)
  // ═══════════════════════════════════════════
  const templates = [
    {
      destination_id: xanId,
      template_code: 'XAN-실속-3N', name: '서안 실속 3박5일',
      course_type: 'package', nights: 3, days: 5,
      day_blocks: [
        { day: 1, blocks: ['XAN-ARR'], fixed: true },
        { day: 2, blocks: ['XAN-B004', 'XAN-B005', 'XAN-B006', 'XAN-B007'], fixed: true, slots: ['XAN-S003'] },
        { day: 3, blocks: ['XAN-B001', 'XAN-B002', 'XAN-B003'], fixed: true, slots: ['XAN-O001'] },
        { day: 4, blocks: ['XAN-B008', 'XAN-B009', 'XAN-B010', 'XAN-B011', 'XAN-B012'], fixed: true, slots: ['XAN-S002', 'XAN-SH01'] },
        { day: 5, blocks: ['XAN-DEP'], fixed: true },
      ],
      default_inclusions: ['항공료 및 텍스', '유류할증료', '여행자보험', '숙박(2인1실)', '차량', '한국어 가이드', '관광지입장료'],
      default_excludes: ['기사/가이드경비', '매너팁', '유류비변동분', '싱글비용'],
      default_tags: ['서안', '병마용', '실속', '3박5일'],
    },
    {
      destination_id: xanId,
      template_code: 'XAN-실속-4N', name: '서안 실속 4박6일',
      course_type: 'package', nights: 4, days: 6,
      day_blocks: [
        { day: 1, blocks: ['XAN-ARR'], fixed: true },
        { day: 2, blocks: ['XAN-B004', 'XAN-B005', 'XAN-B015'], fixed: true, slots: ['XAN-O001'] },
        { day: 3, blocks: ['XAN-B008', 'XAN-B016', 'XAN-B006', 'XAN-B007'], fixed: true, slots: ['XAN-S003'] },
        { day: 4, blocks: ['XAN-B012', 'XAN-B017', 'XAN-B011'], fixed: true, slots: ['XAN-S002'] },
        { day: 5, blocks: ['XAN-B001', 'XAN-B002', 'XAN-B003'], fixed: true, slots: ['XAN-S001', 'XAN-SH01'] },
        { day: 6, blocks: ['XAN-DEP'], fixed: true },
      ],
      default_inclusions: ['항공료 및 텍스', '유류할증료', '여행자보험', '숙박(2인1실)', '차량', '한국어 가이드', '관광지입장료'],
      default_excludes: ['기사/가이드경비', '매너팁', '유류비변동분', '싱글비용'],
      default_tags: ['서안', '병마용', '실속', '4박6일'],
    },
    {
      destination_id: xanId,
      template_code: 'XAN-품격-3N', name: '품격 서안(화산) 3박5일',
      course_type: 'package', nights: 3, days: 5,
      day_blocks: [
        { day: 1, blocks: ['XAN-ARR'], fixed: true },
        { day: 2, blocks: ['XAN-B013', 'XAN-B005', 'XAN-B004', 'XAN-B006', 'XAN-B007'], fixed: true },
        { day: 3, blocks: ['XAN-B014', 'XAN-M001'], fixed: true },
        { day: 4, blocks: ['XAN-B003', 'XAN-B001', 'XAN-B002', 'XAN-S001'], fixed: true },
        { day: 5, blocks: ['XAN-DEP'], fixed: true },
      ],
      default_inclusions: ['항공료 및 텍스', '유류할증료', '여행자보험', '숙박(2인1실)', '한국어 가이드', '입장료', '기사/가이드 경비'],
      default_excludes: ['매너팁', '유류비변동분', '싱글비용'],
      default_tags: ['서안', '화산', '품격', '노팁노옵션노쇼핑', '3박5일'],
    },
    {
      destination_id: xanId,
      template_code: 'XAN-품격-4N', name: '품격 서안(화산) 4박6일',
      course_type: 'package', nights: 4, days: 6,
      day_blocks: [
        { day: 1, blocks: ['XAN-ARR'], fixed: true },
        { day: 2, blocks: ['XAN-B013', 'XAN-B005', 'XAN-B004', 'XAN-B006', 'XAN-B007'], fixed: true },
        { day: 3, blocks: ['XAN-B014', 'XAN-M001'], fixed: true },
        { day: 4, blocks: ['XAN-B003', 'XAN-B001', 'XAN-B002'], fixed: true },
        { day: 5, blocks: ['XAN-B012', 'XAN-B017', 'XAN-B011', 'XAN-S001', 'XAN-S002'], fixed: true },
        { day: 6, blocks: ['XAN-DEP'], fixed: true },
      ],
      default_inclusions: ['항공료 및 텍스', '유류할증료', '여행자보험', '숙박(2인1실)', '한국어 가이드', '입장료', '기사/가이드 경비'],
      default_excludes: ['매너팁', '유류비변동분', '싱글비용'],
      default_tags: ['서안', '화산', '품격', '노팁노옵션노쇼핑', '4박6일'],
    },
  ];

  for (const t of templates) {
    t.destination_id = xanId;
    const { data, error } = await sb.from('course_templates').upsert([t], { onConflict: 'template_code' }).select('id, template_code, name');
    if (error) { console.error(`❌ 템플릿 ${t.template_code}:`, error.message); continue; }
    console.log(`  📋 ${data[0].template_code}: ${data[0].name}`);
  }

  console.log('\n🏁 서안 블록 마스터 시딩 완료!');
  console.log(`  블록: ${allBlocks.length}개`);
  console.log(`  코스: ${templates.length}개`);
}

run().catch(console.error);
