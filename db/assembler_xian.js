/**
 * 서안(Xi'an) 어셈블러 v1
 *
 * 원문 텍스트 → 키워드 스캔 → 블록 자동 매칭 → 코스 판별 → 가격 추출 → 점수 계산 → 상품 JSON 출력
 *
 * 사용법:
 *   node db/assembler_xian.js <raw_text_file>
 *   node db/assembler_xian.js <raw_text_file> --insert   (DB 직접 등록)
 *   node db/assembler_xian.js <raw_text_file> --dry-run  (기본값, JSON 출력만)
 *
 * 입력 텍스트 형식:
 *   - 랜드사 PDF/문서에서 복사한 원문 텍스트
 *   - 일차별 구분 (제1일, DAY1, 1일차 등)
 *   - 가격표, 포함/불포함 사항 포함
 */

const fs = require('fs');
const path = require('path');

// ── Supabase (--insert 모드용) ──
let sb = null;
function initSupabase() {
  if (sb) return sb;
  const { createClient } = require('@supabase/supabase-js');
  const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8');
  const env = {};
  envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
  sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return sb;
}

// ══════════════════════════════════════════════════════════════
// 1. 서안 블록 정의 (block_master_seed_xian.js 기반)
// ══════════════════════════════════════════════════════════════

const N = (time, activity) => ({ time, activity, type: 'normal', transport: null, note: null });
const F = (time, activity, transport) => ({ time, activity, type: 'flight', transport, note: null });
const T = (time, activity) => ({ time, activity, type: 'normal', transport: '전용차량', note: null });
const O = (time, activity) => ({ time, activity, type: 'optional', transport: null, note: null });

const DESTINATION = {
  name: '서안', country: '중국', region_code: 'XIY',
  airline: 'BX(에어부산)', airline_code: 'BX',
  flight_out: 'BX341', flight_in: 'BX342',
  departure_airport: '부산(김해)',
  flight_out_time: '21:55', arrival_time: '00:35',
  return_departure_time: '02:10', flight_in_time: '06:30',
  hotel_pool: [
    { grade: '4성', names: ['천익호텔', '홀리데이인익스프레호텔', '홀리데이인', '천익'], score: 1 },
    { grade: '5성', names: ['서안풀만호텔', '서안풀만', '풀만호텔', '풀만', '쉐라톤호텔', '쉐라톤'], score: 3 },
  ],
  notices: [
    { type: 'CRITICAL', title: '필수 확인', text: '• 여권 유효기간 출발일기준 6개월이상\n• 단수여권, 긴급여권, 관용여권 중국 입국불가\n• 여권 재발급 후 미전달 시 관광지 입장 불가 책임지지 않음' },
    { type: 'INFO', title: '안내', text: '• 아래 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다' },
  ],
};

