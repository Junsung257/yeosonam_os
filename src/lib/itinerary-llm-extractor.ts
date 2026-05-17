/**
 * @file itinerary-llm-extractor.ts
 *
 * 2026-05-17 박제 (CLAUDE.md 12절 — 정보 추출 hierarchy):
 *
 * **사장님 비전 = Information Extraction 학술 표준**:
 *   - L1: rule (regex/DB) → 식사/이동/공항 skip
 *   - L2: fuzzy/alias 매칭 (matchAttraction + attractions_aliases)
 *   - L3: LLM 단순 키워드 추출 (L1+L2 fail 시만)  ← `extractAttractionKeywordsWithLLM`
 *   - L4: human-in-the-loop (`unmatched_activities` 큐)
 *
 * **권장 진입점**:
 *   - `extractAttractionKeywordsWithLLM(line, destination)` — 라인 1개 ambiguity 해결
 *   - `backfillPackageAttractionsL3(packageId)` — 패키지 1개 hierarchy 흐름
 *
 * **@deprecated 모듈** (PR #109/#110 의 LLM 만능 환상 — 사고 박제):
 *   - `extractItineraryWithLLM` — 전체 itinerary 재추출. L3 over-use.
 *   - `mapScheduleToAttractionsWithLLM` — 매칭 후보 200개 prompt 박음.
 *   - `reExtractAndUpdateItineraryByPackageId` — schedule 재구성 (verbatim 위반).
 *   - `backfillScheduleMappingByPackageId` — `backfillPackageAttractionsL3` 로 대체.
 *
 *   이 4개 함수는 호환성 위해 남기되 신규 호출 금지. 다음 PR 에서 제거 예정.
 */

import { z } from 'zod';
import { llmCall } from './llm-gateway';
import { callWithZodValidation } from './llm-validate-retry';

// ═══════════════════════════════════════════════════════════════════════════
//  L3 — 라인 1개에서 attraction 키워드 추출 (CLAUDE.md 12절)
// ═══════════════════════════════════════════════════════════════════════════

const KeywordsSchema = z.object({
  keywords: z.array(z.string().min(1)).max(10),
});

// 2026-05-17 박제 (ERR-loose-match): 마사지/쇼핑/샤워/드랍/도착/출발 누락으로
//   "장가계 도착" → "전신마사지60분(장가계)" 잘못 매칭 사고. 패턴 확장.
const NON_ATTRACTION_PATTERN = /(공항|출국|입국|수속|이동|체크인|체크아웃|투숙|휴식|미팅|조식|중식|석식|온천\s*휴식|호텔\s*안내|면세점|마사지|쇼핑|샤워|드랍|픽업|샌딩|^도착|^출발|도착\s*\/|출발\s*\/|호텔\s*조식\s*후|호텔\s*투숙)/;

// 본문 long-description carry-over 라인 (측정값 시작) — attraction 매칭에서 제외.
// 예: "총길이 430M, 넓이 6M, 계곡에서의 높이 300M에 달하는..." 라인이 다른 패키지 attraction 흡수 사고 차단.
const LONG_DESC_HEADER_PATTERN = /^(?:총\s*)?(?:길이|넓이|높이|면적|폭|해발|약\s*\d|평\s*\d)\s*[\d,]/;

/**
 * LLM/L2 키워드 → attraction 매칭 시 의미 없는 substring 매칭 차단 (ERR-loose-match @ 2026-05-17).
 *
 * 차단 케이스:
 *   1. 키워드 길이 < 3자 (단어 단편)
 *   2. attraction.name 이 25자 이상인데 키워드가 핵심 명사 단어 경계 매칭이 아님
 *      예: "유리다리" → "백룡엘리베이터탑승"(긴 합성어) 매칭 차단
 *      예: "엘리베이터" → "장가계해외국제-[장가계]대협곡B코스(유리다리/VR/미끄럼/유람선)티켓" 차단
 *   3. attraction.name 이 키워드의 2.5배 이상이고 키워드가 괄호 안 region prefix
 *      예: "장가계" → "전신마사지60분(장가계)" 차단
 */
function isLooseMatch(keyword: string, attractionName: string): boolean {
  const kw = keyword.trim();
  const name = attractionName.trim();
  if (kw === name) return false;
  if (kw.length < 3) return true;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 케이스 2: 긴 attraction.name (25자+) 은 코어 명사 단어 경계 매칭 강제
  if (name.length >= 25) {
    const core = name.replace(/[\[\(].*?[\]\)]/g, '').trim();  // 괄호·대괄호 안 제거
    const wb = new RegExp(`(^|[\\s/·,\\-])${escape(kw)}([\\s/·,\\-]|$)`);
    if (!wb.test(core)) return true;
  }
  // 케이스 3: 키워드가 attraction.name 의 2.5배 이상 짧음 + 괄호 안 region prefix
  if (name.length >= kw.length * 2.5) {
    const paren = name.match(/\(([^)]+)\)/g)?.map(p => p.slice(1, -1)) ?? [];
    if (paren.some(p => p === kw)) return true;
    const wb = new RegExp(`(^|[\\s/·,(])${escape(kw)}([\\s/·,)]|$)`);
    if (!wb.test(name)) return true;
  }
  return false;
}

/**
 * 한 schedule 라인에서 attraction 후보 이름 추출 (L3).
 *
 * 호출 조건 (CLAUDE.md 12-3):
 *   - L1 (rule): 식사/이동/공항 라인은 호출 전 skip
 *   - L2 (fuzzy): `matchAttraction` 이 0 건일 때만 L3 호출
 *
 * @example
 *   await extractAttractionKeywordsWithLLM(
 *     '▶ 마을 곳곳에 아기자기한 상점이 즐비한 민예거리 및 긴린호수 관광',
 *     '후쿠오카/유후인'
 *   ) → { keywords: ['민예거리', '긴린호수'] }
 *
 * 비용: ~50~200 토큰 / 호출 (~$0.0001).
 */
