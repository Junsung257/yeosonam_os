/**
 * @file itinerary-llm-extractor.ts
 *
 * 목적:
 *   랜드사 raw_text (PDF/엑셀에서 추출한 원본 텍스트) 의 일정표 섹션을 LLM 으로
 *   structured schedule items 로 재추출.
 *
 *   기존 regex parser 가 잡지 못하는 5가지 패턴을 LLM 의 한국어 의미 이해로 묶음:
 *
 *   A) ▶<이름>(설명)              — 한 줄         (예: 북해도 "▶도야호 유람선탑승(...)")
 *   B) ▶<설명>\n   <이름>           — 두 줄         (예: 시즈오카 "▶705년...신사\n   아라쿠라야마")
 *   C) ▶<이름>\n<부속들>            — 여러 줄       (예: 장가계 "▶천문산 등정\n신선이...\n999계단...")
 *   D) ▶<영역>으로 이동\n-<부속들>  — 영역+부속     (예: 장가계 "▶천자산 풍경구\n-2KM 케이블카...")
 *   E) ▶<설명> <이름1 및 이름2>     — 콤마/및 분리  (예: 대만 "▶트리하우스로 유명한 안평수옥 및 안평옛거리")
 *
 *   regex 30개를 추가해도 false positive 폭발 (사장님 SSOT 무력화 사고 패턴
 *   `feedback_user_intent_is_ssot`). LLM + Zod schema + few-shot 으로 한 번에 해결.
 *
 * 인프라:
 *   - llm-gateway.ts `parse_travel_doc` task (DeepSeek Flash, fallback Gemini, maxRetries=3)
 *   - llm-validate-retry.ts `callWithZodValidation` (instructor-js 스타일 self-repair)
 *
 * 비용:
 *   - 패키지 1개당 ~$0.001 (DeepSeek Flash + prompt cache)
 *   - 사장님 전체 backfill (수백 패키지) <$1
 *
 * 운영:
 *   - 신규 등록: upload/route.ts fire-and-forget 호출
 *   - 기존 패키지: db/backfill_itinerary_v2.js batch (사장님 확인 후 실행)
 */

import { z } from 'zod';
import { llmCall } from './llm-gateway';
import { callWithZodValidation } from './llm-validate-retry';

// ═══════════════════════════════════════════════════════════════════════════
//  Zod schema — LLM 출력 강제 구조
// ═══════════════════════════════════════════════════════════════════════════

const ScheduleItemSchema = z.object({
  activity: z.string().min(1).describe(
    '관광지/활동 이름. 헤딩 설명과 부속코스 이름이 같은 attraction 을 가리키면 한 줄로 묶기. ' +
    '예: "705년에 창건된 후지산의 수호신을 모시는 신사 아라쿠라야마 센겐신사" → "아라쿠라야마 센겐신사 (705년 창건 후지산 수호신 신사)"'
  ),
  type: z.enum(['attraction', 'flight', 'hotel', 'meal', 'shopping', 'transit', 'other']).optional(),
  time: z.string().optional(),
  note: z.string().nullable().optional(),
});

const ScheduleDaySchema = z.object({
  day: z.number().int().min(1),
  schedule: z.array(ScheduleItemSchema).min(1),
});

export const ItineraryExtractSchema = z.object({
  days: z.array(ScheduleDaySchema).min(1),
});

export type ItineraryExtractResult = z.infer<typeof ItineraryExtractSchema>;

// ═══════════════════════════════════════════════════════════════════════════
//  Few-shot 예시 — 5가지 랜드사 패턴 박제
// ═══════════════════════════════════════════════════════════════════════════

