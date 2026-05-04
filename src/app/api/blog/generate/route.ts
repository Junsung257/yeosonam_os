import { NextRequest, NextResponse } from 'next/server';
import { generateBlogText, hasBlogApiKey } from '@/lib/blog-ai-caller';
import { BLOG_STYLE_GUIDE } from '@/prompts/blog/style-guide';

/**
 * 블로그 AI 초안 생성 API
 * - 상품 기반: product_id → 기존 content-hub/generate 위임
 * - 정보성 글: topic + category → Gemini로 직접 생성
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, category } = body;

    if (!topic) {
      return NextResponse.json({ error: 'topic은 필수입니다.' }, { status: 400 });
    }

    if (!hasBlogApiKey()) {
      // AI 키 없으면 템플릿 반환
      return NextResponse.json({
        blog_html: `# ${topic}\n\n안녕하세요, 여소남입니다.\n\n${topic}에 대해 알려드립니다.\n\n## 본문\n\n여기에 내용을 작성하세요.\n\n## 마무리\n\n여소남에서 안심하고 여행을 준비하세요.\n[yeosonam.com](https://yeosonam.com)`,
        seo: {
          slug: topic.toLowerCase().replace(/[^a-z0-9가-힣\s]/g, '').trim().replace(/\s+/g, '-').substring(0, 80),
          seoTitle: `${topic} | 여소남 여행 가이드`.substring(0, 60),
          seoDescription: `${topic}에 대한 완벽 가이드. 여소남에서 확인하세요.`.substring(0, 160),
        },
      });
    }

    const categoryLabel: Record<string, string> = {
      travel_tips: '여행팁',
      visa_info: '비자·입국 정보',
      itinerary: '추천일정',
      preparation: '여행준비',
      local_info: '현지정보',
    };
    const catName = categoryLabel[category] || '여행 정보';


    const prompt = `아래 주제·카테고리로 **한 편의 한국어 블로그 초안**을 작성해라.
위 시스템 스타일 가이드(페르소나·금지어·구조)를 **전부 준수**한다.
정보성 글이므로 상품 H2 블록 대신, 주제에 맞는 H2를 스스로 설계해도 된다. 다만 **## [자주 묻는 질문]** 은 Q/A 포맷으로 넣어라.

## 주제
${topic}

## 카테고리
${catName}

## 이번 글 전용 규칙
1. 마크다운 (# H1, ## H2, ### H3). H1에 주제 키워드 포함.
2. H2는 5~7개.
3. 전체 1,500~2,500자(공백 제외 기준 아님, 본문 길이).
4. 인트로에서 독자가 궁금해할 결론을 먼저 짚고, 뒤에서 근거를 풀어라.
5. 날짜·비용·준비물 등 **검증 가능한 수치**를 구체적으로.
6. 마지막에 여소남 안내 한 줄 + yeosonam.com 링크 (스타일 가이드 CTA 톤에 맞출 것).
7. 마크다운만 출력 (코드블록으로 감싸지 말 것).`;

    const systemPrompt = `${BLOG_STYLE_GUIDE}

## 모드 오버라이드 (이 요청은 정보성 단독 주제)

- 연결된 상품(travel_packages)이 없다. **## [여소남이 이 상품을 고른 이유]** · **## [항공·요금·포함 안내]** 표 섹션은 작성하지 않는다.
- 동등한 실용 분량을 주제·카테고리에 맞는 H2로 채운다.
- **## [자주 묻는 질문]** 은 스타일 가이드 포맷으로 유지한다.`;

    const blogHtml = (await generateBlogText(prompt, {
      temperature: 0.7,
      systemPrompt,
    }))
      .replace(/^```markdown\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    // slug 자동 생성
    const slugBase = topic.toLowerCase()
      .replace(/[^a-z0-9가-힣\s]/g, '').trim().replace(/\s+/g, '-').substring(0, 80);

    const year = new Date().getFullYear();

    return NextResponse.json({
      blog_html: blogHtml,
      seo: {
        slug: slugBase,
        seoTitle: `${topic} | ${year} 여소남 가이드`.substring(0, 60),
        seoDescription: `${topic} 완벽 가이드. 실용 정보와 팁을 여소남에서 확인하세요.`.substring(0, 160),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI 생성 실패' },
      { status: 500 },
    );
  }
}