export async function extractAttractionKeywordsWithLLM(
  activity: string,
  destination?: string | null,
): Promise<{ success: true; keywords: string[]; attempts: number } | { success: false; reason: string; attempts: number }> {
  if (!activity || activity.length < 2) return { success: true, keywords: [], attempts: 0 };
  // L1 빠른 차단 — 식사/이동 등은 LLM 호출조차 안 함
  if (NON_ATTRACTION_PATTERN.test(activity)) return { success: true, keywords: [], attempts: 0 };

  const userPrompt = `[목적지] ${destination ?? '미상'}
[일정 라인]
${activity}

이 라인에 포함된 관광지(attraction) 이름만 추출하라.
- 식사/이동/공항/호텔/조식/중식/석식/체크인/면세점 키워드는 attraction 아님 → 빈 배열
- "민예거리 및 긴린호수" / "어필봉, 선녀헌화" 같이 복수면 각각 분리
- 괄호 안 설명("도야호 유람선탑승(화산분화로...)") 은 attraction 이름에 포함 안 함
- ▶/▷/♥/♨ 등 마크는 제거하고 이름만

JSON: {"keywords":["관광지명1","관광지명2"]}`;

  const result = await callWithZodValidation<z.infer<typeof KeywordsSchema>>({
    label: 'extract-attraction-keywords',
    schema: KeywordsSchema,
    maxAttempts: 2,
    preprocessor: (raw: string): string => {
      let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      try {
        const p: unknown = JSON.parse(s);
        if (p && typeof p === 'object' && Array.isArray((p as { keywords?: unknown[] }).keywords)) return s;
        if (Array.isArray(p)) return JSON.stringify({ keywords: p });
      } catch { /* keep raw */ }
      return s;
    },
    fn: async (feedback) => {
      const prompt = feedback ? `${userPrompt}\n\n[이전 오류] ${feedback}\n다시 JSON 만 응답.` : userPrompt;
      const r = await llmCall<unknown>({
        task: 'parse_travel_doc',
        systemPrompt: '여행 일정 라인에서 관광지 이름만 추출. raw JSON 만 응답.',
        userPrompt: prompt,
        maxTokens: 300,
        jsonSchema: {
          type: 'object',
          properties: { keywords: { type: 'array', items: { type: 'string' } } },
          required: ['keywords'],
        },
      });
      if (!r.success) throw new Error(r.errors?.join('; ') || 'LLM 실패');
      const data = (r as { data?: unknown }).data;
      if (data !== undefined && data !== null) return JSON.stringify(data);
      if (r.rawText && r.rawText.length > 0) return r.rawText;
      throw new Error('LLM 응답 없음');
    },
  });

  if (result.success) {
    // 정제: trim, 빈 문자열 제거, 마크 잔재 제거
    const cleaned = result.value.keywords
      .map(k => k.replace(/^[▶▷♥♨\s\-•]+/, '').replace(/\s*[♥♨]+\s*$/, '').trim())
      .filter(k => k.length >= 2 && !NON_ATTRACTION_PATTERN.test(k));
    return { success: true, keywords: cleaned, attempts: result.attempts };
  }
  return { success: false, reason: result.attemptErrors?.[result.attemptErrors.length - 1] ?? 'unknown', attempts: result.attempts };
}

// ═══════════════════════════════════════════════════════════════════════════
//  L3 (day별) — 한 day 전체 schedule 통째 LLM 호출
// ═══════════════════════════════════════════════════════════════════════════

const DayKeywordsSchema = z.object({
  results: z.array(z.object({
    idx: z.coerce.number().int().min(0),
    keywords: z.array(z.string()),
  })),
});

/**
 * day 1개의 schedule item 들을 통째로 LLM 에 보내 라인별 attraction 키워드 추출.
 *
 * **A안 — Liu et al. 2024 "Lost in the Middle" + Wei et al. 2022 chain-of-thought**:
 *   - day 전체 context 보고 ▶헤딩+부속 두 줄 패턴 자동 묶음 (B안 라인별로는 처리 불가)
 *   - 호출 수 ↓ (라인별 N회 → day 1회) → partial failure 위험 ↓
 *   - DeepSeek system prompt cache 적중률 ↑
 *
 * @example
 *   await extractAttractionsByDayWithLLM([
 *     '▶705년에 창건된 후지산의 수호신을 모시는 신사',
 *     '   아라쿠라야마 센겐신사',
 *     '▶후지산 파노라마 로프웨이 ♥왕복 로프웨이 탑승♥',
 *   ], '시즈오카')
 *   → results: [
 *       { idx: 0, keywords: [] },                          // 헤딩 — 다음 라인이 진짜 attraction
 *       { idx: 1, keywords: ['아라쿠라야마 센겐신사'] },
 *       { idx: 2, keywords: ['후지산 파노라마 로프웨이'] },
 *     ]
 */
export async function extractAttractionsByDayWithLLM(
  activities: string[],
  destination?: string | null,
): Promise<{ success: true; results: Map<number, string[]>; attempts: number } | { success: false; reason: string; attempts: number }> {
  if (activities.length === 0) return { success: true, results: new Map(), attempts: 0 };

  // 라인별 번호 매겨 prompt 에 박음
  const numbered = activities.map((a, i) => `[${i}] ${a}`).join('\n');
  const userPrompt = `[목적지] ${destination ?? '미상'}
[하루 일정 라인들]
${numbered}

각 [idx] 라인에서 관광지(attraction) 이름만 추출하라.
- 식사/이동/공항/호텔/조식/중식/석식/체크인/면세점 키워드는 attraction 아님 → 빈 배열
- ▶<설명> 다음 줄 들여쓰기 부속코스가 있으면 헤딩 라인은 빈 배열, 부속 라인이 진짜 attraction
- "및"/쉼표로 묶인 복수 attraction 은 분리
- 괄호 안 설명은 attraction 이름에서 제외

JSON: {"results":[{"idx":0,"keywords":[...]},{"idx":1,"keywords":[...]}]}`;

  const result = await callWithZodValidation<z.infer<typeof DayKeywordsSchema>>({
    label: 'extract-attractions-by-day',
    schema: DayKeywordsSchema,
    maxAttempts: 2,
    preprocessor: (raw: string): string => {
      let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      try {
        const p: unknown = JSON.parse(s);
        if (p && typeof p === 'object' && Array.isArray((p as { results?: unknown[] }).results)) return s;
        if (Array.isArray(p)) return JSON.stringify({ results: p });
      } catch { /* keep raw */ }
      return s;
    },
    fn: async (feedback) => {
      const prompt = feedback ? `${userPrompt}\n\n[이전 오류] ${feedback}\n다시 JSON 만 응답.` : userPrompt;
      const r = await llmCall<unknown>({
        task: 'parse_travel_doc',
        systemPrompt: '여행 일정 day 의 각 라인에서 관광지 이름만 추출. raw JSON 만 응답.',
        userPrompt: prompt,
        maxTokens: 2000,
        jsonSchema: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: { idx: { type: 'integer' }, keywords: { type: 'array', items: { type: 'string' } } },
                required: ['idx', 'keywords'],
              },
            },
          },
          required: ['results'],
        },
      });
      if (!r.success) throw new Error(r.errors?.join('; ') || 'LLM 실패');
      const data = (r as { data?: unknown }).data;
      if (data !== undefined && data !== null) return JSON.stringify(data);
      if (r.rawText && r.rawText.length > 0) return r.rawText;
      throw new Error('LLM 응답 없음');
    },
  });

  if (result.success) {
    const map = new Map<number, string[]>();
    for (const r of result.value.results) {
      const cleaned = r.keywords
        .map(k => k.replace(/^[▶▷♥♨\s\-•]+/, '').replace(/\s*[♥♨]+\s*$/, '').trim())
        .filter(k => k.length >= 2 && !NON_ATTRACTION_PATTERN.test(k));
      if (cleaned.length > 0) map.set(r.idx, cleaned);
    }
    return { success: true, results: map, attempts: result.attempts };
  }
  return { success: false, reason: result.attemptErrors?.[result.attemptErrors.length - 1] ?? 'unknown', attempts: result.attempts };
}

