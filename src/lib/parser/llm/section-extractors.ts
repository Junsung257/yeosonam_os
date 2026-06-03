/**
 * @file section-extractors.ts — 등록 파이프라인 7 도메인 LLM hierarchy 통합
 *
 * 2026-05-17 박제 (사장님 5번 반복 의도 "섹션별 LLM 처리" 전체 적용):
 *
 * CLAUDE.md 12절 hierarchy 를 attractions 만 적용했던 사고 종결:
 *   - destination/display_title/product_summary  → extractHeroContextWithLLM
 *   - price_dates (요금표 비표준 표)              → extractPriceTableWithLLM
 *   - inclusions/excludes/notices_parsed         → extractInclusionsExcludesNoticesWithLLM
 *
 * 학술 출처: Mihalcea & Csomai 2007 + Andersen 2008 + Asai 2023 Self-RAG (map-reduce LLM).
 * 호출 비용: 패키지 1개당 ~$0.005 (DeepSeek Flash + prompt cache).
 *
 * 호출 전략 (fire-and-forget):
 *   upload/route.ts 등록 직후 → 3 함수 병렬 호출 → DB UPDATE → revalidate.
 *   기존 regex parser 가 0건/빈약하면 fallback 으로만 LLM 사용 (cost ascending).
 */

import { z } from 'zod';
import { llmCall } from '../../llm-gateway';
import { callWithZodValidation } from '../../llm-validate-retry';
import { KOREAN_DESTINATION_TO_ISO } from '../../destination-iso';
import { looksLikeCommaSplitBroken } from '../deterministic/comma-split-signature';
import { extractPriceMatrix } from '../deterministic/price-matrix';
import { extractPriceTable } from '../deterministic/price-table';
import { extractVerticalGradePriceTable } from '../deterministic/vertical-grade-price-table';

// ═══════════════════════════════════════════════════════════════════════════
//  공통 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

