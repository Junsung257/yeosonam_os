/**
 * TrendStyle Engine — 범용 트렌드 기반 자동 문체 변환 엔진
 *
 * 출처: stylometric-transfer (GitHub ⭐) + agent-style-transfer (GitHub ⭐)
 *   - stylometric-transfer: JSON fingerprint 기반 스타일 프로파일 + 조건부 LLM 호출
 *   - agent-style-transfer: Multi-platform 스타일 추론 + 평가 시스템
 *
 * 주요 개념:
 *   1. Stylometric Fingerprint: 기존 글에서 문체 DNA(문장 길이, 단락 리듬, 감정 페이싱 등)를 JSON으로 추출
 *   2. Trend-to-Style: 외부 트렌드(Threads 핫글)를 분석해 현재 최적의 문체를 동적 선택
 *   3. Multi-platform: 블로그/Threads/인스타 각각 다른 fingerprint를 적용
 *   4. Feedback Loop: 성과(engagement) 기반 fingerprint 자동 업데이트
 */

import { z } from 'zod';

// ─── Schema ──────────────────────────────────────────────────────────────────

/** 문체 강도/수준을 표현하는 controlled vocabulary */
const Level3 = z.enum(['low', 'medium', 'high']);
type Level3 = z.infer<typeof Level3>;

const Level5 = z.enum(['very_low', 'low', 'medium', 'high', 'very_high']);
type Level5 = z.infer<typeof Level5>;

const Frequency = z.enum(['rare', 'sometimes', 'often', 'very_often']);
type Frequency = z.infer<typeof Frequency>;

/**
 * Stylometric Fingerprint — stylometric-transfer 의 JSON fingerprint 구조를
 * 한국어/여행 도메인에 맞게 간소화 + 확장.
 *
 * 원본: schema_version, metadata, measurements, targets, lexicon, templates, controls, validators
 * 우리 버전: 한국어 여행 콘텐츠에 최적화 + platform별 적응 + trend 연결
 */
