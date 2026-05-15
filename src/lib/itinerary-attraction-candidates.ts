const NON_ATTRACTION_PREFIX =
  /^(호텔|리조트)?\s*(조식|중식|석식|투숙|체크|휴식|이동|출발|도착|귀환|수속|공항|탑승|기내|자유시간|가이드|미팅)/;

/**
 * ERR-XIY-inline-transit@2026-05-16: 라인 시작이 아니어도 "이동/귀환/도착" 등 trailing 키워드가 있으면
 *   attraction 라인이 아닌 transit 라인으로 분류. ("임동현으로 이동", "서안으로 귀환" 등)
 *   단, "○○사로 가는 길에 ○○ 관광" 같이 attraction 명도 포함된 라인은 별도 split 분기에서 다시 처리되므로 손실 0.
 */
const NON_ATTRACTION_INLINE =
  /(?:으로|로)\s*(?:이동|귀환|출발|도착|향발)(?:\s|$)|(?:^|\s)(?:체크\s*[인아]웃?|투숙|항공\s*탑승|기내\s*식)/;

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
  // ERR-XIY-activity-combo@2026-05-16: 활동성 결합어 차단 (계림 "발마사지" 박힘 사고)
  '발마사지', '전신마사지', '발+전신마사지', '전신+발마사지',
  '일일투어', '1일투어', '2일투어', '반일투어', '한나절투어', '반나절투어',
  '시티투어', '근교투어', '시내관광', '근교관광', '전일투어',
  // 식사·교통 일반어
  '식사', '간식', '디저트', '음료', '버스', '기차', '택시',
  // 호텔·숙박 일반어
  '호텔', '리조트', '풀빌라', '게스트하우스',
]);

/**
 * 서술형 어미 차단 (ERR-XIY-descriptive@2026-05-16).
 * "양귀비와 당현종의 로맨스장소인 화청지" / "흙으로 구워 만든 병사" 같은
 *  설명 라인 통째로 attraction 으로 박히던 사고 영구 차단.
 *  핵심: attraction 명은 어미가 없는 명사(구). 어미가 있으면 verbatim 의심.
 */
const DESCRIPTIVE_VERBATIM_RE =
  /(구워|만든|만들어진|되는|되어|있는|있던|불리는|불리던|보관한|보관된|가져온|즐비한|어우러진|위치한|이루어진|장식한|일컫는|꼽히는|유명한|이름난|장소인|묘지인|모형갱도인|역사탐방|역사를|전통을|문화를|풍경을|모습을|아름다움|일출|일몰|중의\s*하나|풀어주는|풀어주|풀어준|달래주는|달래주|느낄\s*수|볼\s*수|만날\s*수|즐길\s*수|엿볼\s*수|가장\s|최초의|완전한|최고의|최대의|놀라운|훌륭한|중\s*가장)/;

/** 괄호 안 내용도 별도 후보로 뽑아내기 위해 보존했다가 분리한다. (2026-05-15) */
function extractBracketAliases(text: string): string[] {
  const out: string[] = [];
  const re = /[\(\[]([^)\]]{2,40})[\)\]]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1].trim();
    if (inner.length < 2) continue;
    if (!/[가-힣A-Za-z]/.test(inner)) continue;
    // ERR-XIY-bracket-duration@2026-05-16: 괄호 안이 "90분", "2시간", "약3km" 같은 단위 정보면 alias 후보 아님
    //   확장: "2시간30분소요", "약 40분 소요", "1시간30분 비행" 패턴
    if (/^\s*약?\s*\d+\s*(?:분|시간|일|박|개월|주|km|m|m²|cm|위|성|성급|명|kg|g|h)\s*$/.test(inner)) continue;
    if (/^\s*약?\s*\d+\s*시간\s*\d+\s*분?\s*(?:소요|비행|이동|운행)?\s*$/.test(inner)) continue;
    if (/^\s*약?\s*\d+\s*(?:분|시간|일)\s*(?:소요|비행|이동|운행)\s*$/.test(inner)) continue;
    out.push(inner);
  }
  return out;
}

function cleanToken(token: string): string {
  return token
    .replace(/^[▶•\-\s]+/, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/(?:으로|로)\s*이동$/g, '')
    // ERR-XIY-trailing-activity@2026-05-16: 활동성 어미 trailing 제거 확장
    // "화청지 1일투어" → "화청지" / "병마용 한나절투어" → "병마용" / "발+전신 마사지(90분) 체험" → "발+전신"
    .replace(/\s*\d+\s*박\s*\d+\s*일\s*투어\s*$/g, '')
    .replace(/\s*\d+\s*일\s*투어\s*$/g, '')
    .replace(/\s*(?:반나절|한나절|반일|전일|일일|시티|근교|로컬|당일)\s*투어\s*$/g, '')
    .replace(/(?:관광|방문|투어|체험|관람|입장|마사지|일정|견학|이용|감상)\s*$/g, '')
    // ERR-XIY-trailing-include@2026-05-16: "케이블카 왕복포함" 같은 운영 메모성 어미 제거
    .replace(/\s*(?:왕복|편도|왕복\s*포함|편도\s*포함|포함|선택)\s*$/g, '')
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
    // ERR-XIY-stopword-space@2026-05-16: 공백 무시 매칭 ("전신 마사지" ↔ "전신마사지")
    const tNoSpace = t.replace(/\s+/g, '');
    if (STANDALONE_STOP_WORDS.has(t) || STANDALONE_STOP_WORDS.has(tNoSpace)) return;
    // 추가: 너무 짧은 한 단어 (≤3자) + stop word 패턴 매치
    if (t.length <= 3 && /^(시|산|섬|강|길|역|점|관)$/.test(t)) return;
    // ERR-XIY-verbatim-extract@2026-05-16: 추출 단계에도 시드 단계와 동일 정책 적용 (이중 가드).
    //   "양귀비와 당현종의 로맨스장소인 화청지" 같은 라인이 후보로 넘어가 매칭 단계에서 오작동하던 사고 차단.
    //   25자↑ verbatim 의심 후보는 다른 분리 결과(콤마/+/공백)로 들어온 짧은 토큰이 흡수하므로 손실 없음.
    if (t.length > 25) return;
    if (DESCRIPTIVE_VERBATIM_RE.test(t)) return;
    // 공백 가드: 4개+ 만 차단 (도멘 드 마리 성당 = 공백 3개, 정상 attraction 보존).
    if ((t.match(/\s/g) ?? []).length >= 4) return;
    const key = t.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  for (const line of lines) {
    if (NON_ATTRACTION_PREFIX.test(line)) continue;
    if (NON_ATTRACTION_INLINE.test(line)) continue;
    for (const inner of extractBracketAliases(line)) push(inner);
    const noBullet = line.replace(/^[▶•\-\s]+/, '').trim();
    // 한국어 패키지 일정 표현 보강 (2026-05-15): "X 후 Y", "X 거쳐 Y", "X → Y", "X 들러 Y" 도 분리.
    // " 이동/도착/관광 " 자체는 후처리 cleanToken 의 trailing 제거로 흡수.
    // ERR-XIY-plus-split@2026-05-16: "서안성벽+함광문유적지박물관" 같은 + 결합 라인 분리 추가.
    //   원문 verbatim 한 줄 시드되어 DB 오염되는 사고 영구 차단.
    const parts = noBullet.split(/\s*(?:,|，|\/|·|및|와|&|\+|→|⇒|\sㅡ\s|\s후\s|\s이후\s|\s거쳐\s|\s들러\s)\s*/);
    for (const p of parts) push(p);
  }

  return out;
}
