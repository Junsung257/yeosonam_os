/**
 * 다낭(Da Nang) / 호이안 어셈블러 v1
 *
 * 원문 텍스트 → 키워드 스캔 → 블록 매칭 → 코스 판별 → 가격/제외일 추출 → 점수 계산 → 상품 JSON 출력
 *
 * 사용법:
 *   node db/assembler_danang.js <raw_text_file>                                       (dry-run, JSON 출력만)
 *   node db/assembler_danang.js <raw_text_file> --insert                              (DB 직접 등록)
 *   node db/assembler_danang.js <raw_text_file> --operator 랜드부산 --commission 10  (랜드사/마진 명시)
 *
 * 입력 텍스트 형식:
 *   - 랜드사 PDF/문서에서 복사한 원문 텍스트 (랜드부산 포맷 우선 지원)
 *   - 일차별 구분 (제1일/DAY1/1일차)
 *   - 가격표("1,099,-" 또는 "1,099,000원" 형식 지원)
 *   - 항공제외일 / 호텔/식사 명시
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { findDuplicate, isSamePriceDates, isSameDeadline, validatePackage } = require('./templates/insert-template');

// ── Supabase (--insert 모드용) ──────────────────────────────────
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
// 1. 다낭 메타데이터
// ══════════════════════════════════════════════════════════════

const N = (time, activity, note) => ({ time: time || null, activity, type: 'normal', transport: null, note: note || null });
const F = (time, activity, transport) => ({ time, activity, type: 'flight', transport, note: null });
const O = (time, activity, note) => ({ time: time || null, activity, type: 'optional', transport: null, note: note || null });
const S = (time, activity, note) => ({ time: time || null, activity, type: 'shopping', transport: null, note: note || null });

const DESTINATION = {
  name: '다낭/호이안', country: '베트남', region_code: 'DAD',
  airline_default: 'BX(에어부산)', airline_code: 'BX',
  departure_airport: '부산(김해)',
  flight_pool: [
    { code: 'BX773', dep: '20:50', arr: '23:50', dir: 'out', label: 'BX773 김해 20:50 → 다낭 23:50' },
    { code: 'BX7315', dep: '22:05', arr: '01:10', dir: 'out', label: '증편 BX7315 김해 22:05 → 다낭 01:10' },
    { code: 'BX774', dep: '00:45', arr: '07:20', dir: 'in', label: 'BX774 다낭 00:45 → 김해 07:20' },
    { code: 'BX7325', dep: '02:10', arr: '09:05', dir: 'in', label: '증편 BX7325 다낭 02:10 → 김해 09:05' },
  ],
  hotel_pool: [
    // 5성급
    { grade: '5성', names: ['다낭 프린스호텔', '프린스호텔', '셀드메르'], score: 3 },
    { grade: '5성', names: ['멜리아 빈펄', '멜리아빈펄', '빈펄 리버프런트', '빈펄 리버 프론트'], score: 3 },
    { grade: '5성', names: ['페닌슐라 호텔', '페닌슐라'], score: 3 },
    { grade: '5성', names: ['윈덤 솔레일', '윈덤솔레이'], score: 3 },
    { grade: '5성', names: ['포포인츠 바이 쉐라톤', '포포인츠'], score: 3 },
    { grade: '5성', names: ['센터포인트 다낭', '센터포인트'], score: 3 },
    { grade: '5성', names: ['래디슨'], score: 3 },
    { grade: '5성', names: ['골든베이'], score: 3 },
    // 준5성/4성
    { grade: '준5성', names: ['알란씨 호텔', '알란씨', '나로드'], score: 2 },
    { grade: '준5성', names: ['므엉탄', '무엉탄', '송한'], score: 2 },
    { grade: '4성', names: ['로사미아', '어웨이큰'], score: 1 },
  ],
  notices: [
    { type: 'CRITICAL', title: '필수 확인', text: '• 여권 만료일 출발일 기준 6개월 이상 필수\n• 만 15세 미만 아동 베트남 입국 시 가족관계증명서 영문본 지참\n• 2025년 1월 1일부터 베트남 전자담배 금지 (전자담배·가열담배·아이코스·힛츠)' },
    { type: 'INFO', title: '안내', text: '• 항공은 GV2 그룹요금 기준 — 예약 시 출발일별 인상 가능\n• 호텔/리조트 예약 시 날짜별 써차지 체크 필요' },
  ],
};

// ══════════════════════════════════════════════════════════════
// 2. 다낭/호이안 블록 정의 (관광/옵션/쇼핑/식사)
// ══════════════════════════════════════════════════════════════

const BLOCKS = [
  // ── Transfer ──
  {
    code: 'DAD-ARR', name: '다낭 도착', type: 'transfer', duration: 'half',
    schedule: [
      F('20:50', 'BX773 김해국제공항 출발 → 다낭국제공항 23:50 도착 (증편 BX7315 22:05→01:10)', 'BX773'),
      N(null, '다낭 공항 도착 후 현지가이드 미팅하여 호텔로 이동'),
      N(null, '호텔 투숙 및 휴식'),
    ],
    keywords: ['다낭.*도착', '다낭공항.*도착', 'BX773', 'BX7315', '김해.*출발'],
    score: 0, day_position: 'day1',
  },
  {
    code: 'DAD-DEP', name: '다낭 출발 (귀국)', type: 'transfer', duration: 'morning',
    schedule: [
      F('00:45', 'BX774 다낭국제공항 출발 → 김해국제공항 07:20 도착 (증편 BX7325 02:10→09:05)', 'BX774'),
    ],
    keywords: ['BX774', 'BX7325', '부산.*도착', '김해.*도착', '귀국'],
    score: 0, day_position: 'last',
  },
  // ── 다낭 시내 관광 ──
  {
    code: 'DAD-MARBLE', name: '마블마운틴 (대리석산)', type: 'tour', duration: 'half',
    schedule: [N(null, '▶마블마운틴 (대리석산) 관광 — 다낭의 가장 아름다운 명소')],
    keywords: ['마블마운틴', '대리석산', '오행산'],
    score: 2, day_position: 'any',
  },
  {
    code: 'DAD-LINHUNG', name: '영응사 (해수관음상)', type: 'tour', duration: 'half',
    schedule: [N(null, '▶영응사 (베트남 최대 불상 해수관음상) 관광')],
    keywords: ['영응사', '린응사', '해수관음', '관음상'],
    score: 2, day_position: 'any',
  },
  {
    code: 'DAD-CATHEDRAL', name: '다낭대성당', type: 'tour', duration: 'short',
    schedule: [N(null, '▶다낭대성당 (프랑스 식민지배 시기 건축, 다낭 유일)')],
    keywords: ['다낭대성당', '핑크성당', '대성당'],
    score: 1, day_position: 'any',
  },
  {
    code: 'DAD-APEC', name: 'APEC 조각공원', type: 'tour', duration: 'short',
    schedule: [N(null, '▶APEC 조각공원')],
    keywords: ['APEC', '조각공원'],
    score: 1, day_position: 'any',
  },
  {
    code: 'DAD-MYKHE', name: '미케 비치', type: 'tour', duration: 'short',
    schedule: [N(null, '▶세계 6대 비치 중 하나인 미케 비치 산책')],
    keywords: ['미케', 'My Khe', '미케비치'],
    score: 1, day_position: 'any',
  },
  {
    code: 'DAD-CRUISE', name: '한강크루즈', type: 'tour', duration: 'half',
    schedule: [N(null, '▶다낭 한강크루즈 체험 (다낭 야경 감상)')],
    keywords: ['한강크루즈', '한강 크루즈', '다낭야경', 'Han River'],
    score: 2, day_position: 'evening',
  },
  // ── 호이안 ──
  {
    code: 'DAD-HOIAN', name: '호이안 구시가지', type: 'tour', duration: 'half',
    schedule: [
      N(null, '호이안으로 이동 (약 30분)'),
      N(null, '▶호이안 구시가지 (풍흥의 집, 일본내원교, 떤키의 집, 관운장사당 등) 유네스코 지정 전통거리 관광'),
      N(null, '호이안 특산 못주스 1잔 제공'),
    ],
    keywords: ['호이안.*구시가지', '호이안 시내', '풍흥', '일본내원교', '떤키', '관운장'],
    score: 3, day_position: 'any',
  },
  {
    code: 'DAD-HOIAN-NIGHT', name: '호이안 야경/야시장', type: 'tour', duration: 'evening',
    schedule: [N(null, '▶호이안 야경 감상 + 야시장 자유시간 (빛의 도시)')],
    keywords: ['호이안 야경', '호이안 야시장', '빛의 도시', '랜턴'],
    score: 2, day_position: 'evening',
  },
  // ── 바나산 ──
  {
    code: 'DAD-BANA', name: '바나산 국립공원', type: 'tour', duration: 'full',
    schedule: [N(null, '▶바나산 국립공원 (케이블카, 골든브릿지, 테마파크 등)')],
    keywords: ['바나산', '바나힐', 'Ba Na', '골든브릿지', '골든 브릿지', '케이블카'],
    score: 3, day_position: 'any',
  },
  // ── 옵션 (팁별도 활동) ──
  {
    code: 'DAD-OPT-MASSAGE', name: '핫스톤 마사지 90분', type: 'optional', duration: 'short',
    schedule: [N(null, '핫스톤 마사지 90분 체험', '팁별도/아동제외')],
    keywords: ['핫스톤', '핫스톤 마사지', '베트남 전통.*마사지'],
    score: 1, day_position: 'any',
  },
  {
    code: 'DAD-OPT-BASKET', name: '튄퉁 바구니배 체험', type: 'optional', duration: 'short',
    schedule: [N(null, '▶베트남 전통 바구니배 \'튄퉁\' 체험', '팁별도')],
    keywords: ['바구니배', '튄퉁', '바스킷보트'],
    score: 1, day_position: 'any',
  },
  {
    code: 'DAD-OPT-CYCLO', name: '씨클로 체험', type: 'optional', duration: 'short',
    schedule: [N(null, '▶베트남 전통 인력거 씨클로 체험', '팁별도')],
    keywords: ['씨클로', '인력거', 'Cyclo'],
    score: 1, day_position: 'any',
  },
  // ── 쇼핑 ──
  {
    code: 'DAD-SHOP', name: '쇼핑 관광', type: 'shopping', duration: 'short',
    schedule: [S(null, '쇼핑 관광', '쇼핑샵 일정 불참 시 패널티 $150/인')],
    keywords: ['쇼핑.*관광', '쇼핑센터', '쇼핑샵'],
    score: 0, day_position: 'any',
  },
];

// ══════════════════════════════════════════════════════════════
// 3. 식사 풀 (다낭/호이안 특식)
// ══════════════════════════════════════════════════════════════

const MEAL_POOL = {
  특식: ['노니보쌈', '호이안가정식', '퓨전뷔페', '샤브샤브', '반쎄오', '무제한삼겹살', '분짜', '쌀국수', '수상레스토랑', '시푸드'],
  일반: ['호텔식', '한식', '현지식', '도시락'],
};

// ══════════════════════════════════════════════════════════════
// 4. 상품 템플릿 (product_type별)
// ══════════════════════════════════════════════════════════════

const TEMPLATES = {
  '노팁노옵션': {
    label: '노팁/노옵션 (특급호텔)',
    duration: 5, nights: 3,
    blocks: ['DAD-ARR', 'DAD-OPT-MASSAGE', 'DAD-MARBLE', 'DAD-OPT-BASKET', 'DAD-HOIAN', 'DAD-OPT-CYCLO', 'DAD-HOIAN-NIGHT', 'DAD-BANA', 'DAD-MYKHE', 'DAD-OPT-MASSAGE', 'DAD-SHOP', 'DAD-LINHUNG', 'DAD-APEC', 'DAD-CATHEDRAL', 'DAD-CRUISE', 'DAD-DEP'],
    day_split: [1, 7, 4, 3, 1], // Day별 블록 개수
    hotel_grade_min: '5성',
  },
  '실속': {
    label: '실속 (4성호텔)',
    duration: 5, nights: 3,
    blocks: ['DAD-ARR', 'DAD-MARBLE', 'DAD-HOIAN', 'DAD-HOIAN-NIGHT', 'DAD-BANA', 'DAD-MYKHE', 'DAD-SHOP', 'DAD-LINHUNG', 'DAD-CATHEDRAL', 'DAD-DEP'],
    day_split: [1, 3, 2, 3, 1],
    hotel_grade_min: '4성',
  },
  '품격': {
    label: '품격 (5성+호이안+바나)',
    duration: 5, nights: 3,
    blocks: ['DAD-ARR', 'DAD-OPT-MASSAGE', 'DAD-MARBLE', 'DAD-HOIAN', 'DAD-OPT-CYCLO', 'DAD-HOIAN-NIGHT', 'DAD-BANA', 'DAD-MYKHE', 'DAD-LINHUNG', 'DAD-APEC', 'DAD-CATHEDRAL', 'DAD-CRUISE', 'DAD-DEP'],
    day_split: [1, 5, 2, 4, 1],
    hotel_grade_min: '5성',
  },
};

// ══════════════════════════════════════════════════════════════
// 5. 원문 파서
// ══════════════════════════════════════════════════════════════

const DOW_KO = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };

function parseExcludedDates(rawText, year = 2026) {
  const result = new Set();
  const m = rawText.match(/항공\s*제외(?:일)?\s*[–\-:]\s*(.+?)(?:\n|●|$)/);
  if (!m) return [];
  const segment = m[1];
  const tokens = segment.split(/[,，]/).map(t => t.trim()).filter(Boolean);
  let lastMonth = null;
  for (const tok of tokens) {
    const range = tok.match(/^(\d+)\/(\d+)\s*~\s*(\d+)(?:\/(\d+))?$/);
    if (range) {
      const sm = +range[1], sd = +range[2];
      const em = range[4] ? +range[3] : sm;
      const ed = range[4] ? +range[4] : +range[3];
      lastMonth = em;
      const start = new Date(year, sm - 1, sd);
      const end = new Date(year, em - 1, ed);
      const c = new Date(start);
      while (c <= end) {
        result.add(`${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`);
        c.setDate(c.getDate() + 1);
      }
      continue;
    }
    const single = tok.match(/^(\d+)\/(\d+)$/);
    if (single) { const sm = +single[1], sd = +single[2]; lastMonth = sm; result.add(`${year}-${String(sm).padStart(2,'0')}-${String(sd).padStart(2,'0')}`); continue; }
    const dayOnly = tok.match(/^(\d+)$/);
    if (dayOnly && lastMonth) {
      const d = +dayOnly[1];
      result.add(`${year}-${String(lastMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
    }
  }
  return Array.from(result).sort();
}

function parsePriceTable(rawText, year = 2026) {
  // 패턴: "M/D~M/D" 한 줄 → 다음 줄 "수,목,금" → 다음 줄 "1,099,-" or "1,099,000원"
  // 단일 날짜 (스팟특가): "증편) M/D,M/D" 또는 "증편) M/D" 다음 줄 가격
  const tiers = [];
  const lines = rawText.split('\n').map(l => l.trim());

  let pendingPeriods = [];      // [{start, end, label}]
  let pendingSingleDates = [];  // [YYYY-MM-DD]
  let pendingNote = null;

  const flush = (dows, price) => {
    const isSurge = pendingNote && pendingNote.includes('증편');
    const isConfirmed = pendingNote && /출확|출발확정/.test(pendingNote);
    for (const period of pendingPeriods) {
      for (const dow of dows) {
        tiers.push({
          period_label: `${period.label} ${dow}요일${isSurge ? ' (증편)' : ''}`,
          date_range: { start: period.start, end: period.end },
          departure_day_of_week: dow,
          adult_price: price,
          child_price: null,
          status: 'available',
          note: isSurge ? '증편' : null,
        });
      }
    }
    if (pendingSingleDates.length > 0) {
      tiers.push({
        period_label: pendingNote || `${pendingSingleDates.join(', ')}`,
        departure_dates: [...pendingSingleDates],
        adult_price: price,
        child_price: null,
        status: isConfirmed ? 'confirmed' : 'available',
        note: pendingNote || null,
      });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // 단일 날짜 (스팟특가/출확) 패턴: "증편) 7/6,13" 또는 "선발특가 4/28"
    const singleM = line.match(/(?:증편\)?|선발특가|스팟특가|특가)\s*([\d\/,~ ]+)$/);
    if (singleM) {
      const datesStr = singleM[1];
      const dates = [];
      let lastMonth = null;
      for (const tok of datesStr.split(/[,，]/).map(t => t.trim()).filter(Boolean)) {
        const md = tok.match(/^(\d+)\/(\d+)$/);
        if (md) { lastMonth = +md[1]; dates.push(`${year}-${String(+md[1]).padStart(2,'0')}-${String(+md[2]).padStart(2,'0')}`); continue; }
        const dOnly = tok.match(/^(\d+)$/);
        if (dOnly && lastMonth) { dates.push(`${year}-${String(lastMonth).padStart(2,'0')}-${String(+dOnly[1]).padStart(2,'0')}`); }
      }
      if (dates.length > 0) {
        pendingSingleDates.push(...dates);
        pendingNote = (pendingNote ? pendingNote + ' / ' : '') + line;
      }
      continue;
    }

    // 기간 패턴: "4/1~4/30"
    const periodM = line.match(/^(\d+)\/(\d+)\s*~\s*(\d+)\/(\d+)$/);
    if (periodM) {
      const sm = +periodM[1], sd = +periodM[2], em = +periodM[3], ed = +periodM[4];
      pendingPeriods.push({
        start: `${year}-${String(sm).padStart(2,'0')}-${String(sd).padStart(2,'0')}`,
        end: `${year}-${String(em).padStart(2,'0')}-${String(ed).padStart(2,'0')}`,
        label: `${sm}/${sd}~${em}/${ed}`,
      });
      continue;
    }

    // 요일 그룹 패턴: "수,목,금" / "토,일,월,화"
    const dowM = line.match(/^([일월화수목금토](?:[,，][일월화수목금토])+)$/);
    if (dowM && (pendingPeriods.length > 0 || pendingSingleDates.length > 0)) {
      const dows = dowM[1].split(/[,，]/).map(s => s.trim()).filter(s => DOW_KO[s] != null);
      // 다음 줄에서 가격 찾기
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const next = lines[j];
        const priceM = next.match(/^([\d,]+)\s*[,-]?$/) || next.match(/^([\d,]+)\s*원/);
        if (priceM) {
          const num = parseInt(priceM[1].replace(/,/g, ''), 10);
          const price = num < 10000 ? num * 1000 : num; // "1,099" → 1,099,000
          flush(dows, price);
          i = j;
          break;
        }
      }
      continue;
    }

    // 단일 날짜 가격만 (요일 없이): "1,099,-" 직후 readout
    const onlyPrice = line.match(/^([\d,]+)\s*[,-]?$/);
    if (onlyPrice && pendingSingleDates.length > 0 && pendingPeriods.length === 0) {
      const num = parseInt(onlyPrice[1].replace(/,/g, ''), 10);
      const price = num < 10000 ? num * 1000 : num;
      flush([], price);
      pendingSingleDates = [];
      pendingNote = null;
      continue;
    }

    // 새 기간 그룹 시작 시 pending 초기화
    if (line.includes('~') && line.match(/\d+\/\d+/)) {
      pendingPeriods = [];
      pendingNote = null;
    }
  }

  return tiers;
}

function tiersToPriceDates(tiers, excludedDates, confirmedDates = new Set()) {
  const excluded = new Set(excludedDates || []);
  const seen = new Set();
  const result = [];
  for (const tier of tiers) {
    const dates = [];
    if (tier.date_range && tier.departure_day_of_week) {
      const dow = DOW_KO[tier.departure_day_of_week];
      const [sy, sm, sd] = tier.date_range.start.split('-').map(Number);
      const [ey, em, ed] = tier.date_range.end.split('-').map(Number);
      const c = new Date(sy, sm - 1, sd);
      const end = new Date(ey, em - 1, ed);
      while (c <= end) {
        if (c.getDay() === dow) {
          const iso = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`;
          if (!excluded.has(iso)) dates.push(iso);
        }
        c.setDate(c.getDate() + 1);
      }
    }
    if (tier.departure_dates?.length) {
      for (const d of tier.departure_dates) {
        if (!excluded.has(d)) dates.push(d);
      }
    }
    const isConfirmedTier = tier.status === 'confirmed' || /출확|출발확정/.test(tier.note || '');
    for (const d of dates) {
      if (!d || seen.has(d)) continue;
      seen.add(d);
      result.push({ date: d, price: tier.adult_price, confirmed: isConfirmedTier || confirmedDates.has(d) });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

// ── 호텔 매칭 ────────────────────────────────────────────────────
function detectHotel(rawText) {
  for (const h of DESTINATION.hotel_pool) {
    for (const name of h.names) {
      if (rawText.includes(name)) return { name: h.names[0], grade: h.grade, score: h.score };
    }
  }
  return null;
}

// ── 상품 타입 감지 ──────────────────────────────────────────────
function detectProductType(rawText) {
  const hasNoTip = /노팁/.test(rawText);
  const hasNoOpt = /노옵션/.test(rawText);
  const hasNoShop = /노쇼핑/.test(rawText);
  const hasShopShop = /쇼핑샵.*패널티|쇼핑.*불참/.test(rawText);
  if (hasNoTip && hasNoOpt && hasNoShop && !hasShopShop) return '노팁노옵션노쇼핑';
  if (hasNoTip && hasNoOpt) return '노팁노옵션';
  if (/품격/.test(rawText)) return '품격';
  if (/실속/.test(rawText)) return '실속';
  return '실속';
}

// ── 포함/불포함 ─────────────────────────────────────────────────
function parseInclusionsExcludes(rawText) {
  const result = { inclusions: [], excludes: [] };
  const incM = rawText.match(/포함(?:사항)?\s*[:\n]([\s\S]+?)(?=\n\s*(?:불포함|제외|추천옵션|비\s*고|주의|일\s*자|$))/);
  const excM = rawText.match(/불포함(?:사항)?\s*[:\n]([\s\S]+?)(?=\n\s*(?:포함|추천옵션|비\s*고|주의|일\s*자|$))/);
  if (incM) result.inclusions = incM[1].split(/[,，]/).map(s => s.trim().replace(/^[\-•·]\s*/, '')).filter(s => s && s.length < 80);
  if (excM) result.excludes = excM[1].split(/[,，]/).map(s => s.trim().replace(/^[\-•·]\s*/, '')).filter(s => s && s.length < 80);
  return result;
}

