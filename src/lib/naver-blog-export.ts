/**
 * 네이버 블로그 외부 발행(스마트에디터 HTML) — 어댑터 스텁
 *
 * 실제 연동 시 필요한 것:
 * - 네이버 개발자 센터 앱 + 블로그 글쓰기 API 권한
 * - OAuth 액세스 토큰(또는 전용 비즈 계약)
 *
 * 구현 시: HTML sanitize → 스마트에디터 호환 DOM 변환 → POST → 응답의 logNo 저장
 */

export interface NaverBlogPublishInput {
  title: string;
  /** 스마트에디터 호환 HTML 본문 */
  htmlBody: string;
  /** 네이버 블로그 글 ID 등 (성공 시) */
  externalPostId?: string;
}

export type NaverBlogPublishResult =
  | { ok: true; logNo?: string; url?: string }
  | { ok: false; reason: string };

/**
 * 현재는 항상 미구현 스킵 — 키·엔드포인트 확정 후 구현
 */
export async function publishToNaverBlogIfConfigured(_input: NaverBlogPublishInput): Promise<NaverBlogPublishResult> {
  if (!process.env.NAVER_BLOG_ACCESS_TOKEN) {
    return { ok: false, reason: 'NAVER_BLOG_ACCESS_TOKEN 미설정(스텁)' };
  }
  return { ok: false, reason: '어댑터 미구현 — naver-blog-export.ts 에 API 연동 추가' };
}
