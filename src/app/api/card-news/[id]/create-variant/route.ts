/**
 * POST /api/card-news/[id]/create-variant
 *
 * 같은 brief(slides V2)를 다른 template_family로 렌더한 A/B variant 생성.
 * 새 card_news 레코드를 만들고 card_news_variants 테이블에 매핑 기록.
 *
 * Body: { family: 'editorial'|'cinematic'|'premium'|'bold', label?: string }
 * Response: { variant_card_news_id, family }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { ContentBriefSchema, type TemplateFamily, type ContentBrief } from '@/lib/validators/content-brief';
import { briefToSlides } from '@/lib/card-news/v2/brief-to-slides';

export const runtime = 'nodejs';

const VALID_FAMILIES: TemplateFamily[] = ['editorial', 'cinematic', 'premium', 'bold'];

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const baseId = params.id;
  try {
    const body = (await request.json()) as { family?: TemplateFamily; label?: string };
    if (!body.family || !VALID_FAMILIES.includes(body.family)) {
      return NextResponse.json({ error: `family 필수 (${VALID_FAMILIES.join('/')})` }, { status: 400 });
    }

    // 1. base 카드뉴스 조회
    const { data: base, error: baseErr } = await supabaseAdmin
      .from('card_news')
      .select('*')
      .eq('id', baseId)
      .single();
    if (baseErr || !base) {
      return NextResponse.json({ error: 'base 카드뉴스 조회 실패' }, { status: 404 });
    }

    // 2. 기존 variant 이미 있으면 재사용 (UNIQUE 제약 회피)
    const { data: existing } = await supabaseAdmin
      .from('card_news_variants')
      .select('variant_card_news_id')
      .eq('base_card_news_id', baseId)
      .eq('template_family', body.family)
      .maybeSingle();
    if (existing?.variant_card_news_id) {
      return NextResponse.json({
        variant_card_news_id: existing.variant_card_news_id,
        family: body.family,
        reused: true,
      });
    }

    // 3. 가능하면 원본 brief 재활용 → briefToSlides 로 V2 슬롯 포함 새로 생성.
    //    brief 없거나 검증 실패 시 기존 slides 에 template_family만 덮어써 복사 (V1 품질).
    const baseSlides = Array.isArray(base.slides) ? (base.slides as Array<Record<string, unknown>>) : [];
    const briefRaw = (base.generation_config as { brief?: unknown } | null)?.brief;
    let newSlides: Array<Record<string, unknown>> = [];

    if (briefRaw) {
      const parsed = ContentBriefSchema.safeParse(briefRaw);
      if (parsed.success) {
        const briefSlides = briefToSlides(parsed.data as ContentBrief, { family: body.family });
        // 기존 slides 의 bg_image_url / pexels_keyword 를 같은 position 에서 승계 (Pexels 재호출 회피)
        newSlides = briefSlides.map((vs) => {
          const matching = baseSlides.find((b) => (b.position as number) === vs.position);
          return {
            ...vs,
            bg_image_url: (matching?.bg_image_url as string) ?? '',
            pexels_keyword: (matching?.pexels_keyword as string) ?? vs.pexels_keyword ?? '',
            overlay_style: (matching?.overlay_style as string) ?? 'dark',
            elements: (matching?.elements as unknown[]) ?? [],
          };
        });
      } else {
        console.warn('[create-variant] brief 검증 실패, legacy copy 폴백:', parsed.error.issues.slice(0, 2));
      }
    }

    if (newSlides.length === 0) {
      // Fallback: template_family 만 덮어쓴 얕은 복사
      newSlides = baseSlides.map((s) => ({
        ...s,
        template_family: body.family,
        template_version: base.template_version ?? 'v2',
      }));
    }

    // 4. variant 카드뉴스 INSERT
    const variantTitle = `${base.title} [${body.family}]`;
    const { data: variant, error: insertErr } = await supabaseAdmin
      .from('card_news')
      .insert({
        title: variantTitle,
        status: 'DRAFT',
        slides: newSlides,
        card_news_type: base.card_news_type,
        package_id: base.package_id,
        campaign_id: base.campaign_id,
        topic: base.topic,
        category_id: base.category_id,
        template_family: body.family,
        template_version: base.template_version ?? 'v2',
        brand_kit_id: base.brand_kit_id,
        generation_config: base.generation_config,  // 같은 brief 재사용
      })
      .select('id')
      .single();
    if (insertErr || !variant) {
      return NextResponse.json({ error: `variant INSERT 실패: ${insertErr?.message}` }, { status: 500 });
    }

    // 5. card_news_variants 매핑
    const { error: mapErr } = await supabaseAdmin
      .from('card_news_variants')
      .insert({
        base_card_news_id: baseId,
        variant_card_news_id: variant.id,
        template_family: body.family,
        variant_label: body.label ?? body.family.toUpperCase().slice(0, 1),
      });
    if (mapErr) {
      console.warn('[create-variant] 매핑 테이블 INSERT 경고:', mapErr.message);
    }

    return NextResponse.json({
      variant_card_news_id: variant.id,
      family: body.family,
      reused: false,
    }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[create-variant] 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
