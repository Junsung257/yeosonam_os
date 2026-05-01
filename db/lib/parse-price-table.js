'use strict';
/**
 * 가격표 파서 — 날짜 이상치 자동 탐지 + 중복 해결
 *
 * 해결하는 문제:
 *   [ERR-BHO-TB-04] "8/2,3,9,10,16 수목" 같이 월이 틀린 OCR/인쇄 오류 자동 탐지
 *   [ERR-BHO-TB-05] "7/16"이 두 요금 티어에 동시에 존재하는 날짜 중복 해결
 *
 * 사용법:
 *   const { parsePriceRows } = require('./lib/parse-price-table');
 *
 *   // 단순 날짜 + 가격 행 배열로 변환 (원문 텍스트에서 추출)
 *   const result = parsePriceRows([
 *     { label: '5/20 수',          prices: [819, 959, 1049, 1129, 1159] },
 *     { label: '7/15, 7/16 수목',  prices: [1199, 1339, 1429, 1509, 1539] },
 *     { label: '7/16-7/22 수목금', prices: [1069, 1209, 1299, 1379, 1409] },
 *     { label: '8/2,3,9,10,16 수목', prices: [869, 1009, 1099, 1179, 1209] },
 *   ], { year: 2026, priceUnit: 1000 });
 *
 *   result.rows    // [{date:'YYYY-MM-DD', prices:[n...]}, ...]
 *   result.anomalies  // [{label, issue, suggestion}]
 */

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

function getWeekday(year, month, day) {
  return new Date(year, month - 1, day).getDay(); // 0=일
}

function dateStr(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * 날짜 레이블 하나에서 날짜 배열 + 요일 배열 추출
 * 지원 패턴:
 *   '5/20'           → ['2026-05-20']
 *   '5/20 수'        → ['2026-05-20'], dow 검증
 *   '5/20, 5/21'     → ['2026-05-20', '2026-05-21']
 *   '5/27, 5/28 수목' → 각 날짜, 요일 검증
 *   '7/16-7/22 수목금' → 7/16~7/22 중 수/목/금 해당하는 날짜만
 *   '7/15, 7/16 수목'  → 명시 날짜 × 요일 대조
 *   '8/13, 8/14'       → 단순 날짜 목록
 */
function parseDateLabel(label, year) {
  const dates = [];
  const anomalies = [];

  label = label.trim();

  // 요일 토큰 분리 (뒤에 붙은 "수목" "토일월화" 등)
  const dowMatch = label.match(/[일월화수목금토]+$/);
  const dowStr = dowMatch ? dowMatch[0] : '';
  const datePart = dowStr ? label.slice(0, -dowStr.length).trim() : label;
  const expectedDows = dowStr ? [...dowStr].map(c => WEEKDAY_KO.indexOf(c)) : null;

  // 날짜 범위 패턴: M/D-M/D
  const rangeMatch = datePart.match(/^(\d{1,2})\/(\d{1,2})\s*[-~]\s*(\d{1,2})\/(\d{1,2})$/);
  if (rangeMatch) {
    const [, m1, d1, m2, d2] = rangeMatch.map(Number);
    const start = new Date(year, m1 - 1, d1);
    const end = new Date(year, m2 - 1, d2);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (!expectedDows || expectedDows.includes(dow)) {
        dates.push(dateStr(year, d.getMonth() + 1, d.getDate()));
      }
    }
    if (dates.length === 0) {
      anomalies.push({ label, issue: '날짜 범위에서 조건에 맞는 날짜 없음', suggestion: '요일 조건 확인' });
    }
    return { dates, anomalies };
  }

  // 복수 날짜 패턴: M/D, M/D, ... 또는 M/D,D,D (같은 월 다중 일)
  const found = [];
  // 먼저 M/D 기준점 찾기
  const anchorPattern = /(\d{1,2})\/(\d{1,2})/g;
  let m;
  let lastMonth = null;
  let lastMatchEnd = 0;
  const anchors = [];
  while ((m = anchorPattern.exec(datePart)) !== null) {
    anchors.push({ month: Number(m[1]), day: Number(m[2]), end: m.index + m[0].length });
    lastMonth = Number(m[1]);
    lastMatchEnd = m.index + m[0].length;
  }
  if (anchors.length === 0) {
    anomalies.push({ label, issue: '날짜 파싱 실패', suggestion: '원문 레이블 확인' });
    return { dates, anomalies };
  }
  for (const anchor of anchors) {
    found.push({ month: anchor.month, day: anchor.day });
  }
  // 마지막 anchor 이후 ",N" 패턴으로 추가 일자 수집 (같은 월)
  const lastAnchor = anchors[anchors.length - 1];
  const tail = datePart.slice(lastAnchor.end);
  const extraDayPattern = /[,\s]+(\d{1,2})/g;
  while ((m = extraDayPattern.exec(tail)) !== null) {
    found.push({ month: lastAnchor.month, day: Number(m[1]) });
  }

  if (found.length === 0) {
    anomalies.push({ label, issue: '날짜 파싱 실패', suggestion: '원문 레이블 확인' });
    return { dates, anomalies };
  }

  // 전체 날짜 중 DOW 불일치 그룹 분리 (동일 원문 월 기준)
  const mismatchGroups = {};
  const matchOk = [];
  for (const { month, day } of found) {
    const actualDow = getWeekday(year, month, day);
    if (expectedDows && expectedDows.length > 0 && !expectedDows.includes(actualDow)) {
      if (!mismatchGroups[month]) mismatchGroups[month] = [];
      mismatchGroups[month].push(day);
    } else {
      matchOk.push({ month, day });
    }
  }

  // 정상 날짜 추가
  for (const { month, day } of matchOk) {
    dates.push(dateStr(year, month, day));
  }

  // 불일치 그룹: 원문 월별로 "어느 대체 월이 가장 많이 맞는가" 투표
  for (const [origMonthStr, days] of Object.entries(mismatchGroups)) {
    const origMonth = Number(origMonthStr);
    const origDowStr = WEEKDAY_KO[getWeekday(year, origMonth, days[0])];

    // 각 후보 월에 대해 days 중 몇 개가 expectedDows 에 맞는지 점수 산출
    const scores = {};
    for (let cm = 1; cm <= 12; cm++) {
      if (cm === origMonth) continue;
      scores[cm] = days.filter(d => expectedDows.includes(getWeekday(year, cm, d))).length;
    }
    const bestMonth = Object.keys(scores)
      .map(Number)
      .sort((a, b) => scores[b] - scores[a] || Math.abs(a - origMonth) - Math.abs(b - origMonth))[0];

    const bestScore = scores[bestMonth];
    const bestDow = WEEKDAY_KO[getWeekday(year, bestMonth, days[0])];

    anomalies.push({
      label,
      issue: `${origMonth}월 ${days.join(',')}일 요일 불일치 (${origMonth}월은 [${origDowStr}]요일인데 표기=[${dowStr}])`,
      suggestion: `→ ${bestMonth}월로 교정 권장 (${days.length}일 중 ${bestScore}일 일치)`,
      autoCorrect: days.map(d => dateStr(year, bestMonth, d)),
    });

    for (const day of days) {
      dates.push(dateStr(year, bestMonth, day));
    }
  }

  return { dates, anomalies };
}