// 블록 정의 — keywords 배열로 텍스트 매칭
const BLOCKS = [
  // ── Transfer ──
  {
    code: 'XAN-ARR', name: '서안 도착', type: 'transfer', duration: 'half',
    schedule: [
      F('21:55', '부산 출발', 'BX341'),
      N('00:35', '서안 도착 / 가이드 미팅 후 호텔 투숙'),
    ],
    keywords: ['서안 도착', '서안도착', 'BX341', '김해.*출발', '부산.*출발'],
    score: 0, day_position: 'day1',
  },
  {
    code: 'XAN-DEP', name: '서안 출발 (귀국)', type: 'transfer', duration: 'morning',
    schedule: [
      F('02:10', '서안 출발', 'BX342'),
      N('06:30', '부산 도착'),
    ],
    keywords: ['BX342', '부산 도착', '부산도착', '귀국'],
    score: 0, day_position: 'last',
  },

  // ── Sightseeing (17건) ──
  {
    code: 'XAN-B001', name: '진시황릉', type: 'sightseeing', duration: 'half',
    schedule: [N(null, '▶37년에 걸쳐 만들어진 세계 최대의 능 진시황릉')],
    keywords: ['진시황릉', '진시황제.*묘', '진시황.*릉'],
    score: 2.5,
  },
  {
    code: 'XAN-B002', name: '병마용', type: 'sightseeing', duration: 'half',
    schedule: [N(null, '▶세계 8대 불가사의 중 하나인 병마용')],
    keywords: ['병마용', '병마용박물원'],
    score: 3.0,
  },
  {
    code: 'XAN-B003', name: '화청지', type: 'sightseeing', duration: 'half',
    schedule: [N(null, '▶당현종과 양귀비의 로맨스 장소이자 황제들의 온천휴양지 화청지')],
    keywords: ['화청지', '양귀비.*로맨스', '화청궁'],
    score: 2.0,
  },
  {
    code: 'XAN-B004', name: '소안탑 + 서안박물관', type: 'sightseeing', duration: 'half',
    schedule: [N(null, '▶인도에서 가져온 경전을 보관한 소안탑 + 서안박물관 (화요일휴관)')],
    keywords: ['소안탑', '서안박물관'],
    score: 1.5,
  },
  {
    code: 'XAN-B005', name: '흥경궁공원', type: 'sightseeing', duration: 'half',
    schedule: [N(null, '▶당나라 3대 궁전 중의 하나인 흥경궁공원')],
    keywords: ['흥경궁', '흥경궁공원'],
    score: 1.0,
  },
  {
    code: 'XAN-B006', name: '회족거리', type: 'night', duration: 'half',
    schedule: [N(null, '▶소수민족 회족의 전통을 엿볼 수 있는 회족거리')],
    keywords: ['회족거리', '실크로드.*입문'],
    score: 1.5,
  },
  {
    code: 'XAN-B007', name: '종고루광장 야경', type: 'night', duration: 'half',
    schedule: [N(null, '▶종고루광장 야경 및 서안 야시장')],
    keywords: ['종고루', '종루', '야경.*야시장', '야시장.*종'],
    score: 1.0,
  },
  {
    code: 'XAN-B008', name: '대흥선사', type: 'sightseeing', duration: 'half',
    schedule: [N(null, '▶밀종의 발원지 대흥선사')],
    keywords: ['대흥선사', '밀종'],
    score: 1.0,
  },
  {
    code: 'XAN-B009', name: '문서거리', type: 'sightseeing', duration: 'half',
    schedule: [N(null, '▶중국의 인사동 거리라 불리는 문서거리(古文化街)')],
    keywords: ['문서거리', '古文化街', '고문화가', '인사동.*거리'],
    score: 0.5,
  },
  {
    code: 'XAN-B010', name: '와룡사', type: 'sightseeing', duration: 'half',
    schedule: [N(null, '▶한나라 건녕에 창건된 1,800년된 고찰 와룡사')],
    keywords: ['와룡사'],
    score: 1.0,
  },
  {
    code: 'XAN-B011', name: '곡강유적지공원', type: 'sightseeing', duration: 'half',
    schedule: [N(null, '▶고대 황제와 문인들의 놀이터 곡강유적지공원')],
    keywords: ['곡강', '곡강유적지'],
    score: 1.0,
  },
  {
    code: 'XAN-B012', name: '대안탑 + 대안탑북광장', type: 'sightseeing', duration: 'half',
    schedule: [
      N(null, '▶현장법사가 서역에서 가져온 불경을 보존한 대안탑(차창)'),
      N(null, '▶중국의 4대 명필가의 동상과 글씨를 장식해 놓은 대안탑북광장'),
    ],
    keywords: ['대안탑', '대안탑북광장', '현장법사'],
    score: 1.5,
  },
  {
    code: 'XAN-B013', name: '서안성벽 + 함광문유적지', type: 'sightseeing', duration: 'half',
    schedule: [N(null, '▶중국 보존건축물 중 가장 완전한 서안성벽 + 함광문유적지박물관')],
    keywords: ['서안성벽', '함광문', '성벽.*보존', '보존.*성벽'],
    score: 2.0, only_for: '품격',
  },
  {
    code: 'XAN-B014', name: '화산 (북봉케이블카)', type: 'sightseeing', duration: 'full',
    schedule: [
      T(null, '화산으로 이동 (약 2시간 30분 소요)'),
      N(null, '▶화산 관광 (북봉 케이블카 왕복포함)'),
      T(null, '서안으로 귀환'),
    ],
    keywords: ['화산', '북봉', '케이블카.*화산', '화산.*케이블카'],
    score: 3.0,
  },
  {
    code: 'XAN-B015', name: '팔로군 기념관', type: 'sightseeing', duration: 'half',
    schedule: [N(null, '▶일본이 패망 후 건설된 전쟁기념관인 팔로군 기념관')],
    keywords: ['팔로군', '팔로군.*기념관'],
    score: 0.5,
  },
  {
    code: 'XAN-B016', name: '고씨장원', type: 'sightseeing', duration: 'half',
    schedule: [N(null, '▶고씨장원')],
    keywords: ['고씨장원'],
    score: 0.5,
  },
  {
    code: 'XAN-B017', name: '호혜묘', type: 'sightseeing', duration: 'half',
    schedule: [N(null, '▶진2세 황제 호혜묘')],
    keywords: ['호혜묘', '진2세', '진나라.*2세'],
    score: 0.5,
  },

  // ── Service / Entertainment (5건) ──
  {
    code: 'XAN-M001', name: '발+전신 마사지 90분', type: 'massage', duration: 'half',
    schedule: [N(null, '▶여행의 피로를 풀어주는 발+전신 마사지(90분) 체험')],
    keywords: ['마사지.*90', '전신마사지', '발.*전신.*마사지'],
    score: 2.0, is_optional: true, option_price_usd: 40,
  },
  {
    code: 'XAN-S001', name: '실크로드쇼', type: 'show', duration: 'night',
    schedule: [N(null, '▶실크로드쇼 관람')],
    keywords: ['실크로드쇼', '실크로드.*쇼'],
    score: 1.5, is_optional: true, option_price_usd: 50,
  },
  {
    code: 'XAN-S002', name: '대당부용원 + 불야성 야경', type: 'night', duration: 'night',
    schedule: [N(null, '▶세계에서 가장 큰 당건축 테마파크 대당부용원 + 대당불야성 야경감상')],
    keywords: ['대당부용원', '불야성', '대당불야성'],
    score: 1.5, is_optional: true, option_price_usd: 50,
  },
  {
    code: 'XAN-S003', name: '대명궁유적지', type: 'show', duration: 'half',
    schedule: [N(null, '▶당나라 3대 궁전 중의 하나 대명궁유적지(전동차포함)')],
    keywords: ['대명궁'],
    score: 1.0, is_optional: true, option_price_usd: 40,
  },
  {
    code: 'XAN-O001', name: '명대성벽 + 비림박물관', type: 'sightseeing', duration: 'half',
    schedule: [
      N(null, '▶중국에서 가장 잘 보존된 중세방어 성벽인 명대 성벽'),
      N(null, '▶한나라 때부터 4,000여개의 비석을 전시/보관하고 있는 비림박물관'),
    ],
    keywords: ['명대.*성벽', '비림박물관', '비림', '명대성벽'],
    score: 2.0, is_optional: true, option_price_usd: 60,
  },

  // ── Shopping (1건) ──
  {
    code: 'XAN-SH01', name: '쇼핑 (라텍스+찻집+침향)', type: 'shopping', duration: 'half',
    schedule: [N(null, '쇼핑: 라텍스, 찻집, 침향 (총3회) + 농산물')],
    keywords: ['라텍스', '찻집', '침향', '쇼핑.*3회', '총3회'],
    score: -1.0,
  },
];

// ══════════════════════════════════════════════════════════════
// 2. 코스 템플릿 정의
// ══════════════════════════════════════════════════════════════

const TEMPLATES = [
  {
    code: 'XAN-실속-3N', name: '서안 실속 3박5일', type: '실속', nights: 3, days: 5,
    signature_blocks: ['XAN-B004', 'XAN-B005', 'XAN-B001', 'XAN-B002', 'XAN-B003'],
    excludes_blocks: ['XAN-B014'], // 화산 없음
    inclusions: ['항공료 및 텍스', '유류할증료', '여행자보험', '숙박(2인1실)', '차량', '한국어 가이드', '관광지입장료'],
    excludes: ['기사/가이드경비', '매너팁', '유류비변동분', '싱글비용'],
  },
  {
    code: 'XAN-실속-4N', name: '서안 실속 4박6일', type: '실속', nights: 4, days: 6,
    signature_blocks: ['XAN-B004', 'XAN-B005', 'XAN-B015', 'XAN-B001', 'XAN-B002', 'XAN-B003'],
    excludes_blocks: ['XAN-B014'],
    inclusions: ['항공료 및 텍스', '유류할증료', '여행자보험', '숙박(2인1실)', '차량', '한국어 가이드', '관광지입장료'],
    excludes: ['기사/가이드경비', '매너팁', '유류비변동분', '싱글비용'],
  },
  {
    code: 'XAN-품격-3N', name: '품격 서안(화산) 3박5일', type: '품격', nights: 3, days: 5,
    signature_blocks: ['XAN-B014', 'XAN-M001', 'XAN-B013'], // 화산+마사지+성벽 = 품격
    excludes_blocks: [],
    inclusions: ['항공료 및 텍스', '유류할증료', '여행자보험', '숙박(2인1실)', '한국어 가이드', '입장료', '기사/가이드 경비'],
    excludes: ['매너팁', '유류비변동분', '싱글비용'],
  },
  {
    code: 'XAN-품격-4N', name: '품격 서안(화산) 4박6일', type: '품격', nights: 4, days: 6,
    signature_blocks: ['XAN-B014', 'XAN-M001', 'XAN-B013'],
    excludes_blocks: [],
    inclusions: ['항공료 및 텍스', '유류할증료', '여행자보험', '숙박(2인1실)', '한국어 가이드', '입장료', '기사/가이드 경비'],
    excludes: ['매너팁', '유류비변동분', '싱글비용'],
  },
];

// ══════════════════════════════════════════════════════════════
// 3. 식사 패턴 (지역 고정)
// ══════════════════════════════════════════════════════════════

