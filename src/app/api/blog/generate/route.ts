import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

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

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
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

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.7 },
    });

    const prompt = `너는 10년차 여행 블로그 전문 에디터다.
아래 주제로 SEO 최적화된 한국어 블로그 글을 작성해라.

## 주제
${topic}

## 카테고리
${catName}

## 작성 규칙
1. 마크다운 형식 (# H1, ## H2, ### H3)
2. H1: 주제 키워드 포함
3. H2: 5~7개 사용
4. 전체 분량: 1500~2500자
5. 인트로에 핵심 결론 먼저 제시
6. 실용적 정보 위주 (날짜, 비용, 준비물 등 구체적 수치)
7. CTA: "여소남에서 안심 여행 준비하세요 — yeosonam.com"
8. 마크다운만 출력 (코드블록 감싸지 말 것)
9. 브랜드: 여소남`;

    const result = await model.generateContent(prompt);
    const blogHtml = result.response.text()
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