export const StyleFingerprintSchema = z.object({
  schema_version: z.string().default('1.1.0'),
  profile_id: z.string(),
  metadata: z.object({
    name: z.string(),           // 'yeosonam-default' | 'yeosonam-threads-budget' 등
    platform: z.string(),       // 'threads' | 'blog' | 'instagram'
    angle_type: z.string().optional(), // 'budget' | 'luxury' | 'sentimental' | 'adventure'
    description: z.string().optional(),
    source_articles: z.array(z.string()).optional(),  // 이 fingerprint의 근거가 된 article IDs
    generated_at: z.string(),
    version: z.number(),
  }),
  /** 어조/톤 관련 타겟 */
  tone: z.object({
    formality: z.number().min(0).max(1),          // 0=완전 casual, 1=완전 formal
    emotional_valence: z.number().min(0).max(1),   // 0=중립/정보성, 1=감정/공감
    technicality: z.number().min(0).max(1),        // 0=쉬운 말, 1=전문 용어 많음
    humor: z.number().min(0).max(1).optional(),    // 0=진지, 1=유머러스
    urgency: z.number().min(0).max(1).optional(),  // 0=차분, 1=긴급/할인정보
  }),
  /** 문장/단락 구조 */
  structure: z.object({
    avg_sentence_length: z.number(),               // 평균 음절 수
    sentence_length_std: z.number().optional(),     // 문장 길이 표준편차 (변동성)
    paragraph_rhythm: z.enum([
      'short_short_long',     // 짧-짧-길게 (Threads 스타일)
      'balanced',             // 균일
      'long_form',            // 긴 문단 중심 (블로그 스타일)
      'staccato',             // 매우 짧은 문장 반복
    ]),
    one_sentence_paragraph_rate: z.number().min(0).max(1).optional(), // 한줄단락 비율
    punchline_pattern: z.array(z.enum([
      'redefinition',     // "X는 Y가 아니라 Z다"
      'staccato',         // "짧게. 짧게. 긴 감동."
      'question',         // 질문 던지기
      'contrast',         // 대조 ("다른 곳은..., 여기는...")
      'numbers',          // 숫자로 시작 ("3가지 이유")
    ])).optional(),
  }),
  /** 어휘 관련 */
  lexicon: z.object({
    level: z.enum(['basic', 'intermediate', 'advanced']),
    avoid_words: z.array(z.string()).optional(),     // 금지어 (느낌표 남발, AI 티나는 표현)
    avoid_words_soft: z.array(z.string()).optional(), // 가급적 피할 말
    prefer_words: z.record(z.string(), z.string()).optional(), // 대체 선호 용어
    emoji_policy: z.enum(['none', 'minimal', 'moderate', 'generous']),
    hashtag_policy: z.enum(['none', 'minimal', 'moderate']),
    max_hashtags: z.number().optional(),
  }),
  /** 템플릿/패턴 */
  templates: z.object({
    hook_style: z.array(z.enum([
      'question',           // "○○ 가보신 분?"
      'personal_confession', // "저 사실 ○○였거든요"
      'curiosity_gap',      // "○○ 알고 계세요?"
      'bold_statement',     // "○○ 안 가면 후회합니다"
      'statistic',          // "○○%가 모르는 사실"
      'empathy',            // "○○ 고민 많으시죠?"
    ])).optional(),
    cta_style: z.enum([
      'dm_keyword',         // "DM으로 ○○ 보내주세요"
      'reply_question',     // "댓글로 알려주세요"
      'profile_link',       // "프로필 링크 확인"
      'soft_question',      // "어떻게 생각하세요?"
      'direct_link',        // "자세한 건 여기서"
      'urgency',            // "오늘까지!"
      'none',
    ]),
    paragraph_starters: z.array(z.string()).optional(),  // 선호하는 문단 시작 패턴
  }),
  /** 플랫폼별 오버라이드 */
  platform_overrides: z.record(z.string(), z.object({
    tone: z.object({
      formality: z.number().min(0).max(1).optional(),
      emotional_valence: z.number().min(0).max(1).optional(),
    }).optional(),
    structure: z.object({
      max_length: z.number().optional(),    // Threads 500자 제한 등
      paragraph_rhythm: z.enum(['short_short_long', 'balanced', 'long_form', 'staccato']).optional(),
    }).optional(),
    lexicon: z.object({
      emoji_policy: z.enum(['none', 'minimal', 'moderate', 'generous']).optional(),
      max_hashtags: z.number().optional(),
    }).optional(),
  })).optional(),
  /** 트렌드 매핑 — trend 키워드가 들어오면 이 fingerprint의 가중치를 조정 */
  trend_affinity: z.array(z.object({
    keyword: z.string(),
    weight_delta: z.number(),             // 이 키워드가 트렌딩일 때 formality/emotional 등 조정량
    target_tone_shift: z.object({
      formality: z.number().optional(),
      emotional_valence: z.number().optional(),
      technicality: z.number().optional(),
      urgency: z.number().optional(),
    }).optional(),
  })).optional(),
  /** 생성 제어 */
  controls: z.object({
    strictness: z.enum(['relaxed', 'normal', 'strict']),
    priority_order: z.array(z.string()).optional(),  // ['tone', 'structure', 'lexicon']
    max_deviation: z.number().min(0).max(1).default(0.3),  // 허용 최대 편차
  }),
  /** 검증 기준 */
  validators: z.object({
    min_sentence_length: z.number().optional(),
    max_sentence_length: z.number().optional(),
    avoid_repetition_rate: z.number().optional(),  // n-gram 반복률 상한
  }).optional(),
});

export type StyleFingerprint = z.infer<typeof StyleFingerprintSchema>;

// ─── Trend Signal ────────────────────────────────────────────────────────────

export interface TrendSignal {
  keyword: string;
  platform: string;
  /** Threads 핫글에서 추출한 스타일 통계 */
  observed_style?: {
    avg_sentence_length: number;
    formality_estimate: number;     // 0-1
    emotional_estimate: number;     // 0-1
    emoji_density: number;
    hook_patterns: string[];
  };
  score: number;  // engagement 기반 중요도
  captured_at: string;
}

// ─── Fingerprint Registry ────────────────────────────────────────────────────

/**
 * 내장 fingerprint 레지스트리 — stylometric-transfer 방식의 JSON 프로파일 저장소.
 *
 * 초기값: 수동 작성 (향후 DB brand_kits 테이블로 마이그레이션)
 * 실제로는 성과 좋은 글을 분석해 자동 생성됨 (inferFingerprintFromArticles)
 */