// ═══════════════════════════════════════════════════════════════════════════
//  L1+L2+L3+L4 hierarchy — 패키지 1개 backfill
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 패키지 1개의 schedule item 에 대해 정보 추출 hierarchy 적용:
 *   L1: 식사/이동/공항 라인 skip
 *   L2: extractAttractionCandidates (regex) + matchAttraction (fuzzy/alias)
 *   L3: L2 fail 라인만 extractAttractionKeywordsWithLLM (LLM)
 *   L4: 최종 미매칭 → unmatched_activities 큐
 *
 * **schedule activity 원본 텍스트 보존** (사장님 정책). attraction_ids 만 박음.
 * 기존 박힌 attraction_ids 는 union 으로 보존.
 */
export async function backfillPackageAttractionsL3(
  packageId: string,
  options: { skipIfMatchRateAbove?: number; useLLMFallback?: boolean; cleanWrongMatches?: boolean } = {},
): Promise<{ ok: boolean; reason?: string; before?: number; after?: number; llmCalls?: number; cleaned?: number }> {
  const useLLM = options.useLLMFallback !== false;
  // cleanWrongMatches: L1 skip 라인 (식사/이동/마사지/쇼핑) 에 박힌 attraction_ids 정리 + LLM 매칭 prefix-only 차단
  const cleanWrong = options.cleanWrongMatches === true;
  const { supabaseAdmin, isSupabaseConfigured } = await import('./supabase');
  if (!isSupabaseConfigured) return { ok: false, reason: 'supabase-not-configured' };

  const { data: pkg, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id, destination, itinerary_data, title')
    .eq('id', packageId)
    .maybeSingle();
  if (error || !pkg) return { ok: false, reason: error?.message ?? 'package-not-found' };

  type ScheduleItem = { activity?: string; attraction_ids?: string[]; type?: string; note?: string | null; [k: string]: unknown };
  type DayShape = { day?: number; schedule?: ScheduleItem[] };
  const existingItin = (pkg as { itinerary_data?: { days?: DayShape[] } | null }).itinerary_data ?? null;
  if (!existingItin?.days?.length) return { ok: false, reason: 'no-schedule' };

  const dest = (pkg as { destination?: string | null }).destination ?? null;
  const beforeStats = countMatchStats(existingItin);
  const beforeRate = beforeStats.total > 0 ? beforeStats.matched / beforeStats.total : 0;
  if (options.skipIfMatchRateAbove != null && beforeRate >= options.skipIfMatchRateAbove) {
    return { ok: true, reason: 'skip-already-high-match', before: beforeRate };
  }

  // attractions DB fetch (destination scope)
  const { destinationToIsoSet } = await import('./destination-iso');
  const isoSet = destinationToIsoSet(dest);
  let q = supabaseAdmin.from('attractions').select('id, name, aliases, region, country, short_desc, badge_type, emoji, category, mrt_gid').eq('is_active', true);
  const orClauses: string[] = [];
  if (dest) for (const t of dest.split(/[/,·&+\s]+/).filter(Boolean)) orClauses.push(`region.ilike.%${t}%`);
  for (const c of isoSet) orClauses.push(`country.eq.${c}`);
  if (orClauses.length) q = q.or(orClauses.join(','));
  const { data: attrs } = await q.limit(2000);
  type AttrShape = { id: string; name: string; aliases?: string[] | null; region?: string | null; country?: string | null; short_desc?: string | null; badge_type?: string | null; emoji?: string | null; category?: string | null; mrt_gid?: string | null };
  const attractions = ((attrs ?? []) as AttrShape[]);
  if (attractions.length === 0) return { ok: false, reason: 'no-candidate-attractions', before: beforeRate };

  // 인덱스 + 매칭 함수 동적 import
  const { buildAttractionIndex, matchAttractionIndexed } = await import('./attraction-matcher');
  type AttractionData = Parameters<typeof buildAttractionIndex>[0][number];
  const idx = buildAttractionIndex(attractions as unknown as AttractionData[], dest ?? undefined);
  const { extractAttractionCandidates } = await import('./itinerary-attraction-candidates');

  let llmCalls = 0;
  let cleanedCount = 0;
  const newDays: DayShape[] = [];
  // attraction id → name lookup (prefix-only 매칭 검증용)
  const attractionNameById = new Map<string, string>();
  for (const a of attractions) attractionNameById.set(a.id, a.name);

  // L4: 미매칭 큐 적재 헬퍼 (fire-and-forget)
  const pushUnmatched = (kw: string, dayNum: number) => {
    void supabaseAdmin.from('unmatched_activities').upsert({
      activity: kw,
      package_id: packageId,
      package_title: (pkg as { title?: string }).title ?? null,
      day_number: dayNum,
      country: null,
      region: dest,
      occurrence_count: 1,
      status: 'pending',
    }, { onConflict: 'activity' }).then(() => {});
  };

  for (const d of existingItin.days) {
    const newSchedule: ScheduleItem[] = [];
    // 1차 패스: L1 (skip) + L2 (fuzzy/alias 매칭). L2 fail 라인 수집.
    type Pending = { itemIdx: number; activity: string; existingIds: string[]; matchedIds: Set<string> };
    const pendingL3: Pending[] = [];

    (d.schedule ?? []).forEach((item, itemIdx) => {
      const activity = item.activity ?? '';
      const existingIds = Array.isArray(item.attraction_ids) ? item.attraction_ids : [];
      if (!activity || activity.length < 2) { newSchedule.push(item); return; }
      // L1: skip 패턴 (non-attraction + 본문 long-desc carry-over)
      if (
        item.type === 'flight' || item.type === 'hotel' || item.type === 'shopping'
        || NON_ATTRACTION_PATTERN.test(activity)
        || LONG_DESC_HEADER_PATTERN.test(activity)
      ) {
        // cleanWrongMatches: L1 skip 라인에 박혀 있는 attraction_ids 정리 (잘못 박힌 사고 차단)
        if (cleanWrong && existingIds.length > 0) {
          cleanedCount += existingIds.length;
          newSchedule.push({ ...item, attraction_ids: [] });
        } else {
          newSchedule.push(item);
        }
        return;
      }
      // L2: regex candidates + fuzzy match (prefix-only 매칭 차단)
      const matchedIds = new Set<string>(existingIds);
      const candidates = extractAttractionCandidates(activity, item.note);
      for (const c of candidates) {
        const m = matchAttractionIndexed(c, idx);
        if (m?.id) {
          const name = attractionNameById.get(m.id) ?? '';
          if (!isLooseMatch(c, name)) matchedIds.add(m.id);
        }
      }
      // L2 가 새로 매칭 발견했으면 박고 종료. 못 했으면 L3 pending 큐에 넣음.
      if (matchedIds.size > existingIds.length) {
        newSchedule.push({ ...item, attraction_ids: [...matchedIds] });
      } else {
        pendingL3.push({ itemIdx: newSchedule.length, activity, existingIds, matchedIds });
        newSchedule.push(item);  // 임시 — L3 후 갱신
      }
    });

    // 2차 패스: L3 hybrid (Hybrid pattern — Asai et al. 2023 Self-RAG)
    //   pendingL3.length >= 2 → A안 (day 통째 LLM, ▶헤딩+부속 자동 묶기)
    //   pendingL3.length == 1 → B안 (라인별 LLM, cost 절약)
    //   pendingL3.length == 0 → LLM 호출 안 함
    if (useLLM && pendingL3.length > 0) {
      const dayKeywords = new Map<number, string[]>();
      if (pendingL3.length >= 2) {
        // A안: day 통째 호출
        const activities = pendingL3.map(p => p.activity);
        const r = await extractAttractionsByDayWithLLM(activities, dest);
        llmCalls++;
        if (r.success) {
          for (const [localIdx, kws] of r.results.entries()) {
            const itemIdx = pendingL3[localIdx]?.itemIdx;
            if (itemIdx !== undefined) dayKeywords.set(itemIdx, kws);
          }
        }
      } else {
        // B안: 라인 1개만 LLM 호출
        const p = pendingL3[0];
        const r = await extractAttractionKeywordsWithLLM(p.activity, dest);
        llmCalls++;
        if (r.success && r.keywords.length > 0) dayKeywords.set(p.itemIdx, r.keywords);
      }

      // pendingL3 결과 적용 — LLM 키워드 → attraction 매칭 시 prefix-only 매칭 차단
      for (const p of pendingL3) {
        const kws = dayKeywords.get(p.itemIdx) ?? [];
        for (const k of kws) {
          const m = matchAttractionIndexed(k, idx);
          if (m?.id) {
            const name = attractionNameById.get(m.id) ?? '';
            // ERR-loose-match @ 2026-05-17: "장가계"(3자) → "전신마사지60분(장가계)"(15자) 차단
            if (isLooseMatch(k, name)) {
              pushUnmatched(k, d.day ?? 0);
            } else {
              p.matchedIds.add(m.id);
            }
          } else {
            pushUnmatched(k, d.day ?? 0);
          }
        }
        if (p.matchedIds.size > p.existingIds.length) {
          newSchedule[p.itemIdx] = { ...newSchedule[p.itemIdx], attraction_ids: [...p.matchedIds] };
        }
      }
    }

    newDays.push({ ...d, schedule: newSchedule });
  }
  const newItin = { ...existingItin, days: newDays };

  const { error: upErr } = await supabaseAdmin
    .from('travel_packages')
    .update({ itinerary_data: newItin, updated_at: new Date().toISOString() })
    .eq('id', packageId);
  if (upErr) return { ok: false, reason: upErr.message, before: beforeRate, llmCalls };

  // 2026-05-17 박제 (ERR-audit-stale-snapshot): backfill 후 audit_report 자동 정정
  try {
    const { refreshAuditAfterBackfill } = await import('./parser/llm/section-extractors');
    await refreshAuditAfterBackfill(packageId);
  } catch { /* no-op */ }

  // 2026-05-17 박제 (ERR-dev-revalidate-누락): prod + dev 동시 revalidate
  try {
    const { revalidatePackagePaths } = await import('./revalidate-helper');
    await revalidatePackagePaths(packageId, { alsoServerContext: true });
  } catch { /* no-op */ }

  const afterStats = countMatchStats(newItin);
  const afterRate = afterStats.total > 0 ? afterStats.matched / afterStats.total : 0;
  return { ok: true, before: beforeRate, after: afterRate, llmCalls, cleaned: cleanedCount };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Zod schema — LLM 출력 강제 구조
// ═══════════════════════════════════════════════════════════════════════════

// 2026-05-17 박제: LLM 이 'meeting', 'arrival', 'departure' 등 우리 카테고리에 없는
//   enum 을 자주 생성 → Zod 거부로 3회 retry 모두 fail. 자유 string 으로 받고
//   후처리 단계에서 정규화. attraction-only 카드 렌더링만 type 영향 받으므로
//   안전 (DetailClient 는 'flight'/'hotel'/'optional'/'shopping' 만 skip 처리).
const TYPE_NORMALIZE: Record<string, 'attraction' | 'flight' | 'hotel' | 'meal' | 'shopping' | 'transit' | 'other'> = {
  attraction: 'attraction', sightseeing: 'attraction', tour: 'attraction', sight: 'attraction', visit: 'attraction',
  flight: 'flight', flying: 'flight', plane: 'flight',
  hotel: 'hotel', accommodation: 'hotel', lodging: 'hotel', stay: 'hotel', checkin: 'hotel', checkout: 'hotel',
  meal: 'meal', food: 'meal', breakfast: 'meal', lunch: 'meal', dinner: 'meal',
  shopping: 'shopping', shop: 'shopping', dutyfree: 'shopping',
  transit: 'transit', meeting: 'transit', arrival: 'transit', departure: 'transit', transport: 'transit', transfer: 'transit', movement: 'transit', boarding: 'transit',
};

function normalizeType(raw: string | undefined): 'attraction' | 'flight' | 'hotel' | 'meal' | 'shopping' | 'transit' | 'other' | undefined {
  if (!raw) return undefined;
  const key = raw.toLowerCase().replace(/[\s_-]+/g, '');
  return TYPE_NORMALIZE[key] ?? 'other';
}

const ScheduleItemSchema = z.object({
  activity: z.string().min(1).describe(
    '관광지/활동 이름. 헤딩 설명과 부속코스 이름이 같은 attraction 을 가리키면 한 줄로 묶기.'
  ),
  // 자유 string. extractItineraryWithLLM 가 응답 후 normalizeType 으로 정규화.
  type: z.string().optional(),
  time: z.string().optional(),
  note: z.string().nullable().optional(),
});

// 2026-05-17 박제: LLM 이 day 를 "3" (string) 으로 자주 보냄. coerce 로 자동 변환.
const ScheduleDaySchema = z.object({
  day: z.coerce.number().int().min(1),
  schedule: z.array(ScheduleItemSchema).min(1),
});

export const ItineraryExtractSchema = z.object({
  days: z.array(ScheduleDaySchema).min(1),
});

export type ItineraryExtractResult = z.infer<typeof ItineraryExtractSchema>;

// ═══════════════════════════════════════════════════════════════════════════
//  Few-shot 예시 — 5가지 랜드사 패턴 박제
// ═══════════════════════════════════════════════════════════════════════════

// 2026-05-17 박제: 긴 SYSTEM_PROMPT (특수문자+한국어+백슬래시 잡탕) 가
//   DeepSeek 응답 빈 string 폭주 (success=true, rawLen=0) 사고 — debug 확인.
//   user prompt 안에 가벼운 few-shot 박고 system 은 최소화.
const FEW_SHOT_USER = `학습 예시:

원본 일정의 "▶헤딩\\n   이름" 패턴은 두 줄을 한 attraction 으로 묶기:
  ▶705년에 창건된 후지산의 수호신을 모시는 신사
     아라쿠라야마 센겐신사
  → { "activity": "아라쿠라야마 센겐신사", "type": "attraction", "note": "705년 창건된 후지산 수호신 신사" }

"▶영역\\n-부속1\\n-부속2" 패턴은 각 부속을 별개 item:
  ▶천자산 풍경구
   -어필봉, 선녀헌화
   -하룡공원 (10대 원수 동상)
  → [ {"activity": "어필봉", "type": "attraction"},
       {"activity": "선녀헌화", "type": "attraction"},
       {"activity": "하룡공원", "type": "attraction", "note": "10대 원수 하룡장군 동상"} ]

"및" / 쉼표 묶음은 별개:
  ▶트리하우스 안평수옥 및 안평옛거리
  → [ {"activity": "안평수옥", ...}, {"activity": "안평옛거리", ...} ]

type 분류: attraction(관광지), flight(항공편), hotel(호텔), meal(조식/중식/석식), shopping(면세점), transit(공항·이동·집결·도착), other.`;

// ═══════════════════════════════════════════════════════════════════════════
//  Prompt 생성
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = '한국어 여행 일정표를 JSON 으로 정확히 추출하는 전문가. raw JSON 만 응답, 코드블록 없음.';

// ═══════════════════════════════════════════════════════════════════════════
//  메인 함수
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtractItineraryOptions {
  destination?: string | null;
  /** raw_text 가 너무 길면 일정표 섹션만 잘라 입력. 기본 8000자 cap (≈ 3000 토큰) */
  maxInputChars?: number;
  /** vitest 등에서 LLM 호출 우회. 직접 raw JSON 응답 주입 (mock) */
  mockResponse?: string;
}

/**
 * raw_text → schedule 구조화 추출.
 *
 * @deprecated 2026-05-17 — CLAUDE.md 12절 hierarchy 위반. 전체 itinerary 재추출은
 *   schedule activity 텍스트 변경 → 원문 verbatim 정책 위반 + 매칭률 다운그레이드.
 *   대체: `extractAttractionKeywordsWithLLM` (라인 1개 키워드 추출) + `backfillPackageAttractionsL3`.
 * @example
 * const result = await extractItineraryWithLLM(pkg.raw_text, { destination: '시즈오카' });
 * if (result.success) {
 *   // result.value.days = [{ day: 1, schedule: [...] }, ...]
 * }
 */
export async function extractItineraryWithLLM(
  rawText: string,
  options: ExtractItineraryOptions = {},
): Promise<{ success: true; value: ItineraryExtractResult; attempts: number } | { success: false; reason: string; attempts: number }> {
  const cap = options.maxInputChars ?? 5000;
  const truncated = rawText.length > cap ? rawText.slice(0, cap) : rawText;

  // 2026-05-17 박제: 길고 detail prompt 가 DeepSeek 빈 응답 야기.
  //   debug 에서 작동한 minimal prompt 복원. schema 정규화는 preprocessor 가 담당.
  const userPrompt = `[목적지] ${options.destination ?? '미상'}\n[원본]\n${truncated}\n\n위 일정표를 schedule item 배열 JSON 으로 추출.`;

  const result = await callWithZodValidation<ItineraryExtractResult>({
    label: 'itinerary-llm-extract',
    schema: ItineraryExtractSchema,
    maxAttempts: 3,
    // 2026-05-17 박제: LLM 이 다양한 root schema 생성 (예 {schedule:[]} 또는
    //   {days:[]} 또는 {itinerary:[]}). 모두 우리 {days:[{day,schedule:[]}]} 로 정규화.
    preprocessor: (raw: string): string => {
      let s = raw.trim();
      // 코드블록 제거
      s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      try {
        const parsed: unknown = JSON.parse(s);
        const normalizeDay = (d: unknown, fallbackIdx: number): { day: number; schedule: unknown[] } => {
          if (d && typeof d === 'object') {
            const obj = d as { day?: unknown; schedule?: unknown; activities?: unknown };
            let dayNum = fallbackIdx + 1;
            if (typeof obj.day === 'number') dayNum = obj.day;
            else if (typeof obj.day === 'string') { const n = parseInt(obj.day, 10); if (!isNaN(n)) dayNum = n; }
            let sched: unknown[] = [];
            if (Array.isArray(obj.schedule)) sched = obj.schedule;
            else if (Array.isArray(obj.activities)) sched = obj.activities;
            else if (typeof obj.schedule === 'string') sched = [{ activity: obj.schedule }];
            return { day: dayNum, schedule: sched };
          }
          return { day: fallbackIdx + 1, schedule: [] };
        };
        let days: { day: number; schedule: unknown[] }[] = [];
        if (parsed && typeof parsed === 'object') {
          const p = parsed as { days?: unknown; schedule?: unknown; itinerary?: unknown };
          if (Array.isArray(p.days)) days = p.days.map(normalizeDay);
          else if (Array.isArray(p.itinerary)) days = p.itinerary.map(normalizeDay);
          else if (Array.isArray(p.schedule)) days = [{ day: 1, schedule: p.schedule as unknown[] }];
        } else if (Array.isArray(parsed)) {
          days = parsed.map(normalizeDay);
        }
        if (days.length > 0) return JSON.stringify({ days });
      } catch { /* 원본 그대로 */ }
      return s;
    },
    fn: async (feedback) => {
      // vitest mock
      if (options.mockResponse) return options.mockResponse;

      const promptWithFeedback = feedback
        ? `${userPrompt}\n\n[이전 시도 오류]\n${feedback}\n\n위 오류를 정정해 다시 JSON 출력.`
        : userPrompt;

      const r = await llmCall<unknown>({
        task: 'parse_travel_doc',
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: promptWithFeedback,
        // 2026-05-17 박제: default max_tokens=2000 으로 일정표 응답 truncation → JSON parse
        //   fail → preprocessor 빈 응답. 4000 으로 확장.
        maxTokens: 4000,
        // 2026-05-17 박제: jsonSchema 옵션 → DeepSeek response_format=json_object 강제 +
        //   Gemini responseMimeType=application/json. llm-gateway 가 응답을 r.data 로
        //   parse 후 반환 (rawText 비어있음). 아래에서 r.data || r.rawText 둘 다 처리.
        jsonSchema: {
          type: 'object',
          properties: {
            days: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  day: { type: 'integer' },
                  schedule: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        activity: { type: 'string' },
                        type: { type: 'string' },
                        note: { type: 'string' },
                        time: { type: 'string' },
                      },
                      required: ['activity'],
                    },
                  },
                },
                required: ['day', 'schedule'],
              },
            },
          },
          required: ['days'],
        },
      });
      // jsonSchema 모드: r.data 우선 (이미 parsed). 일반 모드: r.rawText.
      const data = (r as { data?: unknown }).data;
      const rawText = r.rawText;
      if (!r.success) throw new Error(r.errors?.join('; ') || 'LLM 호출 실패');
      if (data !== undefined && data !== null) return JSON.stringify(data);
      if (rawText && rawText.length > 0) return rawText;
      throw new Error(`LLM 응답 없음 (success=${r.success}, errors=${JSON.stringify(r.errors)})`);
    },
  });

  if (result.success) {
    // 2026-05-17 박제: LLM 이 activity 에 "이름 (괄호 설명)" 합쳐서 자주 생성 →
    //   attraction.name 과 exact match 실패 → 매칭 0 떨어짐. 괄호 분리 후처리.
    const splitParen = (s: { activity: string; note?: string | null }): { activity: string; note: string | null } => {
      const m = s.activity.match(/^(.+?)\s*\((.+)\)\s*$/);
      if (m && m[1].length >= 2) {
        return { activity: m[1].trim(), note: s.note || m[2].trim() };
      }
      return { activity: s.activity, note: s.note ?? null };
    };
    const normalized: ItineraryExtractResult = {
      days: result.value.days.map(d => ({
        day: d.day,
        schedule: d.schedule.map(s => {
          const { activity, note } = splitParen(s);
          return { ...s, activity, note, type: normalizeType(s.type) };
        }),
      })),
    };
    return { success: true, value: normalized, attempts: result.attempts };
  }
  return { success: false, reason: result.attemptErrors?.[result.attemptErrors.length - 1] ?? 'unknown', attempts: result.attempts };
}