const MEAL_KEYWORDS = {
  '뺭뺭면': '뺭뺭면', '교자연': '덕발장 교자연', '덕발장': '덕발장 교자연',
  '샤브샤브': '샤브샤브', '삼겹살': '삼겹살', '사천요리': '사천요리',
  '삼겹살.*무제한': '삼겹살 무제한', '샤브샤브.*무제한': '샤브샤브 무제한',
  '훠궈': '훠궈', '불고기': '불고기',
};

// ══════════════════════════════════════════════════════════════
// 4. 파서 — 텍스트 → 구조화
// ══════════════════════════════════════════════════════════════

function parseRawText(text) {
  const result = {
    days: [],         // 일자별 텍스트
    priceLines: [],   // 가격 관련 줄
    inclusionLines: [],
    excludeLines: [],
    hotelLines: [],
    optionLines: [],
    shoppingLines: [],
    tipLines: [],
    standaloneOptionals: [], // "선택관광:" 섹션에서 파싱한 원문 목록
    parsedInclusions: null,  // 원문 포함사항 (string[] or null)
    parsedExcludes: null,    // 원문 불포함 (string[] or null)
    rawNights: null,
    rawDays: null,
    rawTitle: null,
    departureDays: null, // "매주 수요일", "수/토 출발" 등
  };

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // ── 제목/박수 추출 ──
  const titleMatch = text.match(/(\d)\s*박\s*(\d)\s*일/);
  if (titleMatch) {
    result.rawNights = parseInt(titleMatch[1]);
    result.rawDays = parseInt(titleMatch[2]);
  }

  // ── 출발요일 감지 ──
  const DOW_CHARS = '월화수목금토일';
  const dowPatterns = [
    /매주\s*([월화수목금토일][/,]?[월화수목금토일]?\s*요?일?)(?:\s*출발)?/,  // "매주 수요일 출발"
    /(?:출발|출발일)\s*[:：]?\s*(?:매주\s*)?([월화수목금토일][/,]?[월화수목금토일]?\s*요?일?)/, // "출발: 수/토요일"
    /([월화수목금토일])[/,]([월화수목금토일])\s*(?:요일)?\s*출발/, // "수/토 출발"
  ];
  for (const pat of dowPatterns) {
    const dowMatch = text.match(pat);
    if (dowMatch) {
      let raw = (dowMatch[1] || dowMatch[0]).trim();
      // "매주" 제거
      raw = raw.replace(/매주\s*/, '');
      result.departureDays = raw.includes('요일') ? `매주 ${raw}` : `매주 ${raw}요일`;
      break;
    }
  }

  // ── 일차별 분리 ──
  // "제1일", "1일차", "DAY1" 만 매칭 — "3박5일" 같은 제목은 무시
  const dayPattern = /(?:제\s*(\d+)\s*일|DAY\s*(\d+)|(\d+)\s*일\s*차)/i;
  let currentDay = null;
  let currentLines = [];

  for (const line of lines) {
    const dayMatch = line.match(dayPattern);
    if (dayMatch) {
      if (currentDay !== null) {
        result.days.push({ day: currentDay, lines: currentLines });
      }
      currentDay = parseInt(dayMatch[1] || dayMatch[2] || dayMatch[3]);
      currentLines = [line];
      continue;
    }

    // 가격 줄 감지
    if (/\d{2,3}[,.]?\d{3}\s*원?/.test(line) || /₩/.test(line) || /성인.*\d/.test(line) || /요금.*\d/.test(line)) {
      result.priceLines.push(line);
    }

    // 포함/불포함
    if (/포함\s*사항|포함내역|여행.*포함|요금.*포함/i.test(line)) {
      result.inclusionLines.push(line);
    }
    if (/불포함|제외|별도/i.test(line)) {
      result.excludeLines.push(line);
    }

    // 호텔
    for (const pool of DESTINATION.hotel_pool) {
      for (const name of pool.names) {
        if (line.includes(name)) {
          result.hotelLines.push({ line, grade: pool.grade, name, score: pool.score });
        }
      }
    }

    // 옵션
    if (/\[.*옵션\]|선택관광|추천옵션|\$\d+/i.test(line)) {
      result.optionLines.push(line);
    }

    // 쇼핑
    if (/쇼핑|라텍스|찻집|침향/i.test(line)) {
      result.shoppingLines.push(line);
    }

    // 팁
    if (/팁|경비.*\$/i.test(line)) {
      result.tipLines.push(line);
    }

    if (currentDay !== null) {
      currentLines.push(line);
    }
  }

  // 마지막 일차 저장
  if (currentDay !== null) {
    result.days.push({ day: currentDay, lines: currentLines });
  }

  // 일차 자동감지 실패 시 — 전체 텍스트를 하나로
  if (result.days.length === 0) {
    result.days.push({ day: 0, lines });
  }

  // 일차순 정렬
  result.days.sort((a, b) => a.day - b.day);

  // ── 포함/불포함 원문 파싱 ──
  const incMatch = text.match(/포함\s*사항\s*[:：]?\s*(.+)/i);
  if (incMatch) {
    result.parsedInclusions = incMatch[1].split(/[,，]/).map(s => s.trim()).filter(Boolean);
  }
  const excMatch = text.match(/불포함\s*[:：]?\s*(.+)/i);
  if (excMatch) {
    result.parsedExcludes = excMatch[1].split(/[,，]/).map(s => s.trim()).filter(Boolean);
  }

  // ── "선택관광:" 섹션 별도 파싱 (원문 그대로) ──
  const optSectionPattern = /선택관광\s*[:：]?\s*\n/i;
  const optSectionMatch = text.match(optSectionPattern);
  if (optSectionMatch) {
    const afterIdx = text.indexOf(optSectionMatch[0]) + optSectionMatch[0].length;
    const afterText = text.slice(afterIdx);
    const optLines = afterText.split(/\r?\n/).map(l => l.trim());
    const pricePattern = /(.+?)\s*[:：]\s*\$?\s*(\d+)/;
    for (const line of optLines) {
      if (!line || /^(요금|포함|불포함|제\d|DAY|\d{4}-)/i.test(line)) break; // 다음 섹션이면 중단
      if (/쇼핑|라텍스|찻집|침향/i.test(line)) continue; // 쇼핑 제외
      const m = line.match(pricePattern);
      if (m) {
        const name = m[1].replace(/\[.*?\]/g, '').replace(/^[-·•]\s*/, '').trim();
        if (name && name.length >= 2) {
          result.standaloneOptionals.push({ name, price_usd: parseInt(m[2]), price_krw: null, note: null });
        }
      }
    }
  }

  return result;
}

// ══════════════════════════════════════════════════════════════
// 5. 블록 매칭 엔진
// ══════════════════════════════════════════════════════════════

