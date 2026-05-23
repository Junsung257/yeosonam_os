/**
 * 콤마 분리 시 보호해야 할 패턴 (천단위 숫자, 일차 나열 "3,4일차" 등).
 * flattenItems · splitByCommaSafe · backfill 감지가 동일 규칙을 공유한다.
 */

/** 불포함 줄에 일차·식사 표기가 섞여 있으면 한 줄로 유지 */
export function isMealDayExcludeLine(text: string): boolean {
  return /\d+\s*일차/.test(text) || /\d+\s*,\s*\d+\s*일차/.test(text);
}

/** 괄호 밖 콤마에서 "여기서 잘라도 되는가?" — false 면 붙여서 유지 */
export function shouldSplitAtComma(text: string, commaIndex: number, parenDepth = 0): boolean {
  if (parenDepth > 0) return false;
  if (isMealDayExcludeLine(text)) return false;
  const prev = text[commaIndex - 1];
  if (prev === undefined || !/\d/.test(prev)) return true;
  const after = text.slice(commaIndex + 1);
  // 천단위: 2,000 / 1,500원
  if (/^\d{3}/.test(after)) return false;
  // 일차·식사 나열: 3,4일차중식 / 3,4일차
  if (/^\s*\d/.test(after)) return false;
  return true;
}

/** 불포함 식사·일차 표기 — 고객용 가독 (ERR-BOH-meal-days) */
export function formatExcludeDisplayLabel(raw: string): string {
  const s = raw.trim();
  if (!s || !/일차/.test(s)) return s;

  let out = s;
  out = out.replace(/(\d+)\s*,\s*(\d+)\s*일차/g, '$1·$2일차');
  out = out.replace(/(\d+(?:·\d+)?)\s*일차([^\s,])/g, '$1일차 $2');
  out = out.replace(/,(?=\S)/g, ', ');
  return out.replace(/\s+/g, ' ').trim();
}

const MEAL_ONLY_RE = /^(?:중식|석식|조식)$/;

/** LLM·콤마 split 으로 깨진 ["3","4일차중식","석식"] → 한 줄 복원 */
export function repairMealDayExcludeItems(items: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    let cur = items[i].trim();
    if (!cur) continue;

    if (/^\d{1,2}$/.test(cur) && i + 1 < items.length && /^\d+일차/.test(items[i + 1].trim())) {
      cur = `${cur},${items[i + 1].trim()}`;
      i++;
    }

    if (MEAL_ONLY_RE.test(cur) && out.length > 0 && isMealDayExcludeLine(out[out.length - 1])) {
      out[out.length - 1] = formatExcludeDisplayLabel(`${out[out.length - 1]},${cur}`);
      continue;
    }

    out.push(isMealDayExcludeLine(cur) ? formatExcludeDisplayLabel(cur) : cur);
  }
  return out;
}
