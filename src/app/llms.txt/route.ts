import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * llms.txt — AI 모델(GPTBot, ClaudeBot, PerplexityBot, Gemini)을 위한
 * 사이트 이해 가이드.
 * https://llmstxt.org/
 *
 * GEO(AI Overviews) 가시성을 높이기 위해 사이트 구조를 요약 제공한다.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 86400; // 24시간 캐시

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';
  const lines: string[] = [];

  lines.push('# 여소남');
  lines.push('> 한국인 맞춤 해외 패키지여행 큐레이션 플랫폼. 모든 여행 상품과 블로그 가이드를 제공합니다.');
  lines.push('');

  // 주요 페이지
  lines.push('## 주요 페이지');
  lines.push(`- [홈](${baseUrl}/) — 여행 상품 검색 및 추천`);
  lines.push(`- [블로그](${baseUrl}/blog) — 여행 가이드 · 꿀팁 · 상품 리뷰`);
  lines.push(`- [패키지 목록](${baseUrl}/packages) — 전체 여행 패키지`);
  lines.push(`- [고객 문의](${baseUrl}/contact) — 상담 및 예약 문의`);
  lines.push('');

  // 카테고리별 블로그
  lines.push('## 블로그 콘텐츠');
  lines.push(`- [목적지별 블로그](${baseUrl}/blog?tab=destinations)`);
  lines.push(`- [가성비 여행](${baseUrl}/blog/angle/value) — 합리적인 가격의 패키지`);
  lines.push(`- [감성 여행](${baseUrl}/blog/angle/emotional) — 분위기 있는 여행지`);
  lines.push(`- [럭셔리 여행](${baseUrl}/blog/angle/luxury) — 프리미엄 패키지`);
  lines.push(`- [효도 여행](${baseUrl}/blog/angle/filial) — 부모님 모시고 가는 여행`);
  lines.push(`- [액티비티](${baseUrl}/blog/angle/activity) — 스포츠·체험 중심 여행`);
  lines.push(`- [미식 여행](${baseUrl}/blog/angle/food) — 현지 음식 탐방`);
  lines.push('');

  // 최근 발행된 블로그 글 20개 (동적)
  if (isSupabaseConfigured) {
    try {
      const { data: recentPosts } = await supabaseAdmin
        .from('content_creatives')
        .select('slug, seo_title, destination')
        .eq('status', 'published')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .order('published_at', { ascending: false })
        .limit(20);

      if (recentPosts && recentPosts.length > 0) {
        lines.push('## 최근 블로그 글');
        for (const post of recentPosts) {
          const title = post.seo_title || `${post.destination || ''} 여행 가이드`;
          lines.push(`- [${title}](${baseUrl}/blog/${post.slug})`);
        }
        lines.push('');
      }
    } catch {
      // 사일런트 — llms.txt가 없어도 서비스는 정상
    }
  }

  // FAQ (AI Overviews 인용 최적화)
  lines.push('## 자주 묻는 질문');
  lines.push('- 여소남은 어떤 서비스인가요? → 한국인 맞춤 해외 패키지여행을 큐레이션하고 판매하는 플랫폼입니다.');
  lines.push('- 어떤 목적지가 인기인가요? → 다낭, 보홀, 세부, 후쿠오카, 나트랑 등 동남아·일본 패키지가 주력입니다.');
  lines.push('- 예약은 어떻게 하나요? → 카카오톡 상담 또는 홈페이지를 통해 가능합니다.');
  lines.push('- 환불 정책은 어떻게 되나요? → 각 상품별 취소 규정에 따르며, 상세 조건은 상품 페이지에서 확인할 수 있습니다.');
  lines.push('');

  // 기술 정보
  lines.push('## 기술 정보');
  lines.push('- Content-Type: blog posts in markdown/html');
  lines.push('- Language: Korean (ko-KR)');
  lines.push('- Structured Data: schema.org/BlogPosting, FAQPage, HowTo, TouristTrip');
  lines.push(`- RSS: ${baseUrl}/api/rss`);
  lines.push('');

  // 허용·불허 경로
  lines.push('## 허용 경로');
  lines.push('- `/blog/*` — 모든 블로그 글');
  lines.push('- `/packages/*` — 모든 여행 상품');
  lines.push('- `/api/rss` — RSS 피드');
  lines.push('');
  lines.push('## 제한 경로');
  lines.push('- `/admin/*` — 관리자 전용');
  lines.push('- `/api/*` — 내부 API (RSS 제외)');

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200',
      'X-Robots-Tag': 'all',
    },
  });
}
