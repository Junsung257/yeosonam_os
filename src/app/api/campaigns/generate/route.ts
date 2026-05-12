/**
 * POST /api/campaigns/generate
 * 상품 1개 → 전체 광고 소재 자동 생성 (캐러셀 + 단일이미지 + 텍스트광고)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseProduct } from '@/lib/creative-engine/parse-product';
import { generateCarouselVariants } from '@/lib/creative-engine/carousel-generator';
import { generateSingleImageVariants } from '@/lib/creative-engine/single-image-generator';
import { generateTextAdVariants } from '@/lib/creative-engine/text-ad-generator';

const PostBodySchema = z.object({
  productId: z.string().uuid('productId는 UUID 형식이어야 합니다.'),
  channels: z.array(z.enum(['meta', 'naver', 'google'])).default(['meta']),
  carouselCount: z.number().int().min(1).max(10).default(3),
  singleImageCount: z.number().int().min(1).max(10).default(3),
  textAdChannels: z.array(z.enum(['naver', 'google'])).default([]),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = PostBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map(i => `[${i.path.join('.')}] ${i.message}`).join(' / ') },
        { status: 400 },
      );
    }
    const { productId, channels, carouselCount, singleImageCount, textAdChannels } = parsed.data;

    // Step 1: 상품 파싱
    const parsedData = await parseProduct(productId);

    // Step 2: 소재 생성 (채널별 병렬)
    const jobs: Promise<any[]>[] = [];

    if (channels.includes('meta')) {
      jobs.push(generateCarouselVariants(parsedData, carouselCount));
      jobs.push(generateSingleImageVariants(parsedData, singleImageCount));
    }

    const actualTextChannels: ('naver' | 'google')[] = textAdChannels.length > 0
      ? textAdChannels
      : channels.filter((c): c is 'naver' | 'google' => c === 'naver' || c === 'google');

    if (actualTextChannels.length > 0) {
      jobs.push(generateTextAdVariants(parsedData, actualTextChannels));
    }

    const allCreatives = (await Promise.all(jobs)).flat();

    // Step 3: DB 저장 (모두 draft 상태) — 병렬 INSERT
    const { supabaseAdmin } = await import('@/lib/supabase');

    const insertResults = await Promise.allSettled(
      allCreatives.map(creative =>
        supabaseAdmin
          .from('ad_creatives')
          .insert({
            product_id: productId,
            creative_type: creative.creative_type,
            channel: creative.channel,
            variant_index: creative.variant_index,
            hook_type: creative.hook_type,
            tone: creative.tone,
            key_selling_point: creative.key_selling_point,
            target_segment: creative.target_segment,
            slides: creative.slides ?? null,
            headline: creative.headline ?? null,
            primary_text: creative.primary_text ?? null,
            description: creative.description ?? null,
            body: creative.body ?? null,
            image_url: creative.image_url ?? null,
            keywords: creative.keywords ?? null,
            ad_copies: creative.ad_copies ?? null,
            status: 'draft',
          })
          .select('id')
          .single()
      )
    );

    const savedIds: string[] = [];
    let failedCount = 0;
    for (const result of insertResults) {
      if (result.status === 'fulfilled') {
        const { data: inserted, error: insertErr } = result.value;
        if (insertErr) {
          console.error('[generate] INSERT 실패:', insertErr.message);
          failedCount++;
        } else if (inserted) {
          savedIds.push(inserted.id);
        }
      } else {
        console.error('[generate] INSERT 거절:', result.reason);
        failedCount++;
      }
    }

    return NextResponse.json({
      success: failedCount === 0,
      product: {
        id: productId,
        destination: parsedData.destination,
        country: parsedData.country,
        price: parsedData.base_price,
      },
      summary: {
        total: allCreatives.length,
        saved: savedIds.length,
        failed: failedCount,
        carousel: allCreatives.filter(c => c.creative_type === 'carousel').length,
        single_image: allCreatives.filter(c => c.creative_type === 'single_image').length,
        text_ad: allCreatives.filter(c => c.creative_type === 'text_ad').length,
      },
      creative_ids: savedIds,
      next_step: '관리자 검토 후 /api/campaigns/launch 호출',
    }, { status: 201 });
  } catch (error) {
    console.error('[generate] 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '소재 생성 실패' },
      { status: 500 }
    );
  }
}
