import type { RetrievalHit, SourceType } from './retriever'

const POLICY_RE = /환불|취소|결제|입금|예약\s*상태|변경|영문명|여권|개인정보|클레임|보상|가격\s*변경|할인|알림톡|카카오톡/i
const PACKAGE_RE = /추천|상품|패키지|가격|비교|출발|일정|호텔|항공|가족|효도|단체|특가/i
const ATTRACTION_RE = /관광지|볼거리|가볼|명소|코스|일정|동선/i
const BLOG_RE = /가이드|준비|날씨|우기|후기|팁|주의/i

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2)
}

function keywordOverlap(queryTokens: Set<string>, hit: RetrievalHit): number {
  if (queryTokens.size === 0) return 0
  const text = `${hit.sourceTitle ?? ''} ${hit.chunkText} ${hit.contextualText}`.toLowerCase()
  let matched = 0
  for (const token of queryTokens) {
    if (text.includes(token)) matched++
  }
  return matched / queryTokens.size
}

function sourceIntentBoost(query: string, sourceType: SourceType): number {
  if (POLICY_RE.test(query)) return sourceType === 'policy' ? 0.18 : -0.04
  if (PACKAGE_RE.test(query)) return sourceType === 'package' ? 0.12 : 0
  if (ATTRACTION_RE.test(query)) return sourceType === 'attraction' ? 0.12 : 0
  if (BLOG_RE.test(query)) return sourceType === 'blog' ? 0.08 : 0
  return 0
}

export function selectEvidenceHits(query: string, hits: RetrievalHit[], limit: number): RetrievalHit[] {
  if (hits.length <= limit) return hits

  const queryTokens = new Set(tokenize(query))
  const selected: RetrievalHit[] = []
  const remaining = [...hits]
  const sourceCounts = new Map<SourceType, number>()
  const titleCounts = new Map<string, number>()

  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = 0
    let bestScore = Number.NEGATIVE_INFINITY

    for (let index = 0; index < remaining.length; index++) {
      const hit = remaining[index]
      const titleKey = hit.sourceTitle ?? hit.id
      const sourcePenalty = (sourceCounts.get(hit.sourceType) ?? 0) * 0.05
      const duplicateTitlePenalty = (titleCounts.get(titleKey) ?? 0) * 0.12
      const relevance =
        (hit.vectorScore * 0.65) +
        (Math.min(hit.bm25Score, 1) * 0.1) +
        (keywordOverlap(queryTokens, hit) * 0.2) +
        sourceIntentBoost(query, hit.sourceType)
      const score = relevance - sourcePenalty - duplicateTitlePenalty

      if (score > bestScore) {
        bestScore = score
        bestIndex = index
      }
    }

    const [best] = remaining.splice(bestIndex, 1)
    selected.push(best)
    sourceCounts.set(best.sourceType, (sourceCounts.get(best.sourceType) ?? 0) + 1)
    titleCounts.set(best.sourceTitle ?? best.id, (titleCounts.get(best.sourceTitle ?? best.id) ?? 0) + 1)
  }

  return selected
}