const BUILTIN_FINGERPRINTS: Record<string, StyleFingerprint> = {
  /** ─── Threads 기본 ─── */
  'threads-default': {
    schema_version: '1.1.0',
    profile_id: 'threads-default',
    metadata: {
      name: 'Threads 기본',
      platform: 'threads',
      description: 'Threads 기본 문체 — 1인칭 대화형, 솔직, 짧은 문장',
      generated_at: new Date().toISOString(),
      version: 1,
    },
    tone: {
      formality: 0.25,
      emotional_valence: 0.6,
      technicality: 0.2,
      humor: 0.4,
    },
    structure: {
      avg_sentence_length: 35,
      paragraph_rhythm: 'short_short_long',
      one_sentence_paragraph_rate: 0.5,
      punchline_pattern: ['redefinition', 'question'],
    },
    lexicon: {
      level: 'basic',
      avoid_words: ['솔직히', '놀라운', '완벽한', '대박'],
      prefer_words: {
        '여행': '여행',
        '가성비': '가성비',
      },
      emoji_policy: 'minimal',
      hashtag_policy: 'minimal',
      max_hashtags: 3,
    },
    templates: {
      hook_style: ['personal_confession', 'question', 'curiosity_gap'],
      cta_style: 'dm_keyword',
    },
    controls: {
      strictness: 'normal',
      priority_order: ['tone', 'structure', 'lexicon'],
      max_deviation: 0.3,
    },
    trend_affinity: [
      { keyword: 'MZ', weight_delta: -0.1, target_tone_shift: { formality: -0.1, emotional_valence: 0.1 } },
      { keyword: '가성비', weight_delta: 0.2, target_tone_shift: { formality: -0.15, technicality: -0.1 } },
      { keyword: '꿀팁', weight_delta: 0.15, target_tone_shift: { formality: -0.1 } },
      { keyword: '감성', weight_delta: 0.1, target_tone_shift: { emotional_valence: 0.2 } },
      { keyword: '럭셔리', weight_delta: 0.1, target_tone_shift: { formality: 0.15 } },
      { keyword: '혼자', weight_delta: 0.1, target_tone_shift: { emotional_valence: 0.1 } },
    ],
  },

  /** ─── Threads 가성비 ─── */
  'threads-budget': {
    schema_version: '1.1.0',
    profile_id: 'threads-budget',
    metadata: {
      name: 'Threads 가성비',
      platform: 'threads',
      angle_type: 'budget',
      description: '가성비 중심 — 간결, 실용적, 숫자 위주',
      generated_at: new Date().toISOString(),
      version: 1,
    },
    tone: {
      formality: 0.15,
      emotional_valence: 0.4,
      technicality: 0.15,
      humor: 0.3,
      urgency: 0.6,
    },
    structure: {
      avg_sentence_length: 30,
      paragraph_rhythm: 'staccato',
      one_sentence_paragraph_rate: 0.7,
      punchline_pattern: ['numbers', 'contrast'],
    },
    lexicon: {
      level: 'basic',
      avoid_words: ['솔직히', '놀라운'],
      prefer_words: {
        '여행': '여행',
        '가성비': '가성비',
        '저렴한': '부담 없는',
      },
      emoji_policy: 'moderate',
      hashtag_policy: 'moderate',
      max_hashtags: 3,
    },
    templates: {
      hook_style: ['bold_statement', 'statistic', 'question'],
      cta_style: 'dm_keyword',
    },
    controls: {
      strictness: 'relaxed',
      priority_order: ['structure', 'tone', 'lexicon'],
      max_deviation: 0.3,
    },
    trend_affinity: [
      { keyword: '가성비', weight_delta: 0.3, target_tone_shift: { formality: -0.1, emotional_valence: 0.1 } },
      { keyword: '할인', weight_delta: 0.3, target_tone_shift: { urgency: 0.2 } },
      { keyword: '특가', weight_delta: 0.3, target_tone_shift: { urgency: 0.2 } },
    ],
  },

  /** ─── Threads 감성/힐링 ─── */
  'threads-sentimental': {
    schema_version: '1.1.0',
    profile_id: 'threads-sentimental',
    metadata: {
      name: 'Threads 감성',
      platform: 'threads',
      angle_type: 'sentimental',
      description: '감성/힐링 중심 — 따뜻한 톤, 서술형, 공감 유도',
      generated_at: new Date().toISOString(),
      version: 1,
    },
    tone: {
      formality: 0.3,
      emotional_valence: 0.85,
      technicality: 0.1,
      humor: 0.2,
    },
    structure: {
      avg_sentence_length: 45,
      paragraph_rhythm: 'short_short_long',
      one_sentence_paragraph_rate: 0.4,
      punchline_pattern: ['redefinition', 'contrast'],
    },
    lexicon: {
      level: 'intermediate',
      avoid_words: ['대박', '완전'],
      prefer_words: {
        '여행': '여행',
        '예쁜': '아름다운',
        '좋은': '특별한',
      },
      emoji_policy: 'moderate',
      hashtag_policy: 'minimal',
      max_hashtags: 2,
    },
    templates: {
      hook_style: ['empathy', 'personal_confession'],
      cta_style: 'reply_question',
    },
    controls: {
      strictness: 'normal',
      priority_order: ['tone', 'structure', 'lexicon'],
      max_deviation: 0.3,
    },
    trend_affinity: [
      { keyword: '감성', weight_delta: 0.2, target_tone_shift: { emotional_valence: 0.15 } },
      { keyword: '힐링', weight_delta: 0.2, target_tone_shift: { emotional_valence: 0.15 } },
      { keyword: '혼자', weight_delta: 0.15, target_tone_shift: { emotional_valence: 0.1 } },
      { keyword: '일상', weight_delta: 0.1, target_tone_shift: { formality: -0.1 } },
    ],
  },

  /** ─── Threads 럭셔리 ─── */
  'threads-luxury': {
    schema_version: '1.1.0',
    profile_id: 'threads-luxury',
    metadata: {
      name: 'Threads 럭셔리',
      platform: 'threads',
      angle_type: 'luxury',
      description: '프리미엄 여행 — 우아한 톤, 세련된 표현, 정보 밀도',
      generated_at: new Date().toISOString(),
      version: 1,
    },
    tone: {
      formality: 0.6,
      emotional_valence: 0.5,
      technicality: 0.3,
      humor: 0.15,
    },
    structure: {
      avg_sentence_length: 50,
      paragraph_rhythm: 'balanced',
      one_sentence_paragraph_rate: 0.3,
      punchline_pattern: ['contrast', 'redefinition'],
    },
    lexicon: {
      level: 'advanced',
      avoid_words: ['싼', '저렴한', '대박'],
      prefer_words: {
        '여행': '여행',
        '싼': '합리적인',
        '호텔': '리조트/부티크 호텔',
      },
      emoji_policy: 'minimal',
      hashtag_policy: 'none',
      max_hashtags: 1,
    },
    templates: {
      hook_style: ['curiosity_gap', 'bold_statement'],
      cta_style: 'profile_link',
    },
    controls: {
      strictness: 'strict',
      priority_order: ['tone', 'lexicon', 'structure'],
      max_deviation: 0.3,
    },
  },

  /** ─── Threads 모험/액티브 ─── */
  'threads-adventure': {
    schema_version: '1.1.0',
    profile_id: 'threads-adventure',
    metadata: {
      name: 'Threads 모험',
      platform: 'threads',
      angle_type: 'adventure',
      description: '액티브/모험 — 에너제틱, 도전적, 경험 공유',
      generated_at: new Date().toISOString(),
      version: 1,
    },
    tone: {
      formality: 0.2,
      emotional_valence: 0.75,
      technicality: 0.15,
      humor: 0.5,
      urgency: 0.3,
    },
    structure: {
      avg_sentence_length: 32,
      paragraph_rhythm: 'short_short_long',
      one_sentence_paragraph_rate: 0.6,
      punchline_pattern: ['staccato', 'question'],
    },
    lexicon: {
      level: 'basic',
      avoid_words: ['지루한', '힘든'],
      prefer_words: {
        '여행': '모험',
        '가다': '떠나다',
      },
      emoji_policy: 'moderate',
      hashtag_policy: 'moderate',
      max_hashtags: 3,
    },
    templates: {
      hook_style: ['bold_statement', 'personal_confession'],
      cta_style: 'reply_question',
    },
    controls: {
      strictness: 'relaxed',
      max_deviation: 0.3,
    },
  },

  /** ─── 블로그 기본 (향후 확장) ─── */
  'blog-default': {
    schema_version: '1.1.0',
    profile_id: 'blog-default',
    metadata: {
      name: '블로그 기본',
      platform: 'blog',
      description: '블로그 기본 — 전문적, 정보 밀도 높음, SEO 최적화',
      generated_at: new Date().toISOString(),
      version: 1,
    },
    tone: {
      formality: 0.6,
      emotional_valence: 0.3,
      technicality: 0.4,
    },
    structure: {
      avg_sentence_length: 60,
      paragraph_rhythm: 'long_form',
      one_sentence_paragraph_rate: 0.15,
      punchline_pattern: ['numbers', 'redefinition'],
    },
    lexicon: {
      level: 'intermediate',
      avoid_words: ['솔직히', '대박', '완전'],
      emoji_policy: 'none',
      hashtag_policy: 'none',
      max_hashtags: 0,
    },
    templates: {
      hook_style: ['statistic', 'question', 'curiosity_gap'],
      cta_style: 'direct_link',
    },
    controls: {
      strictness: 'normal',
      max_deviation: 0.3,
    },
  },
};

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * 트렌드 시그널을 받아 가장 적합한 fingerprint를 선택.
 * stylometric-transfer의 fingerprint 매칭 방식을 차용:
 *   - trend_affinity 키워드 일치도 계산
 *   - 플랫폼 필터
 *   - 가장 높은 affinity 점수의 fingerprint 반환
 */