function matchBlocks(dayText) {
  const text = dayText.join(' ');
  const matched = [];
  const matchedAsOptional = [];

  for (const block of BLOCKS) {
    const isMatch = block.keywords.some(kw => {
      try { return new RegExp(kw, 'i').test(text); } catch { return text.includes(kw); }
    });

    if (isMatch) {
      // 옵션 줄에서만 매칭됐는지 확인
      const optionalLines = dayText.filter(l => /\[.*옵션\]|선택관광|\$\d+|☆/.test(l));
      const normalLines = dayText.filter(l => !/\[.*옵션\]|선택관광|\$\d+|☆/.test(l));

      const inOptional = block.keywords.some(kw => {
        try { return new RegExp(kw, 'i').test(optionalLines.join(' ')); } catch { return false; }
      });
      const inNormal = block.keywords.some(kw => {
        try { return new RegExp(kw, 'i').test(normalLines.join(' ')); } catch { return false; }
      });

      if (inNormal) {
        matched.push(block);
      } else if (inOptional) {
        matchedAsOptional.push(block);
      } else {
        matched.push(block);
      }
    }
  }

  return { matched, optional: matchedAsOptional };
}

// ══════════════════════════════════════════════════════════════
// 6. 식사 감지
// ══════════════════════════════════════════════════════════════

function detectMeals(dayLines) {
  const text = dayLines.join(' ');
  const meals = { breakfast: false, lunch: false, dinner: false, breakfast_note: null, lunch_note: null, dinner_note: null };

  if (/조식|호텔식.*아침|아침.*호텔|호텔 조식/.test(text)) {
    meals.breakfast = true;
    meals.breakfast_note = '호텔식';
  }
  if (/중식|점심|중:/.test(text)) {
    meals.lunch = true;
    const lunchMatch = text.match(/중식\s*[:：]?\s*([^\s,]+)|중:\s*([^\s,]+)/);
    if (lunchMatch) meals.lunch_note = (lunchMatch[1] || lunchMatch[2]).trim();
  }
  if (/석식|저녁|석:/.test(text)) meals.dinner = true;
  // "현지식" → 중식+석식 모두 true
  if (/현지식/.test(text)) {
    meals.lunch = true;
    meals.lunch_note = meals.lunch_note || '현지식';
    meals.dinner = true;
    meals.dinner_note = meals.dinner_note || '현지식';
  }

  // 특정 메뉴 감지
  for (const [kw, name] of Object.entries(MEAL_KEYWORDS)) {
    try {
      if (new RegExp(kw, 'i').test(text)) {
        // 석식에 매칭하는 게 일반적 (서안 패턴)
        if (/석식.*후|저녁/.test(text)) {
          meals.dinner = true;
          meals.dinner_note = name;
        } else {
          meals.dinner_note = meals.dinner_note || name;
        }
      }
    } catch { /* skip */ }
  }

  // day1 (도착일)은 대부분 식사 없음
  // last day (출발일)도 식사 없음 — 호출측에서 판단

  return meals;
}

// ══════════════════════════════════════════════════════════════
// 7. 호텔 감지
// ══════════════════════════════════════════════════════════════

function detectHotel(text) {
  const fullText = Array.isArray(text) ? text.join(' ') : text;

  for (const pool of DESTINATION.hotel_pool) {
    for (const name of pool.names) {
      if (fullText.includes(name)) {
        // 동급 패턴 감지
        const hotelStr = fullText.match(new RegExp(`${name}[^,\\n]*(?:또는[^,\\n]*)*(?:동급)?`))?.[0] || `${name} 또는 동급`;
        return { name: hotelStr.trim(), grade: pool.grade, score: pool.score };
      }
    }
  }

  // 5성/4성 키워드로 추론
  if (/5성|풀만|쉐라톤/.test(fullText)) return { name: '서안풀만호텔 또는 쉐라톤호텔 또는 동급', grade: '5성', score: 3 };
  if (/4성|천익|홀리데이인/.test(fullText)) return { name: '천익호텔 또는 홀리데이인익스프레호텔 또는 동급', grade: '4성', score: 1 };

  return { name: null, grade: null, score: 0 };
}

// ══════════════════════════════════════════════════════════════
// 8. 가격 추출
// ══════════════════════════════════════════════════════════════