const FEW_SHOT_EXAMPLES = `
[예시 1 — 북해도 ZE 패턴 A: ▶<이름>(설명) 한 줄]
원본:
제2일
호텔 조식 후
▶도야호 유람선탑승(화산분화로 생긴 최대 규모의 칼데라호수)
▶쇼와신잔 활화산(일본의 특별 명승이자 천연기념물)
▶사이로 전망대(도야호를 한 눈에 조망할 수 있는 전망대)

출력:
{ "days": [ { "day": 2, "schedule": [
  { "activity": "호텔 조식 후", "type": "meal" },
  { "activity": "도야호 유람선탑승", "type": "attraction", "note": "화산분화로 생긴 최대 규모의 칼데라호수" },
  { "activity": "쇼와신잔 활화산", "type": "attraction", "note": "일본의 특별 명승이자 천연기념물" },
  { "activity": "사이로 전망대", "type": "attraction", "note": "도야호를 한 눈에 조망할 수 있는 전망대" }
] } ] }

[예시 2 — 시즈오카 패턴 B: ▶<설명>\\n   <이름> 두 줄을 한 attraction 으로]
원본:
제2일
호텔 조식 후
▶705년에 창건된 후지산의 수호신을 모시는 신사
   아라쿠라야마 센겐신사
▶후지산 파노라마 로프웨이 ♥왕복 로프웨이 탑승♥

출력:
{ "days": [ { "day": 2, "schedule": [
  { "activity": "호텔 조식 후", "type": "meal" },
  { "activity": "아라쿠라야마 센겐신사", "type": "attraction", "note": "705년에 창건된 후지산의 수호신을 모시는 신사" },
  { "activity": "후지산 파노라마 로프웨이", "type": "attraction", "note": "왕복 로프웨이 탑승" }
] } ] }

[예시 3 — 장가계 패턴 C: ▶<영역>\\n-<부속> 여러 attractions 분리]
원본:
제2일
호텔 조식 후 ▶천자산 풍경구로 이동
 -2KM의 케이블카로 천자산 등정
 -붓을 꽂아놓은 듯한 형상의 어필봉, 선녀헌화
 -중국의 10대 원수 하룡장군의 동상이 있는 하룡공원
▶원가계로 이동
 -200M의 봉우리 2개가 연결되어 있는 천하제일교

출력:
{ "days": [ { "day": 2, "schedule": [
  { "activity": "호텔 조식 후", "type": "meal" },
  { "activity": "천자산 등정 (케이블카 2KM)", "type": "attraction", "note": "천자산 풍경구" },
  { "activity": "어필봉", "type": "attraction", "note": "붓을 꽂아놓은 듯한 형상" },
  { "activity": "선녀헌화", "type": "attraction" },
  { "activity": "하룡공원", "type": "attraction", "note": "중국의 10대 원수 하룡장군 동상" },
  { "activity": "천하제일교", "type": "attraction", "note": "200M 봉우리 2개 연결" }
] } ] }

[예시 4 — 대만 패턴 D/E: ▶<설명> <이름1 및 이름2> 콤마 분리]
원본:
제2일
호텔 조식 후
▶진귀한 예술품이 소장 되어 있는 치메이박물관
▶트리하우스로 유명한 안평수옥 및 안평옛거리
▶네덜란드 식민지 시절 세워진 요새 안평고보

출력:
{ "days": [ { "day": 2, "schedule": [
  { "activity": "호텔 조식 후", "type": "meal" },
  { "activity": "치메이박물관", "type": "attraction", "note": "진귀한 예술품 소장" },
  { "activity": "안평수옥", "type": "attraction", "note": "트리하우스로 유명" },
  { "activity": "안평옛거리", "type": "attraction" },
  { "activity": "안평고보", "type": "attraction", "note": "네덜란드 식민지 시절 세워진 요새" }
] } ] }

[예시 5 — 항공편/이동/식사 분류]
원본:
제1일
07:00 부산 김해 국제 공항 2층 집결
09:05 부산 출발 ✈ 에어부산 BX1645 직항
10:50 시즈오카 도착
중식 후
▶니혼다이라 로프웨이 왕복탑승

출력:
{ "days": [ { "day": 1, "schedule": [
  { "activity": "부산 김해 국제 공항 2층 집결", "type": "transit", "time": "07:00" },
  { "activity": "부산 출발 ✈ 에어부산 BX1645 직항", "type": "flight", "time": "09:05" },
  { "activity": "시즈오카 도착", "type": "transit", "time": "10:50" },
  { "activity": "중식 후", "type": "meal" },
  { "activity": "니혼다이라 로프웨이 왕복탑승", "type": "attraction" }
] } ] }
`.trim();

// ═══════════════════════════════════════════════════════════════════════════
//  Prompt 생성
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `당신은 한국어 여행 상품 일정표 구조화 전문가입니다.

랜드사가 작성한 일정표 raw text 를 schedule item 배열로 정확히 추출하세요.

핵심 규칙:
1. **헤딩+부속코스 묶기**: "▶<설명>" 다음 줄 들여쓰기 부속코스가 있으면 한 schedule item 으로 묶고
   activity 는 attraction 이름(부속코스), note 는 설명을 넣습니다.
2. **콤마/및 분리**: "안평수옥 및 안평옛거리" 같은 복수 attraction 은 각각 별개 item 으로 분리합니다.
3. **type 분류**: attraction(관광지), flight(항공편), hotel(호텔), meal(식사), shopping(쇼핑/면세점),
   transit(공항·이동), other 중 정확히 분류.
4. **원문 보존**: activity 텍스트는 원문 attraction 이름을 최대한 보존. 임의 단어 추가/삭제 금지.
   설명은 note 에 넣고, attraction 이름만 activity 에 넣습니다.
5. **일자 보존**: "제1일", "DAY 2", "Day 3" 등 표기 무관하게 day 번호 보존.

학습 예시:
${FEW_SHOT_EXAMPLES}

응답은 반드시 JSON 만. 코드블록(\`\`\`) 없이 raw JSON.`;

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
  const cap = options.maxInputChars ?? 8000;
  const truncated = rawText.length > cap ? rawText.slice(0, cap) : rawText;

  const userPrompt = [
    options.destination ? `[목적지] ${options.destination}` : null,
    '[원본 일정표 raw_text]',
    truncated,
    '',
    '[지시] 위 일정표를 schedule item 배열로 정확히 추출. 헤딩+부속코스는 한 item 으로 묶고, 복수 attraction 은 분리. JSON 만 응답.',
  ].filter(Boolean).join('\n');

  const result = await callWithZodValidation<ItineraryExtractResult>({
    label: 'itinerary-llm-extract',
    schema: ItineraryExtractSchema,
    maxAttempts: 3,
    fn: async (feedback) => {
      // vitest mock
      if (options.mockResponse) return options.mockResponse;

      const promptWithFeedback = feedback
        ? `${userPrompt}\n\n[이전 시도 오류]\n${feedback}\n\n위 오류를 정정해 다시 JSON 출력.`
        : userPrompt;

      const r = await llmCall<string>({
        task: 'parse_travel_doc',
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: promptWithFeedback,
      });
      if (!r.success || !r.rawText) throw new Error(r.errors?.join('; ') || 'LLM 응답 없음');
      return r.rawText;
    },
  });

  if (result.success) {
    return { success: true, value: result.value, attempts: result.attempts };
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
 * 안전:
 *   - LLM 실패 시 기존 itinerary_data 보존 (덮어쓰기 안 함).
 *   - attraction_ids 기존 박힌 것 우선 merge.
 *   - revalidatePath 실패는 무시 (server context 외 호출 시 throw).
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