/**
 * 날짜 중복 해결:
 * - 명시 단일 날짜(isSingle=true) 가 범위 날짜(isSingle=false) 보다 우선
 * - 동일 priority 간 충돌 시 첫 번째 등록 유지
 */
function resolveOverlaps(rows) {
  const dateMap = new Map(); // date → { prices, priority, label }
  const overlaps = [];

  for (const row of rows) {
    const date = row.date;
    if (dateMap.has(date)) {
      const existing = dateMap.get(date);
      if (row.priority > existing.priority) {
        overlaps.push({ date, kept: row.label, dropped: existing.label });
        dateMap.set(date, row);
      } else {
        overlaps.push({ date, kept: existing.label, dropped: row.label });
      }
    } else {
      dateMap.set(date, row);
    }
  }

  return { dateMap, overlaps };
}

/**
 * parsePriceRows(rawRows, options) → { rows, anomalies, overlaps }
 *
 * rawRows: [
 *   { label: '5/20 수',           prices: [819, 959, ...] },
 *   { label: '7/16-7/22 수목금',  prices: [1069, ...] },
 *   ...
 * ]
 *
 * options:
 *   year:       number (기본: 올해)
 *   priceUnit:  number (기본: 1000 — 천원 단위면 1000 곱함)
 *
 * 반환:
 *   rows:      [{date:'YYYY-MM-DD', prices:[n...]}, ...]  — 중복 해결 완료
 *   anomalies: [{label, issue, suggestion, autoCorrect?}]
 *   overlaps:  [{date, kept, dropped}]
 */
function parsePriceRows(rawRows, options = {}) {
  const year = options.year || new Date().getFullYear();
  const priceUnit = options.priceUnit || 1000;
  const allAnomalies = [];
  const priceRowsWithDates = [];

  for (const raw of rawRows) {
    const { dates, anomalies } = parseDateLabel(raw.label, year);
    allAnomalies.push(...anomalies);

    // 단일 날짜(priority=2) vs 범위(priority=1) 로 우선순위 구분
    const isRange = /[-~]/.test(raw.label) && !/,/.test(raw.label.split(/[-~]/)[0]);
    const priority = isRange ? 1 : 2;

    const scaledPrices = raw.prices.map(p => (p != null ? p * priceUnit : null));

    for (const date of dates) {
      priceRowsWithDates.push({ date, prices: scaledPrices, label: raw.label, priority });
    }
  }

  // 날짜 중복 해결
  const { dateMap, overlaps } = resolveOverlaps(priceRowsWithDates);

  const rows = [...dateMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, prices }) => ({ date, prices }));

  return { rows, anomalies: allAnomalies, overlaps };
}

module.exports = { parsePriceRows, parseDateLabel };