function extractPrices(priceLines, fullText) {
  const prices = [];
  // priceLines가 있으면 거기서만 추출, 없으면 fullText fallback
  const allText = priceLines.length > 0 ? priceLines.join('\n') : fullText;

  // 패턴: 날짜 + 가격 (다양한 형식)
  // "2026-04-01 749,000" / "4/1 749000원" / "04.01 ₩749,000"
  const datePrice = /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[/.]\d{1,2})\s*[:\-~]?\s*(?:₩|원\s*)?\s*(\d{2,3}[,.]?\d{3})\s*원?/g;
  let m;
  while ((m = datePrice.exec(allText)) !== null) {
    let date = m[1];
    // 짧은 날짜를 YYYY-MM-DD로 변환
    if (/^\d{1,2}[/.]\d{1,2}$/.test(date)) {
      const [mm, dd] = date.split(/[/.]/);
      date = `2026-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
    date = date.replace(/[/.]/g, '-');
    const price = parseInt(m[2].replace(/[,.]/g, ''));
    if (price > 100000 && price < 5000000) {
      prices.push({ date, price, confirmed: false });
    }
  }

  // 요일별 가격 패턴: "매주 수요일 549,000원"
  const dowPrice = /(?:매주\s*)?(월|화|수|목|금|토|일)요일?\s*[:\-~]?\s*(?:₩)?\s*(\d{2,3}[,.]?\d{3})\s*원?/g;
  while ((m = dowPrice.exec(allText)) !== null) {
    // DOW 가격은 메타 정보로만 저장 (날짜 전개는 별도)
  }

  // 단순 가격 목록: "749,000 / 629,000 / 549,000"
  if (prices.length === 0) {
    const simplePrices = allText.match(/(\d{2,3})[,.](\d{3})\s*원?/g);
    if (simplePrices) {
      for (const sp of simplePrices) {
        const p = parseInt(sp.replace(/[,.원\s]/g, ''));
        if (p > 100000 && p < 5000000 && !prices.find(x => x.price === p)) {
          prices.push({ price: p });
        }
      }
    }
  }

  return prices;
}

// ══════════════════════════════════════════════════════════════
// 9. 팁/옵션 감지 → 상품 유형 판별
// ══════════════════════════════════════════════════════════════

function detectProductType(parsed, allBlocks) {
  const fullText = parsed.days.flatMap(d => d.lines).join(' ');

  const hasHuashan = allBlocks.some(b => b.code === 'XAN-B014');
  const hasMassageIncluded = allBlocks.some(b => b.code === 'XAN-M001') &&
    !parsed.optionLines.some(l => /마사지/.test(l));
  const hasShopping = allBlocks.some(b => b.code === 'XAN-SH01');
  const hasOptions = parsed.optionLines.length > 0;

  const noTip = /노팁|팁.*없|팁.*포함|경비.*포함/.test(fullText);
  const noOption = /노옵션|옵션.*없/.test(fullText);
  const noShopping = /노쇼핑|쇼핑.*없/.test(fullText) || !hasShopping;

  // 품격 판정: 화산 포함 + 마사지 정규 포함 + (노팁 or 노옵션)
  if (hasHuashan && (noTip || noOption || hasMassageIncluded)) {
    return {
      type: '품격',
      tags: ['노팁노옵션노쇼핑', '화산', '품격'],
      guideTip: 0,
    };
  }

  // 실속
  return {
    type: '실속',
    tags: ['실속'],
    guideTip: null, // 추후 텍스트에서 추출
  };
}

// ══════════════════════════════════════════════════════════════
// 10. 팁 금액 추출
// ══════════════════════════════════════════════════════════════

function extractGuideTip(parsed) {
  const allText = [...parsed.tipLines, ...parsed.excludeLines].join(' ');
  const tipMatch = allText.match(/(?:경비|팁)\s*\$?\s*(\d+)/);
  if (tipMatch) return parseInt(tipMatch[1]);
  return null;
}

// ══════════════════════════════════════════════════════════════
// 11. 품질 점수 계산
// ══════════════════════════════════════════════════════════════

function calculateScore(allBlocks, hotel, productType, hasShopping) {
  let hotelScore = hotel.score || 0;
  let attractionScore = 0;
  let serviceScore = 0;
  let penaltyScore = 0;

  for (const block of allBlocks) {
    if (block.type === 'sightseeing') attractionScore += block.score;
    else if (block.type === 'massage') serviceScore += block.score;
    else if (block.type === 'show' || block.type === 'night') attractionScore += block.score;
    else if (block.type === 'shopping') penaltyScore += block.score; // -1.0
  }

  // 옵션/팁 패널티
  if (productType.type === '실속') {
    penaltyScore -= 2.0; // has_options
    penaltyScore -= 1.0; // tip_required
  } else {
    penaltyScore += 2.0; // no_shopping bonus
  }

  const mealScore = 0.5 * 3; // 특식 약 3회 (서안 패턴)

  return {
    hotel_score: hotelScore,
    attraction_score: Math.round(attractionScore * 10) / 10,
    meal_score: mealScore,
    service_score: Math.round(serviceScore * 10) / 10,
    penalty_score: Math.round(penaltyScore * 10) / 10,
    total_score: Math.round((hotelScore + attractionScore + mealScore + serviceScore + penaltyScore) * 10) / 10,
  };
}

// ══════════════════════════════════════════════════════════════
// 12. 코스 템플릿 매칭
// ══════════════════════════════════════════════════════════════

function matchTemplate(nights, allBlockCodes, productType) {
  let bestMatch = null;
  let bestScore = -1;

  for (const tmpl of TEMPLATES) {
    if (tmpl.nights !== nights) continue;
    if (tmpl.type !== productType.type) continue;

    // 시그니처 블록 매칭 점수
    let score = 0;
    for (const sig of tmpl.signature_blocks) {
      if (allBlockCodes.includes(sig)) score += 2;
    }
    // 제외 블록 체크
    for (const exc of tmpl.excludes_blocks) {
      if (allBlockCodes.includes(exc)) score -= 5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = tmpl;
    }
  }

  return bestMatch;
}

// ══════════════════════════════════════════════════════════════
// 13. 최종 상품 JSON 빌드
// ══════════════════════════════════════════════════════════════

function buildProduct(parsed, rawText) {
  const fullText = rawText || parsed.days.flatMap(d => d.lines).join('\n');

  // ── 일자별 블록 매칭 ──
  const dayResults = [];
  const allMatchedBlocks = new Set();
  const allOptionalBlocks = new Set();

  for (const dayData of parsed.days) {
    if (dayData.day === 0) {
      // 일차 구분 없는 경우 — 전체 텍스트에서 블록 매칭
      const { matched, optional } = matchBlocks(dayData.lines);
      matched.forEach(b => allMatchedBlocks.add(b.code));
      optional.forEach(b => allOptionalBlocks.add(b.code));
      dayResults.push({ day: 0, blocks: matched, optional, lines: dayData.lines });
    } else {
      const { matched, optional } = matchBlocks(dayData.lines);
      matched.forEach(b => allMatchedBlocks.add(b.code));
      optional.forEach(b => allOptionalBlocks.add(b.code));
      dayResults.push({ day: dayData.day, blocks: matched, optional, lines: dayData.lines });
    }
  }

  let allBlockCodes = [...allMatchedBlocks];
  let allBlocks = BLOCKS.filter(b => allBlockCodes.includes(b.code));

  // ── 박/일 수 ──
  const nights = parsed.rawNights || (parsed.days.length > 1 ? parsed.days.length - 2 : 3);
  const days = parsed.rawDays || (nights + 2); // 서안은 N+2 (심야출발)

  // ── 호텔 ──
  const hotel = detectHotel(fullText);

  // ── 상품 유형 ──
  const productType = detectProductType(parsed, allBlocks);

  // ── 상품 유형에 맞지 않는 블록 제거 (예: 품격 전용 블록 → 실속에서 제외) ──
  if (productType.type !== '품격') {
    for (const dr of dayResults) {
      dr.optional = dr.optional.filter(b => !b.only_for || b.only_for === productType.type);
      dr.blocks = dr.blocks.filter(b => !b.only_for || b.only_for === productType.type);
    }
    allOptionalBlocks.clear();
    allMatchedBlocks.clear();
    for (const dr of dayResults) {
      dr.blocks.forEach(b => allMatchedBlocks.add(b.code));
      dr.optional.forEach(b => allOptionalBlocks.add(b.code));
    }
    allBlockCodes = [...allMatchedBlocks];
    allBlocks = BLOCKS.filter(b => allBlockCodes.includes(b.code));
  }

  // ── 코스 템플릿 매칭 ──
  const template = matchTemplate(nights, allBlockCodes, productType);

  // ── 가격 ──
  const prices = extractPrices(parsed.priceLines, fullText);
  const lowestPrice = prices.length > 0
    ? Math.min(...prices.filter(p => p.price).map(p => p.price))
    : null;

  // ── 팁 (원문 excludes/includes에서 감지) ──
  const excText = (parsed.parsedExcludes || []).join(' ');
  const incText = (parsed.parsedInclusions || []).join(' ');
  let guideTip = null;
  const tipMatch = excText.match(/(?:기사|가이드).*?경비\s*\$?\s*(\d+)/);
  if (tipMatch) {
    guideTip = `$${tipMatch[1]}/인`;
  } else if (/노팁|경비.*포함/.test(incText)) {
    guideTip = '없음 (노팁)';
  } else {
    // fallback: 숫자 추출 시도
    const raw = extractGuideTip(parsed);
    guideTip = raw ? `$${raw}/인` : null;
  }

  // ── 점수 ──
  const hasShopping = allBlockCodes.includes('XAN-SH01');
  const score = calculateScore(allBlocks, hotel, productType, hasShopping);

  // ── 쇼핑 정보 ──
  const shoppingInfo = hasShopping ? '라텍스, 찻집, 침향 (총3회)+농산물' : '노쇼핑';

  // ── 옵션 투어 목록: 원문 "선택관광:" 섹션 우선 사용 ──
  let optionalTours = [];

  if (parsed.standaloneOptionals.length > 0) {
    // 원문의 선택관광 섹션이 있으면 그대로 사용 (블록 매칭 무관)
    optionalTours = [...parsed.standaloneOptionals];
  } else {
    // fallback: 인라인 옵션에서 파싱
    const optionPricePattern = /(.+?)\s*[:：]\s*\$?\s*(\d+)/;
    const shoppingKeywords = /라텍스|찻집|침향|쇼핑/i;
    const seenNames = new Set();
    for (const line of parsed.optionLines) {
      if (shoppingKeywords.test(line)) continue;
      const match = line.match(optionPricePattern);
      if (match) {
        const name = match[1].replace(/\[.*?\]/g, '').replace(/^[-·•]\s*/, '').trim();
        if (!name || name.length < 2 || seenNames.has(name)) continue;
        seenNames.add(name);
        optionalTours.push({ name, price_usd: parseInt(match[2]), price_krw: null, note: null });
      }
    }
  }

  // ── highlights 자동 생성 ──
  const highlights = [];
  if (allBlockCodes.includes('XAN-B001') && allBlockCodes.includes('XAN-B002') && allBlockCodes.includes('XAN-B003')) {
    highlights.push('진시황릉·병마용·화청지 핵심 3대 관광지');
  }
  if (allBlockCodes.includes('XAN-B014')) {
    highlights.push('화산 북봉케이블카 관광 포함');
  }
  if (allBlockCodes.includes('XAN-B006') || allBlockCodes.includes('XAN-B007')) {
    highlights.push('서안 회족거리·종고루광장 야경 감상');
  }
  if (allBlockCodes.includes('XAN-M001') && productType.type === '품격') {
    highlights.push('발+전신 마사지 90분 포함');
  }

  // ── itinerary_data 빌드 ──
  const itineraryDays = [];
  for (const dr of dayResults) {
    const isFirst = dr.day === 1 || (dayResults.indexOf(dr) === 0);
    const isLast = dr.day === days || (dayResults.indexOf(dr) === dayResults.length - 1);
    const isSecondLast = dr.day === days - 1 || (dayResults.indexOf(dr) === dayResults.length - 2);

    let schedule = [];
    let meals;

    if (isFirst) {
      schedule.push({ time: DESTINATION.flight_out_time, activity: '부산 출발', type: 'flight', transport: DESTINATION.flight_out, note: null });
      schedule.push({ time: DESTINATION.arrival_time, activity: '서안 도착 / 가이드 미팅 후 호텔 투숙', type: 'normal', transport: null, note: null });
    } else if (isLast) {
      schedule.push({ time: null, activity: '호텔 조식 후', type: 'normal', transport: null, note: null });
    } else {
      schedule.push({ time: null, activity: '호텔 조식 후', type: 'normal', transport: null, note: null });
    }

    meals = detectMeals(dr.lines);
    const hasSightseeing = dr.blocks.some(b => b.type === 'sightseeing' || b.type === 'night');
    if (hasSightseeing) {
      if (!meals.breakfast && !isFirst) { meals.breakfast = true; meals.breakfast_note = meals.breakfast_note || '호텔식'; }
      if (!meals.lunch) { meals.lunch = true; meals.lunch_note = meals.lunch_note || '현지식'; }
      if (!meals.dinner && !isLast) { meals.dinner = true; meals.dinner_note = meals.dinner_note || '현지식'; }
    }

    for (const block of dr.blocks) {
      if (block.code === 'XAN-ARR' || block.code === 'XAN-DEP') continue;
      const typeOverride = block.type === 'shopping' ? 'shopping' : null;
      for (const s of block.schedule) {
        schedule.push({ ...s, type: typeOverride || s.type });
      }
    }

    for (const optBlock of dr.optional) {
      if (optBlock.type === 'shopping') continue;
      schedule.push({ time: null, activity: `[선택옵션] ${optBlock.name} : $${optBlock.option_price_usd || '??'}`, type: 'optional', transport: null, note: null });
      for (const s of optBlock.schedule) {
        schedule.push({ time: null, activity: `☆${s.activity.replace('▶', '')}`, type: 'optional', transport: null, note: null });
      }
    }

    if (isFirst || (!isSecondLast && !isLast)) {
      schedule.push({ time: null, activity: '석식 후 호텔 투숙', type: 'normal', transport: null, note: null });
    } else if (isSecondLast && !isLast) {
      schedule.push({ time: null, activity: '석식 후', type: 'normal', transport: null, note: null });
      schedule.push({ time: null, activity: '공항으로 이동', type: 'transport', transport: '전용차량', note: null });
    }
    
    if (isLast) {
      schedule.push({ time: DESTINATION.return_departure_time, activity: '서안 출발', type: 'flight', transport: DESTINATION.flight_in, note: null });
      schedule.push({ time: DESTINATION.flight_in_time, activity: '부산 도착', type: 'normal', transport: null, note: null });
    }

    const dayHotel = (isLast || isSecondLast)
      ? { name: null, grade: null, note: null }
      : { name: hotel.name, grade: hotel.grade, note: null };

    itineraryDays.push({
      day: dr.day || (dayResults.indexOf(dr) + 1),
      regions: isFirst ? ['부산', '서안'] : isLast ? ['서안', '부산'] : ['서안'],
      meals,
      schedule,
      hotel: dayHotel,
    });
  }

  // ── 최종 상품 객체 ──
  const title = productType.type === '품격'
    ? `품격 서안(병마용,화청지)${allBlockCodes.includes('XAN-B014') ? ', 화산' : ''} ${nights}박 ${days}일`
    : `서안, 병마용, 화청지 ${nights}박 ${days}일`;

  // ── 출발요일 ──
  const departureDays = parsed.departureDays || null;

  const product = {
    title,
    display_title: title,
    destination: '서안',
    country: '중국',
    category: 'package',
    product_type: productType.type,
    trip_style: `${nights}박${days}일`,
    duration: days,
    nights,
    departure_airport: DESTINATION.departure_airport,
    departure_days: departureDays,
    airline: DESTINATION.airline,
    min_participants: 4,
    status: 'pending',
    price: lowestPrice,
    guide_tip: guideTip,
    single_supplement: null,
    small_group_surcharge: null,
    surcharges: [],
    excluded_dates: [],
    price_tiers: [],
    price_dates: prices.filter(p => p.date).map(p => ({ date: p.date, price: p.price, confirmed: false })),
    optional_tours: productType.type === '실속' ? optionalTours : [],
    inclusions: parsed.parsedInclusions || (template ? template.inclusions : TEMPLATES[0].inclusions),
    excludes: parsed.parsedExcludes || (template ? template.excludes : TEMPLATES[0].excludes),
    notices_parsed: DESTINATION.notices,
    special_notes: hasShopping ? `쇼핑: ${shoppingInfo}` : null,
    product_highlights: highlights,
    product_tags: ['서안', '병마용', ...productType.tags],
    accommodations: hotel.name
      ? [`${hotel.name}(${hotel.grade}) × ${nights}박`]
      : [],
    product_summary: null,
    itinerary: [],
    raw_text: '',
    filename: 'assembler_output',
    file_type: 'assembled',
    confidence: 0.85,
    itinerary_data: {
      meta: {
        title,
        product_type: productType.type,
        destination: '서안',
        nights,
        days,
        departure_airport: DESTINATION.departure_airport,
        airline: DESTINATION.airline,
        flight_out: DESTINATION.flight_out,
        flight_in: DESTINATION.flight_in,
        departure_days: departureDays,
        min_participants: 4,
        room_type: '2인1실',
        ticketing_deadline: null,
        hashtags: ['#서안', '#병마용', ...productType.tags.map(t => `#${t}`)],
        brand: '여소남',
      },
      highlights: {
        inclusions: parsed.parsedInclusions || (template ? template.inclusions : []),
        excludes: parsed.parsedExcludes || (template ? template.excludes : []),
        shopping: shoppingInfo,
        remarks: DESTINATION.notices.map(n => typeof n === 'string' ? n : n.text),
      },
      days: itineraryDays,
      optional_tours: productType.type === '실속' ? optionalTours : [],
    },
  };

  // ── 미매칭 활동 감지 (원문에 ▶ 있는데 블록에 안 잡힌 것) ──
  const unmatchedActivities = [];
  for (const dr of dayResults) {
    for (const line of dr.lines) {
      if (!line.includes('▶')) continue;
      const activity = line.replace(/^.*▶/, '').trim();
      if (activity.length < 3) continue;
      // schedule 텍스트 매칭 OR keywords 매칭
      const allDayBlocks = [...dr.blocks, ...dr.optional];
      const isMatched = allDayBlocks.some(b => {
        // schedule activity에 원문 4자 이상 포함?
        const scheduleMatch = b.schedule.some(s => s.activity.includes(activity.slice(0, 4)));
        // 블록 keywords 중 원문에 포함된 것?
        const keywordMatch = b.keywords.some(kw => {
          try { return new RegExp(kw, 'i').test(activity); } catch { return activity.includes(kw); }
        });
        return scheduleMatch || keywordMatch;
      });
      if (!isMatched) unmatchedActivities.push(activity);
    }
  }

  return {
    product,
    meta: {
      template: template ? template.code : 'UNKNOWN',
      matched_blocks: allBlockCodes,
      optional_blocks: [...allOptionalBlocks],
      unmatched: unmatchedActivities,
      score,
      hotel,
      productType,
      departureDays,
      priceCount: prices.length,
      prices,
      dayCount: parsed.days.length,
    },
  };
}

