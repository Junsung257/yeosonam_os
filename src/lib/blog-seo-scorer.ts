/**
 * Blog SEO Score Engine — 발행 전 SEO 점수 측정기
 *
 * Google / Naver 상위 노출을 위해 글의 SEO 최적화 정도를 0~100 점수로 정량화.
 * 모든 글은 발행 전 이 엔진을 통과하며, score < 45 (info) / 35 (product) 면 발행 보류.
 *
 * 평가 항목 (가중치 합 110):
 *   - 제목 SEO      (15) — 길이·power word·연도·키워드 포함
 *   - 메타 설명      (10) — 존재·길이·키워드 포함
 *   - H1-H2 구조     (10) — H1 정확성·H2 다양성·키워드 분포
 *   - 키워드 밀도    (10) — 1.5~3.0% 적정 범위
 *   - LSI 키워드 밀도 (10) — secondaryKeywords 각각 0.5%~2.0% 최적
 *   - LSI 커버리지   (12) — 관련 LSI 키워드 본문 내 등장 수
 *   - 이미지 SEO      (8) — alt 텍스트 존재·파일명 최적화
 *   - 내부 링크      (8)  — 내부 링크 수·관련 글 연결
 *   - 가독성         (10) — 문장 길이·문단 길이·한글 비율
 *   - JSON-LD       (10)  — 필수 스키마 존재 여부
 *   - EEAT 시그널    (7)  — AI 디스클로저·리뷰 인용·편집자 문장
 *   - 모바일 최적화   (5)  — 반응형·이미지 최적화
 *   - URL slug       (5)  — slug 구조·키워드 포함
 *
 * Reference: Backlinko (2M SERP 분석), Google Quality Rater Guidelines, 
 *           Semantic SEO (Bill Slawski), Brian Dean's SEO checklist
 */

const LSI_DICTIONARY: Record<string, string[]> = {
  destination: ['여행', '목적지', '방문', '도착', '출발', '일정'],
  transport: ['비행기', '항공권', '기차', '버스', '렌터카', '픽업', '교통', '이동'],
  accommodation: ['숙소', '호텔', '리조트', '게스트하우스', '민박', '투숙'],
  food: ['맛집', '식사', '음식', '레스토랑', '현지음식', '먹거리', '요리'],
  weather: ['날씨', '기온', '계절', '우기', '건기', '장마', '일기예보'],
  currency: ['환전', '환율', '달러', '엔화', '동', '바트', '화폐', '현지화폐'],
  document: ['비자', '여권', '입국', '면세', '세관', '무비자'],
  tip: ['팁', '챙길', '준비물', '필수', '꿀팁', '주의', '유의'],
  communication: ['통신', '와이파이', '유심', 'esim', '로밍', '인터넷', '언어'],
  cost: ['가격', '비용', '예산', '경비', '요금', '할인', '특가', '가성비'],
};

export interface SeoScoreResult {
  score: number;
  maxScore: number;
  passed: boolean;
  details: SeoScoreDetail[];
  summary: string;
  checkedAt: string;
}

