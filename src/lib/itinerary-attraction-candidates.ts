const NON_ATTRACTION_PREFIX =
  /^(호텔|리조트)?\s*(조식|중식|석식|투숙|체크|휴식|이동|출발|도착|귀환|수속|공항|탑승|기내|자유시간|가이드|미팅)/;

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
 * - 결과는 중복 제거된 짧은 라벨 목록
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

  for (const line of lines) {
    if (NON_ATTRACTION_PREFIX.test(line)) continue;
    const noBullet = line.replace(/^[▶•\-\s]+/, '').trim();
    const parts = noBullet.split(/\s*(?:,|，|\/|·|및|와|&)\s*/);
    for (const p of parts) {
      const t = cleanToken(p);
      if (t.length < 2 || t.length > 30) continue;
      if (!/[가-힣A-Za-z]/.test(t)) continue;
      const key = t.toLowerCase().replace(/\s+/g, '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }

  return out;
}