/**
 * LLM extract 결과 → 기존 itinerary_data 포맷 변환 + attraction_ids 보존.
 *
 * 기존 itinerary_data 의 schedule item 이 LLM 결과로 교체되더라도, 같은 attraction 이
 * 이미 매칭돼서 attraction_ids 가 박혀있었다면 보존. attraction_names 비교로 best-match.
 */
export function mergeLLMExtractWithExisting(
  llmResult: ItineraryExtractResult,
  existingItineraryData: { days?: Array<{ day?: number; schedule?: Array<{ activity?: string; attraction_ids?: string[]; attraction_names?: string[] }> }> } | null,
): ItineraryExtractResult & { _replaced: boolean } {
  if (!existingItineraryData?.days?.length) {
    return { ...llmResult, _replaced: true };
  }

  // existing schedule item 의 attraction_ids 를 (day, activity 부분일치) 키로 매핑
  const existingMap = new Map<string, string[]>();
  for (const d of existingItineraryData.days) {
    for (const s of (d.schedule || [])) {
      if (!s?.activity || !s.attraction_ids?.length) continue;
      // 정규화 키: 공백·특수문자 제거 소문자
      const norm = s.activity.toLowerCase().replace(/[\s♥▶()/,]+/g, '');
      existingMap.set(`d${d.day}|${norm}`, s.attraction_ids);
      // 대체 키 (attraction_names 로 매칭)
      for (const name of (s.attraction_names || [])) {
        existingMap.set(`d${d.day}|name|${name.toLowerCase().replace(/\s+/g, '')}`, s.attraction_ids);
      }
    }
  }

  // LLM 결과의 각 item 에 attraction_ids 복원 (부분일치)
  const enrichedDays = llmResult.days.map(day => {
    const enrichedSchedule = day.schedule.map(item => {
      const norm = item.activity.toLowerCase().replace(/[\s♥▶()/,]+/g, '');
      // 1) 정규화 키 정확 매칭
      const exact = existingMap.get(`d${day.day}|${norm}`);
      if (exact) return { ...item, attraction_ids: exact };
      // 2) 부분 일치 (activity 가 기존 norm 을 포함하거나 그 반대)
      for (const [key, ids] of existingMap.entries()) {
        if (!key.startsWith(`d${day.day}|`)) continue;
        const existingNorm = key.split('|').slice(1).join('|');
        if (existingNorm === 'name' || existingNorm.length < 3) continue;
        if (norm.includes(existingNorm) || existingNorm.includes(norm)) {
          return { ...item, attraction_ids: ids };
        }
      }
      return item;
    });
    return { ...day, schedule: enrichedSchedule };
  });

  return { days: enrichedDays, _replaced: true };
}

