/**
 * 여소남 OS — Jarvis V2 Smoke Tests (Phase 8)
 *
 * 프레임워크 의존 없이 Node 내장 node:test 로 실행.
 * DB/LLM 호출 없이 pure 로직만 검증 — 비용 0.
 *
 * 실행:
 *   node --test db/smoke_jarvis_v2.js
 *
 * 커버:
 *   1. computeCostUsd — Gemini 단가 계산 (cache 할인 적용)
 *   2. scoped-tables 분류 (STRICT/NULLABLE/GLOBAL/UNREGISTERED)
 *   3. SSE 이벤트 인코더 포맷
 *   4. persona guardrail 조립 형식
 *
 * TypeScript 소스를 직접 import 하지 않고 로직을 복제 검증. 실제 구현과
 * 분기하면 본 smoke 도 함께 갱신할 것 — 단가 테이블·분류 기준이 변할 때.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

// ─── 1. Cost compute 로직 복제 (src/lib/jarvis/cost-tracker.ts) ──────
const PRICING = {
  'gemini-2.5-pro':        { input: 1.25,  output: 10.00, cacheRead: 0.31  },
  'gemini-2.5-flash':      { input: 0.075, output: 0.30,  cacheRead: 0.019 },
  'gemini-2.5-flash-lite': { input: 0.04,  output: 0.15,  cacheRead: 0.01  },
}

function computeCostUsd(model, usage) {
  const price = PRICING[model] ?? PRICING['gemini-2.5-flash']
  const input = usage.promptTokenCount ?? 0
  const output = usage.candidatesTokenCount ?? 0
  const cacheRead = usage.cachedContentTokenCount ?? 0
  const thinking = usage.thoughtsTokenCount ?? 0
  const chargedInput = Math.max(0, input - cacheRead)
  return (
    (chargedInput * price.input) +
    (cacheRead    * price.cacheRead) +
    ((output + thinking) * price.output)
  ) / 1_000_000
}

test('cost: pro 10k in / 2k out, no cache', () => {
  const c = computeCostUsd('gemini-2.5-pro', { promptTokenCount: 10_000, candidatesTokenCount: 2_000 })
  // 10000*1.25 + 2000*10 = 12,500 + 20,000 = 32,500 / 1M = 0.0325
  assert.equal(c.toFixed(4), '0.0325')
})

test('cost: pro with 80% cache hit → 상당한 할인', () => {
  const full = computeCostUsd('gemini-2.5-pro', { promptTokenCount: 10_000, candidatesTokenCount: 2_000 })
  const cached = computeCostUsd('gemini-2.5-pro', {
    promptTokenCount: 10_000,
    candidatesTokenCount: 2_000,
    cachedContentTokenCount: 8_000,
  })
  assert.ok(cached < full * 0.85, `cached($${cached}) should be < full*0.85 ($${full * 0.85})`)
})

test('cost: flash 단가가 pro 의 1/16 수준 (input 기준)', () => {
  const pro = computeCostUsd('gemini-2.5-pro',   { promptTokenCount: 1_000_000 })
  const flash = computeCostUsd('gemini-2.5-flash', { promptTokenCount: 1_000_000 })
  assert.ok(pro / flash > 15, `pro/flash ratio = ${(pro / flash).toFixed(1)}, expected > 15`)
})

test('cost: unknown model → flash 단가로 폴백 (과소청구 방지)', () => {
  const unknown = computeCostUsd('gemini-999-future', { promptTokenCount: 10_000 })
  const flash = computeCostUsd('gemini-2.5-flash', { promptTokenCount: 10_000 })
  assert.equal(unknown, flash)
})

test('cost: thinking tokens 는 output 단가로 청구', () => {
  const withThinking = computeCostUsd('gemini-2.5-pro', {
    promptTokenCount: 0, candidatesTokenCount: 0, thoughtsTokenCount: 1_000,
  })
  const outputOnly = computeCostUsd('gemini-2.5-pro', {
    promptTokenCount: 0, candidatesTokenCount: 1_000,
  })
  assert.equal(withThinking, outputOnly)
})

// ─── 2. scoped-tables 분류 로직 복제 ─────────────────────────────────
const STRICT = new Set([
  'bookings', 'customers', 'payments', 'bank_transactions', 'message_logs',
  'settlements', 'jarvis_sessions', 'jarvis_tool_logs', 'jarvis_pending_actions',
  'customer_facts', 'agent_actions', 'inventory_blocks',
  'rfq_access', 'rfq_proposals', 'tenant_bot_profiles', 'jarvis_cost_ledger',
])
const NULLABLE = new Set([
  'travel_packages', 'api_orders', 'error_patterns',
  'content_creatives', 'content_daily_stats', 'content_insights',
  'blog_posts', 'attractions', 'jarvis_knowledge_chunks',
])
const GLOBAL = new Set([
  'tenants', 'iata_codes', 'regions', 'departing_locations',
  'land_operators', 'policies', 'group_rfqs',
])

function classifyTable(t) {
  if (STRICT.has(t)) return 'STRICT'
  if (NULLABLE.has(t)) return 'NULLABLE'
  if (GLOBAL.has(t)) return 'GLOBAL'
  return 'UNREGISTERED'
}

test('scoped-tables: bookings 는 STRICT', () => {
  assert.equal(classifyTable('bookings'), 'STRICT')
})

test('scoped-tables: travel_packages 는 NULLABLE (공유 카탈로그 허용)', () => {
  assert.equal(classifyTable('travel_packages'), 'NULLABLE')
})

test('scoped-tables: tenants 루트는 GLOBAL', () => {
  assert.equal(classifyTable('tenants'), 'GLOBAL')
})

test('scoped-tables: 미등록 테이블은 UNREGISTERED (경고 대상)', () => {
  assert.equal(classifyTable('some_new_table'), 'UNREGISTERED')
})

test('scoped-tables: STRICT 과 NULLABLE 교집합 없음', () => {
  for (const t of STRICT) assert.ok(!NULLABLE.has(t), `table ${t} in both STRICT and NULLABLE`)
})

test('scoped-tables: STRICT 과 GLOBAL 교집합 없음', () => {
  for (const t of STRICT) assert.ok(!GLOBAL.has(t), `table ${t} in both STRICT and GLOBAL`)
})

// ─── 3. SSE 인코더 포맷 ────────────────────────────────────────────
function encodeSSE(type, data) {
  const payload = JSON.stringify(data).replace(/\n/g, '\\n')
  return `event: ${type}\ndata: ${payload}\n\n`
}

test('sse: 표준 포맷 — event / data / empty line', () => {
  const frame = encodeSSE('text_delta', '안녕')
  assert.match(frame, /^event: text_delta\ndata: ".+"\n\n$/)
})

test('sse: 개행은 \\n 으로 이스케이프', () => {
  const frame = encodeSSE('text_delta', '첫줄\n둘째줄')
  // JSON 인코딩으로 "\n" 생성 → replace 로 "\\n" 변환
  assert.ok(!frame.slice(20).includes('\n\n\n'), 'payload 내부에 리터럴 개행 없어야 함')
})

// ─── 4. persona guardrail 조립 스모크 ──────────────────────────────
function buildGuardrailLines(gr) {
  const lines = []
  if (typeof gr.max_discount_pct === 'number' && gr.max_discount_pct > 0) {
    lines.push(`- 할인 약속은 **${gr.max_discount_pct}% 이하** 로 제한.`)
  } else {
    lines.push('- 할인·가격 조정 약속 금지.')
  }
  if (Array.isArray(gr.forbidden_phrases) && gr.forbidden_phrases.length > 0) {
    lines.push(`- 금지 표현: ${gr.forbidden_phrases.map(p => `"${p}"`).join(', ')}`)
  }
  return lines
}

test('persona: max_discount_pct 0 → 할인 금지 문구', () => {
  const lines = buildGuardrailLines({ max_discount_pct: 0 })
  assert.ok(lines[0].includes('할인·가격 조정 약속 금지'))
})

test('persona: max_discount_pct 5 → 제한 문구', () => {
  const lines = buildGuardrailLines({ max_discount_pct: 5 })
  assert.ok(lines[0].includes('5%'))
})

test('persona: forbidden_phrases 배열 처리', () => {
  const lines = buildGuardrailLines({
    max_discount_pct: 0,
    forbidden_phrases: ['매력적인', '완벽한'],
  })
  assert.ok(lines[1].includes('"매력적인"') && lines[1].includes('"완벽한"'))
})

console.log('[smoke] Jarvis V2 유닛 테스트 로드 완료 — node --test db/smoke_jarvis_v2.js')
