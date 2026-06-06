import { NextRequest, NextResponse } from 'next/server';
import { generateBlogJSON, hasBlogApiKey } from '@/lib/blog-ai-caller';
import {
  buildLearningPostSample,
  compareFeatureGroups,
  formatFeatureDeltaNarratives,
  summarizeFeatureGroup,
} from '@/lib/blog-learning-features';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

const MIN_POSTS_FOR_LEARNING = 30;
const MIN_ENGAGEMENT_FOR_LEARNING = 50;

type PerformanceRow = {
  id: string;
  seo_title: string | null;
  angle_type: string | null;
  sub_keyword: string | null;
  prompt_version: string | null;
  traffic_count: number | null;
  avg_time_on_page: number | null;
  avg_scroll_depth: number | null;
  cta_click_rate: number | null;
  first_touch_conversions: number | null;
  avg_search_position: number | null;
  engagement_count: number | null;
};

function summarizeForPrompt(post: ReturnType<typeof buildLearningPostSample>) {
  return {
    title: post.title,
    angle: post.angle,
    destination: post.destination,
    prompt_version: post.prompt_version,
    traffic: post.traffic,
    avg_time: post.avg_time,
    scroll: post.scroll,
    cta_rate: post.cta_rate,
    conversions: post.conversions,
    search_position: post.search_position,
    score: post.score ? Math.round(post.score) : null,
    features: post.features,
  };
}

