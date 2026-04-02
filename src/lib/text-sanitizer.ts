/**
 * @file text-sanitizer.ts
 * @description C 파서 정제/검증 레이어
 *
 * 3단계 파이프라인:
 * 1. sanitizeText() — 정규화 사전 기반 오타 교정
 * 2. validateExclusions() — 불포함 가드레일 (필수 항목 누락 경고)
 * 3. maskProprietaryData() — 커미션/원가/연락처 마스킹 (고객 노출용)
 *
 * 원칙: raw_text는 절대 수정하지 않음. sanitized_text를 별도 생성.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = any;

// ── 타입 정의 ─────────────────────────────────────────────────────────────────

export interface NormalizationRule {
  typo_pattern: string;
  correct_text: string;
  category: string;
  priority: number;
}

export interface ExclusionRule {
  rule_name: string;
  match_keywords: string[];
  severity: 'warning' | 'error';
  description: string | null;
}

export interface SanitizeResult {
  sanitizedText: string;
  corrections: Array<{ from: string; to: string }>;
}

export interface ExclusionResult {
  passed: boolean;
  warnings: Array<{ rule: string; description: string }>;
  errors: Array<{ rule: string; description: string }>;
}

export interface FullSanitizeResult {
  sanitizedText: string;
  corrections: Array<{ from: string; to: string }>;
  exclusionWarnings: Array<{ rule: string; description: string }>;
  exclusionErrors: Array<{ rule: string; description: string }>;
  hasCriticalIssues: boolean;
}

// ── 정규식 특수문자 이스케이프 ────────────────────────────────────────────────

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── 인메모리 캐시 (5분 TTL) ──────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5분
const cache: Record<string, CacheEntry<unknown>> = {};

function getCached<T>(key: string): T | null {
  const entry = cache[key] as CacheEntry<T> | undefined;
  if (entry && Date.now() < entry.expiry) return entry.data;
  delete cache[key];
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache[key] = { data, expiry: Date.now() + CACHE_TTL_MS };
}

/** 캐시 강제 무효화 (관리자가 사전 업데이트 후 호출) */
export function invalidateSanitizerCache(): void {
  delete cache['norm_rules'];
  delete cache['excl_rules'];
}

// ── Step 1: 정규화 사전 기반 오타 교정 ──────────────────────────────────────

/**
 * 텍스트에서 알려진 오타를 표준어로 교정합니다.
 * raw_text는 변경하지 않고, sanitized_text를 새로 생성합니다.
 */
export function sanitizeText(
  rawText: string,
  rules: NormalizationRule[]
): SanitizeResult {
  let sanitized = rawText;
  const corrections: Array<{ from: string; to: string }> = [];

  // priority 내림차순 정렬 (높은 우선순위 먼저)
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);

  for (const rule of sorted) {
    // 이미 맞는 경우 스킵 (typo === correct)
    if (rule.typo_pattern === rule.correct_text) continue;

    const escaped = escapeRegExp(rule.typo_pattern);
    const regex = new RegExp(escaped, 'g');

    if (regex.test(sanitized)) {
      corrections.push({ from: rule.typo_pattern, to: rule.correct_text });
      sanitized = sanitized.replace(regex, rule.correct_text);
    }
  }

  return { sanitizedText: sanitized, corrections };
}

// ── Step 2: 불포함 가드레일 ──────────────────────────────────────────────────

/**
 * 상품 텍스트에서 필수 불포함/주의사항 항목의 존재 여부를 검사합니다.
 * match_keywords 중 하나라도 있으면 해당 룰은 통과.
 * 하나도 없으면 경고(warning) 또는 에러(error).
 */
export function validateExclusions(
  fullText: string,
  rules: ExclusionRule[]
): ExclusionResult {
  const warnings: Array<{ rule: string; description: string }> = [];
  const errors: Array<{ rule: string; description: string }> = [];

  for (const rule of rules) {
    const found = rule.match_keywords.some(kw =>
      fullText.includes(kw)
    );

    if (!found) {
      const entry = {
        rule: rule.rule_name,
        description: rule.description || `${rule.rule_name} 관련 내용이 없습니다.`,
      };

      if (rule.severity === 'error') {
        errors.push(entry);
      } else {
        warnings.push(entry);
      }
    }
  }

  return { passed: errors.length === 0, warnings, errors };
}

// ── Step 3: 민감정보 마스킹 (고객 노출용) ────────────────────────────────────

/**
 * 커미션%, 원가, 전화번호, 이메일 등을 마스킹합니다.
 * 포스터/랜딩/블로그 렌더링 시 사용.
 *
 * 기존 admin/packages/page.tsx의 sanitizeRawText() 서버사이드 버전.
 */
