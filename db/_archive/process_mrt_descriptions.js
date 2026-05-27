#!/usr/bin/env node
/**
 * db/process_mrt_descriptions.js
 *
 * mrt_raw_desc 가 있고 ai_processed_at 이 NULL 인 attractions 행을
 * DeepSeek 으로 재작성해 long_desc / short_desc / typical_duration_hours 를 채운다.
 *
 * 사용법:
 *   node db/process_mrt_descriptions.js [--limit 50] [--city 서안] [--dry-run]
 *
 * 주의:
 *   - mrt_raw_desc 는 삭제하지 않음 (원본 영구 보존 원칙)
 *   - ai_processed_at = NOW() 로 재처리 방지
 *   - COALESCE 로 기존 typical_duration_hours 우선 (수동 입력값 보호)
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL     = 'https://api.deepseek.com/chat/completions';
/** deepseek-chat → V4-Flash 비추론(공식 호환명). 변경: 환경변수 DEEPSEEK_MODEL */
const DEEPSEEK_MODEL   = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

if (!DEEPSEEK_API_KEY) {
  console.error('[오류] DEEPSEEK_API_KEY 환경변수 필요');
  process.exit(1);
}

// ─── 시스템 프롬프트 (고정 prefix → DeepSeek 자동 캐싱) ──────────────────────

const SYSTEM_PROMPT = `당신은 여행 관광지 설명 전문 에디터입니다.
아래 원문의 사실(위치, 역사, 특징, 운영시간 등)은 그대로 유지하되, 문장을 완전히 다시 작성하세요.
독자는 한국인 여행자이며, 친근하고 매력적인 한국어로 작성합니다.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.
소요 시간을 원문에서 파악할 수 없으면 null 을 입력하세요.

{
  "short_desc": "50자 이내 한 줄 요약",
  "long_desc": "200자 이내 상세 설명",
  "typical_duration_hours": 숫자(예: 1.5) 또는 null
}`;

// ─── DeepSeek 호출 ────────────────────────────────────────────────────────────

async function callDeepSeek(name, rawDesc) {
  const userMsg = `관광지명: ${name}\n\n원문:\n${rawDesc}`;

  const res = await fetch(DEEPSEEK_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:       DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMsg },
      ],
      max_tokens:  400,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`DeepSeek HTTP ${res.status}: ${err.slice(0, 200)}`);
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? '';

  // JSON 파싱 (```json ... ``` 마크다운 블록 방어)
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed  = JSON.parse(cleaned);

  return {
    short_desc:              typeof parsed.short_desc  === 'string' ? parsed.short_desc.slice(0, 100)  : null,
    long_desc:               typeof parsed.long_desc   === 'string' ? parsed.long_desc.slice(0, 500)   : null,
    typical_duration_hours:  typeof parsed.typical_duration_hours === 'number' ? parsed.typical_duration_hours : null,
    usage: json.usage ?? {},
  };
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  const args    = process.argv.slice(2);
  const dryRun  = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit   = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) || 50 : 50;
  const cityIdx = args.indexOf('--city');
  const cityArg = cityIdx !== -1 ? args[cityIdx + 1] : null;

  console.log(`MRT 설명 AI 재작성 시작 (${dryRun ? 'DRY RUN' : '실제 저장'}, 최대 ${limit}건)`);

  // 미처리 행 조회
  let query = supabase
    .from('attractions')
    .select('id, name, mrt_raw_desc, mrt_category, country, region, typical_duration_hours')
    .not('mrt_raw_desc', 'is', null)
    .is('ai_processed_at', null)
    .limit(limit);

  if (cityArg) {
    query = query.ilike('region', `%${cityArg}%`);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error('[오류]', error.message);
    process.exit(1);
  }

  console.log(`대상: ${rows.length}건`);
  if (!rows.length) {
    console.log('처리할 항목 없음 (이미 모두 완료됨)');
    return;
  }

  let success = 0;
  let failed  = 0;
  let totalCacheHit = 0;
  let totalInput    = 0;
  let totalOutput   = 0;

  // 5개씩 배치 처리 (동시 요청 최소화 → 캐싱 효율 최대화)
  const BATCH = 5;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);

    await Promise.allSettled(
      chunk.map(async (row) => {
        try {
          console.log(`  [${i + chunk.indexOf(row) + 1}/${rows.length}] ${row.name} (${row.region})`);

          if (dryRun) {
            console.log(`    [dry-run] 원문 ${row.mrt_raw_desc?.length ?? 0}자 → 재작성 예정`);
            success++;
            return;
          }

          const result = await callDeepSeek(row.name, row.mrt_raw_desc);

          totalInput    += result.usage.prompt_tokens ?? 0;
          totalOutput   += result.usage.completion_tokens ?? 0;
          totalCacheHit += result.usage.prompt_cache_hit_tokens ?? 0;

          // UPDATE (mrt_raw_desc 보존, COALESCE 로 기존 duration 보호)
          const { error: upErr } = await supabase
            .from('attractions')
            .update({
              short_desc:             result.short_desc,
              long_desc:              result.long_desc,
              typical_duration_hours: row.typical_duration_hours ?? result.typical_duration_hours,
              ai_processed_at:        new Date().toISOString(),
            })
            .eq('id', row.id);

          if (upErr) throw upErr;

          console.log(`    ✓ short="${result.short_desc?.slice(0, 30)}..." | ${result.typical_duration_hours ?? '?'}h`);
          success++;
        } catch (e) {
          console.error(`    [실패] ${row.name}: ${e.message}`);
          failed++;
        }
      })
    );

    // 배치 간 1초 딜레이
    if (i + BATCH < rows.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // 비용 요약
  const costInput  = (totalInput - totalCacheHit) * 0.14 / 1_000_000;
  const costCache  = totalCacheHit * 0.014 / 1_000_000;
  const costOutput = totalOutput   * 0.28  / 1_000_000;
  const costTotal  = costInput + costCache + costOutput;

  console.log(`\n완료: 성공 ${success}건 / 실패 ${failed}건`);
  if (!dryRun && totalInput > 0) {
    console.log(`토큰: 입력 ${totalInput} (캐시 ${totalCacheHit}) | 출력 ${totalOutput}`);
    console.log(`비용: $${costTotal.toFixed(5)} (캐시할인 $${(costCache).toFixed(5)} 포함)`);
  }
}

main().catch(err => {
  console.error('[치명적 오류]', err);
  process.exit(1);
});