function extractJsonObject(raw: string): any | null {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export async function POST(_request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB not configured' }, { status: 503 });
  }

  try {
    const { data: performance, error } = await supabaseAdmin
      .from('blog_performance_view')
      .select('*');

    if (error) throw error;

    const posts = (performance || []) as PerformanceRow[];
    const totalEngagement = posts.reduce((sum, post) => sum + (post.engagement_count || 0), 0);

    if (posts.length < MIN_POSTS_FOR_LEARNING) {
      return NextResponse.json({
        status: 'insufficient_data',
        message: `Need at least ${MIN_POSTS_FOR_LEARNING} published posts for learning`,
        current: {
          published_blogs: posts.length,
          total_engagement: totalEngagement,
          threshold: {
            posts: MIN_POSTS_FOR_LEARNING,
            engagement: MIN_ENGAGEMENT_FOR_LEARNING,
          },
        },
      });
    }

    if (totalEngagement < MIN_ENGAGEMENT_FOR_LEARNING) {
      return NextResponse.json({
        status: 'insufficient_engagement',
        message: `Need at least ${MIN_ENGAGEMENT_FOR_LEARNING} total engagement for learning`,
        current: {
          published_blogs: posts.length,
          total_engagement: totalEngagement,
        },
      });
    }

    const scored = posts
      .map((post) => {
        const trafficScore = (post.traffic_count || 0) * 1.0;
        const timeScore = (post.avg_time_on_page || 0) * 0.5;
        const scrollScore = (post.avg_scroll_depth || 0) * 0.3;
        const ctaScore = (post.cta_click_rate || 0) * 100 * 2;
        const conversionScore = (post.first_touch_conversions || 0) * 10;
        const positionBoost = post.avg_search_position
          ? Math.max(0, 20 - Number(post.avg_search_position))
          : 0;

        return {
          ...post,
          score: trafficScore + timeScore + scrollScore + ctaScore + conversionScore + positionBoost,
        };
      })
      .sort((a, b) => b.score - a.score);

    const topN = Math.max(3, Math.floor(scored.length * 0.2));
    const topPosts = scored.slice(0, topN);
    const bottomPosts = scored.slice(-topN);
    const selectedIds = Array.from(
      new Set(
        [...topPosts, ...bottomPosts]
          .map((post) => post.id)
          .filter(Boolean),
      ),
    );

    const { data: contentRows, error: contentError } = await supabaseAdmin
      .from('content_creatives')
      .select('id, slug, seo_title, seo_description, blog_html, destination, angle_type, prompt_version')
      .in('id', selectedIds);

    if (contentError) throw contentError;

    const contentMap = new Map((contentRows || []).map((row: any) => [row.id, row]));
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

    const topSamples = topPosts.map((post) =>
      buildLearningPostSample({ ...post, ...(contentMap.get(post.id) || {}) }, baseUrl),
    );
    const bottomSamples = bottomPosts.map((post) =>
      buildLearningPostSample({ ...post, ...(contentMap.get(post.id) || {}) }, baseUrl),
    );

    const topFeatureSummary = summarizeFeatureGroup(topSamples);
    const bottomFeatureSummary = summarizeFeatureGroup(bottomSamples);
    const featureDeltas = compareFeatureGroups(topFeatureSummary, bottomFeatureSummary);
    const featureNarratives = formatFeatureDeltaNarratives(featureDeltas, 10);

    if (!hasBlogApiKey()) {
      return NextResponse.json({ error: 'AI API not configured' }, { status: 503 });
    }

    const prompt = `You are improving a travel blog generation prompt for SEO and conversion.

Compare the top-performing posts and bottom-performing posts, then recommend prompt changes.

Google Search Central guardrails:
- Prioritize helpful, reliable, people-first content.
- Avoid scaled filler, generic rewrites, or structure that exists only for ranking.
- Recommend descriptive, concise, unique titles.
- Recommend page-specific, human-readable meta descriptions.
- Only recommend FAQ, breadcrumb, and article structure when the visible content genuinely supports it.
- Favor original value, official source links, clear summaries, useful internal links, and readable sectioning.

Top posts:
${JSON.stringify(topSamples.map(summarizeForPrompt), null, 2)}

Bottom posts:
${JSON.stringify(bottomSamples.map(summarizeForPrompt), null, 2)}

Top structure summary:
${JSON.stringify(topFeatureSummary, null, 2)}

Bottom structure summary:
${JSON.stringify(bottomFeatureSummary, null, 2)}

Top vs bottom structure deltas:
${JSON.stringify(featureDeltas.slice(0, 12), null, 2)}

Readable delta summary:
${JSON.stringify(featureNarratives, null, 2)}

Return JSON only:
{
  "summary": "2-3 sentence summary",
  "top_patterns": ["pattern 1", "pattern 2"],
  "bottom_patterns": ["problem 1", "problem 2"],
  "structural_patterns": ["shape pattern 1", "shape pattern 2"],
  "suggested_prompt_changes": [
    { "area": "h1_title", "change": "what to change", "reason": "why" },
    { "area": "summary_block", "change": "what to change", "reason": "why" },
    { "area": "faq_and_question_headings", "change": "what to change", "reason": "why" },
    { "area": "official_sources_and_internal_links", "change": "what to change", "reason": "why" },
    { "area": "image_and_alt_policy", "change": "what to change", "reason": "why" },
    { "area": "highlight_density", "change": "what to change", "reason": "why" }
  ],
  "next_version": "v1.5",
  "confidence": "high|medium|low"
}`;

    const analysisText = await generateBlogJSON(prompt, { temperature: 0.3 });
    const analysis = extractJsonObject(analysisText);

    if (!analysis) {
      return NextResponse.json(
        { error: 'Failed to parse analysis JSON', raw: analysisText },
        { status: 500 },
      );
    }

    const { data: action, error: actionError } = await supabaseAdmin
      .from('agent_actions')
      .insert({
        agent_type: 'marketing',
        action_type: 'prompt_improvement_suggestion',
        summary: `블로그 프롬프트 개선 제안: ${analysis.summary || '자동 분석 결과'}`,
        payload: {
          analysis,
          top_posts: topSamples.slice(0, 5).map(summarizeForPrompt),
          bottom_posts: bottomSamples.slice(0, 5).map(summarizeForPrompt),
          top_feature_summary: topFeatureSummary,
          bottom_feature_summary: bottomFeatureSummary,
          feature_deltas: featureDeltas.slice(0, 12),
          feature_narratives: featureNarratives,
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
      feature_summary: {
        top: topFeatureSummary,
        bottom: bottomFeatureSummary,
        deltas: featureDeltas.slice(0, 12),
      },
      stats: {
        total_posts: posts.length,
        analyzed_top: topSamples.length,
        analyzed_bottom: bottomSamples.length,
      },
    });
  } catch (err) {
    console.error('[prompt-optimizer] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Analysis failed' },
      { status: 500 },
    );
  }
}

export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ready: false, reason: 'DB not configured' });
  }

  try {
    const { data: posts, error } = await supabaseAdmin
      .from('blog_performance_view')
      .select('id, engagement_count');

    if (error) throw error;

    const total = (posts || []).length;
    const totalEngagement = (posts || []).reduce(
      (sum: number, post: any) => sum + (post.engagement_count || 0),
      0,
    );
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
    return NextResponse.json(
      { ready: false, error: err instanceof Error ? err.message : 'Lookup failed' },
      { status: 500 },
    );
  }
}
