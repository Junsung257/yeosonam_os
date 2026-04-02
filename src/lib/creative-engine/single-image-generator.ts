/**
 * ══════════════════════════════════════════════════════════
 * Single Image Generator — Meta 단일이미지 광고 3종 변형
 * ══════════════════════════════════════════════════════════
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getWinningPatterns } from './get-patterns';
import type { ParsedProductData } from './parse-product';
import { searchPexelsPhotos, isPexelsConfigured } from '@/lib/pexels';

const TEMPLATES = ['price_hero', 'scene_mood', 'benefit_list'] as const;

export interface SingleImageCreative {
  creative_type: 'single_image';
  channel: 'meta';
  variant_index: number;
  hook_type: string;
  tone: string;
  key_selling_point: string;
  target_segment: string;
  primary_text: string;
  headline: string;
  description: string;
  image_url: string | null;
}

const TEMPLATE_PROMPTS: Record<string, (d: ParsedProductData) => string> = {
  price_hero: (d) => `[가격 중심형] 가격과 마감이 1장에 강하게 전달되어야 함.
primary_text(125자): 페인포인트로 시작 → 가격 → 마감 데드라인
headline(40자): 가격 + 마감 조합
description(30자): 포함 핵심 1줄
핵심 수치: ${d.base_price.toLocaleString()}원 / ${d.deadline || '선착순'} 마감 / 잔여 ${d.seats_left || '소수'}석`,

  scene_mood: (d) => {
    const top = [...d.highlights].sort((a, b) => b.visual_score - a.visual_score)[0];
    return `[감성 장면형] 가장 시각적인 하이라이트 1장면으로 클릭 욕구 자극.
primary_text(125자): 장면 묘사로 시작 → 감정 표현 연결
headline(40자): 장면 + 감성 동사
description(30자): 상품명 + 가격
핵심 장면: ${top?.hook || d.destination}`;
  },

  benefit_list: (d) => `[혜택 나열형] 한눈에 차별점이 보여야 함.
primary_text(125자): "이 가격에 다 포함:" → 혜택 나열
headline(40자): 노팁·노옵션·5성급 조합
description(30자): 가격
핵심 혜택: 노팁=${d.no_tip} / 노옵션=${d.no_option} / ${d.hotel_stars ?? '?'}성급 / 한식 ${d.meals.korean.length}회`,
};

const SYSTEM = `당신은 Meta 단일 이미지 광고 카피라이터입니다.
타겟: 40~60대 한국 중장년 (부산/경남권)
1장에 모든 핵심을 담아야 합니다. 클리셰 금지.

출력 JSON만:
{"primary_text":"...","headline":"...","description":"...","pexels_keyword":"...","cta":"지금 문의하기"}`;

export async function generateSingleImageVariants(
  parsedData: ParsedProductData,
  count = 3,
): Promise<SingleImageCreative[]> {
  const patterns = await getWinningPatterns({
    destinationType: parsedData.destination_type,
    channel: 'meta',
    creativeType: 'single_image',
  });

  return Promise.all(
    TEMPLATES.slice(0, count).map(async (template, i) => {
      const patternExample = patterns[i];
      const copy = await generateOneCopy(parsedData, template, patternExample);
      const imageUrl = await getImage(copy.pexels_keyword, parsedData.destination);

      return {
        creative_type: 'single_image' as const,
        channel: 'meta' as const,
        variant_index: i,
        hook_type: template,
        tone: { price_hero: 'urgent', scene_mood: 'emotional', benefit_list: 'trust' }[template] ?? 'trust',
        key_selling_point: { price_hero: 'price_value', scene_mood: 'highlight_scene', benefit_list: 'notip' }[template] ?? 'notip',
        target_segment: 'middle_age',
        primary_text: copy.primary_text,
        headline: copy.headline,
        description: copy.description,
        image_url: imageUrl,
      };
    })
  );
}

async function generateOneCopy(
  data: ParsedProductData,
  template: string,
  patternExample?: any,
): Promise<{ primary_text: string; headline: string; description: string; pexels_keyword: string }> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return {
      primary_text: `${data.destination} ${data.nights}박${data.days}일 ${data.base_price.toLocaleString()}원`,
      headline: `${data.destination} 노팁 패키지`,
      description: `${data.base_price.toLocaleString()}원~ 여소남`,
      pexels_keyword: `${data.destination} beach resort`,
    };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0.8 } });

  const templatePrompt = TEMPLATE_PROMPTS[template]?.(data) ?? '';
  const patternGuide = patternExample?.best_headline
    ? `\n참고 (CTR ${patternExample.avg_ctr}% 기록):\nheadline: ${patternExample.best_headline}\nbody: ${patternExample.best_body}`
    : '';

  const prompt = `${SYSTEM}\n\n상품:\n${JSON.stringify(data)}\n\n${templatePrompt}${patternGuide}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(text);
  } catch {
    return {
      primary_text: `${data.destination} ${data.base_price.toLocaleString()}원~`,
      headline: data.no_tip ? '노팁·노옵션 품격 패키지' : `${data.destination} 패키지`,
      description: `${data.base_price.toLocaleString()}원~ 여소남`,
      pexels_keyword: `${data.destination} travel landscape`,
    };
  }
}

async function getImage(keyword: string, destination: string): Promise<string | null> {
  if (!isPexelsConfigured()) return null;
  try {
    const photos = await searchPexelsPhotos(keyword, 3);
    if (photos[0]?.src?.large2x) return photos[0].src.large2x;
    const photos2 = await searchPexelsPhotos(`${destination} travel`, 3);
    return photos2[0]?.src?.large2x ?? null;
  } catch { return null; }
}