// ══════════════════════════════════════════════════════════════
// 6. 메인 어셈블 함수
// ══════════════════════════════════════════════════════════════

function assemble(rawText, opts = {}) {
  const operator = opts.operator || '랜드부산';
  const commission = opts.commission != null ? opts.commission : 10;
  const deadline = opts.deadline || null;
  const year = opts.year || 2026;

  const excludedDates = parseExcludedDates(rawText, year);
  const tiers = parsePriceTable(rawText, year);

  // 출발확정 날짜 (스팟특가/출확 표기)
  const confirmedDates = new Set();
  for (const tier of tiers) {
    if (tier.status === 'confirmed' || /출확|출발확정/.test(tier.note || '')) {
      (tier.departure_dates || []).forEach(d => confirmedDates.add(d));
    }
  }

  const priceDates = tiersToPriceDates(tiers, excludedDates, confirmedDates);
  const hotel = detectHotel(rawText) || { name: '미확인', grade: '5성', score: 1 };
  const productType = detectProductType(rawText);
  const { inclusions, excludes } = parseInclusionsExcludes(rawText);

  // 블록 매칭 (rawText에 키워드가 있는 블록만 채택)
  const matchedBlocks = BLOCKS.filter(b => {
    if (b.day_position === 'day1' || b.day_position === 'last') return true; // 항공편은 항상 포함
    return b.keywords.some(kw => new RegExp(kw, 'i').test(rawText));
  });

  // 일정 분배 (간단 버전: Day1=ARR, Day5=DEP, Day2~4에 매칭된 블록 균등 분배)
  const tourBlocks = matchedBlocks.filter(b => !['day1', 'last'].includes(b.day_position));
  const days = [];
  // Day 1
  days.push({
    day: 1, regions: ['부산', '다낭'],
    meals: { breakfast: false, lunch: false, dinner: false, breakfast_note: null, lunch_note: null, dinner_note: null },
    schedule: matchedBlocks.find(b => b.code === 'DAD-ARR')?.schedule || [],
    hotel: { name: hotel.name, grade: hotel.grade, note: '또는 동급' },
  });
  // Day 2~4 (3일에 균등 분배)
  const tourPerDay = Math.ceil(tourBlocks.length / 3);
  for (let d = 2; d <= 4; d++) {
    const slice = tourBlocks.slice((d - 2) * tourPerDay, (d - 1) * tourPerDay);
    const schedule = slice.flatMap(b => b.schedule);
    const regions = d === 2 && tourBlocks.find(b => b.code === 'DAD-HOIAN') ? ['다낭', '호이안', '다낭'] : ['다낭'];
    days.push({
      day: d, regions,
      meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '호텔식', lunch_note: null, dinner_note: null },
      schedule,
      hotel: d === 4 ? { name: null, grade: null, note: '기내숙박' } : { name: hotel.name, grade: hotel.grade, note: '또는 동급' },
    });
  }
  // Day 5
  days.push({
    day: 5, regions: ['다낭', '부산'],
    meals: { breakfast: false, lunch: false, dinner: false, breakfast_note: null, lunch_note: null, dinner_note: null },
    schedule: matchedBlocks.find(b => b.code === 'DAD-DEP')?.schedule || [],
    hotel: { name: null, grade: null, note: null },
  });

  // 가격
  const minPrice = priceDates.length > 0 ? Math.min(...priceDates.map(p => p.price)) : 0;

  const titlePrefix = productType === '노팁노옵션' ? '노팁/노옵션' : (productType === '품격' ? '품격' : '실속');
  const title = `[BX] 다낭/호이안 ${titlePrefix} 3박5일 (${hotel.name})`;

  const RAW_TEXT_HASH = crypto.createHash('sha256').update(rawText).digest('hex');

  return {
    pkg: {
      title,
      destination: '다낭/호이안',
      country: 'Vietnam',
      category: 'package',
      product_type: productType,
      trip_style: '3박5일',
      duration: 5, nights: 3,
      departure_airport: DESTINATION.departure_airport,
      departure_days: '매일',
      airline: DESTINATION.airline_default,
      min_participants: /6명/.test(rawText) ? 6 : (/4명/.test(rawText) ? 4 : 6),
      status: 'pending',
      price: minPrice,
      guide_tip: null,
      single_supplement: /\$150/.test(rawText) ? '$150/인' : null,
      small_group_surcharge: null,
      surcharges: [],
      excluded_dates: excludedDates,
      optional_tours: [],
      price_tiers: tiers,
      price_dates: priceDates,
      inclusions, excludes,
      notices_parsed: DESTINATION.notices,
      special_notes: null,
      product_highlights: [
        `${hotel.name} ${hotel.grade} ${3}박`,
        '호이안 + 바나산 + 다낭 시티 풀코스',
        '특식 6회 (현지 대표 메뉴)',
      ],
      product_summary: `BX 김해 직항 / ${hotel.name} ${hotel.grade} 3박 / 호이안+바나산+다낭 시티 / 노팁·노옵션`,
      product_tags: ['다낭', '호이안', '바나산', hotel.grade + '호텔', productType, 'BX직항'],
      accommodations: [`${hotel.name} ${hotel.grade} 또는 동급 (3박)`],
      itinerary_data: {
        meta: {
          title,
          product_type: productType,
          destination: '다낭/호이안',
          nights: 3, days: 5,
          departure_airport: DESTINATION.departure_airport,
          airline: DESTINATION.airline_default,
          flight_out: 'BX773 김해 20:50 → 다낭 23:50',
          flight_in: 'BX774 다낭 00:45 → 김해 07:20',
          departure_days: '매일',
          min_participants: 6,
          room_type: '2인1실',
          ticketing_deadline: deadline,
          hashtags: ['#다낭', '#호이안', '#바나산', '#BX직항'],
          brand: '여소남',
        },
        highlights: {
          inclusions, excludes,
          shopping: matchedBlocks.find(b => b.code === 'DAD-SHOP') ? '쇼핑센터 1회 (불참 시 패널티 $150/인)' : '노쇼핑',
          remarks: [
            '항공제외일 출발 불가 (excluded_dates 참조)',
            '호텔/리조트 예약 시 날짜별 써차지(추가요금) 체크 필요',
            '항공 GV2 그룹요금 — 예약 시 출발일별 인상 가능',
            '여권 만료일 출발일 기준 6개월 이상 필수',
            '베트남 한국인 가이드 단속 강화 — 현지인 가이드 미팅·샌딩',
          ],
        },
        days,
        optional_tours: [],
      },
      itinerary: days.map(d => `제${d.day}일: ${d.regions.join(' → ')}`),
      raw_text: rawText,
      raw_text_hash: RAW_TEXT_HASH,
      filename: opts.filename || 'manual',
      file_type: 'manual',
      confidence: 0.85,
    },
    meta: {
      operator, commission, deadline,
      matchedBlocks: matchedBlocks.length,
      hotel: hotel.name, hotelGrade: hotel.grade, hotelScore: hotel.score,
      productType,
      priceCount: priceDates.length,
      excludedCount: excludedDates.length,
    },
  };
}

