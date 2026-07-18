import { z } from 'zod';
import { BaseMarketingAgent, type MarketingContext, type AgentResult } from '../base-agent';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { llmCall } from '@/lib/llm-gateway';
import { getSecret } from '@/lib/secret-registry';
import { loadCustomerOpenContractForPackage } from '@/lib/product-registration/customer-open-contract';
import {
  loadPublicContentPackageForGeneration,
  type PublicContentPackage,
} from '@/lib/content-public-package';

const CaptionSchema = z.object({
  caption: z.string().min(50).max(2200),
  preview_hook: z.string().min(10).max(125),
  hashtags: z.array(z.string()).min(5).max(30),
  cta_type: z.enum(['dm_keyword', 'save', 'share', 'link_click', 'comment_question']),
});

type PackageCandidateRow = { id: string };
type MarketingContentPackage = PublicContentPackage & {
  destination: string;
  price: number;
};

export class ContentAgent extends BaseMarketingAgent {
  readonly name = 'content';

  async run(ctx: MarketingContext): Promise<Omit<AgentResult, 'elapsed_ms'>> {
    if (!isSupabaseConfigured) return this.skip('Supabase is not configured');
    if (!getSecret('DEEPSEEK_API_KEY') && !getSecret('GEMINI_API_KEY') && !getSecret('GOOGLE_AI_API_KEY')) {
      return this.skip('LLM API key is not configured');
    }

    const { data: packageCandidates, error } = await supabaseAdmin
      .from('travel_packages')
      .select('id')
      .eq('is_active', true)
      .eq('is_approved', true)
      .in('publication_state', ['approved', 'published'])
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) throw error;
    if (!packageCandidates?.length) return this.skip('No public package candidates');

    let generated = 0;
    let blockedByCustomerOpenContract = 0;

    for (const candidate of packageCandidates as PackageCandidateRow[]) {
      const publicPackage = await loadPublicContentPackageForGeneration(candidate.id);
      if (!publicPackage || !isMarketingContentPackage(publicPackage)) {
        blockedByCustomerOpenContract++;
        continue;
      }

      const openContract = await loadCustomerOpenContractForPackage(supabaseAdmin, publicPackage.id);
      if (!openContract.ok) {
        blockedByCustomerOpenContract++;
        continue;
      }

      const result = await llmCall<z.infer<typeof CaptionSchema>>({
        task: 'card-news',
        systemPrompt:
          '너는 여소남 여행 콘텐츠 에디터다. 승인된 공개 스냅샷에 있는 사실만 사용해 인스타그램 캡션을 JSON으로 작성한다. 확정, 보장, 확보처럼 재고를 약속하는 표현은 쓰지 않는다.',
        userPrompt: buildCaptionPrompt(publicPackage),
        maxTokens: 800,
        temperature: 0.75,
        enableCaching: false,
        autoEscalate: false,
        jsonSchema: {
          type: 'object',
          properties: {
            caption: { type: 'string' },
            preview_hook: { type: 'string' },
            hashtags: { type: 'array', items: { type: 'string' } },
            cta_type: { type: 'string', enum: ['dm_keyword', 'save', 'share', 'link_click', 'comment_question'] },
          },
          required: ['caption', 'preview_hook', 'hashtags', 'cta_type'],
        },
      });

      const caption = result.success && result.data ? result.data : buildFallbackCaption(publicPackage);

      const { error: insertError } = await supabaseAdmin.from('content_distributions').insert({
        product_id: publicPackage.id,
        platform: 'instagram_caption',
        status: 'draft',
        payload: {
          ...caption,
          generated_at: new Date().toISOString(),
          pipeline_run_date: ctx.runDate,
        },
      });
      if (insertError) throw insertError;

      generated++;
    }

    if (generated === 0 && blockedByCustomerOpenContract > 0) {
      return this.skip('customer_open_contract blocked every candidate package');
    }

    return {
      ok: true,
      data: {
        generated,
        packages: packageCandidates.length,
        blocked_by_customer_open_contract: blockedByCustomerOpenContract,
      },
    };
  }
}

function isMarketingContentPackage(pkg: PublicContentPackage): pkg is MarketingContentPackage {
  return Boolean(pkg.destination && typeof pkg.price === 'number' && Number.isFinite(pkg.price));
}

function buildCaptionPrompt(pkg: MarketingContentPackage): string {
  const duration = formatDuration(pkg);
  const highlights = pkg.product_highlights?.slice(0, 3).join(', ') || '승인된 공개 상품 조건';
  const summary = pkg.product_summary || '승인된 공개 스냅샷 기준으로 소개';

  return `아래 승인된 공개 상품 정보만 사용해 인스타그램 캡션을 작성하세요.

상품명: ${pkg.title}
목적지: ${pkg.destination}
기간: ${duration}
가격: ${formatPrice(pkg.price)}
핵심 조건: ${highlights}
설명: ${summary}

작성 규칙:
- 고객이 바로 이해하는 쉬운 한국어로 작성
- 출발확정, 즉시확정, 좌석확보, 최저가보장, 숙박확정 표현 금지
- 없는 포함 사항이나 상품 조건을 추정하지 않기
- 상담 전 확인이 필요한 조건은 "예약 가능 여부는 상담 후 확인"처럼 표현

JSON 형식으로 반환:
{
  "caption": "전체 캡션",
  "preview_hook": "첫 줄 미리보기",
  "hashtags": ["#여행", "#${pkg.destination}", "#여소남"],
  "cta_type": "dm_keyword"
}`;
}

function buildFallbackCaption(pkg: MarketingContentPackage) {
  const duration = formatDuration(pkg);
  const facts = [
    pkg.product_highlights?.[0],
    pkg.product_highlights?.[1],
    duration,
  ].filter(Boolean);

  return {
    caption: `${pkg.destination} ${duration} 여행을 ${formatPrice(pkg.price)}부터 상담할 수 있어요.\n\n${facts.map((fact) => `- ${fact}`).join('\n')}\n\n예약 가능 여부와 세부 조건은 상담 후 확인됩니다.`,
    preview_hook: `${pkg.destination} ${duration} 여행, 조건 먼저 확인해보세요`.slice(0, 125),
    hashtags: ['#여행', '#해외여행', `#${pkg.destination}`, '#여소남', '#패키지여행'],
    cta_type: 'dm_keyword' as const,
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
  if (price >= 10000) {
    const man = Math.floor(price / 10000);
    return `${man}만원~`;
  }
  return `${price.toLocaleString()}원~`;
}
