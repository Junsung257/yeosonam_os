/**
 * 여행지 메타데이터 자동 생성
 * - generateDestinationTaglines: DeepSeek V4-Flash로 감성 타이틀 생성 (초저비용)
 * - searchPexelsForDestination: Pexels 히어로 사진 후보 검색
 *
 * V3 (2026-05-01): Claude Haiku → DeepSeek V4-Flash 전환
 */

import OpenAI from 'openai';
import { searchPexelsPhotos, destToEnKeyword, isPexelsConfigured, type PexelsPhoto } from '@/lib/pexels';

function getDeepSeekClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 미설정');
  return new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' });
}

const TAGLINE_SYSTEM = `당신은 여소남(한국 여행사) 마케팅 카피라이터입니다.
여소남은 B2B2C 여행 플랫폼으로, 운영팀이 직접 검증한 패키지 여행 상품을 제공합니다.
"노팁·노옵션·직항·운영팀 검증"이 핵심 가치입니다.

타이틀 작성 규칙:
1. tagline: 여행지 특성을 살린 감성 H1 제목 (10~20자, 한국어)
   - 예시: "가보면 이해하는 곳, 다낭" / "산호바다 위의 낙원" / "천년 역사가 살아숨쉬는 곳"
   - 진부한 표현 금지: "아름다운", "환상적인", "꿈같은" 단독 사용
2. hero_tagline: 여행자 관점 1~2문장 (40~80자, 한국어)
   - 이 여행지에 가면 어떤 경험을 하게 되는지 구체적으로
   - 여소남 운영팀 목소리 (전문적, 친근, 신뢰감)

반드시 JSON으로만 응답: {"tagline":"...","hero_tagline":"..."}`;

/**
 * 여행지 감성 타이틀 + 서브 설명 LLM 생성 (DeepSeek V4-Flash)
 */
export async function generateDestinationTaglines(destination: string): Promise<{
  tagline: string;
  hero_tagline: string;
}> {
  const client = getDeepSeekClient();

  const response = await client.chat.completions.create({
    model: 'deepseek-v4-flash',
    max_tokens: 256,
    temperature: 0.7,
    messages: [
      { role: 'system', content: TAGLINE_SYSTEM },
      { role: 'user', content: `여행지: ${destination}\n\ntagline과 hero_tagline을 JSON으로 생성해주세요.` },
    ],
    response_format: { type: 'json_object' },
  });

  const text = response.choices?.[0]?.message?.content || '';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      tagline: `가보면 이해하는 곳, ${destination}`,
      hero_tagline: `여소남 운영팀이 직접 검증한 ${destination} 여행의 핵심 정보`,
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { tagline?: string; hero_tagline?: string };
    return {
      tagline: parsed.tagline || `가보면 이해하는 곳, ${destination}`,
      hero_tagline: parsed.hero_tagline || `여소남 운영팀이 직접 검증한 ${destination} 여행의 핵심 정보`,
    };
  } catch {
    return {
      tagline: `가보면 이해하는 곳, ${destination}`,
      hero_tagline: `여소남 운영팀이 직접 검증한 ${destination} 여행의 핵심 정보`,
    };
  }
}

/**
 * 여행지 Pexels 히어로 사진 후보 검색 (저장하지 않음)
 */
export async function searchPexelsForDestination(destination: string): Promise<PexelsPhoto[]> {
  if (!isPexelsConfigured()) return [];
  const keyword = destToEnKeyword(destination);
  const photos = await searchPexelsPhotos(keyword, 8);
  const landscape = photos.filter(p => p.width >= 1200 && p.height >= 700 && p.width > p.height);
  return landscape.length > 0 ? landscape : photos;
}
