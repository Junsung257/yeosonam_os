/**
 * 여소남OS 상품등록 공용 템플릿
 *
 * 사용법:
 *   const { createInserter } = require('./templates/insert-template');
 *   const inserter = createInserter({
 *     landOperator: '투어폰',     // land-operators.json 키
 *     commissionRate: 9,
 *     ticketingDeadline: '2026-04-27',
 *     destCode: 'XIY',           // short_code용 목적지 코드
 *   });
 *   await inserter.run(ALL_PACKAGES);
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ─── W-final F3: Rule Zero 강제 ──────────────────────────────────────────────
// 파서/프롬프트 버전 — 변경할 때마다 이 상수 bump (예: sonnet 교체, prompt 개정)
const PARSER_VERSION = 'register-v2026.04.21-sonnet-4.6';

function computeRawHash(text) {
  if (!text || typeof text !== 'string') return null;
  return crypto.createHash('sha256').update(text).digest('hex');
}

// ─── Supabase 초기화 ─────────────────────────────────────────
function initSupabase() {
  const envPath = path.resolve(__dirname, '..', '..', '.env.local');
  const envFile = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  envFile.split('\n').forEach(l => {
    const [k, ...v] = l.split('=');
    if (k) env[k.trim()] = v.join('=').trim();
  });
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

// ─── 랜드사 매핑 로드 ────────────────────────────────────────
function loadOperators() {
  const jsonPath = path.resolve(__dirname, '..', 'land-operators.json');
  return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
}

// ─── 스케줄 헬퍼 ─────────────────────────────────────────────
function flight(time, activity, transport) {
  return { time, activity, type: 'flight', transport, note: null };
}
function normal(time, activity, note) {
  return { time: time || null, activity, type: 'normal', transport: null, note: note || null };
}
function optional(time, activity, note) {
  return { time: time || null, activity, type: 'optional', transport: null, note: note || null };
}
function shopping(time, activity, note) {
  return { time: time || null, activity, type: 'shopping', transport: null, note: note || null };
}
function train(time, activity, transport, note) {
  return { time: time || null, activity, type: 'train', transport: transport || null, note: note || null };
}
function meal(b, l, d, bn, ln, dn) {
  return {
    breakfast: b, lunch: l, dinner: d,
    breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null,
  };
}

// ─── 콤마 구분 관광지 분리 (관광지 매칭 최적화) ─────────────
// ERR-LB-DAD-paren-split@2026-04-20: "▶호이안 구시가지 (풍흥의 집, 일본내원교, 떤키의 집, 관운장사당 등) 유네스코 지정 전통거리 관광"
//   처럼 **중간에** 괄호로 묶인 콤마 항목 + 괄호 뒤 추가 텍스트가 있으면, 단순 콤마 split이 괄호를 깨뜨려
//   "▶호이안 구시가지 (풍흥의 집" / "▶관운장사당 등) 유네스코 지정 전통거리 관광" 같은 손상된 항목을 만든다.
//   해결: 괄호 위치에 관계없이 (...) 내부의 콤마와 외부 콤마를 분리해서 처리.
// W30 (확장 — 2026-04-28): 서술/체험/연혁 키워드. 괄호 안/밖 동일 적용.
//   - 단위·연도: "234M", "2000년"
//   - 명소 수식: "A급", "최고", "유명한", "신을 모신", "단장한", "자리잡은", "꽃놀이 명소"
//   - 체험·감상 동사: "체험", "관람", "포함", "맛보기", "감상"
//   - 관계절/서술 어미: "~한 ", "~된 ", "~는 ", "~의 " 가 콤마 직전에 오면 서술문 가능성 高
const DESCRIPTIVE_KW = /(\d+\s*년|\d+\s*[Mm](?![a-zA-Z])|A급|최고|불리는|상징|역사|시대|높이|체험|관람|포함|맛보기|감상|중\s*한\s*명|단장한|단장된|모신|자리잡은|위치한|유명한|이루어진|꾸며진|꽃놀이|명소|풍경|배경)/;

// 콤마 직전이 서술 어미 (한/된/는/의 등) 인지 — 명사 종결이면 OK 분리
const HAS_VERB_ENDING_BEFORE_COMMA = /(?:[한된는의이가을를에로]|단장한|단장된|모신|이루어진|꾸며진|위치한)\s*[,，]/;

function splitScheduleItems(scheduleItems) {
  const result = [];
  for (const item of scheduleItems) {
    // normal 타입 + ▶ 접두사 + 콤마 포함인 경우만 분리
    if (item.type !== 'normal' || !item.activity || !item.activity.startsWith('▶')) {
      result.push(item);
      continue;
    }
    const act = item.activity;
    if (!act.includes(',') && !act.includes('，')) {
      result.push(item);
      continue;
    }

    const body = act.slice(1).trim(); // ▶ 제거

    // 1) 중간/말미 괄호 ( ... ) 추출 (가장 마지막 매칭 — non-greedy로 가장 작은 단위)
    const parenMatch = body.match(/\(([^)]*)\)/);
    if (parenMatch) {
      // body를 [prefix] (paren 내용) [suffix] 로 분해
      const parenStart = parenMatch.index;
      const parenEnd = parenStart + parenMatch[0].length;
      const prefix = body.slice(0, parenStart).trim().replace(/[,，]\s*$/, '');
      const innerCSV = parenMatch[1];
      const suffix = body.slice(parenEnd).trim().replace(/^[,，]\s*/, '');

      // ─── W30 ERR-HET-render-over-split@2026-04-21: 과다 분리 방어 ───
      // 괄호 안이 "서브 관광지 리스트" 가 아니라 "체험 리스트 / 부연 설명 / 연혁" 이면 분리 skip.
      const hasDescriptive = DESCRIPTIVE_KW.test(innerCSV);
      if (!suffix || hasDescriptive) {
        result.push(item);
        continue;
      }

      // prefix는 메인 항목 (suffix가 있으면 합침: "호이안 구시가지" + " 유네스코 지정 전통거리 관광")
      const mainTitle = [prefix, suffix].filter(Boolean).join(' ').trim();
      const innerParts = innerCSV.split(/[,，]\s*/).map(s => s.trim()).filter(Boolean);

      // 메인 항목 push
      if (mainTitle) result.push({ ...item, activity: `▶${mainTitle}` });
      // 괄호 안 항목들 각각 push
      for (const p of innerParts) result.push({ ...item, activity: `▶${p}` });
      continue;
    }

    // 2) 괄호 없는 일반 콤마 분리
    // ─── W31 (ERR-FUK-camellia-overcorrect@2026-04-28): 괄호 없는 서술 콤마 보호 ───
    //   원문 "▶높이 234M, 8000장의 유리로 단장한 후쿠오카 타워 관광" 같은 단일 명소 서술문이
    //   "▶높이 234M" / "▶8000장의 유리로 단장한 후쿠오카 타워 관광" 으로 잘못 분리되던 사고 방지.
    //   휴리스틱:
    //     (a) DESCRIPTIVE_KW 가 activity 전체에 매칭 → 단일 명소 서술 가능성 高 → 분리 skip
    //     (b) 콤마 직전이 서술 어미 (~한,/~된,/~의, 등) → 분리 skip
    if (DESCRIPTIVE_KW.test(body) || HAS_VERB_ENDING_BEFORE_COMMA.test(body)) {
      result.push(item);
      continue;
    }

    const parts = body.split(/[,，]\s*/);
    if (parts.length <= 1) { result.push(item); continue; }
    for (const partText of parts) {
      const t = partText.trim();
      if (t) result.push({ ...item, activity: `▶${t}` });
    }
  }
  return result;
}

// ─── display_title / hero_tagline 자동 생성 ─────────────────────────────────
//
// 디자인 결정 (2026-04-29): 모바일 hero 영역의 클릭률·스캔성을 위해
// 단일 `display_title`(+로 잇는 monolith)을 두 필드로 분리.
//
//   ① display_title  → 짧은 헤드라인 (8~14자, h1 큰 글씨)
//                      예: "프리미엄 호화호특 4박5일"
//   ② hero_tagline   → 한 줄 후킹 (≤40자, h1 아래 sub)
//                      예: "부산 직항 전세기 · 기사·가이드팁 전부 포함"
//
// 셀링포인트 칩은 product_highlights 그대로 재활용 → 중복 노출 제거.
// 레퍼런스: Klook / GetYourGuide / Airbnb / Schema.org TouristTrip(name vs description)
//
function generateDisplayTitle(pkg) {
  const type = (pkg.product_type || '').toLowerCase();
  let prefix = '';
  if (type.includes('노쇼핑') && type.includes('노팁') && type.includes('노옵션')) prefix = '추가비용 ZERO';
  else if (type.includes('노팁') && type.includes('노옵션')) prefix = '팁·옵션 걱정없는';
  else if (type.includes('노쇼핑')) prefix = '쇼핑 걱정없는';
  else if (type.includes('고품격')) prefix = '프리미엄';
  else if (type.includes('품격')) prefix = '5성급 검증';
  else if (type.includes('실속')) prefix = '핵심만 담은';

  const dur = (pkg.nights && pkg.duration) ? `${pkg.nights}박${pkg.duration}일`
            : pkg.duration ? `${Math.max(0, pkg.duration - 1)}박${pkg.duration}일`
            : '';
  return [prefix, pkg.destination, dur].filter(Boolean).join(' ');
}