export function maskProprietaryData(text: string): string {
  return text
    // 수수료/커미션 % 마스킹
    .replace(
      /.*[수수료커미션].{0,20}\d+\.?\d*\s*%.*|.*\d+\.?\d*\s*%.*[수수료커미션].*/gim,
      '[여소남 공식 채널]'
    )
    // 입금가/원가/랜드가/net price 마스킹
    .replace(
      /.*(?:입금가|원가|랜드가|net\s*price|기본가).{0,50}\d[\d,]+원?.*/gim,
      '[여소남 공식 채널]'
    )
    // 전화번호 마스킹
    .replace(
      /0(?:2|3[1-3]|4[1-4]|5[1-5]|6[1-4]|70)\s*[-.]?\s*\d{3,4}\s*[-.]?\s*\d{4}/g,
      '[여소남 공식 채널]'
    )
    // 이메일 마스킹
    .replace(
      /[\w.+-]+@[\w-]+\.[a-z]{2,}/gi,
      '[여소남 공식 채널]'
    )
    // 랜드사명 마스킹 (직접 노출 방지)
    .replace(
      /(?:랜드부산|투어폰|투어비|현지투어|나라투어)\s*/gi,
      ''
    );
}

// ── 통합 파이프라인 ──────────────────────────────────────────────────────────

/**
 * DB에서 정규화 사전을 로드합니다 (캐시 적용).
 */
export async function loadNormalizationRules(
  supabaseAdmin: AnySupabaseClient
): Promise<NormalizationRule[]> {
  const cached = getCached<NormalizationRule[]>('norm_rules');
  if (cached) return cached;

  const { data, error } = await supabaseAdmin
    .from('normalization_rules')
    .select('typo_pattern, correct_text, category, priority')
    .eq('is_active', true)
    .order('priority', { ascending: false });

  if (error) {
    console.error('[Sanitizer] 정규화 사전 로드 실패:', error.message);
    return [];
  }

  const rules = (data || []) as NormalizationRule[];
  setCache('norm_rules', rules);
  return rules;
}

/**
 * DB에서 불포함 가드레일 규칙을 로드합니다 (캐시 적용).
 */
export async function loadExclusionRules(
  supabaseAdmin: AnySupabaseClient,
  category: string
): Promise<ExclusionRule[]> {
  const cacheKey = `excl_rules_${category}`;
  const cached = getCached<ExclusionRule[]>(cacheKey);
  if (cached) return cached;

  const { data, error } = await supabaseAdmin
    .from('exclusion_rules')
    .select('rule_name, match_keywords, severity, description')
    .eq('category', category)
    .eq('is_active', true);

  if (error) {
    console.error('[Sanitizer] 가드레일 규칙 로드 실패:', error.message);
    return [];
  }

  const rules = (data || []) as ExclusionRule[];
  setCache(cacheKey, rules);
  return rules;
}

/**
 * 전체 정제 파이프라인을 실행합니다.
 *
 * @param rawText - 랜드사 원문 텍스트
 * @param category - 상품 카테고리 ('golf' | 'tour' | 'cruise' | 'resort')
 * @param supabaseAdmin - Service Role 클라이언트
 * @returns 정제 결과 (교정 내역 + 누락 경고)
 */
export async function runSanitizePipeline(
  rawText: string,
  category: string,
  supabaseAdmin: AnySupabaseClient
): Promise<FullSanitizeResult> {
  // Step 1: 오타 교정
  const normRules = await loadNormalizationRules(supabaseAdmin);
  const { sanitizedText, corrections } = sanitizeText(rawText, normRules);

  // Step 2: 불포함 가드레일
  // 카테고리 매핑 (패키지→tour, 골프→golf 등)
  const exclCategory = category.includes('골프') || category === 'golf' ? 'golf' : 'tour';
  const exclRules = await loadExclusionRules(supabaseAdmin, exclCategory);
  const { warnings, errors } = validateExclusions(sanitizedText, exclRules);

  return {
    sanitizedText,
    corrections,
    exclusionWarnings: warnings,
    exclusionErrors: errors,
    hasCriticalIssues: errors.length > 0,
  };
}

/**
 * 상품의 excludes 배열 + special_notes + raw_text를 합쳐서
 * 가드레일 검사용 전체 텍스트를 생성합니다.
 */
export function buildFullTextForValidation(params: {
  rawText?: string;
  excludes?: string[];
  specialNotes?: string;
  noticesParsed?: Array<{ text?: string }>;
  inclusions?: string[];
}): string {
  const parts: string[] = [];

  if (params.rawText) parts.push(params.rawText);
  if (params.excludes?.length) parts.push(params.excludes.join(' '));
  if (params.specialNotes) parts.push(params.specialNotes);
  if (params.inclusions?.length) parts.push(params.inclusions.join(' '));
  if (params.noticesParsed?.length) {
    parts.push(params.noticesParsed.map(n => n.text || '').join(' '));
  }

  return parts.join(' ');
}