function cleanJsonResponse(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

async function callJsonLLM<T>(
  label: string,
  schema: z.ZodType<T>,
  systemPrompt: string,
  userPrompt: string,
  jsonSchema: Record<string, unknown>,
  maxTokens = 2000,
): Promise<{ success: true; value: T } | { success: false; reason: string }> {
  // 2026-05-18 박제 (ERR-llm-retry-stack): 외부 maxAttempts × 내부 maxRetries 중첩 차단.
  //   외부 callWithZodValidation 이 feedback loop 로 1회 재시도 → 내부 llmCall maxRetries=1
  //   총 호출 상한: 2 × (1+1) = 4회. 기존 2 × (3+1) = 8회에서 50% 절감.
  const result = await callWithZodValidation<T>({
    label,
    schema,
    maxAttempts: 2,
    preprocessor: cleanJsonResponse,
    fn: async (feedback) => {
      const prompt = feedback ? `${userPrompt}\n\n[이전 오류] ${feedback}\n다시 JSON 만.` : userPrompt;
      const r = await llmCall<unknown>({
        task: 'parse_travel_doc',
        systemPrompt,
        userPrompt: prompt,
        maxTokens,
        jsonSchema,
        maxRetries: 1,
      });
      if (!r.success) throw new Error(r.errors?.join('; ') || 'LLM 실패');
      const data = (r as { data?: unknown }).data;
      if (data !== undefined && data !== null) return JSON.stringify(data);
      if (r.rawText && r.rawText.length > 0) return r.rawText;
      throw new Error('LLM 응답 없음');
    },
  });
  if (result.success) return { success: true, value: result.value };
  return { success: false, reason: result.attemptErrors?.[result.attemptErrors.length - 1] ?? 'unknown' };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ① Hero Context — destination + display_title + product_summary + hero_tagline
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 2026-05-18 박제 (CLAUDE.md §12-1 L1 rule):
 *   Hero context 가 L3 (LLM) 직접 호출만 있던 사고 (extractHeroContextWithLLM).
 *   제목 첫 줄에서 KOREAN_DESTINATION_TO_ISO 키를 substring 매칭해 destination 우선 추출.
 *   destination + display_title 모두 잡히면 LLM 호출 자체 skip → 토큰 절감 ~30%.
 *
 * 환각 차단:
 *   product_summary, hero_tagline 은 자동 생성 안 함 (NULL 유지 → 어드민 수동 입력 우선).
 *   사장님 정책 [[feedback_card_news_faithfulness]]: 원문 명시 안 한 사실 자동 추가 금지.
 */
export function extractHeroContextL1(rawText: string): {
  destination?: string;
  display_title?: string;
  confidence: 'high' | 'low';
} {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { confidence: 'low' };

  // 제목 라인 후보: 첫 5줄 중 적절한 길이 (6~80자) + "일정표/일자" 등 헤더 제외
  let titleLine = lines[0];
  for (const ln of lines.slice(0, 5)) {
    if (ln.length < 6 || ln.length > 80) continue;
    if (/^(일\s*자|일정\s*표|DAY\s*\d|제\s*\d\s*일)/i.test(ln)) continue;
    titleLine = ln;
    break;
  }

  // KOREAN_DESTINATION_TO_ISO 키 중 titleLine 에서 매칭. 긴 토큰 우선 (prefix 충돌 차단).
  const tokens = Object.keys(KOREAN_DESTINATION_TO_ISO).sort((a, b) => b.length - a.length);
  const found: string[] = [];
  const remaining = titleLine;
  for (const tok of tokens) {
    if (tok.length < 2) continue;
    if (remaining.includes(tok)) {
      // 이미 추가된 더 긴 토큰의 substring 이면 skip (예: "후쿠오카" 추가 후 "후쿠" skip)
      if (found.some(f => f.includes(tok))) continue;
      found.push(tok);
      if (found.length >= 3) break;
    }
  }

  const trimmedTitle = titleLine.length <= 40 ? titleLine : titleLine.slice(0, 40);

  if (found.length === 0) {
    return { display_title: trimmedTitle, confidence: 'low' };
  }

  return {
    destination: found.join('/'),
    display_title: trimmedTitle,
    confidence: 'high',
  };
}

const HeroContextSchema = z.object({
  destination: z.string().min(2),
  display_title: z.string().min(2),
  product_summary: z.string().min(10),
  hero_tagline: z.string().min(5),
});
export type HeroContext = z.infer<typeof HeroContextSchema>;

/**
 * raw_text 의 제목·헤더·일정·요금 구간 종합 → 4개 hero 필드 한 번에 추출.
 *
 * 사고 사례:
 *   - 후쿠오카: parser 가 본문 한 줄 ("벳부의 명물인 지옥온천 순례...") 을 destination 으로 박음
 *   - product_summary 자동 합성 → destination 환각 연쇄
 *   - display_title NULL → 모바일 hero 후킹 없음
 */
export async function extractHeroContextWithLLM(
  rawText: string,
): Promise<{ success: true; value: HeroContext } | { success: false; reason: string }> {
  if (!rawText || rawText.length < 50) return { success: false, reason: 'raw-text-too-short' };
  // 토큰 절약: 첫 1500자만 (제목·헤더 구간이면 충분)
  const head = rawText.slice(0, 1500);
  const userPrompt = `다음 여행상품 원문에서 4개 필드를 추출:
${head}

추출 규칙:
1. destination: 여행 목적지 도시명 (제목 / 본문 첫 5줄에서 우선). 예: "유후인/벳부/아소/쿠로가와", "북해도", "시즈오카". 본문 설명 한 줄을 채택하면 안 됨.
2. display_title: 모바일 hero 후킹용 짧은 헤드라인 (40자 이내). 제목 라인 + 핵심 셀링포인트.
3. product_summary: 한 줄 요약 (80~150자). 항공·호텔·핵심 코스 명시. 사실 기반, 환각 금지.
4. hero_tagline: 8~20자 짧은 후킹 (예: "온천1박+시내1박 ♨ 큐슈 4대 핵심").

JSON: {"destination":"...","display_title":"...","product_summary":"...","hero_tagline":"..."}`;

  return callJsonLLM(
    'extract-hero-context',
    HeroContextSchema,
    '한국어 여행상품 hero 정보 추출 전문가. raw JSON 만.',
    userPrompt,
    {
      type: 'object',
      properties: {
        destination: { type: 'string' },
        display_title: { type: 'string' },
        product_summary: { type: 'string' },
        hero_tagline: { type: 'string' },
      },
      required: ['destination', 'display_title', 'product_summary', 'hero_tagline'],
    },
    1500,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  ② Price Table — 요금표 비표준 표 추출 (extractPriceTable L1 fallback)
// ═══════════════════════════════════════════════════════════════════════════

const PriceRowSchema = z.object({
  date: z.string().min(4),  // "2026-06-17" or "06-17" or "6/17"
  adult_price: z.coerce.number().int().positive(),
  child_price: z.coerce.number().int().nullable().optional(),
  note: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});
const PriceTableSchema = z.object({
  rows: z.array(PriceRowSchema),
});
export type PriceRow = z.infer<typeof PriceRowSchema>;

/**
 * 비표준 요금표 LLM 추출. L1 (extractPriceTable regex) 가 0건/빈약할 때 fallback.
 *
 * 2026-05-17 박제 (사고 ERR-LLM-price-truncate):
 *   후쿠오카 8구간 × 100+ row 한 번 호출 → JSON max_tokens 초과 truncate → 파싱 fail.
 *   → 구간(월별/range) 단위 chunk 분할 후 병렬 호출 (Asai 2023 Self-RAG map-reduce).
 */
export async function extractPriceTableWithLLM(
  rawText: string,
  todayYear?: number,
): Promise<{ success: true; rows: PriceRow[] } | { success: false; reason: string }> {
  if (!rawText || rawText.length < 50) return { success: false, reason: 'raw-text-too-short' };
  const year = todayYear ?? new Date().getFullYear();

  // 일정표 시작점 ("제1일", "DAY 1", "일 자") 찾고 그 전까지가 가격+비고 영역.
  // 한국 카탈로그는 보통 [제목 → 요금표 → 포함/불포함 → 비고 → 일정표] 순서.
  const itinHints = ['제1일', 'DAY 1', 'Day 1', '제 1 일', '일 자\n', '일자\n'];
  let endIdx = rawText.length;
  for (const hint of itinHints) {
    const i = rawText.indexOf(hint);
    if (i >= 0 && i < endIdx) endIdx = i;
  }
  // 가격 영역만 잡기 위해 비고/포함 섹션 직전까지 자름. "포 함", "비 고", "포함사항" 등.
  const stopHints = ['포 함 사 항', '포함사항', '포 함', '비 고', '주의사항', '주의 사항', '★출발 4주', '최소출발인원'];
  let stopIdx = endIdx;
  for (const hint of stopHints) {
    const i = rawText.indexOf(hint);
    if (i >= 0 && i < stopIdx) stopIdx = i;
  }
  const full = rawText.slice(0, Math.min(stopIdx, 4500));

  // 구간 분할 — 1500자 단위 chunk (line boundary 보존)
  const CHUNK_SIZE = 1500;
  const finalChunks: string[] = [];
  if (full.length <= CHUNK_SIZE) {
    finalChunks.push(full);
  } else {
    const lines = full.split(/\r?\n/);
    let buf = '';
    for (const line of lines) {
      if (buf.length + line.length + 1 > CHUNK_SIZE && buf.length > 0) {
        finalChunks.push(buf);
        buf = line;
      } else {
        buf += (buf ? '\n' : '') + line;
      }
    }
    if (buf.length > 0) finalChunks.push(buf);
  }

  // 각 chunk 병렬 호출 (max_tokens 2000 안전)
  const results = await Promise.all(finalChunks.map(async (chunk) => {
    const prompt = `다음 여행상품 요금 구간에서 모든 출발일+가격을 추출:
${chunk}

규칙:
- date 는 "${year}-MM-DD" 형식. "5/7" → "${year}-05-07".
- 요일 라벨 ("일~화", "수 특가") 은 해당 범위 [날짜~날짜] 안의 모든 해당 요일을 각각 row 로.
- "★ 출확" / "(10명 출확 조건)" / "선발권 특가" 는 note 에. status 는 그대로 비워둠.
- "5/27 제외" 같은 제외문은 그 날짜만 row 에서 빼고 note 에 명시.
- 콤마 천 단위 가격 → 정수. "779,000원" → 779000.

JSON: {"rows":[{"date":"${year}-05-07","adult_price":779000,"note":"일~화"}, ...]}`;

    return callJsonLLM(
      'extract-price-table-chunk',
      PriceTableSchema,
      '한국어 여행상품 요금표 추출 전문가. raw JSON 만.',
      prompt,
      {
        type: 'object',
        properties: {
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string' },
                adult_price: { type: 'integer' },
                child_price: { type: 'integer' },
                note: { type: 'string' },
                status: { type: 'string' },
              },
              required: ['date', 'adult_price'],
            },
          },
        },
        required: ['rows'],
      },
      2000,
    );
  }));

  const allRows: PriceRow[] = [];
  const errors: string[] = [];
  for (const r of results) {
    if (r.success) allRows.push(...r.value.rows);
    else errors.push(r.reason.slice(0, 100));
  }

  if (allRows.length === 0) {
    return { success: false, reason: errors.length > 0 ? `all-chunks-failed: ${errors[0]}` : 'no-rows-extracted' };
  }
  // 중복 제거 (date + adult_price + note)
  const seen = new Set<string>();
  const dedup = allRows.filter(r => {
    const key = `${r.date}|${r.adult_price}|${r.note ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { success: true, rows: dedup };
}

/** L1 deterministic: 매트릭스 → 월별 카탈로그 순. 토큰 0. */
function extractPriceDeterministicL1(rawText: string): PriceRow[] {
  const matrix = extractPriceMatrix(rawText);
  if (matrix.length > 0) {
    return matrix.map(r => ({
      date: r.date,
      adult_price: r.adult_price,
      child_price: r.child_price ?? null,
      note: r.note ?? null,
      status: r.status ?? 'available',
    }));
  }
  const tiers = extractPriceTable(rawText);
  const rows: PriceRow[] = [];
  for (const t of tiers) {
    for (const d of t.departure_dates ?? []) {
      rows.push({
        date: d,
        adult_price: t.adult_price,
        child_price: t.child_price ?? null,
        note: t.note ?? t.period_label ?? null,
        status: t.status ?? 'available',
      });
    }
  }
  if (rows.length > 0) return rows;

  const verticalTiers = extractVerticalGradePriceTable(rawText);
  for (const t of verticalTiers) {
    for (const d of t.departure_dates ?? []) {
      rows.push({
        date: d,
        adult_price: t.adult_price,
        child_price: t.child_price ?? null,
        note: t.note ?? t.period_label ?? null,
        status: t.status ?? 'available',
      });
    }
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ③ Inclusions / Excludes / Notices
// ═══════════════════════════════════════════════════════════════════════════

const InclExclNoticeSchema = z.object({
  inclusions: z.array(z.string()),
  excludes: z.array(z.string()),
  notices: z.array(z.object({
    type: z.enum(['CRITICAL', 'PAYMENT', 'POLICY', 'INFO', 'PRICING_RULE']),
    title: z.string(),
    text: z.string(),
  })),
});
export type InclExclNotice = z.infer<typeof InclExclNoticeSchema>;

/**
 * 포함/불포함/비고 LLM 추출 + 5-type 자동 분류.
 *
 * 5 types (notices_parsed 확장):
 *   - CRITICAL    : 취소/환불/면책
 *   - PAYMENT     : 추가 요금 (유류할증료/가이드경비/싱글차지)
 *   - POLICY      : 현장 규정 (쇼핑·예약·인원 조건)
 *   - INFO        : 정보 안내 (호텔 변경 가능성 / 항공 스케줄)
 *   - PRICING_RULE: 가격 정책 (아동 = 성인가 등)
 */
export async function extractInclusionsExcludesNoticesWithLLM(
  rawText: string,
): Promise<{ success: true; value: InclExclNotice } | { success: false; reason: string }> {
  if (!rawText || rawText.length < 50) return { success: false, reason: 'raw-text-too-short' };

  // "포 함" / "불포함" / "비 고" 섹션 ±2000자만 추출
  const hints = ['포 함', '포함', '불포함', '비 고', '비고', '주의사항', '주의 사항', '특전', '특별 약관'];
  const starts: number[] = [];
  for (const h of hints) {
    const i = rawText.indexOf(h);
    if (i >= 0) starts.push(i);
  }
  const startIdx = starts.length > 0 ? Math.max(0, Math.min(...starts) - 100) : 0;
  const segment = rawText.slice(startIdx, Math.min(rawText.length, startIdx + 3000));

  const userPrompt = `다음 여행상품 원문에서 포함/불포함/비고를 추출:
${segment}

규칙:
- inclusions: 포함 사항 (각 항목 1줄). 예: "왕복항공권+TAX", "전일정 호텔숙박 (2인1실)", "관광지 입장료", "전용차량"
- excludes: 불포함 사항. 예: "유류세(5월 기준 155,600원)", "가이드경비(3만원 성인/아동 동일)", "기타 개인경비"
- notices: 비고/현장규정/취소약관 항목 자동 분류:
  * CRITICAL: 취소/환불/면책/특별약관
  * PAYMENT: 유류할증료/가이드경비/싱글차지/추가 요금
  * POLICY: 면세점 방문 / 최소 인원 / 예약 조건 / 쇼핑 규정
  * INFO: 호텔 변경 가능성 / 항공 스케줄 변경 / 객실 특성
  * PRICING_RULE: 아동가 성인 동일 / 3인실 조건 등 가격 정책

JSON: {"inclusions":[...], "excludes":[...], "notices":[{"type":"...","title":"...","text":"..."}, ...]}`;

  return callJsonLLM(
    'extract-incl-excl-notices',
    InclExclNoticeSchema,
    '한국어 여행상품 포함/불포함/비고 추출 + 분류 전문가. raw JSON 만.',
    userPrompt,
    {
      type: 'object',
      properties: {
        inclusions: { type: 'array', items: { type: 'string' } },
        excludes: { type: 'array', items: { type: 'string' } },
        notices: {
          type: 'array',
          items: {
            type: 'object',
            properties: { type: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' } },
            required: ['type', 'title', 'text'],
          },
        },
      },
      required: ['inclusions', 'excludes', 'notices'],
    },
    3000,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Orchestration — 패키지 1개에 3 함수 모두 적용 + DB UPDATE
// ═══════════════════════════════════════════════════════════════════════════

const MIN_BACKFILL_RAW_LEN = 100;

/** travel_packages.raw_text → normalized_intakes → 정형 필드 합성 순으로 원문 확보 */
async function resolveBackfillRawText(
  packageId: string,
  columnRaw?: string | null,
): Promise<{ raw: string; source: string } | { raw: null; reason: string }> {
  const fromColumn = (columnRaw ?? '').trim();
  if (fromColumn.length >= MIN_BACKFILL_RAW_LEN) {
    return { raw: fromColumn, source: 'travel_packages.raw_text' };
  }

  const { getPackageRawText } = await import('@/lib/packages/raw-text');
  const resolved = await getPackageRawText(packageId);
  if (!resolved.ok) {
    return { raw: null, reason: resolved.error };
  }

  const raw = resolved.data.rawText.trim();
  if (raw.length < MIN_BACKFILL_RAW_LEN) {
    return { raw: null, reason: 'raw-text-empty' };
  }
  return { raw, source: resolved.data.source };
}

/**
 * 패키지 1개의 raw_text 로 7 도메인 LLM hierarchy 적용:
 *   ① Hero context (destination, display_title, product_summary, hero_tagline)
 *   ② Price table (price_dates)
 *   ③ Inclusions / Excludes / Notices
 *
 * 호출 정책:
 *   - onlyIfBlank: true (default) → 기존 값 있으면 skip. NULL/빈 컬럼만 채움.
 *   - force: true → 기존 값 있어도 LLM 호출하고 overwrite (사장님 명시 트리거용)
 *
 * 사장님 정책 박제: 기존 값 verbatim 보존. LLM 은 NULL 채우기·sanity check 만.
 */
export async function backfillSectionsByPackageId(
  packageId: string,
  options: { force?: boolean } = {},
): Promise<{
  ok: boolean;
  reason?: string;
  hero?: { applied: boolean; reason?: string };
  price?: { applied: boolean; rowCount?: number; reason?: string };
  notices?: { applied: boolean; counts?: { inc: number; exc: number; not: number }; reason?: string };
}> {
  const { supabaseAdmin, isSupabaseConfigured } = await import('../../supabase');
  if (!isSupabaseConfigured) return { ok: false, reason: 'supabase-not-configured' };

  const { data: pkg, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id, title, raw_text, destination, display_title, product_summary, hero_tagline, price_dates, price_tiers, inclusions, excludes, notices_parsed, surcharges, special_notes, itinerary_data')
    .eq('id', packageId)
    .maybeSingle();
  if (error || !pkg) return { ok: false, reason: error?.message ?? 'package-not-found' };

  const resolved = await resolveBackfillRawText(
    packageId,
    (pkg as { raw_text?: string | null }).raw_text,
  );
  if (!resolved.raw) return { ok: false, reason: 'reason' in resolved ? resolved.reason : 'raw-text-empty' };
  const raw = resolved.raw;

  const p = pkg as {
    title?: string | null;
    destination?: string | null; display_title?: string | null;
    product_summary?: string | null; hero_tagline?: string | null;
    price_dates?: unknown; price_tiers?: unknown;
    inclusions?: unknown; excludes?: unknown; notices_parsed?: unknown;
  };
  const force = options.force === true;
  const noticesBroken = looksLikeCommaSplitBroken(p.inclusions as unknown[]) || looksLikeCommaSplitBroken(p.excludes as unknown[]);
  const effectiveForce = force || noticesBroken;
  const { inferTravelYearFromText } = await import('../../period-label-dates');
  const travelYear = inferTravelYearFromText(p.title, p.display_title, raw.slice(0, 200));

  // L0: price_tiers → price_dates (period_label hydrate 포함)
  if (!effectiveForce && (!Array.isArray(p.price_dates) || (p.price_dates as unknown[]).length === 0)) {
    const tiers = Array.isArray(p.price_tiers) ? p.price_tiers : [];
    if (tiers.length > 0) {
      const { hydratePriceTiers } = await import('../../period-label-dates');
      const { tiersToDatePrices } = await import('../../price-dates');
      const hydrated = hydratePriceTiers(tiers as import('../../parser').PriceTier[], { year: travelYear });
      const fromTiers = tiersToDatePrices(hydrated, { year: travelYear });
      if (fromTiers.length > 0) {
        const priceDates = fromTiers.map(r => ({
          date: r.date,
          price: r.price,
          child_price: r.child_price ?? null,
          note: null,
          status: r.confirmed ? 'confirmed' : 'available',
        }));
        const tierPatch = JSON.stringify(hydrated) !== JSON.stringify(tiers)
          ? { price_tiers: hydrated }
          : {};
        const l0Update: Record<string, unknown> = {
          price_dates: priceDates,
          ...tierPatch,
          updated_at: new Date().toISOString(),
        };
        const { sanitizePackageUpdate } = await import('../../customer-leak-sanitizer');
        const l0San = sanitizePackageUpdate(l0Update, p as Record<string, unknown>);
        Object.assign(l0Update, l0San.cleaned);
        const { error: tierUpErr } = await supabaseAdmin
          .from('travel_packages')
          .update(l0Update)
          .eq('id', packageId);
        if (!tierUpErr) {
          await refreshAuditAfterBackfill(packageId);
          try {
            const { revalidatePackagePaths } = await import('../../revalidate-helper');
            await revalidatePackagePaths(packageId, { alsoServerContext: true });
          } catch { /* no-op */ }
          return {
            ok: true,
            price: { applied: true, rowCount: priceDates.length, reason: 'L0-price-tiers' },
          };
        }
      }
    }
  }

  // 3 함수 병렬 호출 (cost ↓, 응답 시간 ↓)
  const heroNeeded = effectiveForce || !p.destination || p.destination.length < 2 ||
    !p.display_title || !p.product_summary || !p.hero_tagline;
  const priceNeeded = effectiveForce || !Array.isArray(p.price_dates) || (p.price_dates as unknown[]).length === 0;
  // P2-8 (2026-05-24): price_tiers만 있고 price_dates가 없으면 L0 retry 후에도 실패 시 LLM skip
  //   (price_tiers는 이미 upload route에서 추출한 결과이므로 LLM 재추출 불필요)
  const hasTiers = Array.isArray(p.price_tiers) && (p.price_tiers as unknown[]).length > 0;
  const priceSkipFromTiers = hasTiers && priceNeeded && !effectiveForce;
  const noticesNeeded = effectiveForce || noticesBroken ||
    !Array.isArray(p.inclusions) || (p.inclusions as unknown[]).length === 0 ||
    !Array.isArray(p.excludes) || (p.excludes as unknown[]).length === 0 ||
    !Array.isArray(p.notices_parsed) || (p.notices_parsed as unknown[]).length === 0;

  // 2026-05-18 박제 (CLAUDE.md §12-1 L1 rule):
  //   Hero LLM 호출 전 제목 regex 시도. destination + display_title 둘 다 잡히면 LLM skip.
  //   force=true 면 L1 우회 (사장님이 직접 강제 재추출 요청한 경우).
  //   토큰 절감 ~30% (제목 명확한 신규 패키지 대다수).
  let heroL1Skipped = false;
  const heroL1 = (heroNeeded && !effectiveForce && (!p.destination || p.destination.length < 2 || !p.display_title))
    ? extractHeroContextL1(raw)
    : null;

  // L1 high confidence 시 hero LLM 호출 skip 결정
  const heroL1Sufficient = !!(heroNeeded && heroL1?.confidence === 'high' && heroL1.destination && heroL1.display_title);
  if (heroL1Sufficient) heroL1Skipped = true;

  const detPriceRows = priceNeeded ? extractPriceDeterministicL1(raw) : [];
  const detPriceOk = detPriceRows.length > 0;

  const [heroR, priceR, noticeR] = await Promise.all([
    heroL1Sufficient ? Promise.resolve(null) : (heroNeeded ? extractHeroContextWithLLM(raw) : Promise.resolve(null)),
    priceNeeded && !detPriceOk && !priceSkipFromTiers ? extractPriceTableWithLLM(raw) : Promise.resolve(null),
    noticesNeeded ? extractInclusionsExcludesNoticesWithLLM(raw) : Promise.resolve(null),
  ]);

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const result: Awaited<ReturnType<typeof backfillSectionsByPackageId>> = { ok: true };

  // ① Hero
  if (!heroNeeded) {
    result.hero = { applied: false, reason: 'already-filled' };
  } else if (heroL1Skipped && heroL1) {
    // L1 rule 적용: destination + display_title 만 박고 LLM skip (~30% 토큰 절감)
    if (!p.destination || p.destination.length < 2) update.destination = heroL1.destination;
    if (!p.display_title) {
      const titleTrimmed = (p.title ?? '').trim();
      update.display_title = titleTrimmed.length >= 5
        ? titleTrimmed.slice(0, 40)
        : heroL1.display_title;
    }
    // product_summary, hero_tagline 은 NULL 유지 (환각 차단 — 어드민 수동 입력)
    result.hero = { applied: true, reason: 'L1-rule' };
  } else if (heroR && heroR.success) {
    if (effectiveForce || !p.destination || p.destination.includes('명물') || p.destination.includes('순례')) {
      update.destination = heroR.value.destination;
    }
    if (effectiveForce || !p.display_title) update.display_title = heroR.value.display_title;
    if (effectiveForce || !p.product_summary || p.product_summary.includes('명물') || p.product_summary.includes('순례')) {
      update.product_summary = heroR.value.product_summary;
    }
    if (effectiveForce || !p.hero_tagline) update.hero_tagline = heroR.value.hero_tagline;
    result.hero = { applied: true };
  } else if (heroR) {
    result.hero = { applied: false, reason: heroR.reason };
  }

  // ② Price
  if (!priceNeeded) {
    result.price = { applied: false, reason: 'already-filled' };
  } else if (priceSkipFromTiers) {
    // P2-8: price_tiers가 이미 존재 → LLM 재추출 불필요, L0 실패는 자체 처리
    result.price = { applied: false, reason: 'skip-from-tiers' };
    console.log(`[L3] priceSkipFromTiers: price_tiers=${(p.price_tiers as unknown[])?.length ?? 0}건, LLM skip`);
  } else if (detPriceOk) {
    const priceDates = detPriceRows.map(r => ({
      date: r.date,
      price: r.adult_price,
      child_price: r.child_price ?? null,
      note: r.note ?? null,
      status: r.status ?? 'available',
    }));
    update.price_dates = priceDates;
    result.price = { applied: true, rowCount: priceDates.length, reason: 'L1-matrix-or-table' };
  } else if (priceR && priceR.success) {
    // PriceRow → price_dates jsonb 형식
    const priceDates = priceR.rows.map(r => ({
      date: r.date,
      price: r.adult_price,
      child_price: r.child_price ?? null,
      note: r.note ?? null,
      status: r.status ?? 'available',
    }));
    update.price_dates = priceDates;
    result.price = { applied: true, rowCount: priceDates.length };
  } else if (priceR) {
    result.price = { applied: false, reason: priceR.reason };
  }

  // ③ Inclusions / Excludes / Notices
  if (!noticesNeeded) {
    result.notices = { applied: false, reason: 'already-filled' };
  } else if (noticeR && noticeR.success) {
    if (effectiveForce || !Array.isArray(p.inclusions) || (p.inclusions as unknown[]).length === 0 || noticesBroken) {
      update.inclusions = noticeR.value.inclusions;
    }
    if (effectiveForce || !Array.isArray(p.excludes) || (p.excludes as unknown[]).length === 0 || noticesBroken) {
      update.excludes = noticeR.value.excludes;
    }
    if (effectiveForce || !Array.isArray(p.notices_parsed) || (p.notices_parsed as unknown[]).length === 0) {
      update.notices_parsed = noticeR.value.notices;
    }
    result.notices = {
      applied: true,
      counts: { inc: noticeR.value.inclusions.length, exc: noticeR.value.excludes.length, not: noticeR.value.notices.length },
      ...(noticesBroken && !force ? { reason: 'auto-force-comma-split-signature' } : {}),
    };
  } else if (noticeR) {
    result.notices = { applied: false, reason: noticeR.reason };
  }

  // UPDATE 가 실질 변경 1건 이상 있을 때만 (updated_at 만 있으면 skip)
  if (Object.keys(update).length <= 1) {
    return { ...result, ok: true, reason: 'no-changes' };
  }

  const { sanitizePackageUpdate } = await import('../../customer-leak-sanitizer');
  const sanitized = sanitizePackageUpdate(update, p as Record<string, unknown>);
  Object.assign(update, sanitized.cleaned);
  if (sanitized.incidents.length > 0) {
    console.warn(`[backfill-sections] Customer-Leak sanitizer ${sanitized.incidents.length}건:`, sanitized.incidents.map(i => i.patternId).join(', '));
  }

  const { error: upErr } = await supabaseAdmin
    .from('travel_packages')
    .update(update)
    .eq('id', packageId);
  if (upErr) return { ok: false, reason: upErr.message };

  // 2026-05-17 박제 (ERR-audit-stale-snapshot): audit check 자동 정정
  await refreshAuditAfterBackfill(packageId);

  // 2026-05-17 박제 (ERR-dev-revalidate-누락): prod + dev 동시 revalidate
  try {
    const { revalidatePackagePaths } = await import('../../revalidate-helper');
    await revalidatePackagePaths(packageId, { alsoServerContext: true });
  } catch { /* no-op */ }

  return result;
}

/**
 * 2026-05-17 박제 (ERR-audit-stale-snapshot + ERR-dev-revalidate-누락):
 *   backfill 후 audit_report 자동 정정 + prod/dev revalidate 동시 호출.
 *   stale snapshot 경고 + 사장님 dev 캐시 사고 영구 차단.
 *
 * 자동 정정 대상 check:
 *   - C4 (최저가): price_dates 1+ → pass
 *   - C5 (출발요일): departure_days 또는 price_dates 1+ → pass
 *   - C6 (가격 데이터): price_dates 1+ → pass
 *   - C11 (hero 정합성): display_title 있으면 pass
 *
 * 모든 warn 사라지면 audit_status='clean'.
 */
export async function refreshAuditAfterBackfill(packageId: string): Promise<void> {
  const { supabaseAdmin } = await import('../../supabase');
  const { data: pkg } = await supabaseAdmin
    .from('travel_packages')
    .select('display_title, price_dates, departure_days, audit_report, audit_status, status, inclusions, notices_parsed')
    .eq('id', packageId)
    .maybeSingle();
  if (!pkg) return;
  const p = pkg as { display_title?: string | null; price_dates?: unknown; departure_days?: unknown; audit_report?: { checks?: Array<{ id: string; status: string; detail: string; label?: string }>; [k: string]: unknown } | null; audit_status?: string; status?: string; inclusions?: unknown; notices_parsed?: unknown };
  const report = p.audit_report;
  if (!report?.checks?.length) return;

  const dt = p.display_title;
  const pdLen = Array.isArray(p.price_dates) ? (p.price_dates as unknown[]).length : 0;
  const dDays = p.departure_days;
  const newChecks = report.checks.map(c => {
    if (c.id === 'C11' && dt && dt.trim().length >= 2) {
      return { ...c, status: 'pass', detail: `display_title 박힘 (LLM backfill)` };
    }
    if (c.id === 'C6' && pdLen > 0) {
      return { ...c, status: 'pass', detail: `price_dates ${pdLen}건 (LLM backfill)` };
    }
    if (c.id === 'C4' && pdLen > 0) {
      return { ...c, status: 'pass', detail: `최저가 산출 가능 (price_dates ${pdLen}건)` };
    }
    if (c.id === 'C5' && (pdLen > 0 || (typeof dDays === 'string' && dDays.length > 0))) {
      return { ...c, status: 'pass', detail: `출발요일 산출 가능 (price_dates ${pdLen}건 / dep_days=${typeof dDays === 'string' ? dDays.slice(0, 10) : 'none'})` };
    }
    return c;
  });

  const stillWarn = newChecks.filter(c => c.status === 'warn').length;
  const newAuditStatus = stillWarn === 0 ? 'clean' : (p.audit_status === 'blocked' ? 'blocked' : 'warnings');

  await supabaseAdmin
    .from('travel_packages')
    .update({ audit_report: { ...report, checks: newChecks }, audit_status: newAuditStatus, updated_at: new Date().toISOString() })
    .eq('id', packageId);
}
