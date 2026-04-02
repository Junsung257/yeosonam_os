/**
 * ══════════════════════════════════════════════════════════
 * Text Ad Generator — 네이버/구글 검색광고 텍스트 카피
 * ══════════════════════════════════════════════════════════
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ParsedProductData } from './parse-product';

// ── 키워드 그룹 정의 ───────────────────────────────────────

const KEYWORD_GROUPS: Record<string, {
  label: string;
  templates: string[];
  intent: string;
}> = {
  destination: {
    label: '목적지 키워드',
    templates: ['{dest} 패키지', '{dest} 여행', '{dest} 투어'],
    intent: '여행 정보 탐색 단계',
  },
  feature: {
    label: '상품 특성 키워드',
    templates: ['{dest} 노팁 패키지', '{dest} 노옵션 여행', '{dest} 5성급 패키지'],
    intent: '구매 의도 높음 → 혜택 강조',
  },
  departure: {
    label: '출발지 키워드',
    templates: ['부산출발 {dest}', '김해공항 {dest}', '부산 동남아 패키지'],
    intent: '부산/경남 타겟 → 접근성 강조',
  },
  price: {
    label: '가격 키워드',
    templates: ['{dest} 저렴한 패키지', '{dest} 패키지 가격 비교'],
    intent: '가성비 중시 → 가격+포함사항 강조',
  },
};

export interface TextAdCreative {
  creative_type: 'text_ad';
  channel: 'naver' | 'google';
  variant_index: number;
  hook_type: string;
  tone: string;
  key_selling_point: string;
  target_segment: string;
  keywords: string[];
  ad_copies: {
    title1: string;
    title2: string;
    description: string;
    display_url: string;
    landing_url: string;
  }[];
}

export async function generateTextAdVariants(
  parsedData: ParsedProductData,
  channels: ('naver' | 'google')[] = ['naver', 'google'],
): Promise<TextAdCreative[]> {
  const results: TextAdCreative[] = [];
  let variantIdx = 0;

  for (const channel of channels) {
    for (const [groupKey, group] of Object.entries(KEYWORD_GROUPS)) {
      const keywords = group.templates.map(t =>
        t.replace('{dest}', parsedData.destination)
      );

      const copies = await generateTextCopies(parsedData, groupKey, group, channel);
      const baseUrl = `https://yeosonam.co.kr/packages/${parsedData.product_id}`;

      results.push({
        creative_type: 'text_ad',
        channel,
        variant_index: variantIdx++,
        hook_type: groupKey,
        tone: 'informative',
        key_selling_point: groupKey === 'feature' ? 'notip' : groupKey === 'price' ? 'price_value' : 'destination',
        target_segment: 'middle_age',
        keywords,
        ad_copies: copies.map(copy => ({
          ...copy,
          display_url: 'yeosonam.co.kr',
          landing_url: `${baseUrl}?utm_source=${channel}&utm_medium=cpc&utm_campaign=${encodeURIComponent(parsedData.destination)}&utm_content=${groupKey}&utm_term=${encodeURIComponent(copy.title1)}`,
        })),
      });
    }
  }

  return results;
}

async function generateTextCopies(
  data: ParsedProductData,
  groupKey: string,
  group: typeof KEYWORD_GROUPS[string],
  channel: string,
): Promise<{ title1: string; title2: string; description: string }[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return buildFallbackCopies(data, groupKey);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0.7 } });

  const prompt = `당신은 ${channel === 'naver' ? '네이버' : '구글'} 검색광고 카피라이터입니다.
검색 의도: ${group.intent}

상품 핵심 데이터:
- 목적지: ${data.destination}
- 가격: ${data.base_price.toLocaleString()}원
- 출발: ${data.departure_date || '미정'} / 마감: ${data.deadline || '선착순'}
- 잔여: ${data.seats_left || '소수'}석
- 핵심: 노팁=${data.no_tip} / 노옵션=${data.no_option} / ${data.hotel_stars ?? '?'}성급
- 한식: ${data.meals.korean.join(', ') || '포함'}

규칙 (네이버 기준):
- title1: 최대 15자, 타겟 키워드 포함 필수
- title2: 최대 15자, 핵심 혜택 또는 가격
- description: 최대 45자, 숫자+CTA 포함

3가지 버전을 JSON 배열로:
[{"title1":"...","title2":"...","description":"..."}]`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(text);
  } catch {
    return buildFallbackCopies(data, groupKey);
  }
}

function buildFallbackCopies(
  data: ParsedProductData,
  groupKey: string,
): { title1: string; title2: string; description: string }[] {
  const dest = data.destination;
  const price = data.base_price.toLocaleString();

  switch (groupKey) {
    case 'destination':
      return [
        { title1: `${dest} 패키지`, title2: `${price}원~출발`, description: `노팁노옵션 ${dest} 여소남에서 지금 예약` },
        { title1: `${dest} 여행`, title2: '노팁 보장', description: `${price}원~ 5성급+한식매일 여소남` },
        { title1: `${dest} 투어`, title2: `${data.nights}박${data.days}일`, description: `노옵션 완벽포함 ${price}원 여소남` },
      ];
    case 'feature':
      return [
        { title1: `${dest} 노팁패키지`, title2: '5성급+한식포함', description: `노팁·노옵션 확실! 잔여${data.seats_left ?? '소수'}석 ${price}원 여소남` },
        { title1: `${dest} 노옵션여행`, title2: `${price}원~`, description: `5성급호텔+한식매일 여소남에서 안심예약` },
        { title1: `${dest} 품격패키지`, title2: '노팁노옵션보장', description: `${data.hotels[0] ?? '특급호텔'} ${price}원~ 여소남` },
      ];
    case 'departure':
      return [
        { title1: `부산출발${dest}`, title2: `${price}원~`, description: `김해직항 노팁노옵션 ${data.nights}박 여소남` },
        { title1: `김해공항${dest}`, title2: '노팁보장', description: `${price}원 5성급+한식 여소남 지금예약` },
        { title1: `부산${dest}패키지`, title2: '노옵션확실', description: `김해출발 ${price}원~ 잔여석한정 여소남` },
      ];
    default:
      return [
        { title1: `${dest} ${price}원`, title2: '가성비 최고', description: `노팁+노옵션+5성급+한식 올인클루시브 여소남` },
        { title1: `${dest} 특가`, title2: `${price}원~`, description: `가격대비 최고구성 여소남에서 비교해보세요` },
        { title1: `${dest} 가격비교`, title2: '여소남 추천', description: `${price}원 노팁패키지 지금 문의하세요` },
      ];
  }
}
