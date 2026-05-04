/**
 * 블로그 본문용 — 승인된(post_trip_reviews.status=approved) 실제 후기 스니펫 조회
 * UGC 인용 → 네이버 등 검색 품질 시그널 보강 (법적: 원문 그대로 인용, 낚시 문구 추가 금지 — 프롬프트에서 제약)
 */

import { supabaseAdmin } from '@/lib/supabase'

export interface ReviewSnippet {
  /** 인용에 쓸 한 줄 (원문 일부) */
  quote: string
  overall_rating: number
}

function rowToQuote(row: {
  review_text: string | null
  pros: string[] | null
  overall_rating: number
}): string | null {
  const t = row.review_text?.trim()
  if (t && t.length > 12) return t.length > 280 ? `${t.slice(0, 277)}…` : t
  const p = row.pros?.find(x => typeof x === 'string' && x.trim().length > 8)
  if (p) return p.trim().length > 280 ? `${p.trim().slice(0, 277)}…` : p.trim()
  return null
}

/**
 * package_id 우선; 없으면 destination에 속한 상품들의 후기에서 샘플링
 */
export async function fetchApprovedReviewSnippets(opts: {
  packageId?: string | null
  destination?: string | null
  limit?: number
}): Promise<ReviewSnippet[]> {
  const limit = Math.min(Math.max(opts.limit ?? 4, 1), 8)
  const packageIds: string[] = []

  if (opts.packageId) {
    packageIds.push(opts.packageId)
  } else if (opts.destination?.trim()) {
    const { data: pkgs } = await supabaseAdmin
      .from('travel_packages')
      .select('id')
      .eq('destination', opts.destination.trim())
      .in('status', ['active', 'approved'])
      .limit(40)
    for (const r of pkgs ?? []) {
      const id = (r as { id?: string }).id
      if (id) packageIds.push(id)
    }
  }

  if (packageIds.length === 0) return []

  const { data: rows } = await supabaseAdmin
    .from('post_trip_reviews')
    .select('review_text, pros, overall_rating, helpful_count')
    .eq('status', 'approved')
    .in('package_id', packageIds)
    .order('helpful_count', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit * 3)

  return pickSnippets(rows ?? [], limit)
}

function pickSnippets(
  rows: Array<{
    review_text: string | null
    pros: string[] | null
    overall_rating: number
  }>,
  limit: number,
): ReviewSnippet[] {
  const out: ReviewSnippet[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const q = rowToQuote(row)
    if (!q) continue
    const key = q.slice(0, 40)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ quote: q, overall_rating: row.overall_rating })
    if (out.length >= limit) break
  }
  return out
}

/** 프롬프트에 넣을 마크다운 블록 */
export function formatReviewQuotesForPrompt(snippets: ReviewSnippet[]): string {
  if (snippets.length === 0) return ''
  return snippets
    .map((s, i) => `${i + 1}. 평점 ${s.overall_rating}/5 — ${s.quote}`)
    .join('\n')
}

/** 템플릿 생성 본문 끝에 붙이는 고정 섹션(상품형 generateBlogPost 등) */
export function formatReviewQuotesAppendMarkdown(snippets: ReviewSnippet[]): string {
  if (snippets.length === 0) return ''
  const body = snippets
    .map(
      s =>
        `> ${s.quote.split('\n').join(' ')}\n>\n> — 여행자 평점 ${s.overall_rating}/5\n`,
    )
    .join('\n')
  return `\n\n## 여행자 한마디\n\n실제 다녀오신 분들의 코멘트를 발췌했어요.\n\n${body}`
}