// 셀링포인트 칩에서 가장 강한 1~2개를 골라 한 줄 후킹으로 합성.
// 규칙:
//  - 노쇼핑/노팁/노옵션 등 product_type 중복 노이즈 스킵
//  - 한 칩이 길면 (a) 끝의 괄호 부속절 제거 → (b) ' + '의 첫 절만 → (c) ' — '·'/' 다음 절만
//    (괄호 안쪽 가운뎃점 "·"은 보존)
//  - 두 개를 ' · '로 잇되, 합쳐서 50자 넘으면 첫 칩만 사용
//  - 최종 길이 60자 초과 시 50자 + '…' 절단
function generateHeroTagline(pkg) {
  const skipWords = ['노쇼핑', '노팁', '노옵션', '노팁노옵션'];
  const raw = (pkg.product_highlights || [])
    .filter(h => h && typeof h === 'string')
    .filter(h => !skipWords.some(w => h.includes(w)));

  const TARGET = 30; // 한 칩 목표 길이 (모바일 1줄 ≈ 한국어 16~20자라서 보수적)
  const trim = (s) => {
    let t = s.trim();
    // (a) 끝의 괄호 부속절 제거 ("… (품격 대비 업그레이드)" → "…")
    if (t.length > TARGET) {
      t = t.replace(/\s*[\(（][^\)）]*[\)）]\s*$/, '').trim();
    }
    // (b) " + " 로 나뉜 첫 절만 (highlights에서 자주 쓰는 concatenator)
    if (t.length > TARGET && / \+ /.test(t)) {
      t = t.split(' + ')[0].trim();
    }
    // (c) 대시(— – 「  ─) 또는 어퍼-스페이스 dot(' · ') 이후 절단 — 괄호 안 "·"는 영향 없음
    if (t.length > TARGET) {
      const m = t.match(/^(.{8,}?)\s*[—–─·]\s+/);
      if (m) t = m[1].trim();
    }
    return t;
  };

  const parts = raw.slice(0, 2).map(trim).filter(Boolean);
  if (parts.length === 0) return null;

  let line = parts.join(' · ');
  if (line.length > 50 && parts.length > 1) line = parts[0];
  if (line.length > 60) line = line.slice(0, 50).trim() + '…';
  return line || null;
}

// ─── price_tiers → price_dates 변환 ─────────────────────────
const DOW_MAP = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };

