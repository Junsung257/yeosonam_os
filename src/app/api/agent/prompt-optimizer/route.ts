import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * 블로그 프롬프트 자동 개선 엔진 (스켈레톤)
 *
 * 동작 원리:
 *   1. blog_performance_view에서 발행된 블로그 성과 조회
 *   2. 최소 임계값 체크 (데이터 30건 이상, engagement 50건 이상)
 *   3. 상위 20% vs 하위 20% 글 비교 → Gemini에게 패턴 분석 요청
 *   4. 프롬프트 개선 제안을 agent_actions에 pending으로 등록
 *   5. 사장님이 결재함에서 승인 → 차기 프롬프트 버전에 반영
 *
 * 안전장치:
 *   - 자동 수정 없음. 항상 HITL 결재 필요
 *   - 데이터 부족 시 조용히 대기
 *
 * 호출:
 *   - 사장님이 수동으로 /admin/content-analytics에서 "학습 실행" 버튼
 *   - (미래) Cron에 통합
 */

const MIN_POSTS_FOR_LEARNING = 30;         // 발행 블로그 최소 개수
const MIN_ENGAGEMENT_FOR_LEARNING = 50;    // 누적 engagement 최소 개수

export async function POST(_request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    // 성과 데이터 조회
    const { data: performance, error } = await supabaseAdmin
      .from('blog_performance_view')
      .select('*');

    if (error) throw error;

    const posts = performance || [];

    // 최소 임계값 체크
    const totalEngagement = posts.reduce((sum: number, p: any) => sum + (p.engagement_count || 0), 0);

    if (posts.length < MIN_POSTS_FOR_LEARNING) {
      return NextResponse.json({
        status: 'insufficient_data',
        message: `학습을 위해 최소 ${MIN_POSTS_FOR_LEARNING}개의 발행된 블로그가 필요합니다 (현재: ${posts.length}개)`,
        current: {
          published_blogs: posts.length,
          total_engagement: totalEngagement,
          threshold: { posts: MIN_POSTS_FOR_LEARNING, engagement: MIN_ENGAGEMENT_FOR_LEARNING },
        },
      });
    }

    if (totalEngagement < MIN_ENGAGEMENT_FOR_LEARNING) {
      return NextResponse.json({
        status: 'insufficient_engagement',
        message: `학습을 위해 최소 ${MIN_ENGAGEMENT_FOR_LEARNING}건의 engagement가 필요합니다 (현재: ${totalEngagement}건)`,
        current: {
          published_blogs: posts.length,
          total_engagement: totalEngagement,
        },
      });
    }

    // 성과 점수 계산 (가중 평균: 유입 + 체류시간 + 스크롤 + CTA 전환 + 검색순위)
    const scored = posts.map((p: any) => {
      const trafficScore = (p.traffic_count || 0) * 1.0;
      const timeScore = (p.avg_time_on_page || 0) * 0.5;  // 초당 0.5점
      const scrollScore = (p.avg_scroll_depth || 0) * 0.3;
      const ctaScore = (p.cta_click_rate || 0) * 100 * 2;  // 1% = 2점
      const conversionScore = (p.first_touch_conversions || 0) * 10;
      const positionPenalty = p.avg_search_position ? Math.max(0, 20 - Number(p.avg_search_position)) : 0;

      return {
        ...p,
        score: trafficScore + timeScore + scrollScore + ctaScore + conversionScore + positionPenalty,
      };
    }).sort((a: any, b: any) => b.score - a.score);

    // 상위 20% vs 하위 20%
    const topN = Math.max(3, Math.floor(scored.length * 0.2));
    const topPosts = scored.slice(0, topN);
    const bottomPosts = scored.slice(-topN);

    // AI 분석
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI API 미설정' }, { status: 503 });
    }

    const summarize = (p: any) => ({
      title: p.seo_title,
      angle: p.angle_type,
      sub_keyword: p.sub_keyword,
      prompt_version: p.prompt_version,
      traffic: p.traffic_count,
      avg_time: p.avg_time_on_page,
      scroll: p.avg_scroll_depth,
      cta_rate: p.cta_click_rate,
      conversions: p.first_touch_conversions,
      search_position: p.avg_search_position,
      score: Math.round(p.score),
    });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.3 },  // 분석용이므로 낮은 temp
    });

    const prompt = `너는 블로그 SEO 및 전환율 최적화 전문가다.
아래는 우리 여행 플랫폼 여소남의 블로그 성과 데이터다.
상위 성과 글과 하위 성과 글을 비교 분석하여, 차기 블로그 생성 프롬프트를 어떻게 개선해야 할지 구체적으로 제안하라.

## 상위 성과 글 (상위 20%)
${JSON.stringify(topPosts.map(summarize), null, 2)}

## 하위 성과 글 (하위 20%)
${JSON.stringify(bottomPosts.map(summarize), null, 2)}

## 분석 지시
1. 상위-하위 차이의 패턴을 찾아라 (angle, sub_keyword, 제목 형식, 본문 구조 등)
2. 가설: "이런 프롬프트 변화가 성과를 올릴 것이다"
3. 구체적 개선안을 JSON으로 제시:

{
  "summary": "주요 발견사항 2~3줄 요약",
  "top_patterns": ["상위 글의 공통 패턴 1", "패턴 2"],
  "bottom_patterns": ["하위 글의 공통 문제 1", "문제 2"],
  "suggested_prompt_changes": [
    { "area": "h1_title", "change": "어떻게 바꿀지", "reason": "왜" },
    { "area": "sub_keyword_selection", "change": "...", "reason": "..." }
  ],
  "next_version": "v1.5",
  "confidence": "high|medium|low"
}

반드시 위 JSON 형식만 출력하라. 마크다운 코드블록 금지.`;

    const result = await model.generateContent(prompt);
    let analysisText = result.response.text()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    let analysis: any = null;
    try {
      analysis = JSON.parse(analysisText);
    } catch {
      const match = analysisText.match(/\{[\s\S]*\}/);
      if (match) {
        try { analysis = JSON.parse(match[0]); } catch { /* noop */ }
      }
    }

    if (!analysis) {
      return NextResponse.json({ error: 'AI 분석 결과 파싱 실패', raw: analysisText }, { status: 500 });
    }

    // agent_actions에 제안 등록 (HITL 결재함)
    const { data: action, error: actionError } = await supabaseAdmin
      .from('agent_actions')
      .insert({
        agent_type: 'marketing',
        action_type: 'prompt_improvement_suggestion',
        summary: `블로그 프롬프트 개선 제안: ${analysis.summary || '자동 분석 결과'}`,
        payload: {
          analysis,
          top_posts: topPosts.slice(0, 5).map(summarize),
          bottom_posts: bottomPosts.slice(0, 5).map(summarize),
          analyzed_at: new Date().toISOString(),
          total_posts: posts.length,
          total_engagement: totalEngagement,
        },
        priority: 'normal',
        requested_by: 'prompt-optimizer',
      })
      .select();

    if (actionError) throw actionError;

    return NextResponse.json({
      status: 'suggestion_created',
      action_id: action?.[0]?.id,
      analysis,
      stats: {
        total_posts: posts.length,
        analyzed_top: topPosts.length,
        analyzed_bottom: bottomPosts.length,
      },
    });
  } catch (err) {
    console.error('[prompt-optimizer] 오류:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '분석 실패' },
      { status: 500 },
    );
  }
}

// 학습 상태 확인용 (대시보드에서 호출)
export async function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ ready: false, reason: 'DB 미설정' });

  try {
    const { data: posts, error } = await supabaseAdmin
      .from('blog_performance_view')
      .select('id, engagement_count');

    if (error) throw error;

    const total = (posts || []).length;
    const totalEngagement = (posts || []).reduce((sum: number, p: any) => sum + (p.engagement_count || 0), 0);

    const ready = total >= MIN_POSTS_FOR_LEARNING && totalEngagement >= MIN_ENGAGEMENT_FOR_LEARNING;

    return NextResponse.json({
      ready,
      stats: {
        published_blogs: total,
        total_engagement: totalEngagement,
      },
      thresholds: {
        min_posts: MIN_POSTS_FOR_LEARNING,
        min_engagement: MIN_ENGAGEMENT_FOR_LEARNING,
      },
      progress: {
        posts_pct: Math.min(100, Math.round((total / MIN_POSTS_FOR_LEARNING) * 100)),
        engagement_pct: Math.min(100, Math.round((totalEngagement / MIN_ENGAGEMENT_FOR_LEARNING) * 100)),
      },
    });
  } catch (err) {
    return NextResponse.json({ ready: false, error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}