// ═══════════════════════════════════════════════════════════════════════════
//  (A) Schedule 원본 보존 + attraction_ids 매핑만 (사장님 권장)
// ═══════════════════════════════════════════════════════════════════════════
//
// 사장님 정책 (`feedback_no_reference_pattern_borrow.md`):
//   원본 verbatim 보존. LLM 이 schedule 텍스트를 재구성하면 안 됨.
//   대신 LLM 은 "어떤 schedule.activity 라인이 어떤 attraction 을 가리키는가?" 만 판단.
//
// 예: ▶헤딩\n   부속 두 라인 모두 같은 attraction 가리킴 → 둘 다 attraction_ids 박힘
//     → DetailClient DAY dedup 으로 한 카드 (사장님 화면에 텍스트 두 줄 + 카드 한 개).

const ScheduleMappingSchema = z.object({
  mappings: z.array(z.object({
    day: z.coerce.number().int().min(1),
    idx: z.coerce.number().int().min(0),
    attraction_id: z.string().min(8),  // 매칭된 attraction.id (UUID 또는 짧은 코드)
  })),
});
type ScheduleMappingResult = z.infer<typeof ScheduleMappingSchema>;

export interface MapScheduleOptions {
  destination?: string | null;
  maxInputChars?: number;
  mockResponse?: string;
}

