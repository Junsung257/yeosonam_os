/**
 * Blog Top-Performer Few-Shot Retrieval
 * ─────────────────────────────────────
 * 같은 (destination, angle) 의 과거 성공 블로그를 조회수 기준으로 retrieve →
 * 짧은 발췌(H1·핵심 H2 1개·문단 1개)를 prompt 에 demo 로 주입.
 *
 * 효과: 등록할수록 좋아지는 compound learning loop
 *   - 조회수 높은 글의 톤·구조가 다음 생성에 자연스럽게 반영됨
 *   - 새 상품일수록 비슷한 성공 패턴을 모방
 *
 * 비용 보호:
 *   - 발췌는 글당 ~400자, 최대 3개 → 총 1.2K자 추가
 *   - Gemini 2.5 Flash 입력 비용 무시 가능
 *
 * Hallucination 보호:
 *   - 발췌는 "참고만, 팩트는 현재 상품 정보가 우선" 이라는 가드 문구 함께 주입
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

interface FewShotExample {
  seoTitle: string;
  excerpt: string;
  viewCount: number;
}

/**
 * 조회수 기준 상위 N개 글의 짧은 발췌를 가져온다.
 * 0개면 빈 배열 (graceful fallback — 신규 목적지·앵글은 자연스럽게 skip).
 */
export async function getTopPerformingBlogExcerpts(
  destination: string | null | undefined,
  angle: string,
  options?: {
    excludeProductId?: string | null;
    limit?: number;
    minViewCount?: number;
  },
): Promise<FewShotExample[]> {
  if (!isSupabaseConfigured) return [];
  if (!destination || !angle) return [];

  const limit = options?.limit ?? 3;
  const minViewCount = options?.minViewCount ?? 30; // 노이즈 컷오프

  try {
    // travel_packages.destination JOIN 으로 같은 목적지 + 같은 앵글 검색
    let query = supabaseAdmin
      .from('content_creatives')
      .select(
        'id, slug, seo_title, blog_html, view_count, product_id, travel_packages!inner(destination)',
      )
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .eq('angle_type', angle)
      .eq('travel_packages.destination', destination)
      .gte('view_count', minViewCount)
      .order('view_count', { ascending: false })
      .limit(limit);

    if (options?.excludeProductId) {
      query = query.neq('product_id', options.excludeProductId);
    }

    const { data, error } = await query;
    if (error || !data) return [];

    const examples: FewShotExample[] = [];
    for (const row of data as Array<{
      seo_title: string | null;
      blog_html: string | null;
      view_count: number | null;
    }>) {
      if (!row.blog_html) continue;
      const excerpt = extractKeyExcerpt(row.blog_html);
      if (!excerpt) continue;
      examples.push({
        seoTitle: row.seo_title ?? '',
        excerpt,
        viewCount: row.view_count ?? 0,
      });
    }
    return examples;
  } catch (err) {
    // 학습 루프 실패는 블로커 X — 기존 생성 흐름 유지
    console.warn('[blog-few-shot] retrieval 실패 (무시):', err);
    return [];
  }
}

/**
 * 마크다운 글에서 H1 + 첫 H2 단락(최대 ~400자) 발췌.
 * "성공한 글이 어떤 어조·구성으로 시작했는지" 만 보여주면 충분.
 */
function extractKeyExcerpt(html: string): string {
  const lines = html.split('\n');
  const out: string[] = [];
  let h1Captured = false;
  let h2Captured = false;
  let bodyAfterH2 = 0;
  const MAX_BODY = 280;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // H1 (1개만)
    if (!h1Captured && /^#\s/.test(trimmed)) {
      out.push(trimmed);
      h1Captured = true;
      continue;
    }
    // H2 1개 + 그 다음 단락 280자
    if (h1Captured && !h2Captured && /^##\s/.test(trimmed)) {
      out.push('', trimmed);
      h2Captured = true;
      continue;
    }
    if (h2Captured && !/^#{1,6}\s/.test(trimmed)) {
      // 본문 (이미지·인용 제외)
      if (/^!\[/.test(trimmed) || /^>/.test(trimmed)) continue;
      out.push(trimmed);
      bodyAfterH2 += trimmed.length;
      if (bodyAfterH2 >= MAX_BODY) break;
    }
  }

  const excerpt = out.join('\n').trim();
  return excerpt.length >= 80 ? excerpt : '';
}

/**
 * 발췌들을 Gemini 프롬프트용 블록으로 직렬화.
 * 빈 배열이면 빈 문자열 (프롬프트에 영향 0).
 */
export function formatFewShotBlock(examples: FewShotExample[]): string {
  if (examples.length === 0) return '';

  const blocks = examples.map((ex, i) =>
    `### 성공 사례 ${i + 1} (조회 ${ex.viewCount}회)
제목: ${ex.seoTitle}

${ex.excerpt}`,
  );

  return `\n## 📈 같은 목적지·앵글의 과거 성공 글 (참고만 — 팩트는 현재 상품 정보가 우선)
아래는 조회수가 잘 나온 비슷한 글의 도입부입니다. 톤·구성·Hook 만 참고하고, 사실(가격·일정·관광지명)은 절대 차용하지 마세요.

${blocks.join('\n\n')}
`;
}