// ══════════════════════════════════════════════════════════════
// 7. INSERT (--insert 모드)
// ══════════════════════════════════════════════════════════════

async function insertToDB({ pkg, meta }) {
  const sb = initSupabase();
  const operators = require('./land-operators.json');
  const op = operators[meta.operator];
  if (!op) throw new Error(`알 수 없는 랜드사: ${meta.operator}`);

  const { data: existingPkgs } = await sb
    .from('travel_packages')
    .select('id, title, destination, product_type, duration, price, price_tiers, price_dates, ticketing_deadline, short_code, status')
    .eq('land_operator_id', op.uuid)
    .in('status', ['approved', 'active', 'pending']);

  const dup = findDuplicate(pkg, existingPkgs || []);
  const toArchive = [];
  if (dup) {
    const samePrices = isSamePriceDates(dup, pkg);
    const sameDeadline = isSameDeadline(dup.ticketing_deadline, meta.deadline);
    if (samePrices && sameDeadline) {
      console.log(`⏭️  SKIP: ${pkg.title} (${dup.short_code}) — 완전 동일`);
      return { skipped: true };
    }
    toArchive.push(dup);
  }

  const { errors, warnings } = validatePackage(pkg);
  if (warnings.length > 0) warnings.forEach(w => console.log(`   ⚠️  ${w}`));
  if (errors.length > 0) {
    errors.forEach(e => console.error(`   ❌ ${e}`));
    throw new Error(`검증 실패 (${errors.length}건)`);
  }

  // short_code
  const { data: codes } = await sb
    .from('travel_packages').select('short_code')
    .ilike('short_code', `${op.code}-${DESTINATION.region_code}-%`);
  const maxSeq = (codes || []).reduce((m, r) => {
    const n = parseInt((r.short_code || '').split('-').pop() || '0', 10);
    return n > m ? n : m;
  }, 0);
  const dur = String(pkg.duration).padStart(2, '0');
  const short_code = `${op.code}-${DESTINATION.region_code}-${dur}-${String(maxSeq + 1).padStart(2, '0')}`;

  if (toArchive.length > 0) {
    await sb.from('travel_packages').update({ status: 'archived' }).in('id', toArchive.map(a => a.id));
    console.log(`📦 아카이브: ${toArchive.map(a => a.short_code).join(', ')}`);
  }

  const { data, error } = await sb
    .from('travel_packages')
    .insert([{
      ...pkg,
      land_operator_id: op.uuid,
      short_code,
      commission_rate: meta.commission,
      ticketing_deadline: meta.deadline,
      baseline_requested_at: new Date().toISOString(),
    }])
    .select('id, title, short_code');

  if (error) throw error;
  console.log(`✅ ${data[0].short_code} | ${data[0].title}`);
  return { inserted: data[0] };
}

