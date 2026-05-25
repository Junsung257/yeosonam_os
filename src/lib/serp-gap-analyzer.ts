/**
 * SERP Competitor Gap Analyzer
 *
 * 경쟁사 상위 글의 주제 커버리지를 분석해 내 글에 부족한 하위주제를 자동 발견.
 *
 * TF-IDF 스타일:
 *  - 말뭉치(내 글 + 경쟁사 제목)에서 TF(단어 빈도) 계산
 *  - IDF(역문서 빈도)로 희귀 단어 가중치 부여
 *  - 내 글에 없는 고 IDF 단어 → 누락 주제
 */

export interface SerpGapResult {
  /** 내 글에 없지만 경쟁사가 공통으로 다루는 주제 */
  missingTopics: string[];
  /** 0~100 커버리지 점수 (높을수록 좋음) */
  coverageScore: number;
  /** 구체적인 보충 제안 */
  suggestions: string[];
}

/**
 * 간단한 한국어 불용어 목록
 */
const STOP_WORDS = new Set([
  '그', '이', '저', '것', '수', '등', '들', '및', '에서', '에게',
  '위해', '통해', '대한', '관한', '의', '에', '를', '을', '은', '는',
  '이', '가', '와', '과', '도', '만', '으로', '로', '처럼', '커녕',
  '보다', '하고', '안', '못', '더', '가장', '매우', '아주', '별로',
  '전혀', '좀', '잘', '이미', '벌써', '아직', '또', '다시', '계속',
  '항상', '늘', '가끔', '자주', '드물게', '대부분', '주로', '보통',
  '정말', '진짜', '너무', '무척', '제일', '최고', '최대', '최소',
  '함께', '같이', '따로', '직접', '간접', '각', '모든', '어떤',
  '무슨', '어느', '누구', '무엇', '언제', '어디', '왜', '어떻게',
  '이런', '그런', '저런', '어떤', '이것', '그것', '저것',
  '네', '예', '아니오', '응', '그래', '아', '어', '음',
  '대해', '대한', '통해', '통한', '의한', '의해',
  '때문', '때', '중', '안', '속', '밖', '쪽', '편',
  '분', '님', '씨', '군', '양',
]);

/**
 * H2 섹션 제목에서 추출한 주요 패턴 (가중치 부여)
 */
const SECTION_PATTERNS = new Set([
  '추천', '비교', '후기', '순위', '가격', '비용', '팁', '방법',
  '코스', '일정', '여행', '관광', '맛집', '숙소', '교통', '날씨',
  '준비물', '주의사항', '체크리스트', '장단점', '꿀팁', '가이드',
  '이용', '예약', '티켓', '입장', '시간', '영업', '운영',
  '할인', '이벤트', '프로모션', '패키지', '투어',
  '사진', '인증', '스팟', '명소', '액티비티', '체험',
  '쇼핑', '면세', '시장', '거리', '음식', '카페', '바',
  '야경', '전망', '일몰', '일출', '자연', '공원', '산책',
]);

/**
 * 텍스트를 토큰화: 한글/영문/숫자만 추출
 */