function tiersToDatePrices(tiers) {
  const seen = new Set();
  const result = [];
  for (const tier of (tiers || [])) {
    if (tier.status === 'soldout') continue;
    const dates = [];
    if (tier.date_range?.start && tier.date_range?.end && tier.departure_day_of_week != null && DOW_MAP[tier.departure_day_of_week] != null) {
      const dow = DOW_MAP[tier.departure_day_of_week];
      const [sy, sm, sd] = tier.date_range.start.split('-').map(Number);
      const [ey, em, ed] = tier.date_range.end.split('-').map(Number);
      const c = new Date(sy, sm - 1, sd);
      const end = new Date(ey, em - 1, ed);
      while (c <= end) {
        if (c.getDay() === dow) {
          dates.push(`${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`);
        }
        c.setDate(c.getDate() + 1);
      }
    }
    if (tier.departure_dates?.length) dates.push(...tier.departure_dates);
    const isConfirmed = tier.status === 'confirmed'
      || !!(tier.note && /출확|출발확정/.test(tier.note));

    for (const date of dates) {
      if (!date || seen.has(date)) continue;
      seen.add(date);
      result.push({ date, price: tier.adult_price || 0, confirmed: !!isConfirmed });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

// ─── INSERT 전 검증 (A4포스터/모바일랜딩 렌더링 필수 필드) ──

/**
 * 렌더링 계약 검증기 (A4 포스터 + 모바일 랜딩 공통)
 *
 * errors: INSERT 차단 — 이 상태로 DB에 넣으면 렌더링 크래시
 * warnings: INSERT 진행 — 데이터 품질 이슈 (수동 확인 권장)
 *
 * 규칙 추가 가이드:
 *   렌더링 크래시 유발 → errors에 추가
 *   고객 혼선/데이터 누락 → warnings에 추가
 */
function validatePackage(pkg) {
  const errors = [];
  const warnings = [];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const VALID_SCHEDULE_TYPES = new Set(['normal', 'flight', 'optional', 'shopping', 'meal', 'hotel', 'train']);
  const today = new Date().toISOString().slice(0, 10);

  // ══════════════════════════════════════════════════════════════
  // ERRORS — INSERT 차단 (렌더링 크래시 방지)
  // ══════════════════════════════════════════════════════════════

  // E1. 기본 필드
  if (!pkg.title || pkg.title.length < 3) errors.push('title 3자 이상 필요');
  if (!pkg.destination) errors.push('destination 필수');
  if (!pkg.duration || pkg.duration < 1) errors.push('duration 1 이상 필수');
  if (pkg.nights == null || pkg.nights < 0) errors.push('nights 0 이상 필수');
  if (pkg.nights >= pkg.duration) errors.push(`nights(${pkg.nights}) >= duration(${pkg.duration}) — 박수가 일수 이상은 불가능`);

  // E1-Z. Rule Zero 강제 (W-final F3) — raw_text 필수 + hash 일치 검증.
  //        이전: warning. 이제: ERROR (INSERT 차단).
  //        raw_text 원본이 감사의 기준점이므로 오염/부재 시 INSERT 불가.
  if (!pkg.raw_text || typeof pkg.raw_text !== 'string' || pkg.raw_text.length < 50) {
    errors.push(`[RuleZero] raw_text 누락 또는 의심스럽게 짧음 (${pkg.raw_text?.length || 0}자). 원문 원본을 저장해야 감사가 가능합니다 (ERR-FUK-rawtext-pollution).`);
  } else if (pkg.raw_text_hash) {
    // 해시가 명시되어 있으면 반드시 일치해야 함
    const actual = computeRawHash(pkg.raw_text);
    if (actual !== pkg.raw_text_hash) {
      errors.push(`[RuleZero] raw_text_hash 불일치: 저장된 해시=${pkg.raw_text_hash.slice(0, 16)}... vs 실제=${actual.slice(0, 16)}... — 사후 변조 또는 해시 계산 오류`);
    }
  }

  // E2. price_dates 필수 (요금표 렌더링)
  const pd = pkg.price_dates || tiersToDatePrices(pkg.price_tiers || []);
  if (!Array.isArray(pd) || pd.length === 0) {
    errors.push('price_dates가 비어있음 — 요금표가 렌더링되지 않습니다');
  } else {
    pd.forEach((p, i) => {
      if (!p.date || !DATE_RE.test(p.date)) errors.push(`price_dates[${i}].date 형식 오류: "${p.date}" (YYYY-MM-DD 필요)`);
      if (typeof p.price !== 'number' || p.price <= 0) errors.push(`price_dates[${i}].price 양수 필요: ${p.price}`);
    });
  }

  // E3. itinerary_data.days 필수 (일정표 렌더링)
  const days = pkg.itinerary_data?.days;
  if (!Array.isArray(days) || days.length === 0) {
    errors.push('itinerary_data.days가 비어있음 — 일정표가 렌더링되지 않습니다');
  } else {
    days.forEach((d, i) => {
      if (typeof d.day !== 'number' || d.day < 1) errors.push(`days[${i}].day가 1 이상 정수여야 함: ${d.day}`);
      if (!d.schedule || d.schedule.length === 0) errors.push(`days[${i}].schedule 비어있음 — 일정 없는 날`);
      if (d.schedule) {
        d.schedule.forEach((s, j) => {
          if (!s.activity || s.activity.trim() === '') errors.push(`days[${i}].schedule[${j}].activity 빈 문자열`);
          if (s.type === 'transport') errors.push(`days[${i}].schedule[${j}].type='transport' 금지 — TransportBar 크래시`);
          if (s.type && !VALID_SCHEDULE_TYPES.has(s.type)) errors.push(`days[${i}].schedule[${j}].type='${s.type}' 허용 안 됨 (${[...VALID_SCHEDULE_TYPES].join('/')})`);
        });
      }
    });
  }

  // E4. highlights.remarks는 string[] 필수 (객체 배열 → 크래시)
  const remarks = pkg.itinerary_data?.highlights?.remarks;
  if (remarks && Array.isArray(remarks) && remarks.length > 0) {
    if (typeof remarks[0] !== 'string') errors.push('highlights.remarks는 string[] 필수 — 객체 배열 금지 (크래시)');
  }

  // E5. inclusions/excludes는 string[] 필수
  if (pkg.inclusions && Array.isArray(pkg.inclusions) && pkg.inclusions.length > 0) {
    if (typeof pkg.inclusions[0] !== 'string') errors.push('inclusions는 string[] 필수');
  }
  if (pkg.excludes && Array.isArray(pkg.excludes) && pkg.excludes.length > 0) {
    if (typeof pkg.excludes[0] !== 'string') errors.push('excludes는 string[] 필수');
  }

  // ══════════════════════════════════════════════════════════════
  // WARNINGS — 경고만 (INSERT 진행, 데이터 품질 이슈)
  // ══════════════════════════════════════════════════════════════

  // W1. 과거 출발일 포함
  if (Array.isArray(pd) && pd.length > 0) {
    const pastDates = pd.filter(p => p.date && p.date < today);
    if (pastDates.length > 0) {
      warnings.push(`과거 출발일 ${pastDates.length}건 포함 (${pastDates.slice(0, 3).map(p => p.date).join(', ')}${pastDates.length > 3 ? '...' : ''})`);
    }
  }

  // W2. 출확 note가 있는데 confirmed가 하나도 없음
  if (Array.isArray(pkg.price_tiers) && pkg.price_tiers.length > 0) {
    const hasConfirmNote = pkg.price_tiers.some(t => t.note && /출확|출발확정/.test(t.note));
    const hasConfirmStatus = pkg.price_tiers.some(t => t.status === 'confirmed');
    const pdConfirmed = Array.isArray(pd) && pd.some(p => p.confirmed);
    if ((hasConfirmNote || hasConfirmStatus) && !pdConfirmed) {
      warnings.push('출발확정 정보가 price_tiers에 있지만 price_dates.confirmed에 반영 안 됨 — 포스터 출확 배너 안 나옴');
    }
  }

  // W3. 비현실적 가격 범위
  if (Array.isArray(pd) && pd.length > 0) {
    const prices = pd.map(p => p.price).filter(p => typeof p === 'number');
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    if (minPrice < 100000) warnings.push(`최저가 ${minPrice.toLocaleString()}원 — 10만원 미만 (오타 가능성)`);
    if (maxPrice > 5000000) warnings.push(`최고가 ${maxPrice.toLocaleString()}원 — 500만원 초과 (오타 가능성)`);
    if (maxPrice > minPrice * 5) warnings.push(`가격 편차 ${(maxPrice / minPrice).toFixed(1)}배 — 최저 ${minPrice.toLocaleString()} / 최고 ${maxPrice.toLocaleString()} (확인 필요)`);
  }

  // W4. 호텔 정보 누락 (중간 일차)
  if (Array.isArray(days) && days.length > 0) {
    days.forEach((d, i) => {
      const isFirst = i === 0;
      const isLast = i === days.length - 1;
      if (!isFirst && !isLast && (!d.hotel || !d.hotel.name)) {
        warnings.push(`Day ${d.day} 호텔 정보 없음 (중간 일차는 호텔 필요)`);
      }
    });
  }

  // W5. meals 필드 누락
  if (Array.isArray(days) && days.length > 0) {
    days.forEach((d, i) => {
      if (!d.meals) warnings.push(`Day ${d.day} meals 필드 없음 — 식사 정보 안 나옴`);
    });
  }

  // W6. meta 정보 누락
  const meta = pkg.itinerary_data?.meta;
  if (!meta) {
    warnings.push('itinerary_data.meta 없음 — 포스터 헤더 정보 누락');
  } else {
    if (!meta.airline) warnings.push('meta.airline 없음');
    if (!meta.flight_out) warnings.push('meta.flight_out 없음');
    if (!meta.departure_airport) warnings.push('meta.departure_airport 없음');
  }

  // W7. 필수 상품 정보 누락
  if (!pkg.country) warnings.push('country 없음');
  if (!pkg.airline) warnings.push('airline 없음');
  if (!pkg.departure_airport) warnings.push('departure_airport 없음');
  if (!pkg.product_type) warnings.push('product_type 없음 (실속/품격 등)');

  // W8. 포함/불포함 비어있음
  if (!pkg.inclusions || pkg.inclusions.length === 0) warnings.push('inclusions(포함사항) 비어있음');
  if (!pkg.excludes || pkg.excludes.length === 0) warnings.push('excludes(불포함사항) 비어있음');

  // W9. accommodations 비어있음
  if (!pkg.accommodations || pkg.accommodations.length === 0) warnings.push('accommodations(숙소) 비어있음');

  // W10. product_highlights 비어있음
  if (!pkg.product_highlights || pkg.product_highlights.length === 0) warnings.push('product_highlights 비어있음 — 포스터 셀링포인트 없음');

  // W11. 콤마 포함 ▶ activity (안내성 — splitScheduleItems 가 자동 분리하거나 W31 휴리스틱이 단일 명소로 보호)
  // [W11] 접두사: post-audit 의 INFO_RULES 가 INFO 로 분류 (audit_status='info' → 자동 승인)
  if (Array.isArray(days)) {
    let commaCount = 0;
    days.forEach(d => {
      (d.schedule || []).forEach(s => {
        if (s.type === 'normal' && s.activity && s.activity.startsWith('▶') && (s.activity.includes(',') || s.activity.includes('，'))) {
          commaCount++;
        }
      });
    });
    if (commaCount > 0) warnings.push(`[W11] 콤마 포함 ▶ activity ${commaCount}건 — splitScheduleItems 가 자동 분리하거나 W31 휴리스틱이 단일 명소로 보호 (안내성)`);
  }

  // ── 원문 대조 검증 (Semantic Validation) — rawText 사전 선언 ────
  // (W13 이하 룰들과 공유. raw_text가 있을 때만 의미적 룰 실행. Error Registry의 ERR ID로 추적.)
  const rawText = pkg.raw_text || '';

  // W32 — ERR-FUK-camellia-overcorrect@2026-04-28: schedule + inclusions verbatim substring 검증
  // 환각 변환 (예: "태재부" → "다자이후") + 환각 보강 (예: "왕복훼리비" → "왕복 훼리비 (카멜리아)") 자동 검출.
  // 휴리스틱: 활동/포함 텍스트의 공백 제거 normalize 가 raw_text 의 공백 제거 normalize 의 substring 인지 검사.
  // 띄어쓰기 차이는 흡수, 단어 추가/변환은 검출. notices_parsed 는 의역 허용 (검증 제외 — false-positive 회피).
  if (rawText && rawText.length >= 50) {
    const normalize = (s) => (s || '').replace(/\s+/g, '');
    const rawN = normalize(rawText);
    const violations = [];

    // schedule ▶ activity 검증
    if (Array.isArray(days)) {
      for (const d of days) {
        for (const s of (d.schedule || [])) {
          if (s.type !== 'normal' || !s.activity?.startsWith('▶')) continue;
          const actBody = s.activity.slice(1).trim();
          const actN = normalize(actBody);
          if (actN.length < 4) continue;  // 너무 짧으면 false-positive 위험
          if (!rawN.includes(actN)) {
            violations.push(`Day${d.day} schedule "${actBody.slice(0, 60)}${actBody.length > 60 ? '…' : ''}"`);
          }
        }
      }
    }

    // inclusions 검증 (한국어 토큰 포함된 항목만)
    for (const inc of (pkg.inclusions || [])) {
      if (typeof inc !== 'string' || inc.length < 2) continue;
      if (!/[가-힣]/.test(inc)) continue;  // 영문/숫자 only 는 false-positive 위험
      const incN = normalize(inc);
      if (!rawN.includes(incN)) {
        violations.push(`inclusions "${inc}"`);
      }
    }

    if (violations.length > 0) {
      warnings.push(`[W32] verbatim 위반 의심 ${violations.length}건 (raw_text substring 매칭 실패) — 환각 변환·보강 검출. ${violations.slice(0, 3).join(' / ')}${violations.length > 3 ? ` (외 ${violations.length - 3}건)` : ''}`);
    }
  }

  // W12. itinerary_data.highlights와 top-level inclusions/excludes 불일치
  const hlInc = pkg.itinerary_data?.highlights?.inclusions;
  if (hlInc && pkg.inclusions && hlInc.length !== pkg.inclusions.length) {
    warnings.push(`itinerary_data.highlights.inclusions(${hlInc.length}건) ≠ top-level inclusions(${pkg.inclusions.length}건) — 불일치`);
  }

  // (rawText 는 위에서 W32 와 함께 선언됨)

  // W13 — ERR-20260418-01 (min_participants 10→4 조작 방지)
  // 원문에 "N명 이상"이 있으면 pkg.min_participants와 대조
  if (rawText) {
    const mpMatch = rawText.match(/(?:최소 출발|성인)\s*(\d+)\s*명\s*이상/);
    if (mpMatch) {
      const rawMin = Number(mpMatch[1]);
      if (pkg.min_participants != null && pkg.min_participants !== rawMin) {
        warnings.push(`[W13 ERR-20260418-01] min_participants 원문 불일치: 원문 ${rawMin}명 vs 파싱 ${pkg.min_participants}명 — 템플릿 기본값 조작 의심`);
      }
    }
  }

  // W14 — ERR-20260418-02 (notices_parsed 축약 감지)
  // 원문 "비고" 섹션 길이 대비 notices_parsed 총 길이 비율 < 50% → 축약 의심
  if (rawText && Array.isArray(pkg.notices_parsed)) {
    const bigoMatch = rawText.match(/비\s*고[\s\S]{0,2000}?(?=\n\s*일\s*자|$)/);
    const rawLen = bigoMatch?.[0]?.length || 0;
    const parsedLen = pkg.notices_parsed.reduce((s, n) => s + (n.text?.length || 0), 0);
    if (rawLen > 100 && parsedLen < rawLen * 0.5) {
      warnings.push(`[W14 ERR-20260418-02] notices_parsed 축약 의심: 원문 비고 ${rawLen}자 vs 파싱 ${parsedLen}자 (${Math.round(parsedLen/rawLen*100)}%)`);
    }
  }

  // W15 — ERR-20260418-03 (surcharges 기간 누락 감지)
  // 원문에 "M/D ~ D" 또는 "M/D~M/D" 날짜 범위가 있는데 surcharges 배열이 빈 경우
  if (rawText) {
    const surchargeRawRanges = rawText.match(/\d+\/\d+\s*[~-]\s*\d+/g) || [];
    const surchargeCount = Array.isArray(pkg.surcharges) ? pkg.surcharges.length : 0;
    if (surchargeRawRanges.length >= 2 && surchargeCount < Math.ceil(surchargeRawRanges.length / 2)) {
      warnings.push(`[W15 ERR-20260418-03] surcharges 기간 누락 의심: 원문 날짜범위 ${surchargeRawRanges.length}개 vs 파싱 surcharges ${surchargeCount}개`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // W16~W19 — ERR-KUL (2026-04-18 쿠알라룸푸르 상품에서 발견된 누락 방어)
  // ─────────────────────────────────────────────────────────────────────

  // W16 — ERR-KUL-01 (departure_days JSON 배열 문자열 누출)
  // `["금"]` 같은 JSON 포맷 저장 → A4/모바일 UI에 그대로 노출되는 사고 방지
  if (pkg.departure_days && typeof pkg.departure_days === 'string') {
    const dd = pkg.departure_days.trim();
    if (dd.startsWith('[') && dd.endsWith(']')) {
      warnings.push(`[W16 ERR-KUL-01] departure_days가 JSON 배열 문자열입니다 (${dd}) — 평문("월/수")으로 저장해야 UI에 정상 렌더됩니다.`);
    }
  }

  // W17 — ERR-KUL-04 (optional_tours 모호 이름에 region 누락)
  // "2층버스", "리버보트" 같이 이름만으로 지역 식별 불가한 투어는 region 필수
  if (Array.isArray(pkg.optional_tours)) {
    const AMBIGUOUS_OT = ['2층버스', '리버보트', '야시장투어', '크루즈', '마사지', '스카이파크', '스카이 파크'];
    const OT_REGION_KW = ['말레이시아', '쿠알라', '말라카', '겐팅', '싱가포르', '태국', '방콕', '파타야', '푸켓', '베트남', '다낭', '하노이', '나트랑', '대만', '타이페이', '타이베이', '일본', '후쿠오카', '오사카', '중국', '서안', '라오스', '몽골', '필리핀', '보홀', '세부', '인도네시아', '발리'];
    for (const tour of pkg.optional_tours) {
      if (!tour.name) continue;
      const nameHasRegion = OT_REGION_KW.some(kw => tour.name.includes(kw));
      const isAmbiguous = AMBIGUOUS_OT.some(kw => tour.name.includes(kw));
      if (isAmbiguous && !nameHasRegion && !tour.region) {
        warnings.push(`[W17 ERR-KUL-04] optional_tours 모호 이름: "${tour.name}" — region 필드가 없고 이름에도 지역 키워드가 없습니다. A4/모바일 라벨에 "(지역)" 표기가 누락됩니다.`);
      }
    }
  }

  // W18 — ERR-KUL-02/03 (DAY 교차 오염 의심: 원문에 없는 랜드마크가 등장)
  // 한 원문에 여러 상품(3박5일/4박6일 등)이 섞여 있을 때 AI가 DAY 일정을
  // 교차 복사하는 패턴 방어. rawText에 없는 고유 명칭이 schedule에 있으면 경고.
  if (rawText && pkg.itinerary_data) {
    const days = Array.isArray(pkg.itinerary_data) ? pkg.itinerary_data : (pkg.itinerary_data.days || []);
    const LANDMARK_WHITELIST = ['메르데카 광장', '바투동굴', '겐팅 하이랜드', '푸트라자야', '보타닉가든', '가든스 바이 더 베이', '야경투어'];
    for (const day of days) {
      for (const item of (day.schedule || [])) {
        const act = item.activity || '';
        for (const landmark of LANDMARK_WHITELIST) {
          if (act.includes(landmark) && !rawText.includes(landmark)) {
            warnings.push(`[W18 ERR-KUL-02] DAY${day.day} "${landmark}" — 원문에 없는 랜드마크가 일정에 삽입됨 (다른 상품에서 복사된 교차 오염 의심).`);
          }
        }
      }
    }
  }

  // W19 — 일차 수 일치 검사 (duration ↔ itinerary_data.days.length)
  if (pkg.itinerary_data && typeof pkg.duration === 'number') {
    const days = Array.isArray(pkg.itinerary_data) ? pkg.itinerary_data : (pkg.itinerary_data.days || []);
    if (days.length > 0 && days.length !== pkg.duration) {
      warnings.push(`[W19] 일차 수 불일치: pkg.duration=${pkg.duration} vs itinerary_data.days.length=${days.length}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // W21~W25 — Content Policy Validator (ERR-FUK-customer-leaks 방지)
  // "의미론적 검증" — 데이터 구조는 맞지만 잘못된 내용이 고객 필드에 있는지 감지
  // ─────────────────────────────────────────────────────────────────────

  // W21 — customer_notes 에 내부 운영 키워드 금지 (ERR-special-notes-leak@2026-04-27)
  // CRC resolveShopping 이 customer_notes 를 쇼핑 fallback 으로 렌더 → 운영 메모 누출 위험
  // special_notes 는 deprecated (LLM 컨텍스트만 사용, 고객 fallback 경로 제거됨) → 자유 통과
  // internal_notes 는 운영 전용 (어떤 텍스트도 OK)
  const INTERNAL_KEYWORDS = [
    '커미션', 'commission_rate', 'commission ', '정산',
    '스키마 제약', 'LAND_OPERATOR', '내부', '[랜드사', '[INTERNAL]',
    '네트 가격', 'net_price', 'margin_rate',
  ];
  if (pkg.customer_notes && typeof pkg.customer_notes === 'string') {
    const leaked = INTERNAL_KEYWORDS.filter(kw => pkg.customer_notes.includes(kw));
    if (leaked.length > 0) {
      errors.push(`[W21 ERR-special-notes-leak] customer_notes 에 내부 운영 키워드 노출: ${leaked.join(', ')} — 쇼핑센터 섹션에 그대로 노출됨. internal_notes 로 옮기거나 제거할 것.`);
    }
  }

  // W22 — 고객 필드(title/product_summary/product_highlights)에 내부 표기 금지
  const CUSTOMER_FORBIDDEN = ['commission', '내부전용', '[랜드사', 'net_price', 'TODO', 'FIXME'];
  const customerFields = [
    ['title', pkg.title],
    ['product_summary', pkg.product_summary],
    ...((pkg.product_highlights || []).map((h, i) => [`product_highlights[${i}]`, h])),
  ];
  for (const [name, value] of customerFields) {
    if (typeof value !== 'string' || !value) continue;
    const leaked = CUSTOMER_FORBIDDEN.filter(kw => value.toLowerCase().includes(kw.toLowerCase()));
    if (leaked.length > 0) {
      errors.push(`[W22 ERR-FUK-customer-leaks] ${name}에 내부 키워드: ${leaked.join(', ')} (값: "${value.slice(0, 50)}")`);
    }
  }

  // W23 — excludes/inclusions에 숫자 포맷 오류 감지
  // "2|000엔" 같은 split 잔해는 " 2 " + "000엔" 형태 또는 pipe 잔존
  const checkNumericIntegrity = (field, arr) => {
    for (const s of (arr || [])) {
      if (typeof s !== 'string') continue;
      // "2000엔" 은 OK. "2|000엔", "2, 000엔" (공백 포함) 은 split 잔해
      if (/^\d{1,3}\s*[|]\s*\d{3}\s*엔/.test(s)) {
        errors.push(`[W23 ERR-FUK-customer-leaks] ${field} 숫자 포맷 오류 (split 잔해): "${s}"`);
      }
      // "000엔/박" 처럼 숫자로 시작하는 단독 항목 = split 잔해
      if (/^\d{3,}\s*엔\s*\//.test(s)) {
        errors.push(`[W23 ERR-FUK-customer-leaks] ${field} 숫자 split 잔해: "${s}"`);
      }
    }
  };
  checkNumericIntegrity('excludes', pkg.excludes);
  checkNumericIntegrity('inclusions', pkg.inclusions);

  // W24 — surcharges 객체 배열과 excludes 문자열 중복 감지
  if (Array.isArray(pkg.surcharges) && pkg.surcharges.length > 0 && Array.isArray(pkg.excludes)) {
    const surchargeNames = pkg.surcharges.map(s => s.name).filter(Boolean);
    const dups = pkg.excludes.filter(e =>
      typeof e === 'string' && surchargeNames.some(name => e.includes(name.replace(/\s+/g, '')))
    );
    if (dups.length > 0) {
      warnings.push(`[W24 ERR-FUK-customer-leaks] surcharges 객체와 excludes에 중복 항목 ${dups.length}건 — A4 추가요금 섹션에 중복 렌더 위험: ${dups.slice(0, 2).join(' / ')}`);
    }
  }

  // W25 — 항공편 activity 포맷 검증 (parseFlightActivity 호환성)
  if (pkg.itinerary_data) {
    const days = Array.isArray(pkg.itinerary_data) ? pkg.itinerary_data : (pkg.itinerary_data.days || []);
    for (const day of days) {
      for (const item of (day.schedule || [])) {
        if (item.type !== 'flight') continue;
        const act = item.activity || '';
        // 화살표가 있으면 "출발 → 도착" 포맷 + 시간 파싱 가능해야
        if (act.includes('→')) {
          // "XX 출발 → YY 도착 HH:MM" 또는 "XX 출발 → YY HH:MM 도착" 포맷 지원
          const hasArrTime = /도착\s+\d{1,2}:\d{2}/.test(act) || /\d{1,2}:\d{2}\s*도착/.test(act);
          if (!hasArrTime) {
            warnings.push(`[W25 ERR-FUK-customer-leaks] DAY ${day.day} flight activity 도착 시간 파싱 불가: "${act.slice(0, 60)}"`);
          }
        }
      }
    }
  }

  return { errors, warnings };
}

// ─── 중복 감지 (출발일 겹침 기반) ──────────────────────────
/**
 * price_tiers에서 출발일 배열 추출 (price_dates 없는 레거시 상품 fallback)
 * tiersToDatePrices()와 동일 로직, date만 추출
 */
function extractDatesFromTiers(tiers) {
  const DOW_KO = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
  const seen = new Set();
  const result = [];

  for (const tier of (tiers || [])) {
    if (tier.status === 'soldout') continue;
    const dates = [];

    // 1) date_range + departure_day_of_week
    const range = tier.date_range;
    const dowStr = tier.departure_day_of_week;
    if (range?.start && range?.end && dowStr != null) {
      const targetDow = typeof dowStr === 'number' ? dowStr : DOW_KO[String(dowStr).trim()];
      if (targetDow != null) {
        const [sy, sm, sd] = range.start.split('-').map(Number);
        const [ey, em, ed] = range.end.split('-').map(Number);
        const cursor = new Date(sy, sm - 1, sd);
        const endDate = new Date(ey, em - 1, ed);
        while (cursor <= endDate) {
          if (cursor.getDay() === targetDow) {
            const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
            dates.push(iso);
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      }
    }

    // 2) departure_dates
    if (Array.isArray(tier.departure_dates)) {
      dates.push(...tier.departure_dates.filter(d => typeof d === 'string'));
    }

    for (const d of dates) {
      if (!d || seen.has(d)) continue;
      seen.add(d);
      result.push({ date: d });
    }
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 두 출발일 집합의 겹침 검사
 * 비즈니스 규칙: 출발일이 하나라도 겹치면 "같은 행사"
 * YYYY-MM-DD 문자열 직접 비교 — Date 객체 변환 금지 (UTC 파싱 시 KST 하루 밀림)
 * @returns {{ overlaps: boolean, count: number, dates: string[] }}
 */
function checkDateOverlap(pkgDates, existingDates) {
  if (!pkgDates?.length || !existingDates?.length) {
    return { overlaps: false, count: 0, dates: [] };
  }

  const existingSet = new Set(
    existingDates.filter(d => d?.date).map(d => String(d.date).trim())
  );

  const overlappingDates = pkgDates
    .filter(d => d?.date)
    .map(d => String(d.date).trim())
    .filter(d => existingSet.has(d));

  return { overlaps: overlappingDates.length > 0, count: overlappingDates.length, dates: overlappingDates };
}

/**
 * 🆕 완전성(completeness) 점수 — 0~100
 *
 * 목적: AI가 파싱 중 필드를 대량 누락했는지 감지 (위험 1 방어).
 * 신규 상품의 완전성이 기존 대비 20%+ 하락하면 라이브 교체 보류.
 *
 * 가중치:
 *   - title / destination: 각 10점 (필수)
 *   - duration / airline: 각 5점
 *   - price_tiers / price_dates: 각 있으면 10점 (합계 최대 15점 — 중복 방지)
 *   - itinerary_data.days: 일수당 5점 (최대 25점)
 *   - inclusions / excludes: 각 항목당 1점 (각 최대 10점)
 *   - optional_tours: 개당 1점 (최대 5점)
 *   - notices_parsed: 개당 1점 (최대 5점)
 *   - product_highlights: 개당 1점 (최대 5점)
 *   - surcharges: 개당 2점 (최대 5점)
 */
function calcCompletenessScore(pkg) {
  if (!pkg) return 0;
  let score = 0;
  if (pkg.title && pkg.title.length >= 3) score += 10;
  if (pkg.destination) score += 10;
  if (pkg.duration && pkg.duration > 0) score += 5;
  if (pkg.airline) score += 5;

  const hasTiers = Array.isArray(pkg.price_tiers) && pkg.price_tiers.length > 0;
  const hasDates = Array.isArray(pkg.price_dates) && pkg.price_dates.length > 0;
  if (hasTiers && hasDates) score += 15;
  else if (hasTiers || hasDates) score += 10;

  const days = Array.isArray(pkg.itinerary_data)
    ? pkg.itinerary_data
    : (pkg.itinerary_data?.days || []);
  score += Math.min(days.length * 5, 25);

  score += Math.min((pkg.inclusions?.length || 0), 10);
  score += Math.min((pkg.excludes?.length || 0), 10);
  score += Math.min((pkg.optional_tours?.length || 0), 5);
  score += Math.min((pkg.notices_parsed?.length || 0), 5);
  score += Math.min((pkg.product_highlights?.length || 0), 5);
  score += Math.min((pkg.surcharges?.length || 0) * 2, 5);

  return score;
}

/**
 * 중복 여행상품 찾기 (출발일 겹침 기반)
 * 1. destination + product_type + duration 3개 exact match
 * 2. 출발일 집합 교집합 > 0 → "같은 행사" 중복 판정
 * 결과에 _overlapInfo 포함 (로그 출력용)
 */
function findDuplicate(pkg, existingPkgs) {
  if (!Array.isArray(existingPkgs) || existingPkgs.length === 0) return undefined;

  const pkgDates = pkg.price_dates?.length
    ? pkg.price_dates
    : extractDatesFromTiers(pkg.price_tiers);

  for (const existing of existingPkgs) {
    const isBasicMatch =
      existing.destination === pkg.destination &&
      (existing.product_type ?? null) === (pkg.product_type ?? null) &&
      existing.duration === pkg.duration;

    if (!isBasicMatch) continue;

    const existingDates = existing.price_dates?.length
      ? existing.price_dates
      : extractDatesFromTiers(existing.price_tiers);

    const overlap = checkDateOverlap(pkgDates, existingDates);
    if (overlap.overlaps) return { ...existing, _overlapInfo: overlap };
  }

  return undefined;
}

/**
 * 두 상품의 가격이 동일한지 판정 (price_dates 기반)
 * - date + price만 비교 (confirmed/note는 무시 — 가격 정체성이 아님)
 * - 빈 배열 vs 빈 배열 → false (SKIP 아님, 신규 INSERT)
 */
function isSamePriceDates(oldPkg, newPkg) {
  const toSortedPairs = (pkg) =>
    (pkg.price_dates?.length ? pkg.price_dates : extractDatesFromTiers(pkg.price_tiers))
      .map(d => ({ date: String(d.date || '').trim(), price: Number(d.price) || 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));

  const oldPairs = toSortedPairs(oldPkg);
  const newPairs = toSortedPairs(newPkg);

  if (!oldPairs.length && !newPairs.length) return false; // 정보 없음 → 신규 INSERT
  if (oldPairs.length !== newPairs.length) return false;

  for (let i = 0; i < oldPairs.length; i++) {
    if (oldPairs[i].date !== newPairs[i].date) return false;
    if (oldPairs[i].price !== newPairs[i].price) return false;
  }
  return true;
}

/**
 * 발권 마감일 동일성 판정 (null 안전)
 */
function isSameDeadline(oldDeadline, newDeadline) {
  return String(oldDeadline ?? '').trim() === String(newDeadline ?? '').trim();
}

// ─── 메인 inserter 팩토리 ───────────────────────────────────
function createInserter({ landOperator, commissionRate, commissionFixedAmount, commissionCurrency, ticketingDeadline, destCode }) {
  const operators = loadOperators();
  const op = operators[landOperator];
  if (!op) throw new Error(`알 수 없는 랜드사: ${landOperator}. land-operators.json 확인 필요.`);

  const LAND_OPERATOR_ID = op.uuid;
  const SUPPLIER_CODE = op.code;
  const DEST_CODE = destCode;
  // P1 #5 (2026-04-27): 정액/% 마진 상호배타. 정액이면 commissionRate=0 자동 설정.
  const COMMISSION_FIXED_AMOUNT = commissionFixedAmount ?? null;
  const COMMISSION_CURRENCY = commissionCurrency || 'KRW';
  const COMMISSION_RATE = COMMISSION_FIXED_AMOUNT != null ? 0 : commissionRate;
  const TICKETING_DEADLINE = ticketingDeadline;

  async function run(packages) {
    const sb = initSupabase();

    // 1. 기존 상품 조회 (동일 랜드사 + 활성 상태)
    const { data: existingPkgs } = await sb
      .from('travel_packages')
      .select('id, title, destination, product_type, duration, price, price_tiers, price_dates, ticketing_deadline, short_code, status')
      .eq('land_operator_id', LAND_OPERATOR_ID)
      .in('status', ['approved', 'active', 'pending']);

    // 2. short_code 최대 시퀀스 조회
    const { data: allCodes } = await sb
      .from('travel_packages')
      .select('short_code')
      .ilike('short_code', `${SUPPLIER_CODE}-${DEST_CODE}-%`);

    function nextSeq(prefix) {
      return (allCodes || []).reduce((max, r) => {
        if (!r.short_code?.startsWith(prefix)) return max;
        const n = parseInt(r.short_code.split('-').pop() || '0', 10);
        return n > max ? n : max;
      }, 0);
    }

    const toInsert = [];
    const toArchive = [];
    const skipped = [];
    const seqCounters = {};

    // 3. 검증 + 중복 검사 + INSERT 준비
    for (const pkg of packages) {
      // 관광지 매칭 최적화: 콤마 구분 관광지를 개별 schedule item으로 분리
      if (pkg.itinerary_data?.days) {
        for (const day of pkg.itinerary_data.days) {
          if (day.schedule) {
            day.schedule = splitScheduleItems(day.schedule);
          }
        }
      }

      // 렌더링 계약 검증 (errors: 차단, warnings: STRICT 모드에서 차단)
      const { errors: validationErrors, warnings: validationWarnings } = validatePackage(pkg);
      const STRICT = process.env.STRICT_VALIDATION === 'true';

      // Phase 1 CRC — Zod PackageStrictSchema (W26~W29) 기본 ON
      // ZOD_STRICT=false 로만 비활성화 가능. ERR-HSN-render-bundle 재발 방지.
      if (process.env.ZOD_STRICT !== 'false') {
        try {
          // CommonJS 에서 TS Zod 를 직접 쓰기 어려우므로, 경량 수동 검증 수행
          // 1) inclusions 최상위 콤마 (W26)
          if (Array.isArray(pkg.inclusions)) {
            pkg.inclusions.forEach((item, idx) => {
              if (typeof item !== 'string') return;
              let depth = 0;
              for (const ch of item) {
                if (ch === '(' || ch === '[' || ch === '{') depth++;
                else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
                else if (ch === ',' && depth === 0) {
                  const prev = item[item.indexOf(ch) - 1];
                  const nextRest = item.slice(item.indexOf(ch) + 1, item.indexOf(ch) + 4);
                  if (!(/\d/.test(prev || '') && /^\d{3}/.test(nextRest || ''))) {
                    validationErrors.push(`[W26 ERR-HSN] inclusions[${idx}] 콤마 포함: "${item.slice(0, 50)}..." → 개별 배열 요소로 분리 필요`);
                    break;
                  }
                }
              }
            });
          }
          // 2) 하루 flight activity 분리 (W27)
          const daysArr = Array.isArray(pkg.itinerary_data) ? pkg.itinerary_data : (pkg.itinerary_data?.days || []);
          daysArr.forEach((day, dIdx) => {
            const flights = (day?.schedule || []).filter(s => s?.type === 'flight');
            if (flights.length > 1) {
              const unmerged = flights.some(f => !/→|↦|⇒/.test(f.activity || ''));
              if (unmerged) {
                validationErrors.push(`[W27 ERR-HSN] Day ${day?.day ?? dIdx + 1}: 분리된 flight activity ${flights.length}개. "A 출발 → B 도착 HH:MM" 단일 포맷 필요`);
              }
            }
          });
          // 3) 호텔 activity 앞절 붙이기 (W28)
          daysArr.forEach((day, dIdx) => {
            (day?.schedule || []).forEach((item, sIdx) => {
              if (item?.type !== 'normal' || !item.activity) return;
              const hasHotelSuffix = /호텔\s*(?:투숙|휴식|체크인|체크 인)/.test(item.activity);
              const startsWithHotel = /^[*\s]*호텔/.test(item.activity);
              if (hasHotelSuffix && !startsWithHotel) {
                validationErrors.push(`[W28 ERR-HSN] Day ${day?.day ?? dIdx + 1} schedule[${sIdx}] "${item.activity.slice(0, 40)}..." — 호텔 activity 앞절 붙이기 금지 (별도 normal 로 분리)`);
              }
            });
          });
        } catch (zodErr) {
          console.warn(`   ⚠️  Zod strict 검증 예외(무시): ${zodErr?.message || zodErr}`);
        }
      }

      // 🆕 P3 #2 — Agent self-audit INSERT 차단 게이트 (ERR-self-audit-gate-bypass@2026-04-27)
      //   agent_audit_report.overall_verdict === 'blocked' 또는 CRITICAL unsupported claim 존재 시 INSERT 차단.
      //   기존: post-audit 단계에서 warnings 만 추가됨 → INSERT 는 그대로 진행되어 환각 데이터가 DB에 유입.
      //   해결: pre-INSERT 에서 verdict 검사. STRICT_AUDIT=true 면 report 누락도 차단.
      {
        const ar = pkg.agent_audit_report;
        const STRICT_AUDIT = process.env.STRICT_AUDIT === 'true';
        if (ar && typeof ar === 'object') {
          const verdict = ar.overall_verdict;
          const critical = Number(ar.unsupported_critical || 0);
          const high = Number(ar.unsupported_high || 0);
          if (verdict === 'blocked') {
            validationErrors.push(`[AGENT_AUDIT_BLOCKED] agent_audit_report.overall_verdict=blocked (CRITICAL:${critical} HIGH:${high}) — claims[].supported=false 항목을 원문 근거로 정정 후 재시도`);
          } else if (critical >= 1) {
            validationErrors.push(`[AGENT_AUDIT_CRITICAL] CRITICAL unsupported claim ${critical}건 — INSERT 차단. 환각·축약 의심 claim 을 원문 근거로 정정`);
          } else if (high >= 3) {
            const msg = `[AGENT_AUDIT_HIGH] HIGH unsupported claim ${high}건 — 검토 필요`;
            if (STRICT_AUDIT) validationErrors.push(msg);
            else validationWarnings.push(msg);
          }
        } else if (STRICT_AUDIT) {
          validationErrors.push(`[AGENT_AUDIT_MISSING] agent_audit_report 누락 — STRICT_AUDIT 모드에서는 필수`);
        }
      }

      if (validationWarnings.length > 0) {
        console.log(`\n⚠️  경고 (${pkg.title || '제목없음'}):`);
        validationWarnings.forEach(w => console.log(`   ⚠️  ${w}`));
        if (STRICT) {
          // STRICT 모드: warning도 차단하거나, draft 상태로 저장
          if (!process.env.ALLOW_DRAFT) {
            console.error(`   → STRICT_VALIDATION=true — 경고 있는 상품은 차단됩니다. (또는 ALLOW_DRAFT=true 로 draft 저장)`);
            skipped.push({ title: pkg.title, reason: `STRICT 경고 ${validationWarnings.length}건` });
            continue;
          } else {
            console.log(`   → ALLOW_DRAFT=true — status='draft'로 저장. 어드민 검수 후 published로 승격 필요.`);
            pkg.status = 'draft';
            pkg.validation_warnings = validationWarnings;
          }
        }
      }

      if (validationErrors.length > 0) {
        console.error(`\n❌ 검증 실패: ${pkg.title || '제목없음'}`);
        validationErrors.forEach(e => console.error(`   ❌ ${e}`));
        console.error('   → 이 상품은 건너뜁니다.\n');
        skipped.push({ title: pkg.title, reason: `검증 실패 (${validationErrors.length}건)` });
        continue;
      }

      // ─── P2-#4-C + Step 2 (Per-field confidence): Pre-INSERT 교차검증 gate ─────────
      //   Sonnet 정규화 결과를 Gemini Flash 가 비판적으로 검토 → 환각 의심 시 INSERT 차단/강등.
      //   추가: 의심 필드별 confidence 점수를 field_confidences jsonb 에 저장 → 어드민 빨간색 highlight.
      //   비용: ~$0.0003/건 (Gemini Flash). 사고 방지 ROI 100x+.
      //   SKIP_PRE_INSERT_GATE=1 로 우회 가능 (테스트/긴급 등록).
      if (!process.env.SKIP_PRE_INSERT_GATE && pkg.raw_text && pkg.raw_text.length >= 50) {
        try {
          const geminiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
          if (geminiKey) {
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(geminiKey);
            const judge = genAI.getGenerativeModel({
              model: 'gemini-2.5-flash',
              systemInstruction: `너는 여행 상품 정규화 결과 감사관이다. 다른 LLM 추출 결과를 원문과 대조해 환각/축약을 찾아라. CRITICAL=금액·인원·날짜·항공편 환각, HIGH=축약·verbatim 위반.`,
              generationConfig: {
                responseMimeType: 'application/json', temperature: 0.0,
                responseSchema: {
                  type: 'object',
                  properties: {
                    recommendation: { type: 'string', enum: ['pass', 'review', 'reject'] },
                    overall_confidence: { type: 'number' },
                    suspicious_critical: { type: 'integer' },
                    suspicious_fields: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          field_path: { type: 'string' },
                          score: { type: 'number' },
                          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                          reason: { type: 'string' },
                        },
                        required: ['field_path', 'score', 'severity', 'reason'],
                      },
                    },
                    reasoning: { type: 'string' },
                  },
                  required: ['recommendation', 'overall_confidence', 'suspicious_critical', 'reasoning'],
                },
              },
            });

            // 핵심 필드만 비교 (토큰 절약)
            const normalizedSummary = {
              title: pkg.title,
              destination: pkg.destination,
              duration: pkg.duration,
              min_participants: pkg.min_participants,
              ticketing_deadline: pkg.ticketing_deadline,
              inclusions: pkg.inclusions,
              excludes: pkg.excludes,
              accommodations: pkg.accommodations,
              flight_out: pkg.itinerary_data?.meta?.flight_out,
              flight_in: pkg.itinerary_data?.meta?.flight_in,
              surcharges: pkg.surcharges,
            };

            const judgeRes = await judge.generateContent([
              `## 원문\n${pkg.raw_text.slice(0, 8000)}`,
              `\n## 추출 결과 핵심 필드\n${JSON.stringify(normalizedSummary).slice(0, 6000)}`,
              '\n위 추출 결과의 환각·축약·verbatim 위반을 평가하라.',
            ].join('\n'));
            const verdict = JSON.parse(judgeRes.response.text());

            const conf = Number(verdict.overall_confidence) || 0;
            const crit = Number(verdict.suspicious_critical) || 0;

            // Per-field confidence 저장 (Step 2) — INSERT payload 에 첨부
            const fieldsObj = {};
            for (const sf of (verdict.suspicious_fields || [])) {
              if (!sf?.field_path) continue;
              fieldsObj[sf.field_path] = {
                score: Number(sf.score) || 0,
                severity: sf.severity || 'medium',
                reason: sf.reason || '',
              };
            }
            pkg.field_confidences = {
              overall_confidence: conf,
              fields: fieldsObj,
              recommendation: verdict.recommendation || 'pass',
              reasoning: verdict.reasoning || '',
              validated_at: new Date().toISOString(),
              validator: 'gemini-2.5-flash',
            };

            if (verdict.recommendation === 'reject' || crit >= 1 || conf < 0.5) {
              console.error(`\n🚨 [Pre-INSERT Gate] REJECT: ${pkg.title}`);
              console.error(`   confidence=${conf.toFixed(2)} CRITICAL=${crit}`);
              console.error(`   ${verdict.reasoning}`);
              console.error('   → 이 상품은 INSERT 차단됩니다 (사장님 검토 후 SKIP_PRE_INSERT_GATE=1 로 강제 등록 가능).\n');
              skipped.push({ title: pkg.title, reason: `Pre-INSERT 교차검증 차단 (conf ${conf.toFixed(2)})` });
              continue;
            }
            if (verdict.recommendation === 'review' || conf < 0.7) {
              console.log(`\n⚠️  [Pre-INSERT Gate] REVIEW: ${pkg.title} — confidence=${conf.toFixed(2)}`);
              console.log(`   ${verdict.reasoning}`);
              console.log('   → INSERT 진행하되 audit_status=warnings 강등.');
              // pkg.audit_status 는 post-audit 단계에서 설정됨. 여기서는 표식만.
              pkg._pre_insert_review = true;
            } else {
              console.log(`✅ [Pre-INSERT Gate] PASS: ${pkg.title} (conf ${conf.toFixed(2)})`);
            }
          }
        } catch (eGate) {
          // gate 실패는 INSERT 막지 않음 (안전 fallback)
          console.warn(`⚠️  [Pre-INSERT Gate] 호출 실패 — 게이트 무시: ${eGate.message}`);
        }
      }

      const dup = findDuplicate(pkg, existingPkgs);

      if (dup) {
        const overlapInfo = dup._overlapInfo;
        const samePrices = isSamePriceDates(dup, pkg);
        const sameDeadline = isSameDeadline(dup.ticketing_deadline, TICKETING_DEADLINE);
        const overlapLog = `겹치는 출발일: ${overlapInfo.count}건 (${overlapInfo.dates.slice(0, 3).join(', ')}${overlapInfo.count > 3 ? ' ...' : ''})`;

        if (samePrices && sameDeadline) {
          console.log(`\n⏭️  SKIP: ${pkg.title} (완전 동일)`);
          console.log(`   ${overlapLog}`);
          skipped.push({ title: pkg.title, existingId: dup.id, reason: '완전 동일' });
          continue;
        }

        // 🆕 조건부 아카이브 (ERR-KUL-safe-replace)
        // 기존 상품 대비 신규 상품의 "완전성(completeness)"을 계산하여
        // 심각한 퇴화(degradation) 시 라이브 교체하지 않고 pending_replace로 보류.
        const compScore = calcCompletenessScore(pkg);
        const dupScore = calcCompletenessScore(dup);
        const degradationPct = dupScore > 0 ? ((dupScore - compScore) / dupScore) * 100 : 0;
        const DEGRADATION_THRESHOLD = 20; // 신규가 기존보다 20%+ 빈약하면 보류

        if (degradationPct > DEGRADATION_THRESHOLD) {
          console.log(`\n⚠️  PENDING_REPLACE: ${pkg.title}`);
          console.log(`   완전성 점수 하락: 기존 ${dupScore}점 → 신규 ${compScore}점 (-${degradationPct.toFixed(1)}%)`);
          console.log(`   → 기존 상품 유지, 신규는 status='pending_replace'로 보류. 어드민 검수 필요.`);
          pkg.status = 'pending_replace';
          pkg.validation_warnings = [
            ...(pkg.validation_warnings || []),
            `[SAFE-REPLACE] 기존 상품(${dup.short_code}) 대비 완전성 -${degradationPct.toFixed(1)}%. 라이브 교체 보류.`,
          ];
          // 기존 아카이브 중단 — toArchive에 추가하지 않음
        } else {
          const reason = samePrices ? '마감일 변경' : '가격 변경';
          console.log(`\n📦 아카이브 예정 (${reason}, 완전성 ${compScore}점): ${dup.short_code} | ${dup.title}`);
          console.log(`   ${overlapLog}`);
          toArchive.push({ id: dup.id, title: dup.title, short_code: dup.short_code, reason });
        }
      }

      const dur = String(pkg.duration).padStart(2, '0');
      const prefix = `${SUPPLIER_CODE}-${DEST_CODE}-${dur}-`;
      if (!seqCounters[prefix]) seqCounters[prefix] = nextSeq(prefix);
      seqCounters[prefix]++;
      const short_code = `${prefix}${String(seqCounters[prefix]).padStart(2, '0')}`;

      toInsert.push({
        title: pkg.title,
        display_title: pkg.display_title || generateDisplayTitle(pkg),
        hero_tagline: pkg.hero_tagline || generateHeroTagline(pkg),
        destination: pkg.destination,
        country: pkg.country,
        category: pkg.category || 'package',
        product_type: pkg.product_type,
        trip_style: pkg.trip_style,
        duration: pkg.duration,
        nights: pkg.nights,
        departure_airport: pkg.departure_airport,
        departure_days: pkg.departure_days || null,
        airline: pkg.airline,
        min_participants: pkg.min_participants || 4,
        status: pkg.status || 'pending',
        price: pkg.price,
        guide_tip: pkg.guide_tip ?? null,
        single_supplement: pkg.single_supplement ?? null,
        small_group_surcharge: pkg.small_group_surcharge ?? null,
        surcharges: pkg.surcharges || [],
        excluded_dates: pkg.excluded_dates || [],
        optional_tours: pkg.optional_tours || [],
        price_tiers: pkg.price_tiers || [],
        price_dates: pkg.price_dates?.length ? pkg.price_dates : tiersToDatePrices(pkg.price_tiers),
        inclusions: pkg.inclusions || [],
        excludes: pkg.excludes || [],
        notices_parsed: pkg.notices_parsed || null,
        special_notes: pkg.special_notes || null,
        customer_notes: pkg.customer_notes || null,
        internal_notes: pkg.internal_notes || null,
        product_highlights: pkg.product_highlights || [],
        product_summary: pkg.product_summary || null,
        product_tags: pkg.product_tags || [],
        itinerary_data: pkg.itinerary_data || null,
        itinerary: pkg.itinerary || [],
        accommodations: pkg.accommodations || [],
        raw_text: pkg.raw_text || '',
        // W-final F3 — Rule Zero 강제. hash 누락 시 자동 계산.
        raw_text_hash: pkg.raw_text_hash || (pkg.raw_text ? computeRawHash(pkg.raw_text) : null),
        // W-final F3 — 파서 버전 기록. Agent 가 명시하면 그 값, 아니면 기본 버전.
        parser_version: pkg.parser_version || PARSER_VERSION,
        // W-final F1 — Agent self-audit 결과 (있으면 저장, 없으면 null → post-audit 에서 채워짐)
        agent_audit_report: pkg.agent_audit_report || null,
        // Step 2 (Per-field confidence) — Pre-INSERT cross-validate 결과
        field_confidences: pkg.field_confidences || null,
        filename: pkg.filename || 'manual',
        file_type: pkg.file_type || 'manual',
        confidence: pkg.confidence ?? 0.9,
        land_operator_id: LAND_OPERATOR_ID,
        short_code,
        commission_rate: COMMISSION_RATE,
        commission_fixed_amount: COMMISSION_FIXED_AMOUNT,
        commission_currency: COMMISSION_FIXED_AMOUNT != null ? COMMISSION_CURRENCY : null,
        ticketing_deadline: TICKETING_DEADLINE,
        // Option B: INSERT 시점에 baseline 큐 자동 등록
        baseline_requested_at: new Date().toISOString(),
      });
    }

    // 4. 리포트 출력
    console.log(`\n📋 중복 검사 결과:`);
    console.log(`  - 신규 등록: ${toInsert.length}개`);
    console.log(`  - 아카이브 (기존→대체): ${toArchive.length}개`);
    console.log(`  - 건너뜀 (동일): ${skipped.length}개\n`);

    if (skipped.length > 0) {
      skipped.forEach(s => console.log(`  ⏭️  SKIP: ${s.title} (${s.reason})`));
    }

    // 5. 아카이브 처리
    if (toArchive.length > 0) {
      const archiveIds = toArchive.map(a => a.id);
      await sb.from('travel_packages').update({ status: 'archived' }).in('id', archiveIds);
      toArchive.forEach(a => console.log(`  📦 아카이브: ${a.short_code} | ${a.title}`));
    }

    // 6. INSERT
    const insertedIds = [];
    if (toInsert.length > 0) {
      const { data, error } = await sb
        .from('travel_packages')
        .insert(toInsert)
        .select('id, title, status, price, short_code, commission_rate, ticketing_deadline, price_dates');

      if (error) {
        console.error('❌ 등록 실패:', error.message);
        process.exit(1);
      }

      console.log(`\n✅ ${data.length}개 상품 등록 완료!\n`);
      data.forEach(r => {
        const dateCount = Array.isArray(r.price_dates) ? r.price_dates.length : 0;
        console.log(`  📦 ${r.short_code} | ${r.title}`);
        console.log(`     💰 ${r.price?.toLocaleString()}원 | 수수료 ${r.commission_rate}% | 마감 ${r.ticketing_deadline}`);
        console.log(`     📅 출발일 ${dateCount}건\n`);
        insertedIds.push(r.id);
      });
    }

    if (toInsert.length === 0 && skipped.length > 0) {
      console.log('ℹ️  신규 등록할 상품이 없습니다 (전부 기존과 동일).');
    }

    // 🚨 7. 자동 감사 (MANDATORY — register.md Step 7)
    // 이 단계가 누락되면 ERR-process-violation: 오류 사일런트 배포 위험
    if (insertedIds.length > 0 && !process.env.SKIP_POST_AUDIT) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  🔍 Step 7: 자동 감사 실행 (필수)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      try {
        const { spawnSync } = require('child_process');
        const path = require('path');
        const auditScript = path.join(__dirname, '..', 'post_register_audit.js');
        if (require('fs').existsSync(auditScript)) {
          const result = spawnSync('node', [auditScript, ...insertedIds], { stdio: 'inherit' });
          if (result.status !== 0) {
            console.log('\n⚠️  감사 스크립트 비정상 종료 — 수동 확인 필요');
          }
        } else {
          console.log('ℹ️  post_register_audit.js 미발견 — 감사 생략');
        }

        // 🚀 7-A. clean 자동 승인 (MANDATORY — ERR-process-violation-auto-approve)
        //      approve_package.js 가 audit_status 를 읽어 clean 만 active 로 승격.
        //      Dev 서버 독립 (Supabase 직접 UPDATE) → 서버 다운 중이어도 작동.
        const approveScript = path.join(__dirname, '..', 'approve_package.js');
        if (require('fs').existsSync(approveScript) && !process.env.SKIP_AUTO_APPROVE) {
          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('  🚀 Step 7-A: 자동 승인 (CLEAN 만)');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          spawnSync('node', [approveScript, ...insertedIds], { stdio: 'inherit' });
        }

        // 📋 7-C. 결과값 도출 (MANDATORY — 사장님 재요청 방지)
        //        실제 DB 에 들어간 판매 필드 풀덤프.
        const dumpScript = path.join(__dirname, '..', 'dump_package_result.js');
        if (require('fs').existsSync(dumpScript) && !process.env.SKIP_DUMP_RESULT) {
          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('  📋 Step 7-C: 결과값 도출 (판매 필드 풀덤프)');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          spawnSync('node', [dumpScript, ...insertedIds], { stdio: 'inherit' });
        }

        // 📸 7-D. 시각 회귀 baseline 생성 (OPTIONAL — ERR-HET-* 렌더 회귀 차단)
        //        fixtures.json upsert + playwright --update-snapshots 로 baseline 생성.
        //        실패해도 등록 프로세스는 진행(상품 활성화 유지). dev 서버 off 시 자동 skip.
        const visualScript = path.join(__dirname, '..', 'generate_visual_baseline.js');
        if (require('fs').existsSync(visualScript) && !process.env.SKIP_VISUAL_BASELINE) {
          // dev 서버가 안 떠 있으면 baseline 생성 불가 → 빠른 health check 후 스킵
          // (playwright 의 reuseExistingServer 는 dev 서버 없으면 자동 기동하지만 5~10분 소요되어
          //  등록 프로세스를 너무 오래 잡아둠. dev 서버가 이미 떠 있을 때만 실행.)
          const http = require('http');
          const ok = await new Promise(resolve => {
            const req = http.get('http://localhost:3000', { timeout: 2000 }, res => { resolve(res.statusCode !== undefined); req.destroy(); });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
          });
          if (ok) {
            spawnSync('node', [visualScript, ...insertedIds], { stdio: 'inherit' });
          } else {
            console.log('\nℹ️  Step 7-D 건너뜀: dev 서버(localhost:3000) 응답 없음. 수동 실행:');
            console.log(`   npm run dev (다른 터미널) → node db/generate_visual_baseline.js ${insertedIds.join(' ')}`);
          }
        }

        // 🗺️ 7-F. unmatched_activities 자동 적재 — 등록 직후 서버사이드
        //   기존: 랜딩 페이지 로드 시 사용자 브라우저에서 적재 (지연 + 사용자 의존)
        //   개선: 등록 직후 schedule activity 추출 → attractions 매칭 → 미매칭만 unmatched_activities INSERT
        //   효과: 사장님이 /admin/attractions/unmatched 페이지에서 즉시 1클릭 alias 적립 가능 (Compound improvement 가속)
        //   비용: 0 (DB 호출만)
        //   SKIP_UNMATCHED_INGEST=1 로 우회
        if (!process.env.SKIP_UNMATCHED_INGEST) {
          try {
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('  🗺️ Step 7-F: unmatched_activities 자동 적재');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            // 1) 모든 등록된 패키지의 ▶ activity 수집
            const activityRecords = [];
            for (const pkg of toInsert) {
              const days = Array.isArray(pkg.itinerary_data) ? pkg.itinerary_data : (pkg.itinerary_data?.days || []);
              const insertedRow = (await sb
                .from('travel_packages')
                .select('id, title')
                .eq('short_code', pkg.short_code)
                .limit(1)).data?.[0];
              if (!insertedRow) continue;

              for (const day of days) {
                for (const item of (day?.schedule || [])) {
                  if (!item || item.type !== 'normal' && item.type !== 'optional') continue;
                  const act = String(item.activity || '').trim();
                  // ▶ 마커가 있는 관광지·체험·투어만 매칭 시도
                  if (!act.startsWith('▶') || act.length < 4) continue;
                  activityRecords.push({
                    activity: act,
                    package_id: insertedRow.id,
                    package_title: insertedRow.title,
                    day_number: day.day || null,
                    country: pkg.country || null,
                    region: pkg.destination || null,
                  });
                }
              }
            }

            if (activityRecords.length === 0) {
              console.log('  ℹ️  ▶ 마커 activity 없음 — skip');
            } else {
              // 2) attractions 전체 조회 (이번 패키지들의 destination/country 범위)
              const regions = [...new Set(activityRecords.map(r => r.region).filter(Boolean))];
              const countries = [...new Set(activityRecords.map(r => r.country).filter(Boolean))];
              let attrQuery = sb.from('attractions').select('id, name, aliases, region, country');
              if (regions.length > 0 || countries.length > 0) {
                const orParts = [
                  ...regions.map(r => `region.eq.${r}`),
                  ...countries.map(c => `country.eq.${c}`),
                ];
                attrQuery = attrQuery.or(orParts.join(','));
              }
              const { data: attractions } = await attrQuery.limit(2000);
              const candidates = attractions || [];

              // 3) 매칭 시도 — name 또는 aliases 의 부분 일치
              const cleanText = (t) => String(t || '')
                .replace(/^[▶☆※♣*]+\s*/, '')
                .replace(/[(\[].*?[)\]]/g, ' ')
                .replace(/\s+/g, ' ')
                .toLowerCase()
                .trim();

              const matchAttr = (act) => {
                const clean = cleanText(act);
                if (!clean) return null;
                for (const a of candidates) {
                  const terms = [a.name, ...(a.aliases || [])].filter(Boolean);
                  for (const t of terms) {
                    const tc = String(t).toLowerCase().trim();
                    if (tc.length < 2) continue;
                    if (clean.includes(tc) || tc.includes(clean)) return a;
                  }
                }
                return null;
              };

              // 4) 미매칭 항목만 추출 (중복 activity 제거 + occurrence_count 누적)
              const unmatchedMap = new Map();
              for (const r of activityRecords) {
                const matched = matchAttr(r.activity);
                if (matched) continue; // 매칭 성공 → unmatched 큐 적재 안 함
                const key = r.activity;
                if (unmatchedMap.has(key)) {
                  unmatchedMap.get(key).occurrence_count += 1;
                } else {
                  unmatchedMap.set(key, { ...r, occurrence_count: 1, status: 'pending' });
                }
              }

              if (unmatchedMap.size === 0) {
                console.log(`  ✅ ${activityRecords.length}개 activity 모두 attractions 매칭 성공`);
              } else {
                // 5) RPC 우선, 실패 시 fallback upsert
                const items = [...unmatchedMap.values()];
                let saved = 0;
                for (const it of items) {
                  try {
                    const { error: rpcErr } = await sb.rpc('upsert_unmatched_activity', {
                      p_activity: it.activity,
                      p_package_id: it.package_id,
                      p_package_title: it.package_title,
                      p_day_number: it.day_number,
                      p_country: it.country,
                      p_region: it.region,
                    }).single();
                    if (rpcErr) throw rpcErr;
                    saved++;
                  } catch {
                    const { error: e2 } = await sb
                      .from('unmatched_activities')
                      .upsert(it, { onConflict: 'activity' });
                    if (!e2) saved++;
                  }
                }
                console.log(`  📊 매칭 ${activityRecords.length - unmatchedMap.size}/${activityRecords.length}건 / 미매칭 ${saved}건 unmatched_activities 적재`);
                console.log(`  → /admin/attractions/unmatched 에서 1클릭 alias 적립 (다음 등록부터 자동 매칭)`);
              }
            }
          } catch (eIngest) {
            console.warn(`⚠️  Step 7-F 실패 (무시 — 랜딩 페이지가 백필): ${eIngest.message}`);
          }
        }

        // 🧠 7-E. EPR few-shot 풀에 즉시 합류 — raw_text 임베딩 자동 생성
        //   Rubin et al. NAACL 2022 (arXiv 2112.08633) — 등록할수록 다음 추출이 똑똑해짐.
        //   travel_packages.embedding(vector 1536d) 컬럼 + HNSW 인덱스 + Gemini gemini-embedding-001.
        //   실패해도 cron(/api/cron/embed-products) 이 백필하므로 프로세스 막지 않음.
        if (!process.env.SKIP_EPR_EMBEDDING) {
          try {
            const geminiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
            if (geminiKey) {
              console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log('  🧠 Step 7-E: EPR few-shot 풀 합류 (raw_text 임베딩)');
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

              const EMBED_DIM = 1536;
              const EMBED_MODEL = 'gemini-embedding-001';

              for (const pkg of (toInsert || [])) {
                if (!pkg.raw_text || pkg.raw_text.length < 50) continue;
                const insertedRow = (await sb
                  .from('travel_packages')
                  .select('id, embedding')
                  .eq('short_code', pkg.short_code)
                  .limit(1)).data?.[0];
                if (!insertedRow || insertedRow.embedding) continue;

                const text = [
                  pkg.title,
                  pkg.destination ? `목적지: ${pkg.destination}` : null,
                  pkg.country ? `국가: ${pkg.country}` : null,
                  pkg.duration ? `기간: ${pkg.duration}일` : null,
                  pkg.airline ? `항공사: ${pkg.airline}` : null,
                  pkg.product_summary || null,
                  pkg.raw_text.slice(0, 2500),
                ].filter(Boolean).join('\n');

                const res = await fetch(
                  `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${geminiKey}`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      model: `models/${EMBED_MODEL}`,
                      content: { parts: [{ text: text.slice(0, 8000) }] },
                      taskType: 'RETRIEVAL_DOCUMENT',
                      outputDimensionality: EMBED_DIM,
                    }),
                  }
                );
                if (!res.ok) {
                  console.log(`  ⚠️  ${pkg.short_code} 임베딩 실패 (HTTP ${res.status})`);
                  continue;
                }
                const json = await res.json();
                const values = json?.embedding?.values;
                if (!Array.isArray(values) || values.length !== EMBED_DIM) {
                  console.log(`  ⚠️  ${pkg.short_code} 임베딩 응답 형식 오류`);
                  continue;
                }
                const { error: embErr } = await sb
                  .from('travel_packages')
                  .update({ embedding: values })
                  .eq('id', insertedRow.id);
                if (embErr) {
                  console.log(`  ⚠️  ${pkg.short_code} 임베딩 UPDATE 실패: ${embErr.message}`);
                } else {
                  console.log(`  ✅ ${pkg.short_code} 임베딩 저장 (다음 등록 시 EPR demo 풀 합류)`);
                }
                await new Promise(r => setTimeout(r, 200)); // Rate limit 방어
              }
            } else {
              console.log('\nℹ️  Step 7-E 건너뜀: GOOGLE_AI_API_KEY 미설정');
            }
          } catch (eEpr) {
            console.log(`⚠️  Step 7-E 임베딩 실패 (무시 — cron 이 백필): ${eEpr.message}`);
          }
        }
      } catch (e) {
        console.log(`⚠️  감사/승인/덤프/baseline 실행 실패: ${e.message}`);
      }
    }

    return { inserted: toInsert.length, archived: toArchive.length, skipped: skipped.length, insertedIds };
  }

  return {
    run,
    // 외부에서도 사용 가능하도록 유틸 노출
    helpers: { flight, normal, optional, shopping, train, meal },
    generateDisplayTitle,
    generateHeroTagline,
    tiersToDatePrices,
    findDuplicate,
    isSamePriceDates,
    config: { LAND_OPERATOR_ID, SUPPLIER_CODE, DEST_CODE, COMMISSION_RATE, TICKETING_DEADLINE },
  };
}

module.exports = { createInserter, initSupabase, loadOperators, tiersToDatePrices, generateDisplayTitle, generateHeroTagline, extractDatesFromTiers, checkDateOverlap, findDuplicate, isSamePriceDates, isSameDeadline, validatePackage, splitScheduleItems, computeRawHash };
