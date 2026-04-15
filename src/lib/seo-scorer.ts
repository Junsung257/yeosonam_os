/**
 * SEO 품질 점수 시스템 (0-100)
 * SEO Machine(seo_quality_rater.py) 로직을 TypeScript로 재구현
 * 블로그 콘텐츠의 SEO 품질을 자동 평가
 */

export interface SeoScore {
  overall: number          // 0-100
  content: number          // 단어 수, 문단 구조
  keyword: number          // 키워드 밀도, 배치
  meta: number             // 메타 타이틀/설명 길이
  structure: number        // H1/H2/H3 계층 구조
  readability: number      // 가독성 (문장 길이, 문단 길이)
  recommendations: string[]
}

interface SeoInput {
  content: string           // 마크다운 본문
  primaryKeyword?: string   // 주요 키워드 (목적지명 등)
  metaTitle?: string
  metaDescription?: string
}

// ── 콘텐츠 점수 (25점 만점) ─────────────────────────────────
function scoreContent(content: string): { score: number; recs: string[] } {
  const recs: string[] = [];
  const text = content.replace(/[#*\[\]()!|`>-]/g, '').trim();
  const charCount = text.length;

  // 한국어 기준: 1500~3000자가 적정
  let score = 0;
  if (charCount >= 1500 && charCount <= 3000) {
    score = 25;
  } else if (charCount >= 1000) {
    score = 20;
    if (charCount < 1500) recs.push(`본문이 짧습니다 (${charCount}자). 1500자 이상 권장.`);
  } else if (charCount >= 500) {
    score = 12;
    recs.push(`본문이 너무 짧습니다 (${charCount}자). 1500자 이상 권장.`);
  } else {
    score = 5;
    recs.push(`본문 분량이 부족합니다 (${charCount}자). 최소 1000자 이상 필요.`);
  }

  if (charCount > 4000) {
    score -= 3;
    recs.push(`본문이 너무 깁니다 (${charCount}자). 3000자 이하로 요약 권장.`);
  }

  return { score: Math.max(0, score), recs };
}

// ── 키워드 점수 (25점 만점) ─────────────────────────────────
function scoreKeyword(content: string, keyword?: string): { score: number; recs: string[] } {
  const recs: string[] = [];
  if (!keyword) return { score: 15, recs: ['주요 키워드를 지정하면 더 정확한 분석이 가능합니다.'] };

  const text = content.replace(/[#*\[\]()!|`>-]/g, '');
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyCount = (text.match(new RegExp(escaped, 'gi')) || []).length;
  const charCount = text.length;
  // 한국어: 1000자당 2~5회가 적정 밀도
  const density = charCount > 0 ? (keyCount / (charCount / 1000)) : 0;

  let score = 0;
  if (density >= 2 && density <= 5) {
    score = 25;
  } else if (density >= 1) {
    score = 18;
    if (density < 2) recs.push(`키워드 '${keyword}'가 부족합니다 (1000자당 ${density.toFixed(1)}회). 2~5회 권장.`);
  } else if (density > 0) {
    score = 10;
    recs.push(`키워드 '${keyword}'가 매우 부족합니다. 본문에 자연스럽게 추가하세요.`);
  } else {
    score = 0;
    recs.push(`키워드 '${keyword}'가 본문에 없습니다.`);
  }

  // H1/H2에 키워드 포함 여부
  const h1Match = content.match(/^# .+/m);
  if (h1Match && new RegExp(escaped, 'i').test(h1Match[0])) {
    score = Math.min(25, score + 3);
  } else {
    recs.push(`H1 제목에 키워드 '${keyword}'를 포함하세요.`);
  }

  if (density > 7) {
    score -= 5;
    recs.push(`키워드 과다 사용(키워드 스터핑). 1000자당 5회 이하로 줄이세요.`);
  }

  return { score: Math.max(0, score), recs };
}

// ── 메타 점수 (20점 만점) ───────────────────────────────────
function scoreMeta(title?: string, desc?: string): { score: number; recs: string[] } {
  const recs: string[] = [];
  let score = 0;

  // 타이틀: 30~60자 적정
  if (title) {
    if (title.length >= 30 && title.length <= 60) {
      score += 10;
    } else if (title.length > 0) {
      score += 5;
      if (title.length < 30) recs.push(`메타 타이틀이 짧습니다 (${title.length}자). 30~60자 권장.`);
      if (title.length > 60) recs.push(`메타 타이틀이 깁니다 (${title.length}자). 60자 이하 권장.`);
    }
  } else {
    recs.push('메타 타이틀이 없습니다. SEO에 필수입니다.');
  }

  // 설명: 80~160자 적정
  if (desc) {
    if (desc.length >= 80 && desc.length <= 160) {
      score += 10;
    } else if (desc.length > 0) {
      score += 5;
      if (desc.length < 80) recs.push(`메타 설명이 짧습니다 (${desc.length}자). 80~160자 권장.`);
      if (desc.length > 160) recs.push(`메타 설명이 깁니다 (${desc.length}자). 160자 이하 권장.`);
    }
  } else {
    recs.push('메타 설명이 없습니다. 검색 결과 CTR에 영향을 줍니다.');
  }

  return { score, recs };
}

// ── 구조 점수 (15점 만점) ───────────────────────────────────
function scoreStructure(content: string): { score: number; recs: string[] } {
  const recs: string[] = [];
  let score = 0;

  const h1Count = (content.match(/^# [^#]/gm) || []).length;
  const h2Count = (content.match(/^## [^#]/gm) || []).length;
  const h3Count = (content.match(/^### /gm) || []).length;

  // H1: 정확히 1개
  if (h1Count === 1) {
    score += 5;
  } else if (h1Count === 0) {
    recs.push('H1 제목이 없습니다.');
  } else {
    score += 2;
    recs.push(`H1이 ${h1Count}개입니다. 1개만 사용하세요.`);
  }

  // H2: 3~7개 적정
  if (h2Count >= 3 && h2Count <= 7) {
    score += 7;
  } else if (h2Count >= 1) {
    score += 4;
    if (h2Count < 3) recs.push(`H2 소제목이 ${h2Count}개뿐입니다. 3~7개 권장.`);
    if (h2Count > 7) recs.push(`H2가 ${h2Count}개로 많습니다. 7개 이하 권장.`);
  } else {
    recs.push('H2 소제목이 없습니다. 가독성과 SEO를 위해 추가하세요.');
  }

  // H3: 있으면 가산
  if (h3Count > 0) {
    score += 3;
  }

  return { score, recs };
}

// ── 가독성 점수 (15점 만점) ─────────────────────────────────
function scoreReadability(content: string): { score: number; recs: string[] } {
  const recs: string[] = [];
  const text = content.replace(/[#*\[\]()!|`>-]/g, '').trim();

  // 문장 분리 (한국어: 마침표/물음표/느낌표)
  const sentences = text.split(/[.?!。]\s*/).filter(s => s.trim().length > 0);
  const avgSentenceLen = sentences.length > 0
    ? sentences.reduce((sum, s) => sum + s.trim().length, 0) / sentences.length
    : 0;

  let score = 0;

  // 평균 문장 길이: 30~60자 적정 (한국어)
  if (avgSentenceLen >= 20 && avgSentenceLen <= 60) {
    score += 8;
  } else if (avgSentenceLen > 0) {
    score += 4;
    if (avgSentenceLen > 80) recs.push(`평균 문장 길이가 깁니다 (${Math.round(avgSentenceLen)}자). 60자 이내 권장.`);
  }

  // 문단 분리 (빈 줄 기준)
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0 && !p.trim().startsWith('#'));
  if (paragraphs.length >= 5) {
    score += 4;
  } else if (paragraphs.length >= 3) {
    score += 2;
  } else {
    recs.push('문단이 너무 적습니다. 빈 줄로 문단을 나눠 가독성을 높이세요.');
  }

  // 리스트 사용 여부
  const listCount = (content.match(/^[-*] /gm) || []).length;
  if (listCount >= 3) {
    score += 3;
  } else {
    score += 1;
    recs.push('리스트(- 항목)를 활용하면 스캔 가독성이 향상됩니다.');
  }

  return { score, recs };
}

// ── 통합 점수 ───────────────────────────────────────────────
export function calculateSeoScore(input: SeoInput): SeoScore {
  const c = scoreContent(input.content);
  const k = scoreKeyword(input.content, input.primaryKeyword);
  const m = scoreMeta(input.metaTitle, input.metaDescription);
  const s = scoreStructure(input.content);
  const r = scoreReadability(input.content);

  const overall = c.score + k.score + m.score + s.score + r.score;
  const recommendations = [...c.recs, ...k.recs, ...m.recs, ...s.recs, ...r.recs];

  return {
    overall,
    content: c.score,
    keyword: k.score,
    meta: m.score,
    structure: s.score,
    readability: r.score,
    recommendations,
  };
}

/** 점수별 등급 라벨 */
export function getSeoGrade(score: number): { label: string; color: string } {
  if (score >= 80) return { label: 'A (우수)', color: 'text-emerald-600' };
  if (score >= 60) return { label: 'B (양호)', color: 'text-blue-600' };
  if (score >= 40) return { label: 'C (보통)', color: 'text-amber-600' };
  return { label: 'D (개선 필요)', color: 'text-red-600' };
}