/**
 * @deprecated 2026-05-17 — CLAUDE.md 12절 hierarchy 위반. 매칭 후보 200개를 한 번에 LLM
 *   prompt 에 박는 NIH 패턴. 기존 `matchAttraction` (L2) + `extractAttractionKeywordsWithLLM`
 *   (L3) 조합이 학술 표준이고 비용·정확도 우월.
 *   대체: `backfillPackageAttractionsL3`.
 *
 * (A) 방식: schedule item 원본 텍스트 그대로 두고, LLM 이 각 라인에 어떤 attraction 이
 * 매핑되는지 판단. 결과를 schedule[].attraction_ids 에 박음.
 */
export async function mapScheduleToAttractionsWithLLM(
  existingItin: { days?: Array<{ day?: number; schedule?: Array<{ activity?: string }> }> } | null,
  candidateAttractions: Array<{ id: string; name: string; aliases?: string[] | null }>,
  options: MapScheduleOptions = {},
): Promise<{ success: true; mappings: Map<string, string[]>; attempts: number } | { success: false; reason: string; attempts: number }> {
  if (!existingItin?.days?.length || !candidateAttractions.length) {
    return { success: true, mappings: new Map(), attempts: 0 };
  }

  // schedule items 직렬화 (day, idx, activity 만)
  const scheduleLines: string[] = [];
  for (const d of existingItin.days) {
    const dayNum = d.day ?? 0;
    (d.schedule ?? []).forEach((s, i) => {
      if (!s.activity) return;
      scheduleLines.push(`[${dayNum}-${i}] ${s.activity}`);
    });
  }
  if (scheduleLines.length === 0) return { success: true, mappings: new Map(), attempts: 0 };

  // attractions 후보 직렬화
  const attrLines = candidateAttractions.slice(0, 200).map(a => {
    const aliases = (a.aliases ?? []).slice(0, 3).join(', ');
    return `${a.id}: ${a.name}${aliases ? ` (alias: ${aliases})` : ''}`;
  });

  const userPrompt =
`[목적지] ${options.destination ?? '미상'}
[schedule items]
${scheduleLines.join('\n')}

[attractions 후보 (id: name)]
${attrLines.join('\n')}

각 schedule 라인이 어떤 attraction 을 가리키는지 매핑. 한 attraction 을 여러 라인이 가리킬 수 있음 (헤딩+부속). 매핑 안 되는 라인은 결과에서 제외.

JSON 응답: {"mappings":[{"day":1,"idx":4,"attraction_id":"7a04cfba-..."}]}`;

  const result = await callWithZodValidation<ScheduleMappingResult>({
    label: 'map-schedule-to-attractions',
    schema: ScheduleMappingSchema,
    maxAttempts: 3,
    preprocessor: (raw: string): string => {
      let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      try {
        const p: unknown = JSON.parse(s);
        if (p && typeof p === 'object' && Array.isArray((p as { mappings?: unknown[] }).mappings)) return s;
        if (Array.isArray(p)) return JSON.stringify({ mappings: p });
      } catch { /* keep raw */ }
      return s;
    },
    fn: async (feedback) => {
      if (options.mockResponse) return options.mockResponse;
      const promptWithFeedback = feedback ? `${userPrompt}\n\n[이전 오류]\n${feedback}\n다시 시도.` : userPrompt;
      const r = await llmCall<unknown>({
        task: 'parse_travel_doc',
        systemPrompt: '한국어 일정표 schedule item ↔ attraction 매핑 전문가. raw JSON 만 응답.',
        userPrompt: promptWithFeedback,
        maxTokens: 4000,
        jsonSchema: {
          type: 'object',
          properties: {
            mappings: {
              type: 'array',
              items: {
                type: 'object',
                properties: { day: { type: 'integer' }, idx: { type: 'integer' }, attraction_id: { type: 'string' } },
                required: ['day', 'idx', 'attraction_id'],
              },
            },
          },
          required: ['mappings'],
        },
      });
      const data = (r as { data?: unknown }).data;
      if (!r.success) throw new Error(r.errors?.join('; ') || 'LLM 실패');
      if (data !== undefined && data !== null) return JSON.stringify(data);
      if (r.rawText && r.rawText.length > 0) return r.rawText;
      throw new Error('LLM 응답 없음');
    },
  });

  if (!result.success) {
    return { success: false, reason: result.attemptErrors?.[result.attemptErrors.length - 1] ?? 'unknown', attempts: result.attempts };
  }

  // schedule 위치 ("day-idx") → attraction_id[] 매핑
  const validIds = new Set(candidateAttractions.map(a => a.id));
  const mappings = new Map<string, string[]>();
  for (const m of result.value.mappings) {
    if (!validIds.has(m.attraction_id)) continue;  // hallucinated id 차단
    const key = `${m.day}-${m.idx}`;
    if (!mappings.has(key)) mappings.set(key, []);
    mappings.get(key)!.push(m.attraction_id);
  }
  return { success: true, mappings, attempts: result.attempts };
}

