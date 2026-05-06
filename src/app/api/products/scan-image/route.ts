/**
 * POST /api/products/scan-image
 *
 * 밴드 캡처 이미지 → Claude Haiku Vision OCR → AI 분석 → 상품 미리보기 반환
 * scan-text와 동일한 응답 구조 유지.
 *
 * Body: multipart/form-data
 *   image: File (jpeg|png|webp|gif, 최대 5MB)
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { analyzeFromText } from '@/lib/band-ai-analyzer';
import { getSecret } from '@/lib/secret-registry';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type AllowedType = typeof ALLOWED_TYPES[number];
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

export async function POST(request: NextRequest) {
  if (!getSecret('ANTHROPIC_API_KEY')) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY 미설정' }, { status: 503 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'multipart/form-data 형식 필요' }, { status: 400 });
  }

  const file = formData.get('image');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'image 필드가 필요합니다' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type as AllowedType)) {
    return NextResponse.json(
      { error: `지원 형식: ${ALLOWED_TYPES.join(', ')}` },
      { status: 415 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: '이미지 최대 5MB' }, { status: 413 });
  }

  const base64 = buffer.toString('base64');

  try {
    // 1. Claude Haiku Vision으로 텍스트 추출
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: '당신은 OCR 엔진입니다. 이미지에서 텍스트만 추출하세요. 설명이나 해석 없이 원문 그대로 출력하세요.',
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: file.type as AllowedType,
                data: base64,
              },
            },
            {
              type: 'text',
              text: '이 이미지에서 여행 상품 텍스트를 모두 추출하세요. OCR 결과만 출력하세요.',
            },
          ],
        },
      ],
    });

    const extracted =
      response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';

    if (!extracted) {
      return NextResponse.json({ error: '이미지에서 텍스트를 추출할 수 없습니다' }, { status: 422 });
    }

    // 2. 기존 analyzeFromText() 재사용
    const ai = await analyzeFromText(extracted);
    if (!ai) {
      return NextResponse.json(
        { error: '여행 상품 정보를 추출할 수 없습니다', extracted_text: extracted },
        { status: 422 },
      );
    }

    return NextResponse.json({
      preview: {
        display_name:           ai.display_name,
        destination:            ai.destination,
        destination_code:       ai.destination_code,
        departure_region:       ai.departure_region,
        departure_region_code:  ai.departure_region_code,
        duration_days:          ai.duration_days,
        departure_date:         ai.departure_date,
        net_price:              ai.net_price,
        ai_tags:                ai.ai_tags,
        source:                 'band_image_ocr',
      },
      extracted_text: extracted,
    });
  } catch (err) {
    console.error('[scan-image] 처리 실패:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'OCR 처리 실패' },
      { status: 500 },
    );
  }
}