function tokenize(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')    // HTML 제거
    .replace(/[^가-힣a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.split(/\s+/).filter(Boolean);
}

/**
 * 불용어 제거
 */
function removeStopWords(tokens: string[]): string[] {
  return tokens.filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

/**
 * TF (Term Frequency) 계산 — 문서 내 단어 빈도
 */
function computeTf(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  // 정규화: 전체 토큰 수로 나눔
  const total = tokens.length || 1;
  for (const [k, v] of tf) {
    tf.set(k, v / total);
  }
  return tf;
}

/**
 * IDF (Inverse Document Frequency) 계산
 */
function computeIdf(documents: string[][]): Map<string, number> {
  const docCount = documents.length;
  const df = new Map<string, number>();

  for (const doc of documents) {
    const seen = new Set(doc);
    for (const t of seen) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [t, count] of df) {
    idf.set(t, Math.log((docCount + 1) / (count + 1)) + 1);
  }
  return idf;
}

/**
 * 경쟁사 제목에서 H2 스타일 주요 주제 추출
 */
function extractTopicsFromTitles(titles: string[]): string[] {
  const topics = new Set<string>();

  for (const title of titles) {
    const tokens = removeStopWords(tokenize(title));

    // 단일 토큰 (키워드)
    for (const t of tokens) {
      if (t.length >= 2 && !STOP_WORDS.has(t)) {
        topics.add(t);
      }
    }

    // 바이그램 패턴 (2-gram)
    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`;
      if (bigram.length >= 3) {
        topics.add(bigram);
      }
    }
  }

  return Array.from(topics);
}

/**
 * HTML 본문에서 H2 섹션 텍스트 추출
 */
function extractMyTopics(html: string): string[] {
  const topics = new Set<string>();

  // H2 태그 내용 추출
  const h2Matches = html.match(/<h2[^>]*>(.*?)<\/h2>/gi) || [];
  for (const h2 of h2Matches) {
    const text = h2.replace(/<[^>]+>/g, '');
    const tokens = removeStopWords(tokenize(text));
    for (const t of tokens) {
      if (t.length >= 2) topics.add(t);
    }
  }

  // 일반 본문 텍스트에서도 키워드 추출
  const bodyText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = removeStopWords(tokenize(bodyText));

  // 상위 빈도 단어만 토픽으로 추가 (내용 기반)
  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }

  // 3회 이상 등장 단어를 토픽으로
  for (const [t, count] of freq) {
    if (count >= 3 && SECTION_PATTERNS.has(t)) {
      topics.add(t);
    }
  }

  return Array.from(topics);
}

/**
 * SERP 갭 분석 실행
 *
 * @param keyword           - 메인 키워드
 * @param myHtml            - 내 블로그 HTML 본문
 * @param competitorTitles  - 경쟁사 상위 N개 글의 제목 목록
 * @returns SerpGapResult
 */
export function analyzeSerpGap(
  keyword: string,
  myHtml: string,
  competitorTitles: string[],
): SerpGapResult {
  // 1) 내 글 토픽 추출
  const myTopics = new Set(extractMyTopics(myHtml));

  // 2) 경쟁사 제목 토픽 추출
  const competitorTopics = extractTopicsFromTitles(competitorTitles);

  // 3) 말뭉치 구성 (TF-IDF용)
  const myTokens = removeStopWords(tokenize(myHtml));
  const competitorTokenSets = competitorTitles.map(t => removeStopWords(tokenize(t)));
  const allDocuments = [myTokens, ...competitorTokenSets];
  const idfMap = computeIdf(allDocuments);

  // 4) 내 글에 없는 경쟁사 토픽 = 갭
  const missingTopics = new Map<string, number>();

  for (const topic of competitorTopics) {
    if (myTopics.has(topic)) continue;

    // 키워드 자체가 내 글에 등장하는지도 확인
    const topicTokens = tokenize(topic);
    const appearsInMyText = topicTokens.some(t => myTokens.includes(t));
    if (appearsInMyText) continue;

    // IDF 가중치 부여 (희귀할수록 중요한 주제)
    let weight = 0;
    for (const t of topicTokens) {
      weight += idfMap.get(t) ?? 1;
    }
    // SECTION_PATTERNS 가중치 추가
    if (topicTokens.some(t => SECTION_PATTERNS.has(t))) {
      weight *= 1.5;
    }

    missingTopics.set(topic, weight);
  }

  // 점수 계산 (많고 높은 가중치의 missingTopics 가 많으면 낮은 점수)
  const sortedMissing = Array.from(missingTopics.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // 커버리지 점수: 0~100
  // missingTopics 가 없으면 100, 많을수록 감소
  const coverageScore = Math.max(
    0,
    Math.min(100, Math.round(100 - sortedMissing.reduce((a, [, w]) => a + w, 0) * 5)),
  );

  // 구체적인 제안 생성
  const suggestions: string[] = [];
  for (const [topic] of sortedMissing) {
    if (competitorTitles.some(t => t.toLowerCase().includes(topic))) {
      suggestions.push(
        `경쟁사 글에서 "${topic}" 주제를 다루고 있습니다. 관련 섹션(H2)을 추가하거나 내용을 보강하세요.`,
      );
    }
  }

  return {
    missingTopics: sortedMissing.map(([t]) => t),
    coverageScore,
    suggestions,
  };
}