/**
 * @deprecated 2026-05-17 — `mapScheduleToAttractionsWithLLM` 호출. 대체: `backfillPackageAttractionsL3`.
 *
 * 패키지 1개를 (A) 방식으로 backfill (schedule 보존 + LLM 매핑).
 */
export async function backfillScheduleMappingByPackageId(
  packageId: string,
  options: { onlyIfMatchRateBelow?: number } = {},
): Promise<{ ok: boolean; reason?: string; before?: number; after?: number }> {
  const { supabaseAdmin, isSupabaseConfigured } = await import('./supabase');
  if (!isSupabaseConfigured) return { ok: false, reason: 'supabase-not-configured' };

  const { data: pkg, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id, destination, itinerary_data')
    .eq('id', packageId)
    .maybeSingle();
  if (error || !pkg) return { ok: false, reason: error?.message ?? 'package-not-found' };

  type ScheduleItem = { activity?: string; attraction_ids?: string[]; type?: string; [k: string]: unknown };
  type Day = { day?: number; schedule?: ScheduleItem[] };
  const existingItin = (pkg as { itinerary_data?: { days?: Day[] } | null }).itinerary_data;
  if (!existingItin?.days?.length) return { ok: false, reason: 'no-schedule' };

  const beforeStats = countMatchStats(existingItin);
  const beforeRate = beforeStats.total > 0 ? beforeStats.matched / beforeStats.total : 0;
  if (options.onlyIfMatchRateBelow != null && beforeRate >= options.onlyIfMatchRateBelow) {
    return { ok: true, reason: 'skip-already-high-match', before: beforeRate };
  }

  // destination 기반 후보 attractions fetch (page.tsx Step A 와 동일 패턴)
  const dest = (pkg as { destination?: string | null }).destination ?? null;
  const { destinationToIsoSet } = await import('./destination-iso');
  const isoSet = destinationToIsoSet(dest);
  let q = supabaseAdmin.from('attractions').select('id, name, aliases').eq('is_active', true);
  const orClauses: string[] = [];
  if (dest) {
    for (const t of dest.split(/[/,·&+\s]+/).filter(Boolean)) orClauses.push(`region.ilike.%${t}%`);
  }
  for (const c of isoSet) orClauses.push(`country.eq.${c}`);
  if (orClauses.length) q = q.or(orClauses.join(','));
  const { data: attrs } = await q.limit(300);
  const candidates = (attrs ?? []) as Array<{ id: string; name: string; aliases: string[] | null }>;
  if (candidates.length === 0) return { ok: false, reason: 'no-candidate-attractions', before: beforeRate };

  // LLM 매핑
  const mapResult = await mapScheduleToAttractionsWithLLM(existingItin, candidates, { destination: dest });
  if (!mapResult.success) return { ok: false, reason: `llm-map-fail:${mapResult.reason}`, before: beforeRate };

  // schedule 에 attraction_ids 박음 (기존 박힌 것은 union 으로 보존)
  const newDays = existingItin.days.map(d => {
    const dayNum = d.day ?? 0;
    return {
      ...d,
      schedule: (d.schedule ?? []).map((s, i) => {
        const llmIds = mapResult.mappings.get(`${dayNum}-${i}`) ?? [];
        const existing = Array.isArray(s.attraction_ids) ? s.attraction_ids : [];
        const merged = [...new Set([...existing, ...llmIds])];
        return merged.length > 0 ? { ...s, attraction_ids: merged } : s;
      }),
    };
  });
  const newItin = { ...existingItin, days: newDays };

  const { error: upErr } = await supabaseAdmin
    .from('travel_packages')
    .update({ itinerary_data: newItin, updated_at: new Date().toISOString() })
    .eq('id', packageId);
  if (upErr) return { ok: false, reason: upErr.message, before: beforeRate };

  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath(`/packages/${packageId}`);
    revalidatePath(`/m/packages/${packageId}`);
  } catch { /* no-op */ }

  const afterStats = countMatchStats(newItin);
  const afterRate = afterStats.total > 0 ? afterStats.matched / afterStats.total : 0;
  return { ok: true, before: beforeRate, after: afterRate };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Orchestration — DB 패키지 1개 재추출 + UPDATE + re-enrich
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 패키지 1개의 raw_text 를 LLM 으로 재추출 → itinerary_data UPDATE →
 * enrichItineraryWithAttractionReferences 로 attraction_ids 재매칭 → revalidatePath.
 *
 * 사용처:
 *   - upload/route.ts: 신규 등록 직후 fire-and-forget
 *   - db/backfill_itinerary_v2.js: 기존 패키지 batch
 *   - (선택) 어드민 endpoint /api/admin/itinerary/re-extract
 *
 * @deprecated 2026-05-17 — schedule activity 재구성 → 원문 verbatim 정책 위반.
 *   대체: `backfillPackageAttractionsL3`.
 *
 * 안전:
 *   - LLM 실패 시 기존 itinerary_data 보존 (덮어쓰기 안 함).
 */
export async function reExtractAndUpdateItineraryByPackageId(
  packageId: string,
  options: { skipIfMatchRateAbove?: number } = {},
): Promise<{ ok: boolean; reason?: string; matchRate?: number; before?: number; after?: number }> {
  // Dynamic import 로 server-only 의존성 격리 (vitest mock 가능)
  const { supabaseAdmin, isSupabaseConfigured } = await import('./supabase');
  if (!isSupabaseConfigured) return { ok: false, reason: 'supabase-not-configured' };

  const { data: pkg, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id, destination, raw_text, itinerary_data')
    .eq('id', packageId)
    .maybeSingle();
  if (error || !pkg) return { ok: false, reason: error?.message ?? 'package-not-found' };

  const rawText = (pkg as { raw_text?: string | null }).raw_text;
  if (!rawText || rawText.length < 100) return { ok: false, reason: 'raw_text-empty' };

  // 1) 기존 매칭률 측정 — skipIfMatchRateAbove 옵션
  type Day = { day?: number; schedule?: Array<{ activity?: string; attraction_ids?: string[]; type?: string }> };
  const existingItin = (pkg as { itinerary_data?: { days?: Day[] } | null }).itinerary_data ?? null;
  const totals = countMatchStats(existingItin);
  const beforeRate = totals.total > 0 ? totals.matched / totals.total : 0;
  if (options.skipIfMatchRateAbove != null && beforeRate >= options.skipIfMatchRateAbove) {
    return { ok: true, reason: 'skip-already-high-match', matchRate: beforeRate };
  }

  // 2) LLM 호출
  const llmResult = await extractItineraryWithLLM(rawText, {
    destination: (pkg as { destination?: string | null }).destination ?? null,
  });
  if (!llmResult.success) {
    return { ok: false, reason: `llm-fail:${llmResult.reason}`, matchRate: beforeRate };
  }

  // 3) 기존 attraction_ids 와 merge
  const merged = mergeLLMExtractWithExisting(llmResult.value, existingItin);

  // 4) attractions DB fetch 후 enrichItineraryWithAttractionReferences 재매칭
  const { data: attrs } = await supabaseAdmin
    .from('attractions')
    .select('id, name, aliases, region, country, short_desc, badge_type, emoji, category, mrt_gid')
    .eq('is_active', true);
  // dynamic import — enricher 가 시즈오카 PR 의 동일 모듈 사용
  const { enrichItineraryWithAttractionReferences } = await import('./itinerary-attraction-enricher');
  const enriched = enrichItineraryWithAttractionReferences(
    { days: merged.days },
    (attrs ?? []) as Parameters<typeof enrichItineraryWithAttractionReferences>[1],
    (pkg as { destination?: string | null }).destination ?? undefined,
  );

  // 5) DB UPDATE
  const newItin = enriched.itineraryData ?? { days: merged.days };
  const { error: upErr } = await supabaseAdmin
    .from('travel_packages')
    .update({ itinerary_data: newItin, updated_at: new Date().toISOString() })
    .eq('id', packageId);
  if (upErr) return { ok: false, reason: upErr.message, matchRate: beforeRate };

  // 6) ISR revalidate (server context 외에선 throw 가능 — 무시)
  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath(`/packages/${packageId}`);
    revalidatePath(`/m/packages/${packageId}`);
  } catch { /* no-op */ }

  const afterStats = countMatchStats(newItin as { days?: Day[] });
  const afterRate = afterStats.total > 0 ? afterStats.matched / afterStats.total : 0;
  return { ok: true, before: beforeRate, after: afterRate, matchRate: afterRate };
}

function countMatchStats(itin: { days?: Array<{ schedule?: Array<{ activity?: string; attraction_ids?: string[]; type?: string }> }> } | null): { total: number; matched: number } {
  let total = 0, matched = 0;
  for (const d of (itin?.days ?? [])) {
    for (const s of (d.schedule ?? [])) {
      if (!s?.activity) continue;
      const t = s.type;
      if (t === 'flight' || t === 'hotel' || t === 'shopping') continue;
      total++;
      if (Array.isArray(s.attraction_ids) && s.attraction_ids.length > 0) matched++;
    }
  }
  return { total, matched };
}
