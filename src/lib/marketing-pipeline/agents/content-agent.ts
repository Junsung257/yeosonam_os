/**
 * ContentAgent — 활성 패키지 → 인스타그램 캡션 생성 → content_distributions 저장
 *
 * ContentBrief 전체 구조 생성 없이 llmCall로 직접 캡션 생성 (파이프라인 단순화).
 * 재사용: src/lib/llm-gateway.ts (llmCall)
 */
import { z } from 'zod';
import { BaseMarketingAgent, type MarketingContext, type AgentResult } from '../base-agent';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { llmCall } from '@/lib/llm-gateway';
import { getSecret } from '@/lib/secret-registry';

const CaptionSchema = z.object({
  caption: z.string().min(50).max(2200),
  preview_hook: z.string().min(10).max(125),
  hashtags: z.array(z.string()).min(5).max(30),
  cta_type: z.enum(['dm_keyword', 'save', 'share', 'link_click', 'comment_question']),
});

interface PackageRow {
  id: string;
  title: string;
  destination: string | null;
  nights: number | null;
  duration: number | null;
  min_price: number | null;
  product_summary: string | null;
  product_highlights: string[] | null;
}

export class ContentAgent extends BaseMarketingAgent {
  readonly name = 'content';

  async run(ctx: MarketingContext): Promise<Omit<AgentResult, 'elapsed_ms'>> {
    if (!isSupabaseConfigured) return this.skip('Supabase 미설정');
    if (!getSecret('DEEPSEEK_API_KEY') && !getSecret('GEMINI_API_KEY') && !getSecret('GOOGLE_AI_API_KEY')) {
      return this.skip('LLM API 키 미설정');
    }

    const { data: packages, error } = await supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, nights, duration, min_price, product_summary, product_highlights')
      .eq('is_active', true)
      .eq('is_approved', true)
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) throw error;
    if (!packages?.length) return this.skip('활성 패키지 없음');

    let generated = 0;

    for (const pkg of packages as PackageRow[]) {
      const systemPrompt = `당신은 여행 마케터입니다. 인스타그램 캡션을 JSON으로 생성하세요.`;
      const userPrompt = buildCaptionPrompt(pkg);

      const result = await llmCall<z.infer<typeof CaptionSchema>>({
        task: 'card-news',
        systemPrompt,
        userPrompt,
        maxTokens: 800,
        temperature: 0.85,
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

      const caption = result.success && result.data ? result.data : buildFallbackCaption(pkg);

      const { error: insErr } = await supabaseAdmin.from('content_distributions').insert({
        product_id: pkg.id,
        platform: 'instagram_caption',
        status: 'draft',
        payload: {
          ...caption,
          generated_at: new Date().toISOString(),
          pipeline_run_date: ctx.runDate,
        },
      });
      if (insErr) throw insErr;

      generated++;
    }

    return { ok: true, data: { generated, packages: packages.length } };
  }
}

function buildCaptionPrompt(pkg: PackageRow): string {
  const dest = pkg.destination ?? '여행지';
  const priceText = pkg.min_price ? formatPrice(pkg.min_price) : '특가';
  const duration = pkg.nights ? `${pkg.nights}박${(pkg.nights + 1)}일` : '';
  const highlights = pkg.product_highlights?.slice(0, 3).join(', ') ?? '';

  return `다음 여행 상품으로 인스타그램 캡션을 작성하세요.

상품명: ${pkg.title}
목적지: ${dest}
기간: ${duration}
가격: ${priceText}
하이라이트: ${highlights}
설명: ${pkg.product_summary ?? ''}

JSON 형식으로 반환:
{
  "caption": "전체 캡션 (500~1500자, 이모지 포함)",
  "preview_hook": "첫 125자 프리뷰 (125자 이하)",
  "hashtags": ["#여행", "#${dest}", "#여소남"],
  "cta_type": "dm_keyword"
}`;
}

function buildFallbackCaption(pkg: PackageRow) {
  const dest = pkg.destination ?? '여행지';
  const priceText = pkg.min_price ? formatPrice(pkg.min_price) : '특가';
  return {
    caption: `${priceText} ${dest} 여행, 여소남이 엄선한 패키지입니다.\n\n✅ ${pkg.product_highlights?.[0] ?? '노팁·노옵션'}\n✅ ${pkg.product_highlights?.[1] ?? '왕복 항공 포함'}\n\n댓글에 "${dest.slice(0, 2)}" 남겨주세요!`,
    preview_hook: `${priceText} ${dest} 여행 — 여소남 엄선 패키지`.slice(0, 125),
    hashtags: ['#여행', '#해외여행', `#${dest}`, '#여소남', '#패키지여행'],
    cta_type: 'dm_keyword' as const,
  };
}

function formatPrice(price: number): string {
  if (price >= 10000) {
    const man = Math.floor(price / 10000);
    return `${man}만원~`;
  }
  return `${price.toLocaleString()}원~`;
}
