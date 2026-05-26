/**
 * Next.js dynamic route params 안전 디코더.
 *
 * Next.js 15/16에서 dynamic route segment의 한글·이모지 등 non-ASCII는
 * URL-encoded 상태(`%EC%84%9D%EA%B0%80%EC%9E%A5`)로 page 핸들러에 전달되는 케이스가 있다.
 * DB에는 디코딩된 원본(`석가장-6월-...`)으로 저장돼 있어 `.eq('slug', param)` 매칭이 실패하고
 * `notFound()`로 빠진다. — 2026-05-16 정보성 블로그 25건 일괄 404 사고의 진짜 원인.
 *
 * 이미 디코딩된 상태로 들어오는 경우(`석가장-...`)도 안전하게 통과해야 하므로,
 * 1) `%`가 포함된 경우에만 decodeURIComponent 시도,
 * 2) 디코드 실패(URIError) 시 원문 그대로 반환.
 *
 * 모든 한글/유니코드 slug를 받는 dynamic route는 이 함수를 거쳐야 한다.
 */

// 치환 문자(\uFFFD)가 slug에 포함되어 있으면 로그 출력 (GSC noindex 진단용)
function logIfCorrupted(slug: string, context: string): void {
  if (slug.includes('\uFFFD')) {
    console.warn(`[decode-slug] 치환문자 감지 (context=${context}): slug="${slug}"`);
  }
}

export function safeDecodeSlug(slug: string): string {
  if (typeof slug !== 'string' || !slug) return slug;
  logIfCorrupted(slug, 'input');
  if (!slug.includes('%')) return slug;
  try {
    const decoded = decodeURIComponent(slug);
    logIfCorrupted(decoded, 'decoded');
    return decoded;
  } catch {
    return slug;
  }
}