// ══════════════════════════════════════════════════════════════
// 8. CLI
// ══════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const args = { _: [], dryRun: false, insert: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--insert') args.insert = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--operator') args.operator = argv[++i];
    else if (a === '--commission') args.commission = parseFloat(argv[++i]);
    else if (a === '--deadline') args.deadline = argv[++i];
    else args._.push(a);
  }
  if (!args.insert) args.dryRun = true;
  return args;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('사용법: node db/assembler_danang.js <raw_text_file> [--operator <name>] [--commission <%>] [--deadline <YYYY-MM-DD>] [--insert]');
    process.exit(1);
  }
  const args = parseArgs(argv);
  const inputFile = args._[0];
  if (!fs.existsSync(inputFile)) {
    console.error(`파일 없음: ${inputFile}`);
    process.exit(1);
  }

  const rawText = fs.readFileSync(inputFile, 'utf-8');
  const result = assemble(rawText, {
    operator: args.operator,
    commission: args.commission,
    deadline: args.deadline,
    filename: path.basename(inputFile),
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  📦 다낭 어셈블러 결과');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  랜드사: ${result.meta.operator} (${result.meta.commission}%)`);
  console.log(`  타입:   ${result.meta.productType}`);
  console.log(`  호텔:   ${result.meta.hotel} (${result.meta.hotelGrade}, score ${result.meta.hotelScore})`);
  console.log(`  블록:   ${result.meta.matchedBlocks}개 매칭`);
  console.log(`  출발일: ${result.meta.priceCount}건 / 항공제외일 ${result.meta.excludedCount}건`);
  console.log(`  최저가: ${result.pkg.price.toLocaleString()}원`);

  if (args.insert) {
    console.log('\n💾 INSERT 모드 — DB에 등록합니다...\n');
    insertToDB(result).then(r => {
      console.log('\n📊 결과:', r);
    }).catch(e => { console.error('❌ INSERT 실패:', e.message); process.exit(1); });
  } else {
    console.log('\n🔍 dry-run 모드 — JSON 미리보기\n');
    console.log(JSON.stringify({ pkg: { title: result.pkg.title, price: result.pkg.price, price_dates_count: result.pkg.price_dates.length, days_count: result.pkg.itinerary_data.days.length }, meta: result.meta }, null, 2));
  }
}

module.exports = { assemble, BLOCKS, DESTINATION, TEMPLATES, parsePriceTable, parseExcludedDates };
