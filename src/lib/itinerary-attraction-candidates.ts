const NON_ATTRACTION_PREFIX =
  /^(호텔|리조트)?\s*(조식|중식|석식|투숙|체크|휴식|이동|출발|도착|귀환|수속|공항|탑승|기내|자유시간|가이드|미팅)/;

/**
 * 일반어 단독 차단 (2026-05-15 ERR-KWL-맛집 박제).
 * "맛집/카페/옷가게가 즐비한 계림의 명동 동서항(옛거리)" 같은 라인에서 split 결과
 * "맛집", "카페", "옷가게" 단독이 attraction 후보로 등록되던 사고 영구 차단.
 * Set 멤버는 정확 일치 (length 정상 + 의미 빈약 한 단어). matcher 의 MATCH_STOP_WORDS 와 중복 허용.
 */
const STANDALONE_STOP_WORDS = new Set<string>([
  // 일반 시설·장소
  '맛집', '카페', '옷가게', '명동', '시내', '시장', '거리', '옛거리',
  '면세점', '쇼핑센터', '쇼핑몰', '백화점',
  // 일반 자연·건물 카테고리 (단독)
  '산', '바다', '강', '호수', '폭포', '동굴', '섬', '해변', '계곡',
  '공원', '광장', '사원', '성당', '교회', '박물관', '궁전', '탑',
  '전망대', '분수', '정원', '다리',
  // 활동 일반어
  '관광', '방문', '투어', '체험', '입장', '관람', '탐방',
  '마사지', '쇼', '공연', '온천', '수영', '다이빙',
  // 식사·교통 일반어
  '식사', '간식', '디저트', '음료', '버스', '기차', '택시',
  // 호텔·숙박 일반어
  '호텔', '리조트', '풀빌라', '게스트하우스',
]);

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
    // F1 박제 (2026-05-15): 일반어 단독 차단 — "맛집"/"시장"/"명동" 등이 attraction 으로 시드되던 사고
    if (STANDALONE_STOP_WORDS.has(t)) return;
    // 추가: 너무 짧은 한 단어 (≤3자) + stop word 패턴 매치
    if (t.length <= 3 && /^(시|산|섬|강|길|역|점|관)$/.test(t)) return;
    const key = t.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  for (const line of lines) {
    if (NON_ATTRACTION_PREFIX.test(line)) continue;
    for (const inner of extractBracketAliases(line)) push(inner);
    const noBullet = line.replace(/^[▶•\-\s]+/, '').trim();
    // 한국어 패키지 일정 표현 보강 (2026-05-15): "X 후 Y", "X 거쳐 Y", "X → Y", "X 들러 Y" 도 분리.
    // " 이동/도착/관광 " 자체는 후처리 cleanToken 의 trailing 제거로 흡수.
    const parts = noBullet.split(/\s*(?:,|，|\/|·|및|와|&|→|⇒|\sㅡ\s|\s후\s|\s이후\s|\s거쳐\s|\s들러\s)\s*/);
    for (const p of parts) push(p);
  }

  return out;
}
