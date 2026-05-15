const NON_ATTRACTION_PREFIX =
  /^(호텔|리조트)?\s*(조식|중식|석식|투숙|체크|휴식|이동|출발|도착|귀환|수속|공항|탑승|기내|자유시간|가이드|미팅)/;

/** 괄호 안 내용도 별도 후보로 뽑아내기 위해 보존했다가 분리한다. (2026-05-15) */
function extractBracketAliases(text: string): string[] {
  const out: string[] = [];
  const re = /[\(\[]([^)\]]{2,40})[\)\]]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1].trim();
    if (inner.length >= 2 && /[가-힣A-Za-z]/.test(inner)) out.push(inner);
  }
  return out;
}

function cleanToken(token: string): string {
  return token
    .replace(/^[▶•\-\s]+/, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/(?:으로|로)\s*이동$/g, '')
    .replace(/(?:관광|방문|투어|체험)\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * 일정 activity/note 원문에서 "관광지 후보 키워드"만 추출한다.
 * - 이동/식사/투숙류 라인은 제외
 * - "및, /, ,"로 묶인 복수 명소는 분리
 * - 괄호 안 내용도 별도 후보로 뽑음 ("린푸억사원(달랏 핑크 사원)" → ['린푸억사원','달랏 핑크 사원'])
 * - 길이 제한 30 → 60 (긴 정식 명칭 흡수, 예: "도멘 드 마리 성당")
 */
export function extractAttractionCandidates(activity: string, note?: string | null): string[] {
  const merged = [activity, note ?? '']
    .filter(Boolean)
    .join('\n')
    .replace(/\r\n/g, '\n');

  const lines = merged
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length >= 2);

  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const t = cleanToken(raw);
    if (t.length < 2 || t.length > 60) return;
    if (!/[가-힣A-Za-z]/.test(t)) return;
    const key = t.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  for (const line of lines) {
    if (NON_ATTRACTION_PREFIX.test(line)) continue;
    for (const inner of extractBracketAliases(line)) push(inner);
    const noBullet = line.replace(/^[▶•\-\s]+/, '').trim();
    const parts = noBullet.split(/\s*(?:,|，|\/|·|및|와|&)\s*/);
    for (const p of parts) push(p);
  }

  return out;
}
