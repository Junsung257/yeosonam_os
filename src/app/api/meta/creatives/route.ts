import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getAdCreatives, saveCreatives } from '@/lib/supabase';
import { generateAdVariants } from '@/lib/ai';
import type { AiModel, CreativePlatform } from '@/types/meta-ads';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const { searchParams } = request.nextUrl;
  const packageId = searchParams.get('package_id') ?? undefined;
  const campaignId = searchParams.get('campaign_id') ?? undefined;
  const platform = searchParams.get('platform') ?? undefined;

  try {
    const creatives = await getAdCreatives({ packageId, campaignId, platform });

    // 플랫폼별로 그룹화
    const grouped = {
      thread: creatives.filter(c => c.platform === 'thread'),
      instagram: creatives.filter(c => c.platform === 'instagram'),
      blog: creatives.filter(c => c.platform === 'blog'),
    };

    return NextResponse.json({ creatives, grouped });
  } catch (error) {
    return NextResponse.json({ error: '소재 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const { package_id, ai_model = 'openai' } = await request.json();

    if (!package_id) {
      return NextResponse.json({ error: 'package_id 필수' }, { status: 400 });
    }

    // 상품 정보 조회
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: pkg } = await sb
      .from('travel_packages')
      .select('destination, price, duration, product_highlights, inclusions, product_summary')
      .eq('id', package_id)
      .single();

    if (!pkg) {
      return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });
    }

    const platforms: CreativePlatform[] = ['thread', 'instagram', 'blog'];
    const allCreatives: Omit<import('@/types/meta-ads').AdCreative, 'id' | 'created_at'>[] = [];
    const errors: string[] = [];

    // 3개 플랫폼 × 10개 변형 = 30개 병렬 생성
    await Promise.allSettled(
      platforms.map(async (platform) => {
        try {
          const variants = await generateAdVariants(
            {
              destination: pkg.destination,
              price: pkg.price,
              duration: pkg.duration,
              product_highlights: pkg.product_highlights,
              inclusions: pkg.inclusions,
              product_summary: pkg.product_summary,
            },
            platform,
            ai_model as AiModel
          );

          variants.forEach((variant, idx) => {
            allCreatives.push({
              package_id,
              campaign_id: null,
              platform,
              variant_index: idx + 1,
              headline: variant.headline ?? null,
              body_copy: variant.body_copy,
              image_path: null,
              meta_creative_id: null,
              is_deployed: false,
              performance_score: null,
              ai_model: ai_model as AiModel,
            });
          });
        } catch (err) {
          errors.push(`${platform}: ${err instanceof Error ? err.message : '실패'}`);
        }
      })
    );

    if (allCreatives.length === 0) {
      return NextResponse.json(
        { error: '소재 생성 실패', details: errors },
        { status: 500 }
      );
    }

    const saved = await saveCreatives(allCreatives);

    return NextResponse.json(
      {
        creatives: saved,
        total: saved.length,
        errors: errors.length > 0 ? errors : undefined,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('소재 생성 실패:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '소재 생성 실패' },
      { status: 500 }
    );
  }
}
