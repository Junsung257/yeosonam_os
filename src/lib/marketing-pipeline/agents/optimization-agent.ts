/**
 * OptimizationAgent — GSC 검색 성과 수집 → DeepSeek 입찰가 최적화 추천
 *
 * 재사용:
 *   - src/lib/gsc-client.ts (GSC 데이터 수집)
 *   - src/lib/llm-gateway.ts (llmCall)
 *
 * GOOGLE_SERVICE_ACCOUNT_JSON 미설정 시 skip.
 * 추천 결과는 keywords 테이블에 저장 — 실제 입찰가 조정은 어드민 승인 후.
 */
import { BaseMarketingAgent, type MarketingContext, type AgentResult } from '../base-agent';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { fetchBlogSearchMetrics, isGSCConfigured } from '@/lib/gsc-client';
import { llmCall } from '@/lib/llm-gateway';

interface BidAction {
  keyword: string;
  action: 'INCREASE_BID' | 'DECREASE_BID' | 'PAUSE';
  reason: string;
  current_position?: number;
  current_ctr?: number;
}

export class OptimizationAgent extends BaseMarketingAgent {
  readonly name = 'optimization';
  protected override readonly agentRole = 'performance_analyst' as const;

  async run(ctx: MarketingContext): Promise<Omit<AgentResult, 'elapsed_ms'>> {
    if (!isGSCConfigured()) return this.skipWithContract('GOOGLE_SERVICE_ACCOUNT_JSON not configured', {
      input_summary: 'GSC search metrics for performance diagnosis and bid recommendations.',
    });
    if (!isSupabaseConfigured) return this.skipWithContract('Supabase not configured', {
      input_summary: 'GSC search metrics and keyword cache for performance diagnosis.',
    });

    const siteUrl = process.env.GSC_SITE_URL || 'https://www.yeosonam.com/';

    // 어제 날짜 (GSC는 최소 1일 지연)
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const dateStr = yesterday.toISOString().slice(0, 10);

    // GSC 검색 성과 데이터
    let rawMetrics: Awaited<ReturnType<typeof fetchBlogSearchMetrics>> = [];
    try {
      rawMetrics = await fetchBlogSearchMetrics(siteUrl, dateStr, false);
    } catch (err) {
      throw new Error(`GSC 수집 실패: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!rawMetrics.length) return this.withContract({
      ok: true,
      data: { analyzed: 0, reason: 'GSC data unavailable' },
    }, {
      input_summary: `${siteUrl} GSC search metrics for ${dateStr}.`,
      evidence: ['No GSC rows returned'],
      decision: 'insufficient_data',
      next_action: 'Wait for search metrics or verify GSC site access before optimization.',
    });

    // 성과 요약 (상위 20개 키워드)
    const topKeywords = rawMetrics
      .filter(m => m.query != null)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 20)
      .map(m => ({
        keyword: m.query as string,
        impressions: m.impressions,
        clicks: m.clicks,
        ctr: m.impressions > 0 ? +(m.clicks / m.impressions).toFixed(4) : 0,
        avg_position: +m.position.toFixed(1),
      }));

    if (!topKeywords.length) return this.withContract({
      ok: true,
      data: { analyzed: 0 },
    }, {
      input_summary: `${rawMetrics.length} GSC rows checked for keyword optimization.`,
      evidence: ['No keyword rows were eligible for analysis'],
      decision: 'insufficient_keyword_data',
      next_action: 'Collect query-level clicks and impressions before bid diagnosis.',
    });

    // DeepSeek에 입찰가 최적화 요청
    const systemPrompt = `당신은 여행 업계 Google Ads 전문가입니다.
검색 성과 데이터를 분석하여 목표 ROAS 300% 달성을 위한 키워드별 입찰가 조정 액션을 JSON으로 반환하세요.

규칙:
- CTR < 2% + Position > 5: DECREASE_BID (노출만 되고 클릭 없음)
- Position > 8 + Impressions > 100: INCREASE_BID (검색은 되지만 하단 노출)
- Clicks = 0 + Impressions < 10: PAUSE (성과 없음)
- 그 외: 현상 유지 (출력 불필요)`;

    const userPrompt = `다음 ${topKeywords.length}개 키워드의 어제(${dateStr}) 검색 성과입니다:

${JSON.stringify(topKeywords, null, 2)}

목표 ROAS 300% 기준으로 각 키워드의 입찰가 조정 액션을 반환하세요.

출력 JSON 형식:
{
  "actions": [
    { "keyword": "보홀여행", "action": "INCREASE_BID", "reason": "position 6.2로 하단 노출, 클릭 기회 손실", "current_position": 6.2, "current_ctr": 0.018 }
  ]
}`;

    const llmResult = await llmCall<{ actions: BidAction[] }>({
      task: 'jarvis-simple',
      systemPrompt,
      userPrompt,
      maxTokens: 1000,
      temperature: 0.1,
      enableCaching: false,
      jsonSchema: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                keyword: { type: 'string' },
                action: { type: 'string', enum: ['INCREASE_BID', 'DECREASE_BID', 'PAUSE'] },
                reason: { type: 'string' },
                current_position: { type: 'number' },
                current_ctr: { type: 'number' },
              },
              required: ['keyword', 'action', 'reason'],
            },
          },
        },
        required: ['actions'],
      },
    });

    const actions: BidAction[] = llmResult.success && llmResult.data?.actions
      ? llmResult.data.actions
      : [];

    // keyword_research_cache에 입찰가 추천 결과 저장 (raw JSONB 활용)
    let saved = 0;
    const impressionMap = new Map(topKeywords.map(k => [k.keyword, k.impressions]));
    for (const action of actions) {
      try {
        const competitionLevel = action.action === 'INCREASE_BID' ? 'high'
          : action.action === 'DECREASE_BID' ? 'low' : 'very_low';
        await supabaseAdmin.from('keyword_research_cache').upsert({
          keyword: action.keyword,
          source: 'gsc_bid_optimization',
          monthly_search_volume: impressionMap.get(action.keyword) ?? null,
          competition_level: competitionLevel,
          raw: {
            bid_recommendation: action.action,
            bid_reason: action.reason,
            current_position: action.current_position,
            current_ctr: action.current_ctr,
            analyzed_at: new Date().toISOString(),
            tenant_id: ctx.tenantId,
          },
          fetched_at: new Date().toISOString(),
        }, { onConflict: 'keyword' }).throwOnError();
        saved++;
      } catch {
        // 개별 실패 무시
      }
    }

    return this.withContract({
      ok: true,
      data: {
        keywords_analyzed: topKeywords.length,
        actions_generated: actions.length,
        actions_saved: saved,
        date: dateStr,
      },
    }, {
      input_summary: `${topKeywords.length} top GSC keywords analyzed for CTR, position, and bid action signals.`,
      evidence: [`${actions.length} bid actions generated`, `${saved} recommendations saved`, `GSC date ${dateStr}`],
      decision: actions.length > 0 ? 'optimization_candidates_ready' : 'no_change',
      next_action: actions.length > 0 ? 'Review bid recommendations before any platform mutation.' : 'Keep collecting performance data.',
      needs_human_approval: actions.length > 0,
    });
  }
}
