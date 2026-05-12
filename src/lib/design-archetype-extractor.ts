/**
 * Design Archetype Extractor — Gemini Vision으로 cover image → archetype 라벨링 (PR-3)
 *
 * 자체 호스팅 CLIP을 회피하기 위해 Gemini 2.5 Flash Vision으로 직접 분류.
 * 비용: 이미지당 ~$0.001 (768×768 기준).
 *
 * 출력 archetype:
 *   - palette_category: nature | architecture | food | street | data_story | premium | urgency | default
 *   - layout_type: text_overlay | photo_dominant | grid | infographic | quote_card
 *   - dominant_emotion: awe | curiosity | amusement | fear | anger | relief | trust
 *   - hook_pattern: 한 줄 요약 (예: "숫자 + 의외성", "현지 시점 contrarian")
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getProviderApiKey } from '@/lib/ai-provider-policy';
import type { PaletteCategory } from '@/lib/card-news/tokens';

export interface DesignArchetype {
  palette_category: PaletteCategory;
  layout_type: 'text_overlay' | 'photo_dominant' | 'grid' | 'infographic' | 'quote_card';
  dominant_emotion: 'awe' | 'curiosity' | 'amusement' | 'fear' | 'anger' | 'relief' | 'trust' | 'unknown';
  hook_pattern: string;
  text_density: 'low' | 'medium' | 'high';
  has_face: boolean;
  has_numbers: boolean;
  reasoning: string;
}

const PROMPT = `다음 인스타그램 카드뉴스 cover 이미지를 분석해 JSON으로 라벨링해주세요.

규칙:
1. palette_category: nature | architecture | food | street | data_story | premium | urgency | default
   - nature/architecture: 풍경·건물·자연 (blue 우세 추정)
   - food/street: 음식·시장·거리 (warm 톤 추정)
   - data_story: 숫자·차트·통계 카드
   - premium: 럭셔리·골드·다크
   - urgency: 빨강·"D-N"·"오늘만" 강조
   - default: 명확하지 않으면

2. layout_type: text_overlay | photo_dominant | grid | infographic | quote_card

3. dominant_emotion: awe | curiosity | amusement | fear | anger | relief | trust | unknown

4. hook_pattern: 텍스트 의도 한 줄 (한국어, 20자 이내)
   예: "숫자 + 의외성", "질문형 hook", "현지인 시점", "데이터 강조"

5. text_density: low (≤10%) | medium (10~25%) | high (>25%)

6. has_face: 인물 얼굴 명확히 보이는지

7. has_numbers: 숫자/통계 명확히 표시되는지

8. reasoning: 위 판단 근거 1줄 (50자 이내)

JSON 형식으로만 응답:
{
  "palette_category": "...",
  "layout_type": "...",
  "dominant_emotion": "...",
  "hook_pattern": "...",
  "text_density": "...",
  "has_face": false,
  "has_numbers": false,
  "reasoning": "..."
}`;

export async function analyzeCoverImage(imageUrl: string): Promise<DesignArchetype | null> {
  const apiKey = getProviderApiKey('gemini');
  if (!apiKey) {
    console.warn('[archetype] Gemini API key 미설정 → skip');
    return null;
  }
  if (!imageUrl) return null;

  try {
    // 이미지 다운로드 → base64
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      console.warn(`[archetype] 이미지 다운로드 실패 ${imageUrl}: ${imgRes.status}`);
      return null;
    }
    const buf = await imgRes.arrayBuffer();
    const base64 = Buffer.from(buf).toString('base64');
    const mimeType = imgRes.headers.get('content-type') ?? 'image/jpeg';

    const ai = new GoogleGenerativeAI(apiKey);
    const model = ai.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
    });

    const result = await model.generateContent([
      PROMPT,
      { inlineData: { data: base64, mimeType } },
    ]);
    const text = result.response.text();
    const parsed = JSON.parse(text);
    return normalizeArchetype(parsed);
  } catch (err) {
    console.warn('[archetype] 분석 실패:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

function normalizeArchetype(raw: unknown): DesignArchetype | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const palette = String(r.palette_category ?? 'default') as PaletteCategory;
  const validPalettes: PaletteCategory[] = ['nature', 'architecture', 'food', 'street', 'data_story', 'premium', 'urgency', 'default'];
  const finalPalette = validPalettes.includes(palette) ? palette : 'default';

  const layout = String(r.layout_type ?? 'photo_dominant');
  const validLayouts = ['text_overlay', 'photo_dominant', 'grid', 'infographic', 'quote_card'];
  const finalLayout = (validLayouts.includes(layout) ? layout : 'photo_dominant') as DesignArchetype['layout_type'];

  const emotion = String(r.dominant_emotion ?? 'unknown');
  const validEmotions = ['awe', 'curiosity', 'amusement', 'fear', 'anger', 'relief', 'trust', 'unknown'];
  const finalEmotion = (validEmotions.includes(emotion) ? emotion : 'unknown') as DesignArchetype['dominant_emotion'];

  const density = String(r.text_density ?? 'medium');
  const finalDensity = (['low', 'medium', 'high'].includes(density) ? density : 'medium') as DesignArchetype['text_density'];

  return {
    palette_category: finalPalette,
    layout_type: finalLayout,
    dominant_emotion: finalEmotion,
    hook_pattern: String(r.hook_pattern ?? '').slice(0, 60),
    text_density: finalDensity,
    has_face: Boolean(r.has_face),
    has_numbers: Boolean(r.has_numbers),
    reasoning: String(r.reasoning ?? '').slice(0, 200),
  };
}

/**
 * Bucket key for archetype clustering — 비슷한 archetype을 묶어 archetype 테이블 row로 만들기.
 */
export function archetypeBucketKey(a: DesignArchetype): string {
  return `${a.palette_category}::${a.layout_type}::${a.dominant_emotion}::${a.text_density}`;
}
