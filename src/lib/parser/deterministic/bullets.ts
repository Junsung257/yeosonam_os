/**
 * @file deterministic/bullets.ts — ▶ 불릿 inclusions/excludes 결정적 추출 (2026-05-14 박제)
 *   부관훼리 케이스에서 LLM 이 inclusions 0건으로 깨졌는데, 원문에는
 *     ▶왕복훼리비, 부두세&유류세, 출국세, 관광지입장료, 가이드, 전용버스, 선내식1회, 여행자보험
 *   같이 ▶ 불릿이 명시되어 있음. 한국 여행사 카탈로그 표준이라 정규식 100%.
 *
 * 패턴:
 *   - "포함 사항" / "포함" / "✅ 포함" → inclusions 섹션
 *   - "불포함 사항" / "불포함" / "❌ 불포함" → excludes 섹션
 *   - 각 섹션 안의 ▶/●/•/-/+/○ 으로 시작하는 라인 → 개별 항목
 *   - 콤마로 이어붙인 한 줄도 분리 (▶왕복훼리비, 부두세&유류세, 가이드 → 3개)
 */

import { formatExcludeDisplayLabel, isMealDayExcludeLine, repairMealDayExcludeItems, shouldSplitAtComma } from './comma-split-safe';

const BULLET_PREFIX_RE = /^[▶●•·◆◇■□★☆+\-○•▪●◦]+\s*/;
const SECTION_INCLUDE_RE = /^[\s　]*(?:✅\s*)?(포함\s*사항|포함)\s*[:：]?\s*$/m;
const SECTION_EXCLUDE_RE = /^[\s　]*(?:❌\s*)?(불포함\s*사항|불포함|미포함)\s*[:：]?\s*$/m;
const SECTION_END_RE = /^[\s　]*(?:비\s*고|REMARK|특이\s*사항|쇼핑\s*센터|일\s*자|지\s*역|교통|상\s*세|취소|환불|발권|항공|호텔|예약\s*문의|선택\s*관광|특\s*전|구비|기타|문의|제\s*\d+\s*일|DAY\s*\d+|Day\s*\d+)/i;

/**
 * 한 줄을 콤마로 분리 — 단 괄호 안 콤마(예: "(1,099,000원)") 와 숫자 콤마(예: "159,000") 는 보존.
 */
function splitByCommaSafe(line: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '(' || c === '（' || c === '[' || c === '【') depth++;
    else if (c === ')' || c === '）' || c === ']' || c === '】') depth--;
    if ((c === ',' || c === '，') && depth <= 0) {
      if (!shouldSplitAtComma(line, i, depth)) {
        buf += c;
        continue;
      }
      const t = buf.trim();
      if (t) parts.push(t);
      buf = '';
    } else {
      buf += c;
    }
  }
  const last = buf.trim();
  if (last) parts.push(last);
  return parts;
}

function cleanItem(raw: string): string {
  return raw
    .replace(BULLET_PREFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ExtractedBullets {
  inclusions: string[];
  excludes: string[];
}

export function extractBullets(rawText: string): ExtractedBullets {
  if (!rawText) return { inclusions: [], excludes: [] };
  const lines = rawText.split(/\r?\n/);

  // 섹션 시작 인덱스 탐지
  const findSectionStart = (re: RegExp): number => {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) return i + 1;
    }
    return -1;
  };
  // 섹션 끝 인덱스 탐지 — 다른 섹션 헤더 발견 시
  const findSectionEnd = (start: number, others: RegExp[]): number => {
    for (let i = start; i < lines.length; i++) {
      const t = lines[i];
      if (SECTION_END_RE.test(t)) return i;
      for (const re of others) {
        if (re.test(t)) return i;
      }
    }
    return lines.length;
  };

  const collect = (start: number, end: number): string[] => {
    const items: string[] = [];
    let foundAnyBullet = false;
    for (let i = start; i < end; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (SECTION_END_RE.test(line)) break;
      const hasBullet = BULLET_PREFIX_RE.test(line);
      if (hasBullet) {
        foundAnyBullet = true;
        const body = line.replace(BULLET_PREFIX_RE, '');
        if (isMealDayExcludeLine(body)) {
          const c = cleanItem(body);
          if (c.length >= 2 && c.length <= 200) items.push(formatExcludeDisplayLabel(c));
          continue;
        }
        const subItems = splitByCommaSafe(body);
        for (const sub of subItems) {
          const c = cleanItem(sub);
          if (c.length >= 2 && c.length <= 200) items.push(c);
        }
      } else if (!foundAnyBullet && /^[\p{L}A-Za-z0-9]/u.test(line)) {
        const subItems = splitByCommaSafe(line);
        for (const sub of subItems) {
          const c = cleanItem(sub);
          if (c.length >= 2 && c.length <= 200) items.push(c);
        }
      } else if (foundAnyBullet && /^[가-힣A-Za-z0-9]/.test(line)) {
        if (SECTION_END_RE.test(line)) break;
        // 이전 항목의 연결줄 (들여쓰기) — 단 새 섹션 키워드면 stop
        const prev = items[items.length - 1];
        if (prev && prev.length + line.length < 200) {
          items[items.length - 1] = (prev + ' ' + line.replace(/\s+/g, ' ')).trim();
        }
      }
    }
    return items;
  };

  const incStart = findSectionStart(SECTION_INCLUDE_RE);
  const excStart = findSectionStart(SECTION_EXCLUDE_RE);

  const inclusions = incStart >= 0
    ? collect(incStart, findSectionEnd(incStart, [SECTION_EXCLUDE_RE]))
    : [];
  const excludes = excStart >= 0
    ? repairMealDayExcludeItems(collect(excStart, findSectionEnd(excStart, [SECTION_INCLUDE_RE])))
    : [];

  return { inclusions, excludes };
}