// ══════════════════════════════════════════════════════════════
// 14. 출력 포맷터
// ══════════════════════════════════════════════════════════════

function printReport(result) {
  const { product, meta } = result;
  const warnings = [];

  console.log('\n' + '═'.repeat(60));
  console.log('  서안 어셈블러 v2 — 검수 리포트');
  console.log('═'.repeat(60));

  // ── 지역 ──
  console.log(`\n✅ 지역: ${product.destination} (${meta.template})`);
  console.log(`✅ 유형: ${meta.productType.type} | ${product.nights}박${product.duration}일`);

  // ── 호텔 ──
  if (meta.hotel.name) {
    console.log(`✅ 호텔: ${meta.hotel.name} (${meta.hotel.grade})`);
  } else {
    console.log(`⚠️  호텔: 감지 실패 → 직접 입력 필요`);
    warnings.push('호텔 미감지');
  }

  // ── 매칭된 블록 ──
  const blockNames = meta.matched_blocks
    .map(c => BLOCKS.find(b => b.code === c))
    .filter(b => b && b.type !== 'transfer')
    .map(b => b.name);
  console.log(`✅ 매칭됨: ${blockNames.join(', ')} (${meta.matched_blocks.length}개)`);

  // ── 옵션 블록 ──
  if (meta.optional_blocks.length > 0) {
    const optNames = meta.optional_blocks
      .map(c => BLOCKS.find(b => b.code === c))
      .filter(Boolean)
      .map(b => `${b.name}($${b.option_price_usd || '?'})`);
    console.log(`✅ 옵션: ${optNames.join(', ')} (${meta.optional_blocks.length}개)`);
  }

  // ── 미매칭 활동 ──
  if (meta.unmatched.length > 0) {
    for (const u of meta.unmatched) {
      console.log(`⚠️  미매칭: "${u}" (블록 없음)`);
      warnings.push(`미매칭: ${u}`);
    }
  }

  // ── 출발요일 ──
  if (meta.departureDays) {
    console.log(`✅ 출발요일: ${meta.departureDays} 감지`);
  } else {
    console.log(`⚠️  출발요일: 감지 실패 → 직접 입력 필요`);
    warnings.push('출발요일 미감지');
  }

  // ── 가격 ──
  if (meta.prices.length > 0) {
    const priceStrs = meta.prices.slice(0, 4).map(p =>
      p.date ? `${p.date.slice(5)} ₩${p.price.toLocaleString()}` : `₩${p.price.toLocaleString()}`
    );
    const suffix = meta.prices.length > 4 ? ` ... 외 ${meta.prices.length - 4}건` : '';
    console.log(`✅ 가격: ${priceStrs.join(' / ')}${suffix} (${meta.prices.length}개)`);
    console.log(`✅ 최저가: ₩${product.price.toLocaleString()}`);
  } else {
    console.log(`⚠️  가격: 감지 실패`);
    warnings.push('가격 미감지');
  }

  // ── 팁 ──
  console.log(`✅ 가이드팁: $${product.guide_tip}`);

  // ── 점수 ──
  console.log(`✅ 품질점수: ${meta.score.total_score}점 (호텔${meta.score.hotel_score} 관광${meta.score.attraction_score} 서비스${meta.score.service_score} 감점${meta.score.penalty_score})`);

  // ── 일정 요약 ──
  console.log(`\n📅 일정:`);
  for (const day of product.itinerary_data.days) {
    const activities = day.schedule
      .filter(s => s.type !== 'optional' && s.activity.includes('▶'))
      .map(s => s.activity.replace('▶', '').trim());
    const optionals = day.schedule
      .filter(s => s.type === 'optional' && s.activity.startsWith('['))
      .map(s => s.activity);

    const actStr = activities.length > 0
      ? activities.join(' → ')
      : (day.day === 1 ? '부산→서안' : '서안→부산');
    console.log(`   Day ${day.day}: ${actStr}`);
    if (optionals.length > 0) {
      optionals.forEach(o => console.log(`          ${o}`));
    }
  }

  // ── 경고 요약 ──
  if (warnings.length > 0) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`⚠️  검수 필요 항목 ${warnings.length}개:`);
    warnings.forEach((w, i) => console.log(`   ${i + 1}. ${w}`));
  } else {
    console.log(`\n✅ 검수 필요 항목 없음 — 바로 등록 가능`);
  }

  console.log('═'.repeat(60));
}

