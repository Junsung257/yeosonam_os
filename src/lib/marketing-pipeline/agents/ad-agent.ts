import { BaseMarketingAgent, type MarketingContext, type AgentResult } from '../base-agent';
import { resolveOAuthToken } from '../token-resolver';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { llmCall } from '@/lib/llm-gateway';
import { getSecret } from '@/lib/secret-registry';
import { loadCustomerOpenContractForPackage } from '@/lib/product-registration/customer-open-contract';
import {
  loadPublicContentPackageForGeneration,
  type PublicContentPackage,
} from '@/lib/content-public-package';

type PackageCandidateRow = { id: string };
type MarketingAdPackage = PublicContentPackage & {
  destination: string;
  price: number;
};

export class AdAgent extends BaseMarketingAgent {
  readonly name = 'ad';

  async run(ctx: MarketingContext): Promise<Omit<AgentResult, 'elapsed_ms'>> {
    if (!isSupabaseConfigured) return this.skip('Supabase is not configured');
    if (!getSecret('DEEPSEEK_API_KEY') && !getSecret('GEMINI_API_KEY') && !getSecret('GOOGLE_AI_API_KEY')) {
      return this.skip('LLM API key is not configured');
    }

    const [metaToken, googleToken] = await Promise.all([
      resolveOAuthToken(ctx.tenantId, 'meta'),
      resolveOAuthToken(ctx.tenantId, 'google_ads'),
    ]);

    if (!metaToken && !googleToken) {
      return this.skip('Meta/Google OAuth tokens are not configured');
    }

    const { data: packageCandidates, error } = await supabaseAdmin
      .from('travel_packages')
      .select('id')
      .eq('is_active', true)
      .eq('is_approved', true)
      .eq('publication_state', 'published')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) throw error;
    if (!packageCandidates?.length) return this.skip('No public package candidates');

    const results: { packages_processed: number; blocked_by_customer_open_contract: number; items: unknown[] } = {
      packages_processed: 0,
      blocked_by_customer_open_contract: 0,
      items: [],
    };

    for (const candidate of packageCandidates as PackageCandidateRow[]) {
      const publicPackage = await loadPublicContentPackageForGeneration(candidate.id);
      if (!publicPackage || !isMarketingAdPackage(publicPackage)) {
        results.blocked_by_customer_open_contract += 1;
        results.items.push({ package_id: candidate.id, skipped: true, reason: 'public_snapshot_missing_or_incomplete' });
        continue;
      }

      const item: Record<string, unknown> = { package_id: publicPackage.id, title: publicPackage.title };
      const openContract = await loadCustomerOpenContractForPackage(supabaseAdmin, publicPackage.id);
      if (!openContract.ok) {
        item.skipped = true;
        item.reason = 'customer_open_contract_blocked';
        item.blockers = openContract.blockers.slice(0, 5);
        results.blocked_by_customer_open_contract += 1;
        results.items.push(item);
        continue;
      }

      if (metaToken) {
        try {
          const metaAds = await generateAdCopy(publicPackage, 'meta');
          const { data: campaign, error: campaignError } = await supabaseAdmin.from('ad_campaigns').insert({
            package_id: publicPackage.id,
            channel: 'meta',
            status: 'DRAFT',
            name: `[Auto] ${publicPackage.title} - ${ctx.runDate}`,
          }).select('id').maybeSingle();
          if (campaignError) throw campaignError;
          if (campaign?.id) {
            await supabaseAdmin.from('ad_creatives').insert({
              product_id: publicPackage.id,
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
        item.meta = { ok: true, skipped: true, reason: 'Meta OAuth token is not configured' };
      }

      if (googleToken) {
        try {
          const googleAds = await generateAdCopy(publicPackage, 'google');
          await supabaseAdmin.from('ad_creatives').insert({
            product_id: publicPackage.id,
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
        item.google = { ok: true, skipped: true, reason: 'Google OAuth token is not configured' };
      }

      results.items.push(item);
      results.packages_processed += 1;
    }

    return { ok: true, data: results };
  }
}

function isMarketingAdPackage(pkg: PublicContentPackage): pkg is MarketingAdPackage {
  return Boolean(pkg.destination && typeof pkg.price === 'number' && Number.isFinite(pkg.price));
}

async function generateAdCopy(
  pkg: MarketingAdPackage,
  platform: 'meta' | 'google',
): Promise<{ primary_texts: string[]; headlines: string[]; cta_button: string }> {
  const duration = formatDuration(pkg);
  const highlights = pkg.product_highlights?.slice(0, 3).join(' · ') || '승인된 공개 상품 조건';
  const priceText = formatPrice(pkg.price);

  const systemPrompt = platform === 'meta'
    ? 'Facebook/Instagram 광고 카피라이터다. 승인된 공개 스냅샷에 있는 사실만 사용하고 확정, 확보, 보장 표현은 쓰지 않는다.'
    : 'Google Ads RSA 카피라이터다. 승인된 공개 스냅샷에 있는 사실만 사용하고 확정, 확보, 보장 표현은 쓰지 않는다.';

  const userPrompt = `승인된 공개 상품 정보:
상품명: ${pkg.title}
목적지: ${pkg.destination}
기간: ${duration}
가격: ${priceText}
핵심 조건: ${highlights}

작성 규칙:
- 고객이 즉시 이해하는 짧은 한국어
- 출발확정, 즉시확정, 좌석확보, 최저가보장, 숙박확정 표현 금지
- 없는 포함 사항, 호텔 등급, 테마를 추정하지 않기
- 상담 후 가능 여부를 확인한다는 뉘앙스 유지

JSON 반환:
{
  "primary_texts": ["문구1", "문구2", "문구3"],
  "headlines": ["헤드라인1", "헤드라인2", "헤드라인3"],
  "cta_button": "LEARN_MORE"
}`;

  const result = await llmCall<{ primary_texts: string[]; headlines: string[]; cta_button: string }>({
    task: 'card-news',
    systemPrompt,
    userPrompt,
    maxTokens: 600,
    temperature: 0.7,
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

  return {
    primary_texts: [
      `${pkg.destination} ${duration} 여행, ${priceText}부터 상담 가능합니다.`,
      `${highlights}`,
      '예약 가능 여부와 세부 조건은 상담 후 확인됩니다.',
    ],
    headlines: [
      `${pkg.destination} 여행 상담`,
      `${duration} 패키지`,
      `${priceText}부터 확인`,
    ],
    cta_button: 'LEARN_MORE',
  };
}

function formatDuration(pkg: Pick<PublicContentPackage, 'duration' | 'nights'>): string {
  if (typeof pkg.duration === 'number' && Number.isFinite(pkg.duration)) {
    const nights = typeof pkg.nights === 'number' && Number.isFinite(pkg.nights)
      ? pkg.nights
      : Math.max(pkg.duration - 1, 0);
    return `${nights}박${pkg.duration}일`;
  }
  if (typeof pkg.nights === 'number' && Number.isFinite(pkg.nights)) {
    return `${pkg.nights}박${pkg.nights + 1}일`;
  }
  return '';
}

function formatPrice(price: number): string {
  if (price >= 10000) return `${Math.floor(price / 10000)}만원~`;
  return `${price.toLocaleString()}원~`;
}