interface SeoScoreDetail {
  name: string;
  score: number;
  maxScore: number;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export interface ScorerInput {
  blogHtml: string;
  slug: string;
  seoTitle?: string;
  seoDescription?: string;
  primaryKeyword?: string | null;
  /** LSI 보조 키워드 배열 (밀도 검증용) */
  secondaryKeywords?: string[];
  destination?: string | null;
  blogType: 'product' | 'info';
  imageCount?: number;
  imagesWithAlt?: number;
  hasJsonLd?: {
    blogPosting?: boolean;
    faqPage?: boolean;
    howTo?: boolean;
    breadcrumbList?: boolean;
  };
}

const MAX_SCORE = 125;

function extractPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/[#*_`>\[\]()\-:|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreTitle(input: ScorerInput, keyword: string, dest: string): SeoScoreDetail {
  let score = 0;
  const title = input.seoTitle || '';
  const msgs: string[] = [];
  if (title.length >= 25 && title.length <= 60) {
    score += 6;
    msgs.push(`제목 길이 ${title.length}자 (양호)`);
  } else if (title.length > 0) {
    score += 3;
    msgs.push(`제목 길이 ${title.length}자 (25~60자 권장)`);
  }
  if (keyword && title.includes(keyword)) { score += 4; msgs.push('주요 키워드 포함'); }
  if (dest && dest !== keyword && title.includes(dest)) { score += 2; msgs.push('목적지명 포함'); }
  if (/2025|2026|2027/.test(title)) { score += 3; msgs.push('연도 포함'); }
  return {
    name: '제목 SEO', score: Math.min(score, 15), maxScore: 15,
    status: score >= 10 ? 'pass' : score >= 5 ? 'warn' : 'fail',
    message: msgs.join(', ') || '제목 없음',
  };
}

function scoreMeta(input: ScorerInput, keyword: string): SeoScoreDetail {
  let score = 0;
  const desc = input.seoDescription || '';
  const msgs: string[] = [];
  if (desc.length >= 50 && desc.length <= 160) { score += 5; msgs.push(`설명 ${desc.length}자 (양호)`); }
  else if (desc.length > 0) { score += 2; msgs.push(`설명 ${desc.length}자 (50~160자 권장)`); }
  else { msgs.push('메타 설명 없음'); }
  if (keyword && desc.includes(keyword)) { score += 3; msgs.push('키워드 포함'); }
  if (desc.length > 0 && desc.length < 50) { score -= 1; }
  return {
    name: '메타 설명', score: Math.max(0, Math.min(score, 10)), maxScore: 10,
    status: score >= 6 ? 'pass' : score >= 3 ? 'warn' : 'fail',
    message: msgs.join(', '),
  };
}

function scoreHeadings(html: string, keyword: string, dest: string): SeoScoreDetail {
  let score = 0;
  const h1 = html.match(/^#\s+.+$/gm) || [];
  const h2 = html.match(/^##\s+.+$/gm) || [];
  const msgs: string[] = [];
  if (h1.length === 1) { score += 3; msgs.push('H1 1개 (양호)'); }
  else { msgs.push(`H1 ${h1.length}개 (1개 권장)`); }
  if (h2.length >= 3) { score += 3; msgs.push(`H2 ${h2.length}개`); }
  else { msgs.push(`H2 ${h2.length}개 (3개 이상 권장)`); }
  if (keyword) {
    const kw = [...(h1 || []), ...(h2 || [])].filter(h => h.includes(keyword)).length;
    if (kw >= 1) { score += 2; msgs.push('키워드 헤딩 포함'); }
  }
  if (dest && dest !== keyword) {
    const dh = [...(h1 || []), ...(h2 || [])].filter(h => h.includes(dest)).length;
    if (dh >= 1) { score += 2; msgs.push('목적지 헤딩 포함'); }
  }
  return {
    name: 'H1-H2 구조', score: Math.min(score, 10), maxScore: 10,
    status: score >= 7 ? 'pass' : score >= 4 ? 'warn' : 'fail',
    message: msgs.join(', '),
  };
}

function scoreKeywordDensity(plainText: string, keyword: string, blogType: string): SeoScoreDetail {
  let score = 0;
  const msgs: string[] = [];
  if (keyword && plainText.length > 0) {
    const kwCount = plainText.split(keyword).length - 1;
    const density = (kwCount / plainText.length) * 100;
    const targetMax = blogType === 'product' ? 3.0 : 2.0;
    if (density >= 0.5 && density <= targetMax) { score += 10; msgs.push(`밀도 ${density.toFixed(2)}% (적정)`); }
    else if (density > 0 && density < 0.5) { score += 5; msgs.push(`밀도 ${density.toFixed(2)}% (낮음)`); }
    else { score += 2; msgs.push(`밀도 ${density.toFixed(2)}% (스터핑 위험)`); }
  } else { msgs.push('키워드 미지정'); }
  return {
    name: '키워드 밀도', score, maxScore: 10,
    status: score >= 8 ? 'pass' : score >= 4 ? 'warn' : 'fail',
    message: msgs.join(', '),
  };
}

/** LSI 키워드 밀도 검증 — 각 secondaryKeywords의 밀도를 측정하고 스터핑 경고 */
function scoreLsiKeywordDensity(plainText: string, secondaryKeywords?: string[]): SeoScoreDetail {
  let score = 0;
  const msgs: string[] = [];
  if (!secondaryKeywords || secondaryKeywords.length === 0) {
    return { name: 'LSI 키워드 밀도', score: 0, maxScore: 10, status: 'warn', message: 'LSI 키워드 미지정' };
  }
  let optimalCount = 0;
  let stuffingCount = 0;
  const stuffingKeywords: string[] = [];
  for (const kw of secondaryKeywords) {
    if (!kw || plainText.length === 0) continue;
    const count = plainText.split(kw).length - 1;
    const density = (count / plainText.length) * 100;
    if (density >= 0.5 && density <= 2.0) {
      optimalCount++;
    } else if (density > 2.0) {
      stuffingCount++;
      stuffingKeywords.push(kw);
    }
  }
  // 점수: LSI 키워드 중 최적 범위 비율에 따라 0~10점
  const total = secondaryKeywords.length;
  const optimalRatio = optimalCount / total;
  if (optimalRatio >= 0.7) { score = 10; msgs.push(`LSI ${optimalCount}/${total} 최적 범위`); }
  else if (optimalRatio >= 0.4) { score = 6; msgs.push(`LSI ${optimalCount}/${total} 최적 (${total - optimalCount}개 조정 필요)`); }
  else { score = 2; msgs.push(`LSI ${optimalCount}/${total} 최적 — 추가 권장`); }
  if (stuffingCount > 0) {
    score = Math.max(0, score - stuffingCount * 3);
    msgs.push(`${stuffingCount}개 스터핑 (${stuffingKeywords.slice(0, 3).join(', ')})`);
  }
  return {
    name: 'LSI 키워드 밀도', score, maxScore: 10,
    status: score >= 7 ? 'pass' : score >= 3 ? 'warn' : 'fail',
    message: msgs.join(', '),
  };
}

function scoreLsiCoverage(plainText: string): SeoScoreDetail {
  let score = 0;
  const msgs: string[] = [];
  const matched: string[] = [];
  for (const [cat, words] of Object.entries(LSI_DICTIONARY)) {
    const hits = words.filter(w => plainText.includes(w));
    if (hits.length >= 2) { matched.push(cat); score += 2; }
  }
  score = Math.min(score, 12);
  if (score >= 8) { msgs.push(`LSI ${matched.length}개 카테고리 (${matched.join(', ')})`); }
  else if (score >= 4) { msgs.push(`LSI ${matched.length}개 카테고리 — 추가 권장`); }
  else { msgs.push('LSI 키워드 부족 (4개 카테고리 이상 권장)'); }
  return {
    name: 'LSI 커버리지', score, maxScore: 12,
    status: score >= 8 ? 'pass' : score >= 4 ? 'warn' : 'fail',
    message: msgs.join(', '),
  };
}

function scoreImageSeo(input: ScorerInput, dest: string): SeoScoreDetail {
  let score = 0;
  const msgs: string[] = [];
  const imgCount = input.imageCount ?? 0;
  const altCount = input.imagesWithAlt ?? 0;
  if (imgCount >= 2) { score += 2; msgs.push(`이미지 ${imgCount}개`); }
  else if (imgCount >= 1) { score += 1; msgs.push(`이미지 ${imgCount}개 (2개 이상 권장)`); }
  else { msgs.push('이미지 없음'); }
  if (altCount > 0) {
    const altRatio = altCount / Math.max(imgCount, 1);
    if (altRatio >= 0.8) { score += 4; msgs.push(`alt ${altCount}/${imgCount} (${Math.round(altRatio * 100)}%)`); }
    else { score += 2; msgs.push(`alt ${altCount}/${imgCount} (누락 있음)`); }
  } else if (imgCount > 0) { msgs.push('alt 태그 없음'); }
  if (dest) {
    const altTexts = input.blogHtml.match(/\[([^\]]*)\]/g)?.join(' ') || '';
    if (altTexts.includes(dest)) { score += 2; msgs.push('alt에 목적지명 포함'); }
  }
  return {
    name: '이미지 SEO', score: Math.min(score, 8), maxScore: 8,
    status: score >= 5 ? 'pass' : score >= 2 ? 'warn' : 'fail',
    message: msgs.join(', '),
  };
}

function scoreInternalLinks(html: string): SeoScoreDetail {
  let score = 0;
  const msgs: string[] = [];
  const internalLinks = (html.match(/\]\(\/(?!\/)/g) || []).length;
  const fullLinks = (html.match(/\]\(https?:\/\/[^)]*yeosonam/g) || []).length;
  const total = internalLinks + fullLinks;
  if (total >= 2) { score += 5; msgs.push(`내부 링크 ${total}개`); }
  else if (total >= 1) { score += 3; msgs.push(`내부 링크 ${total}개 (2개 이상 권장)`); }
  else { msgs.push('내부 링크 없음'); }
  if (html.includes('👉') || /yeosonam\.com\/packages/.test(html)) { score += 3; msgs.push('CTA 링크 있음'); }
  return {
    name: '내부 링크', score: Math.min(score, 8), maxScore: 8,
    status: score >= 5 ? 'pass' : score >= 2 ? 'warn' : 'fail',
    message: msgs.join(', '),
  };
}

function scoreReadability(html: string, plainText: string): SeoScoreDetail {
  let score = 0;
  const msgs: string[] = [];
  const sentences = plainText.split(/[.!?]\s+/).filter(s => s.trim().length > 0);
  const avgSent = sentences.length > 0
    ? sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length : 0;
  if (avgSent >= 20 && avgSent <= 60) { score += 3; msgs.push(`평균 문장 ${Math.round(avgSent)}자`); }
  else { score += 1; msgs.push(`평균 문장 ${Math.round(avgSent)}자 (20~60자 권장)`); }
  const paragraphs = html.split('\n\n').filter(p => p.trim().length > 20);
  if (paragraphs.length >= 5) { score += 3; msgs.push(`문단 ${paragraphs.length}개`); }
  else { msgs.push(`문단 ${paragraphs.length}개 (5개 이상 권장)`); }
  const koreanChars = plainText.match(/[가-힣]/g)?.length || 0;
  if (plainText.length > 0 && koreanChars / plainText.length >= 0.4) { score += 2; }
  if (html.includes('- ') || html.includes('* ')) { score += 2; msgs.push('목록 활용'); }
  return {
    name: '가독성', score: Math.min(score, 10), maxScore: 10,
    status: score >= 6 ? 'pass' : score >= 3 ? 'warn' : 'fail',
    message: msgs.join(', '),
  };
}

function scoreJsonLd(input: ScorerInput): SeoScoreDetail {
  let score = 0;
  const msgs: string[] = [];
  const jld = input.hasJsonLd;
  if (jld) {
    if (jld.blogPosting) { score += 3; msgs.push('BlogPosting'); }
    if (jld.faqPage) { score += 3; msgs.push('FAQPage'); }
    if (jld.howTo) { score += 2; msgs.push('HowTo'); }
    if (jld.breadcrumbList) { score += 2; msgs.push('Breadcrumb'); }
  } else { msgs.push('JSON-LD 미확인'); }
  return {
    name: 'JSON-LD', score, maxScore: 10,
    status: score >= 8 ? 'pass' : score >= 4 ? 'warn' : 'fail',
    message: msgs.join(', '),
  };
}

function scoreEeat(html: string): SeoScoreDetail {
  let score = 0;
  const msgs: string[] = [];
  if (html.includes('여소남') || html.includes('운영팀')) { score += 2; msgs.push('발행자 정보'); }
  if (/AI|자동|생성/i.test(html)) { score += 2; msgs.push('AI 디스클로저'); }
  if (html.includes('> ')) { score += 2; msgs.push('리뷰 인용'); }
  if (/검증|직접|확인/.test(html)) { score += 1; msgs.push('검증 시그널'); }
  return {
    name: 'EEAT 시그널', score: Math.min(score, 7), maxScore: 7,
    status: score >= 5 ? 'pass' : score >= 2 ? 'warn' : 'fail',
    message: msgs.join(', ') || 'EEAT 시그널 부족',
  };
}

/** 얇은 콘텐츠(Thin Content) 감지 — HCS(Helpful Content System) 대응 */
function scoreThinContent(plainText: string): SeoScoreDetail {
  let score = 0;
  const msgs: string[] = [];
  const totalChars = plainText.length;

  // 1,500자 미만: 강력 감점
  if (totalChars < 800) {
    score = 0;
    msgs.push(`매우 얇은 콘텐츠 (${totalChars}자, 1,500자 권장)`);
  } else if (totalChars < 1500) {
    score = 5;
    msgs.push(`다소 얇은 콘텐츠 (${totalChars}자, 1,500자 권장)`);
  } else if (totalChars < 2500) {
    score = 12;
    msgs.push(`적정 길이 (${totalChars}자)`);
  } else {
    score = 15;
    msgs.push(`충분한 길이 (${totalChars}자)`);
  }

  // 정보 밀도 체크: 고유 정보(숫자, 날짜, 인용) 비율
  const infoSignals = (plainText.match(/\d+/g) || []).length +
    (plainText.match(/\d{4}년/g) || []).length * 2 +
    (plainText.match(/"[^"]+"/g) || []).length;
  const infoDensity = infoSignals / Math.max(totalChars, 1);
  if (infoDensity >= 0.02) {
    score += 3;
    msgs.push('정보 밀도 양호');
  } else {
    score -= 5;
    msgs.push('정보 밀도 낮음 (숫자/인용 부족)');
  }

  // 단락 다양성 체크
  const uniqueStarts = new Set(plainText.split(/[.!?]\s+/).map(s => s.trim().substring(0, 3)).filter(Boolean));
  if (uniqueStarts.size >= 5) {
    score += 2;
    msgs.push('문장 다양성 양호');
  } else {
    score -= 3;
    msgs.push('문장 다양성 낮음 (반복 패턴 의심)');
  }

  return {
    name: '콘텐츠 깊이 (HCS)',
    score: Math.max(0, Math.min(score, 15)),
    maxScore: 15,
    status: score >= 10 ? 'pass' : score >= 5 ? 'warn' : 'fail',
    message: msgs.join(', '),
  };
}

function scoreMobile(html: string, plainText: string): SeoScoreDetail {
  let score = 0;
  const msgs: string[] = [];
  if (html.includes('.webp') || html.includes('.avif')) { score += 2; msgs.push('차세대 포맷'); }
  const tables = (html.match(/<table|^\|/gm) || []).length;
  if (tables <= 3) { score += 2; }
  const paragraphs = html.split('\n\n').filter(p => p.trim().length > 20);
  if (paragraphs.length >= 5) { score += 1; }
  return {
    name: '모바일 최적화', score: Math.min(score, 5), maxScore: 5,
    status: score >= 3 ? 'pass' : score >= 1 ? 'warn' : 'fail',
    message: msgs.join(', ') || '개선 필요',
  };
}

function scoreSlug(input: ScorerInput, keyword: string): SeoScoreDetail {
  let score = 0;
  const msgs: string[] = [];
  const slug = input.slug || '';
  if (slug.length >= 20 && slug.length <= 80) { score += 2; msgs.push(`slug ${slug.length}자`); }
  else { msgs.push(`slug ${slug.length}자 (20~80자 권장)`); }
  if (keyword) {
    if (slug.includes(keyword.replace(/\s+/g, '-').toLowerCase()) ||
        keyword.split(' ').some(w => w.length >= 2 && slug.includes(w))) {
      score += 2; msgs.push('키워드 포함');
    }
  }
  if (!/재작성|v\d$|untitled/.test(slug)) { score += 1; msgs.push('slug 깔끔'); }
  return {
    name: 'URL Slug', score: Math.min(score, 5), maxScore: 5,
    status: score >= 4 ? 'pass' : score >= 2 ? 'warn' : 'fail',
    message: msgs.join(', '),
  };
}

export function computeSeoScore(input: ScorerInput): SeoScoreResult {
  const plainText = extractPlainText(input.blogHtml);
  const keyword = input.primaryKeyword || '';
  const dest = input.destination || '';

  const details: SeoScoreDetail[] = [
    scoreTitle(input, keyword, dest),
    scoreMeta(input, keyword),
    scoreHeadings(input.blogHtml, keyword, dest),
    scoreKeywordDensity(plainText, keyword, input.blogType),
    scoreLsiKeywordDensity(plainText, input.secondaryKeywords),
    scoreLsiCoverage(plainText),
    scoreImageSeo(input, dest),
    scoreInternalLinks(input.blogHtml),
    scoreReadability(input.blogHtml, plainText),
    scoreJsonLd(input),
    scoreEeat(input.blogHtml),
    scoreThinContent(plainText),
    scoreMobile(input.blogHtml, plainText),
    scoreSlug(input, keyword),
  ];

  const totalScore = details.reduce((sum, d) => sum + d.score, 0);
  const threshold = input.blogType === 'info' ? 45 : 35;

  const summary = totalScore >= 70
    ? `SEO 점수 ${totalScore}/${MAX_SCORE} — 발행 적합 (우수)`
    : totalScore >= threshold
    ? `SEO 점수 ${totalScore}/${MAX_SCORE} — 발행 가능 (${threshold}점 이상)`
    : `SEO 점수 ${totalScore}/${MAX_SCORE} — 발행 보류 (${input.blogType === 'info' ? 45 : 35}점 미만)`;

  return {
    score: totalScore,
    maxScore: MAX_SCORE,
    passed: totalScore >= threshold,
    details,
    summary,
    checkedAt: new Date().toISOString(),
  };
}