// ══════════════════════════════════════════════════════════════
// 15. DB 등록 (--insert 모드)
// ══════════════════════════════════════════════════════════════

async function insertToDB(product, landOperatorId, commissionRate, ticketingDeadline, supplierCode) {
  const supabase = initSupabase();

  // short_code 생성
  supplierCode = supplierCode || 'XX';
  const destCode = 'XIY';
  const dur = String(product.duration).padStart(2, '0');
  const prefix = `${supplierCode}-${destCode}-${dur}-`;

  const { data: existingCodes } = await supabase
    .from('travel_packages')
    .select('short_code')
    .ilike('short_code', `${prefix}%`)
    .order('short_code', { ascending: false });

  const maxSeq = (existingCodes || []).reduce((max, r) => {
    const n = parseInt(r.short_code?.split('-').pop() || '0', 10);
    return n > max ? n : max;
  }, 0);

  const short_code = `${prefix}${String(maxSeq + 1).padStart(2, '0')}`;

  const row = {
    ...product,
    land_operator_id: landOperatorId,
    commission_rate: commissionRate,
    ticketing_deadline: ticketingDeadline,
    short_code,
  };

  const { data, error } = await supabase
    .from('travel_packages')
    .insert([row])
    .select('id, title, short_code, status, price');

  if (error) {
    console.error('❌ DB 등록 실패:', error.message);
    return null;
  }

  console.log(`\n✅ DB 등록 완료!`);
  console.log(`   ID: ${data[0].id}`);
  console.log(`   코드: ${data[0].short_code}`);
  console.log(`   상태: ${data[0].status}`);
  return data[0];
}

