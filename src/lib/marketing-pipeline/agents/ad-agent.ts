/**
 * AdAgent — Meta/Google 광고 카피 생성 → ad_campaigns/ad_creatives에 DRAFT 저장
 *
 * ContentBrief 전체 구조 생성 없이 llmCall로 직접 광고 카피 생성.
 * 실제 광고 API 호출은 어드민 승인 후 수행 (DRAFT 패턴).
 * 재사용: src/lib/llm-gateway.ts, src/lib/marketing-pipeline/token-resolver.ts
 */
import { BaseMarketingAgent, type MarketingContext, type AgentResult } from '../base-agent';
import { resolveOAuthToken } from '../token-resolver';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { llmCall } from '@/lib/llm-gateway';
import { getSecret } from '@/lib/secret-registry';

interface PackageRow {
  id: string;
  title: string;
  destination: string | null;
  nights: number | null;
  min_price: number | null;
  product_highlights: string[] | null;
}

export class AdAgent extends BaseMarketingAgent {
  readonly name = 'ad';
  protected override readonly agentRole = 'campaign_planner' as const;

  async run(ctx: MarketingContext): Promise<Omit<AgentResult, 'elapsed_ms'>> {
    if (!isSupabaseConfigured) return this.skipWithContract('Supabase not configured', {
      input_summary: 'Approved packages and connected ad accounts for campaign draft planning.',
    });
    if (!getSecret('DEEPSEEK_API_KEY') && !getSecret('GEMINI_API_KEY') && !getSecret('GOOGLE_AI_API_KEY')) {
      return this.skipWithContract('LLM API key not configured', {
        input_summary: 'Approved packages and connected ad accounts for campaign draft planning.',
      });
    }

    const [metaToken, googleToken] = await Promise.all([
      resolveOAuthToken(ctx.tenantId, 'meta'),
      resolveOAuthToken(ctx.tenantId, 'google_ads'),
    ]);

    if (!metaToken && !googleToken) {
      return this.skipWithContract('Meta/Google OAuth not connected', {
        input_summary: 'Tenant OAuth tokens for Meta and Google Ads campaign drafting.',
        next_action: 'Connect at least one ad platform token before campaign draft generation.',
      });
    }

    const { data: packages } = await supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, nights, min_price, product_highlights')
      .eq('is_active', true)
      .eq('is_approved', true)
      .order('created_at', { ascending: false })
      .limit(5); // 한 번에 최대 5개 상품 처리

    if (!packages?.length) return this.skipWithContract('No active approved packages', {
      input_summary: 'Latest active approved packages for campaign draft generation.',
    });

    const results: { packages_processed: number; items: unknown[] } = { packages_processed: 0, items: [] };

    for (const pkg of packages as PackageRow[]) {
      const item: Record<string, unknown> = { package_id: pkg.id, title: pkg.title };

      // ── Meta 광고 카피 생성 + DRAFT 저장 ─────────────────────────────────
      if (metaToken) {
        try {
          const metaAds = await generateAdCopy(pkg, 'meta');
          const { data: campaign, error: campErr } = await supabaseAdmin.from('ad_campaigns').insert({
            package_id: pkg.id,
            channel: 'meta',
            status: 'DRAFT',
            name: `[Auto] ${pkg.title} - ${ctx.runDate}`,
          }).select('id').maybeSingle();
          if (campErr) throw campErr;
          if (campaign?.id) {
            await supabaseAdmin.from('ad_creatives').insert({
              product_id: pkg.id,
              campaign_id: campaign.id,
              channel: 'meta',
              creative_type: 'single_image',
              status: 'draft',
              ad_copies: metaAds,
            }).throwOnError();
          }
          item.meta = { ok: true, campaign_id: campaign?.id };
        } catch (err) {
          item.meta = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      } else {
        item.meta = { ok: true, skipped: true, reason: 'Meta 토큰 미연동' };
      }

      // ── Google Ads RSA DRAFT 저장 ─────────────────────────────────────────
      if (googleToken) {
        try {
          const googleAds = await generateAdCopy(pkg, 'google');
          await supabaseAdmin.from('ad_creatives').insert({
            product_id: pkg.id,
            channel: 'google',
            creative_type: 'text_ad',
            status: 'draft',
            ad_copies: googleAds,
          }).throwOnError();
          item.google = { ok: true, saved: true };
        } catch (err) {
          item.google = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      } else {
        item.google = { ok: true, skipped: true, reason: 'Google OAuth 미연동' };
      }

      results.items.push(item);
      results.packages_processed += 1;
    }

    return this.withContract({
      ok: true,
      data: results,
    }, {
      input_summary: `${results.packages_processed} packages processed for Meta/Google campaign draft planning.`,
      evidence: [`${results.items.length} package draft result rows`, `Meta connected: ${Boolean(metaToken)}`, `Google connected: ${Boolean(googleToken)}`],
      decision: results.packages_processed > 0 ? 'campaign_drafts_prepared' : 'no_campaign_drafts',
      next_action: 'Review draft campaign copy and approve only budget-safe candidates.',
      needs_human_approval: results.packages_processed > 0,
    });
  }
}

async function generateAdCopy(
  pkg: PackageRow,
  platform: 'meta' | 'google',
): Promise<{ primary_texts: string[]; headlines: string[]; cta_button: string }> {
  const dest = pkg.destination ?? '여행지';
  const priceText = pkg.min_price
    ? `${Math.floor(pkg.min_price / 10000)}만원~`
    : '특가';
  const duration = pkg.nights ? `${pkg.nights}박${pkg.nights + 1}일` : '';
  const highlights = pkg.product_highlights?.slice(0, 3).join(' · ') ?? '노팁 · 항공 포함';

  const systemPrompt = platform === 'meta'
    ? 'Facebook/Instagram 광고 카피라이터. 여행 상품 광고 문구를 JSON으로 생성.'
    : 'Google Ads RSA 카피라이터. 검색 광고 문구를 JSON으로 생성.';

  const userPrompt = `상품: ${pkg.title}
목적지: ${dest}, 기간: ${duration}, 가격: ${priceText}
하이라이트: ${highlights}

JSON 반환:
{
  "primary_texts": ["문구1 (125자 이하)", "문구2", "문구3"],
  "headlines": ["헤드라인1 (40자 이하)", "헤드라인2", "헤드라인3"],
  "cta_button": "BOOK_TRAVEL"
}`;

  const result = await llmCall<{ primary_texts: string[]; headlines: string[]; cta_button: string }>({
    task: 'card-news',
    systemPrompt,
    userPrompt,
    maxTokens: 600,
    temperature: 0.8,
    enableCaching: false,
    autoEscalate: false,
    jsonSchema: {
      type: 'object',
      properties: {
        primary_texts: { type: 'array', items: { type: 'string' } },
        headlines: { type: 'array', items: { type: 'string' } },
        cta_button: { type: 'string' },
      },
      required: ['primary_texts', 'headlines', 'cta_button'],
    },
  });

  if (result.success && result.data) return result.data;

  // fallback
  return {
    primary_texts: [`${dest} ${duration} ${priceText}`, `${highlights}`, `여소남 엄선 패키지`],
    headlines: [`${dest} 여행 ${priceText}`, `${duration} 패키지`, `지금 예약`],
    cta_button: 'BOOK_TRAVEL',
  };
}
