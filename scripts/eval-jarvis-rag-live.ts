#!/usr/bin/env tsx

import dotenv from 'dotenv'
import type { RetrievalHit, SourceType } from '@/lib/jarvis/rag/retriever'
import type { RetrievalConfidenceDecision } from '@/lib/jarvis/rag/retrieval-confidence'

dotenv.config({ path: '.env.local' })
dotenv.config()

interface LiveRagCase {
  id: string
  query: string
  sourceTypes: SourceType[]
  expectedTopSourceTypes: SourceType[]
  minConfidence: number
  requiresEscalation?: boolean
}

interface LiveRagCaseResult extends LiveRagCase {
  passed: boolean
  count: number
  topSourceType: SourceType | null
  topSourceTitle: string | null
  confidence: number
  confidenceLevel: string
  actualRequiresEscalation: boolean
  reasons: string[]
}

const CASES: LiveRagCase[] = [
  {
    id: 'live-refund-policy',
    query: '환불 규정 알려줘',
    sourceTypes: ['policy', 'package', 'blog'],
    expectedTopSourceTypes: ['policy'],
    minConfidence: 0.7,
  },
  {
    id: 'live-refund-action',
    query: '환불 처리해주세요',
    sourceTypes: ['policy', 'package', 'blog'],
    expectedTopSourceTypes: ['policy'],
    minConfidence: 0.7,
    requiresEscalation: true,
  },
  {
    id: 'live-deposit-check',
    query: '입금 확인은 어떻게 하나요',
    sourceTypes: ['policy', 'package', 'blog'],
    expectedTopSourceTypes: ['policy'],
    minConfidence: 0.65,
  },
  {
    id: 'live-booking-change',
    query: '예약 날짜 변경하고 싶어요',
    sourceTypes: ['policy', 'package', 'blog'],
    expectedTopSourceTypes: ['policy'],
    minConfidence: 0.65,
    requiresEscalation: true,
  },
  {
    id: 'live-package-recommendation',
    query: '나트랑 가격 비교해줘',
    sourceTypes: ['package', 'blog', 'policy'],
    expectedTopSourceTypes: ['package'],
    minConfidence: 0.7,
  },
]

function parseArgs() {
  const args = process.argv.slice(2)
  return {
    json: args.includes('--json'),
    strict: args.includes('--strict'),
    requireDb: args.includes('--require-db'),
  }
}

function hasLiveEnv(): boolean {
  return Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    (process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY),
  )
}

async function evaluateCase(
  testCase: LiveRagCase,
  retrieve: (query: { query: string; sourceTypes: SourceType[]; limit: number; rerank: boolean }) => Promise<RetrievalHit[]>,
  assessRetrievalConfidence: (query: string, hits: RetrievalHit[]) => RetrievalConfidenceDecision,
): Promise<LiveRagCaseResult> {
  const hits = await retrieve({
    query: testCase.query,
    sourceTypes: testCase.sourceTypes,
    limit: 3,
    rerank: true,
  })
  const decision = assessRetrievalConfidence(testCase.query, hits)
  const top = hits[0] ?? null
  const topSourceType = top?.sourceType ?? null
  const expectedEscalation = testCase.requiresEscalation
  const escalationPassed = expectedEscalation === undefined
    ? true
    : decision.requiresEscalation === expectedEscalation
  const passed = (
    hits.length > 0 &&
    topSourceType !== null &&
    testCase.expectedTopSourceTypes.includes(topSourceType) &&
    decision.confidence >= testCase.minConfidence &&
    escalationPassed
  )

  return {
    ...testCase,
    passed,
    count: hits.length,
    topSourceType,
    topSourceTitle: top?.sourceTitle ?? null,
    confidence: decision.confidence,
    confidenceLevel: decision.level,
    actualRequiresEscalation: decision.requiresEscalation,
    reasons: decision.reasons,
  }
}

async function main() {
  const options = parseArgs()

  if (!hasLiveEnv()) {
    const payload = {
      skipped: true,
      ok: !options.requireDb,
      reason: 'Missing Supabase service role or Google AI embedding key.',
    }
    console.log(options.json ? JSON.stringify(payload, null, 2) : `Jarvis live RAG eval skipped: ${payload.reason}`)
    if (options.requireDb) process.exitCode = 1
    return
  }

  const [{ retrieve }, { assessRetrievalConfidence }] = await Promise.all([
    import('@/lib/jarvis/rag/retriever'),
    import('@/lib/jarvis/rag/retrieval-confidence'),
  ])
  const results = await Promise.all(CASES.map((testCase) => evaluateCase(
    testCase,
    retrieve,
    assessRetrievalConfidence,
  )))
  const passed = results.filter((result) => result.passed).length
  const passRate = results.length === 0 ? 1 : passed / results.length
  const ok = options.strict ? passRate === 1 : passRate >= 0.9
  const payload = {
    skipped: false,
    ok,
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate,
    results,
  }

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2))
  } else {
    console.log(`Jarvis live RAG retrieval eval: ${passed}/${results.length} passed (${Math.round(passRate * 100)}%)`)
    for (const result of results) {
      console.log(`- ${result.passed ? 'PASS' : 'FAIL'} ${result.id}: top=${result.topSourceType ?? 'none'} confidence=${result.confidence}`)
    }
  }

  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