// ══════════════════════════════════════════════════════════════
// 랜드사 매핑 (이름 → UUID)
// ══════════════════════════════════════════════════════════════

const LAND_OPERATORS = {
  '투어폰': { id: '43a54eed-1390-4713-bb43-2624c87436a4', code: 'TP' },
  '랜드부산': { id: 'bca5ed71-ef0a-4fd4-b24e-c88c3d1e7d73', code: 'LB' },
  '투어라운지': { id: null, code: 'TL' },
  '백두산관광': { id: null, code: 'BD' },
  '비루방': { id: null, code: 'VB' },
};

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════

function getArg(args, name) {
  const found = args.find(a => a.startsWith(`--${name}=`) || a.startsWith(`--${name} `));
  if (found) return found.split('=')[1] || found.split(' ')[1];
  // --name value 형식
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const inputFile = args.find(a => !a.startsWith('--'));
  const doInsert = args.includes('--insert');
  const dryRun = args.includes('--dry-run');
  const jsonOnly = args.includes('--json');

  // CLI 파라미터
  const operatorName = getArg(args, 'operator');
  const commission = parseInt(getArg(args, 'commission') || '9');
  const deadline = getArg(args, 'deadline');
  const landId = getArg(args, 'land'); // UUID 직접 지정

  if (!inputFile) {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║  서안(Xi'an) 어셈블러 v2                                ║
║  원문 텍스트 → 블록 매칭 → 상품 자동 조립               ║
╚══════════════════════════════════════════════════════════╝

사용법:
  node db/assembler_xian.js <텍스트파일>                              리포트 출력
  node db/assembler_xian.js <텍스트파일> --json                       JSON 출력
  node db/assembler_xian.js <텍스트파일> --dry-run --operator 투어폰  등록 전 검증
  node db/assembler_xian.js <텍스트파일> --insert  --operator 투어폰  DB 직접 등록

옵션:
  --operator <이름>     랜드사 이름 (투어폰, 랜드부산, 투어라운지, 백두산관광, 비루방)
  --land <UUID>         랜드사 ID 직접 지정 (--operator 대신)
  --commission <N>      수수료율 (기본 9)
  --deadline <날짜>     발권마감일 (YYYY-MM-DD)
  --dry-run             DB 등록 없이 최종 JSON 검증만
  --insert              DB 직접 등록
  --json                JSON만 출력 (파이프용)
`);
    process.exit(0);
  }

  // 파일 읽기
  let rawText;
  try {
    rawText = fs.readFileSync(inputFile, 'utf-8');
  } catch (e) {
    console.error(`❌ 파일 읽기 실패: ${inputFile}`);
    console.error(e.message);
    process.exit(1);
  }

  console.log(`📄 입력: ${inputFile} (${rawText.length}자)`);

  // 파싱
  const parsed = parseRawText(rawText);
  console.log(`📊 감지: ${parsed.days.length}일 | 가격줄 ${parsed.priceLines.length}개 | 옵션줄 ${parsed.optionLines.length}개 | 호텔줄 ${parsed.hotelLines.length}개`);

  // 어셈블
  const result = buildProduct(parsed, rawText);

  // 랜드사/수수료/마감일 반영
  const operator = operatorName ? LAND_OPERATORS[operatorName] : null;
  const resolvedLandId = landId || (operator ? operator.id : null);
  const supplierCode = operator ? operator.code : 'XX';

  if (operatorName) {
    result.meta.operator = operatorName;
    result.meta.supplierCode = supplierCode;
  }
  if (commission) result.product.commission_rate = commission;
  if (deadline) {
    result.product.ticketing_deadline = deadline;
    result.product.itinerary_data.meta.ticketing_deadline = deadline;
  }

  if (jsonOnly) {
    console.log(JSON.stringify(result.product, null, 2));
  } else if (dryRun) {
    // ── dry-run: 리포트 + 핵심 필드 검증 ──
    printReport(result);

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📋 dry-run 검증:`);
    if (operatorName) console.log(`✅ 랜드사: ${operatorName} (${supplierCode}) ${resolvedLandId ? `ID: ${resolvedLandId.slice(0, 8)}...` : '⚠️  ID 없음'}`);
    console.log(`✅ 수수료: ${commission}%`);
    if (deadline) console.log(`✅ 발권마감: ${deadline}`);
    console.log(`✅ itinerary_data.days: ${result.product.itinerary_data.days.length}일`);
    console.log(`✅ price_dates: ${result.meta.prices.length}건`);
    if (result.meta.prices.length > 0) {
      console.log(`   첫째: ${result.meta.prices[0].date} ₩${result.meta.prices[0].price.toLocaleString()}`);
      const last = result.meta.prices[result.meta.prices.length - 1];
      console.log(`   마지막: ${last.date} ₩${last.price.toLocaleString()}`);
    }
    console.log(`✅ display_title: "${result.product.display_title}"`);
    console.log(`✅ departure_days: ${result.product.departure_days || '미설정'}`);

    // JSON 파일로 저장
    const outFile = inputFile.replace(/\.[^.]+$/, '_dryrun.json');
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`\n💾 결과 저장: ${outFile}`);
    console.log(`   → 확인 후 --insert로 실제 등록`);
  } else if (doInsert) {
    printReport(result);

    if (!resolvedLandId) {
      console.error(`\n❌ 랜드사 ID 없음. --operator <이름> 또는 --land <UUID> 필요`);
      process.exit(1);
    }

    await insertToDB(result.product, resolvedLandId, commission, deadline, supplierCode);
  } else {
    printReport(result);

    // JSON 파일로 자동 저장
    const outFile = inputFile.replace(/\.[^.]+$/, '_assembled.json');
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`\n💾 결과 저장: ${outFile}`);
  }
}

main().catch(e => { console.error('❌ 에러:', e.message); process.exit(1); });