export function selectFingerprint(
  platform: string,
  trendKeywords: string[],
  angleType?: string,
): StyleFingerprint {
  const candidates = Object.values(BUILTIN_FINGERPRINTS).filter(
    f => f.metadata.platform === platform
  );

  if (candidates.length === 0) {
    // fallback
    return BUILTIN_FINGERPRINTS['threads-default']!;
  }

  // angleType이 명시되면 우선 매칭
  if (angleType) {
    const exact = candidates.find(f => f.metadata.angle_type === angleType);
    if (exact) return exact;
  }

  // trend affinity 스코어링
  const scored = candidates.map(fp => {
    let score = 0;
    const affinities = fp.trend_affinity ?? [];
    for (const kw of trendKeywords) {
      const match = affinities.find(a =>
        kw.toLowerCase().includes(a.keyword.toLowerCase()) ||
        a.keyword.toLowerCase().includes(kw.toLowerCase())
      );
      if (match) score += match.weight_delta;
    }
    return { fp, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.fp;
}

/**
 * 트렌드 키워드로 fingerprint의 tone 가중치 조정.
 * trend_affinity의 target_tone_shift를 현재 fingerprint에 적용.
 */
export function adjustFingerprintForTrends(
  fingerprint: StyleFingerprint,
  trendKeywords: string[],
): StyleFingerprint {
  const adjusted = structuredClone(fingerprint);
  const trendMatches = (fingerprint.trend_affinity ?? []).filter(a =>
    trendKeywords.some(kw =>
      kw.toLowerCase().includes(a.keyword.toLowerCase()) ||
      a.keyword.toLowerCase().includes(kw.toLowerCase())
    )
  );

  for (const match of trendMatches) {
    if (match.target_tone_shift) {
      const shift = match.target_tone_shift;
      if (shift.formality !== undefined) {
        adjusted.tone.formality = clamp(adjusted.tone.formality + shift.formality, 0, 1);
      }
      if (shift.emotional_valence !== undefined) {
        adjusted.tone.emotional_valence = clamp(
          adjusted.tone.emotional_valence + shift.emotional_valence, 0, 1
        );
      }
      if (shift.technicality !== undefined) {
        adjusted.tone.technicality = clamp(
          adjusted.tone.technicality + shift.technicality, 0, 1
        );
      }
      if (shift.urgency !== undefined) {
        adjusted.tone.urgency = clamp(
          (adjusted.tone.urgency ?? 0) + shift.urgency, 0, 1
        );
      }
    }
  }

  return adjusted;
}

/**
 * Fingerprint를 AI 프롬프트에 주입할 수 있는 자연어 블록으로 변환.
 * stylometric-transfer의 derived_instructions.rewrite_prompt 역할.
 */
export function fingerprintToPromptBlock(fingerprint: StyleFingerprint): string {
  const t = fingerprint.tone;
  const s = fingerprint.structure;
  const l = fingerprint.lexicon;
  const tmpl = fingerprint.templates;

  const lines: string[] = [
    `## 글 스타일 가이드 (자동 분석 기반)`,
    ``,
    `### 톤`,
    `- 격식 수준: ${describeFormality(t.formality)}`,
    `- 감정 표현: ${describeEmotion(t.emotional_valence)}`,
    `- 전문성: ${describeTechnicality(t.technicality)}`,
    t.humor !== undefined ? `- 유머: ${t.humor > 0.5 ? '가벼운 유머 허용' : '진지한 톤 유지'}` : '',
    ``,
    `### 문장/단락 구조`,
    `- 평균 문장 길이: 약 ${s.avg_sentence_length}음절 내외`,
    `- 단락 리듬: ${describeRhythm(s.paragraph_rhythm)}`,
    s.punchline_pattern ? `-推薦 킬포인트 패턴: ${s.punchline_pattern.map(describePunchline).join(', ')}` : '',
    ``,
    `### 어휘`,
    `- 난이도: ${describeLexiconLevel(l.level)}`,
    l.avoid_words?.length ? `- 금지어: ${l.avoid_words.join(', ')}` : '',
    l.prefer_words ? `- 선호 표현: ${Object.entries(l.prefer_words).map(([k, v]) => `${k}→${v}`).join(', ')}` : '',
    `- 이모지: ${describeEmojiPolicy(l.emoji_policy)}`,
    l.hashtag_policy !== 'none' ? `- 해시태그: ${l.hashtag_policy === 'minimal' ? '최소 (1~2개)' : l.hashtag_policy === 'moderate' ? '적당히 (최대 ' + (l.max_hashtags ?? 3) + '개)' : '없음'}` : '',
    ``,
    `### 후크/CTA`,
    tmpl.hook_style ? `- 후크 스타일: ${tmpl.hook_style.map(h => describeHook(h)).join(', ')}` : '',
    `- CTA: ${describeCTA(tmpl.cta_style)}`,
    ``,
    `### 엄격 규칙`,
    `- 위 가이드를 최대한 따라갈 것 (strictness: ${fingerprint.controls.strictness})`,
    `- 톤/구조/어휘 중 우선순위: ${(fingerprint.controls.priority_order ?? ['tone', 'structure', 'lexicon']).join(' > ')}`,
    `- 의미는 유지하고 스타일만 변경할 것`,
    fingerprint.controls.strictness === 'strict' ? `- 가이드와 30% 이상 차이나면 재작성 필요` : '',
  ];

  return lines.filter(Boolean).join('\n');
}

/**
 * 기존 글 컬렉션에서 stylometric fingerprint를 추론.
 * stylometric-transfer의 make/measurement 함수 역할.
 * @param articles 발행된 글 배열 (text + performance_score)
 * @returns 추론된 StyleFingerprint
 */
export function inferFingerprintFromArticles(
  articles: Array<{ text: string; platform: string; performance_score?: number; angle_type?: string }>,
): Partial<StyleFingerprint> {
  if (articles.length === 0) return {};

  const allSentences = articles.flatMap(a => splitSentences(a.text));
  const avgSentenceLength = allSentences.length > 0
    ? Math.round(allSentences.reduce((sum, s) => sum + s.length, 0) / allSentences.length)
    : 40;

  const oneSentenceParagraphs = articles.filter(a => {
    const paragraphs = a.text.split('\n\n').filter(Boolean);
    return paragraphs.some(p => !p.includes('\n') && p.length > 0);
  }).length;
  const oneSentenceParagraphRate = articles.length > 0
    ? oneSentenceParagraphs / articles.length
    : 0.3;

  // 감정 표현 추정 (느낌표, 감정 단어 비율)
  const emotionalWords = ['진짜', '완전', '대박', '최고', '최악', '사랑', '행복', '감동', '힐링', '그리다', '아쉽', '후회'];
  const emotionalRatio = articles.length > 0
    ? articles.reduce((sum, a) => {
      const count = emotionalWords.filter(w => a.text.includes(w)).length;
      return sum + count / Math.max(a.text.length, 1) * 1000;
    }, 0) / articles.length / 10
    : 0.3;

  const topArticle = articles.sort((a, b) => (b.performance_score ?? 0) - (a.performance_score ?? 0))[0];

  return {
    metadata: {
      name: `${articles[0]?.platform ?? 'unknown'}-inferred`,
      platform: articles[0]?.platform ?? 'threads',
      source_articles: articles.map(a => a.text.slice(0, 50)),
      generated_at: new Date().toISOString(),
      version: 1,
    },
    tone: {
      formality: clamp(1 - emotionalRatio, 0, 1),
      emotional_valence: clamp(emotionalRatio, 0, 1),
      technicality: 0.3,
    },
    structure: {
      avg_sentence_length: avgSentenceLength,
      paragraph_rhythm: oneSentenceParagraphRate > 0.5 ? 'short_short_long' : 'balanced',
      one_sentence_paragraph_rate: oneSentenceParagraphRate,
    },
    lexicon: {
      level: avgSentenceLength > 50 ? 'intermediate' : 'basic',
      emoji_policy: 'minimal',
      hashtag_policy: 'minimal',
    },
    templates: {
      cta_style: 'dm_keyword',
    },
    controls: {
      strictness: 'normal',
      max_deviation: 0.3,
    },
  };
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function splitSentences(text: string): string[] {
  return text.split(/[.!?]\s*/).filter(s => s.trim().length > 1);
}

function describeFormality(v: number): string {
  if (v < 0.2) return '매우 캐주얼 (친구한테 말하듯)';
  if (v < 0.4) return '캐주얼 (편한 대화체)';
  if (v < 0.6) return '중립 (두루두루)';
  if (v < 0.8) return '격식 (공식적인 문서체)';
  return '매우 격식 (전문 보고서)';
}

function describeEmotion(v: number): string {
  if (v < 0.2) return '사실/정보 위주';
  if (v < 0.4) return '약간의 감정 표현';
  if (v < 0.6) return '적절한 감정 표현';
  if (v < 0.8) return '감정 표현 풍부';
  return '매우 감성적/공감 유도';
}

function describeTechnicality(v: number): string {
  if (v < 0.2) return '쉬운 말 (누구나 이해)';
  if (v < 0.4) return '일상 용어 수준';
  if (v < 0.6) return '적절한 전문 용어';
  if (v < 0.8) return '전문적';
  return '매우 전문적 (업계 용어)';
}

function describeRhythm(r: string): string {
  const map: Record<string, string> = {
    'short_short_long': '짧은 문장 여러 개 → 긴 문장 (Threads 최적)',
    'balanced': '균일한 길이 유지',
    'long_form': '긴 문단 중심 (블로그 스타일)',
    'staccato': '매우 짧은 문장 연속 (충격/강조)',
  };
  return map[r] ?? r;
}

function describePunchline(p: string): string {
  const map: Record<string, string> = {
    'redefinition': '"X는 Y가 아니라 Z다" 재정의',
    'staccato': '짧-짧-긴 리듬',
    'question': '질문 던지기',
    'contrast': '대조 ("다른 곳은… 여기는…")',
    'numbers': '숫자로 시작',
  };
  return map[p] ?? p;
}

function describeLexiconLevel(l: string): string {
  const map: Record<string, string> = { basic: '쉬운 말', intermediate: '중급', advanced: '고급/전문' };
  return map[l] ?? l;
}

function describeEmojiPolicy(p: string): string {
  const map: Record<string, string> = {
    none: '사용 금지',
    minimal: '최소 (1~2개)',
    moderate: '적당히 (3~5개)',
    generous: '자유롭게',
  };
  return map[p] ?? p;
}

function describeHook(h: string): string {
  const map: Record<string, string> = {
    question: '질문형',
    personal_confession: '고백/경험담',
    curiosity_gap: '호기심 유발',
    bold_statement: '강한 주장',
    statistic: '통계/숫자',
    empathy: '공감 유도',
  };
  return map[h] ?? h;
}

function describeCTA(c: string): string {
  const map: Record<string, string> = {
    dm_keyword: 'DM 키워드 전송 유도 (전환 최고)',
    reply_question: '댓글 참여 유도 (engagement)',
    profile_link: '프로필 링크 안내',
    soft_question: '의견 묻기',
    direct_link: '직접 링크',
    urgency: '한정/마감 강조',
    none: '없음',
  };
  return map[c] ?? c;
}

// ─── Deviation Measurement ───────────────────────────────────────────────────

export interface DeviationReport {
  /** 0 = 완전 일치, 1 = 완전 불일치 */
  overall_deviation: number;
  tone_deviation: number;
  structure_deviation: number;
  lexicon_deviation: number;
  failures: string[];
  passed: boolean;  // overall_deviation ≤ max_deviation
}

/**
 * 생성된 텍스트가 StyleFingerprint와 얼마나 일치하는지 측정.
 *
 * agent-style-transfer의 평가 시스템에서 차용:
 *   - tone: 문장 단위 감정/격식 추정값과 fingerprint 목표값의 MSE
 *   - structure: 실제 문장/단락 통계와 fingerprint 목표값의 MSE
 *   - lexicon: 금지어 사용률 검출
 *
 * @returns DeviationReport — auto-publisher에서 quality gate로 사용
 */
export function measureDeviation(
  generatedText: string,
  fingerprint: StyleFingerprint,
): DeviationReport {
  const failures: string[] = [];
  const sentences = splitSentences(generatedText);
  const paragraphs = generatedText.split('\n\n').filter(Boolean);

  if (sentences.length === 0) {
    return {
      overall_deviation: 1,
      tone_deviation: 1,
      structure_deviation: 1,
      lexicon_deviation: 1,
      failures: ['텍스트가 너무 짧거나 분석 불가'],
      passed: false,
    };
  }

  // ── Tone 측정 ──────────────────────────────────────────────────
  const actualSentenceLength = Math.round(
    sentences.reduce((sum, s) => sum + s.length, 0) / Math.max(sentences.length, 1),
  );
  const toneTarget = fingerprint.tone;
  // formality 근사: 문장 길이가 길수록 격식 있다고 가정
  const estimatedFormality = clamp(actualSentenceLength / 80, 0, 1);
  const toneDev = Math.abs(estimatedFormality - toneTarget.formality);
  // emotional 근사: 느낌표/감정단어 포함 비율
  const emojiCount = (generatedText.match(/[\u{1F000}-\u{1FFFF}]/gu) ?? []).length;
  const estimatedEmotion = clamp(emojiCount / Math.max(sentences.length, 1) * 0.3, 0, 1);
  const emoDev = Math.abs(estimatedEmotion - toneTarget.emotional_valence);

  const tone_deviation = clamp((toneDev + emoDev) / 2, 0, 1);
  if (tone_deviation > (fingerprint.controls.max_deviation ?? 0.3)) {
    failures.push(`톤 편차 ${tone_deviation.toFixed(2)} > 허용 ${fingerprint.controls.max_deviation?.toFixed(2)}`);
  }

  // ── Structure 측정 ─────────────────────────────────────────────
  const targetLength = fingerprint.structure.avg_sentence_length;
  const lengthRatio = targetLength > 0
    ? Math.abs(actualSentenceLength - targetLength) / Math.max(targetLength, 1)
    : 0;
  const structure_deviation = clamp(lengthRatio, 0, 1);
  if (structure_deviation > (fingerprint.controls.max_deviation ?? 0.3)) {
    failures.push(`구조 편차 ${structure_deviation.toFixed(2)} > 허용 ${fingerprint.controls.max_deviation?.toFixed(2)}`);
  }

  // ── Lexicon 측정 ───────────────────────────────────────────────
  const avoidWords = fingerprint.lexicon.avoid_words ?? [];
  const matched = avoidWords.filter(w => generatedText.includes(w));
  const lexicon_deviation = matched.length > 0
    ? clamp(matched.length / Math.max(avoidWords.length, 1), 0, 1)
    : 0;
  if (matched.length > 0) {
    failures.push(`금지어 사용: ${matched.join(', ')}`);
  }

  // ── 종합 ──────────────────────────────────────────────────────
  const overall_deviation = clamp(
    (tone_deviation + structure_deviation + lexicon_deviation) / 3,
    0, 1,
  );
  const passed = overall_deviation <= (fingerprint.controls.max_deviation ?? 0.3);

  return {
    overall_deviation,
    tone_deviation,
    structure_deviation,
    lexicon_deviation,
    failures,
    passed,
  };
}
