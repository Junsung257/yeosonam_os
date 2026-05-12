/**
 * @file src/app/api/card-news/generate-html/route.ts
 *
 * 카드뉴스 HTML 모드 생성 라우트.
 * Claude Sonnet 4.6 + Extended Thinking + Prompt Caching 으로 6장 carousel HTML 생성.
 * 기존 V2 (Satori) 파이프라인과 병행 — mode 구분은 template_version='html-v1'.
 *
 * Body:
 *   {
 *     rawText: string                       // 필수, 원문 텍스트
 *     productMeta?: { title, destination, nights, duration, price, highlights, departureDates }
 *     angleHint?: 'luxury' | 'value' | 'urgency' | 'emotional' | 'filial' | 'activity' | 'food'
 *     toneHint?: string
 *     title?: string                        // card_news.title (기본: productMeta.title 또는 '제목 없음')
 *     package_id?: string                   // 연결할 상품 UUID (선택)
 *     card_news_id?: string                 // 기존 레코드 업데이트 시 (선택)
 *   }
 *
 * Response:
 *   201 { card_news_id, html, thinking, usage, costUsd, model, durationMs }
 *   500 { error }
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateCardNewsHtml, type GenerateInput } from '@/lib/card-news-html/generate';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300; // Sonnet 4.6 + 21K output 시 약 200초

interface RequestBody extends GenerateInput {
  title?: string;
  package_id?: string | null;
  card_news_id?: string | null;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const body = (await request.json()) as RequestBody;

    if (!body.rawText || typeof body.rawText !== 'string' || !body.rawText.trim()) {
      return NextResponse.json({ error: 'rawText 가 필요합니다' }, { status: 400 });
    }

    const result = await generateCardNewsHtml({
      rawText: body.rawText,
      productMeta: body.productMeta,
      angleHint: body.angleHint,
      toneHint: body.toneHint,
      brandCode: (body as RequestBody & { brandCode?: string }).brandCode ?? 'yeosonam',
    });

    const title =
      body.title?.trim() ||
      body.productMeta?.title?.trim() ||
      `HTML 카드뉴스 (${new Date().toISOString().slice(0, 10)})`;

    let cardNewsId = body.card_news_id ?? null;

    if (cardNewsId) {
      const { error } = await supabaseAdmin
        .from('card_news')
        .update({
          title,
          html_raw: body.rawText,
          html_generated: result.html,
          html_thinking: result.thinking,
          html_usage: {
            ...result.usage,
            costUsd: result.costUsd,
            model: result.model,
            durationMs: result.durationMs,
            generatedAt: new Date().toISOString(),
          },
          template_version: 'html-v1',
          template_family: 'html',
          updated_at: new Date().toISOString(),
        })
        .eq('id', cardNewsId);

      if (error) throw new Error(`card_news UPDATE 실패: ${error.message}`);
    } else {
      const { data, error } = await supabaseAdmin
        .from('card_news')
        .insert({
          title,
          status: 'DRAFT',
          slides: [],
          package_id: body.package_id ?? null,
          card_news_type: body.package_id ? 'product' : 'info',
          html_raw: body.rawText,
          html_generated: result.html,
          html_thinking: result.thinking,
          html_usage: {
            ...result.usage,
            costUsd: result.costUsd,
            model: result.model,
            durationMs: result.durationMs,
            generatedAt: new Date().toISOString(),
          },
          template_version: 'html-v1',
          template_family: 'html',
          generation_config: {
            html_mode: {
              angleHint: body.angleHint ?? null,
              toneHint: body.toneHint ?? null,
              productMeta: body.productMeta ?? null,
            },
          },
        })
        .select('id')
        .single();

      if (error) throw new Error(`card_news INSERT 실패: ${error.message}`);
      cardNewsId = data.id;
    }

    return NextResponse.json(
      {
        card_news_id: cardNewsId,
        html: result.html,
        thinking: result.thinking,
        usage: result.usage,
        costUsd: result.costUsd,
        model: result.model,
        durationMs: result.durationMs,
        faithfulness: result.faithfulness,
      },
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'HTML 생성 실패';
    console.error('[generate-html]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
