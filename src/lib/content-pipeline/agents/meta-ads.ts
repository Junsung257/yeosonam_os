/**
 * Meta Ads Agent (Facebook + Instagram Ads)
 *
 * Meta 광고 관리자에 그대로 입력 가능한 Creative 세트 생성.
 *
 * 스펙:
 *   - Primary Text (본문): 125자 권장, 최대 300자, 5개 변형
 *   - Headline: 27자 권장, 최대 40자, 5개 변형
 *   - Description: 27자 권장, 최대 30자, 5개 변형
 *   - CTA button: 지정된 enum 중 1개
 *
 * 다변형 생성 이유:
 *   - Meta A/B 테스트는 다수 변형 조합 필요 (5×5×5 = 125 조합 자동 생성)
 *   - 최적 조합을 Meta 알고리즘이 학습
 */
import { z } from 'zod';
import type { ContentBrief } from '@/lib/validators/content-brief';
import { callWithZodValidation } from '@/lib/llm-validate-retry';
import { generateBlogJSON, hasBlogApiKey } from '@/lib/blog-ai-caller';
import { getBrandVoiceBlock } from '../brand-voice';
import { getCompetitorPromptBlock } from './competitor-ad-analyzer';

const META_CTA_VALUES = [
  'SHOP_NOW',      // 지금 쇼핑하기
  'LEARN_MORE',    // 더 알아보기
  'SIGN_UP',       // 가입하기
  'BOOK_TRAVEL',   // 여행 예약
  'GET_OFFER',     // 혜택 받기
  'CONTACT_US',    // 문의하기
  'SEND_MESSAGE',  // 메시지 보내기
  'GET_QUOTE',     // 견적 받기
] as const;

export const MetaAdsSchema = z.object({
  primary_texts: z.array(z.string().min(20).max(300)).length(5),
  headlines: z.array(z.string().min(5).max(40)).length(5),
  descriptions: z.array(z.string().min(5).max(30)).length(5),
  cta_button: z.enum(META_CTA_VALUES),
  audience_hint: z.string().max(200),           // 추천 타겟 오디언스
  primary_angle: z.enum(['price', 'benefit', 'social_proof', 'urgency', 'story']),
});

export type MetaAds = z.infer<typeof MetaAdsSchema>;

export interface MetaAdsInput {
  brief: ContentBrief;
  product?: {
    title: string;
    destination?: string;
    duration?: number;
    nights?: number;
    price?: number;
    product_summary?: string;
    product_highlights?: string[];
  };
  angle?: 'price' | 'benefit' | 'social_proof' | 'urgency' | 'story';
}

export async function generateMetaAds(input: MetaAdsInput): Promise<MetaAds> {
  if (!hasBlogApiKey()) return fallbackMetaAds(input);

  const voiceBlock = await getBrandVoiceBlock('yeosonam', 'meta_ads');
  const destHints = input.product?.destination ? [input.product.destination] : [];
  const competitorBlock = await getCompetitorPromptBlock(destHints);
  const prompt = [voiceBlock, competitorBlock, buildMetaAdsPrompt(input)]
    .filter(Boolean).join('\n\n');

  const result = await callWithZodValidation({
    label: 'meta-ads',
    schema: MetaAdsSchema,
    maxAttempts: 3,
    fn: (feedback) => generateBlogJSON(prompt + (feedback ?? ''), { temperature: 0.8 }),
  });

  if (result.success) return result.value;
  console.warn('[meta-ads] callWithZodValidation 실패 → fallback');
  return fallbackMetaAds(input);
}

function buildMetaAdsPrompt(input: MetaAdsInput): string {
  const b = input.brief;
  const p = input.product;
  const priceText = p?.price ? formatPrice(p.price) : '';
  const dest = p?.destination ?? '';

  return `너는 **Meta(Facebook/Instagram) 광고 퍼포먼스 마케터 10년차**. Creative 5×5×5 변형을 생성한다. Meta 알고리즘이 학습할 수 있도록 각 슬롯을 **5개 각자 다른 각도**로 작성.

## 소재
- H1: ${b.h1}
- 타겟: ${b.target_audience}
- 핵심 셀링: ${b.key_selling_points.join(', ')}
${p ? `- 상품: ${p.title}
- 목적지: ${dest}
- 가격: ${priceText}
- 기간: ${p.duration ? `${p.nights ?? p.duration - 1}박${p.duration}일` : ''}` : ''}

## 출력 스펙 (Meta 광고 관리자 직접 입력용)

### primary_texts (5개, 각 125자 권장 최대 300자)
"본문" 영역. 첫 1~2줄이 핵심 (알고리즘 + UX).
각각 다른 각도:
1. 가격 강조 ("${priceText} 주말 ${dest}")
2. 혜택 나열 ("팁·옵션·쇼핑 0원 포함")
3. 사회적 증거 ("★ 4.9 · 예약 50건")
4. 긴급성 ("[선착순 20석] 마감 임박")
5. 스토리 ("저도 이 가격 처음 봤습니다")

### headlines (5개, 각 27자 권장 최대 40자)
광고 제목. 굵게 표시됨. 5개 다른 훅:
- 숫자 훅 / 질문 훅 / 명령형 훅 / 자기관련성 / FOMO

### descriptions (5개, 각 27자 권장 최대 30자)
보조 설명. 혜택 요약 또는 CTA 보강.

### cta_button (1개만)
${META_CTA_VALUES.join(' | ')} 중 상품 성격 맞는 것 1개.
여행 상품은 BOOK_TRAVEL 기본, 정보성은 LEARN_MORE.

### audience_hint (타겟 오디언스 힌트)
"30~40대 수도권 직장인, 해외여행 관심, 일본/동남아 검색 이력" 같이 구체.

### primary_angle
이 광고 세트의 대표 각도 (price|benefit|social_proof|urgency|story).

## 출력 JSON
{
  "primary_texts": ["", "", "", "", ""],
  "headlines": ["", "", "", "", ""],
  "descriptions": ["", "", "", "", ""],
  "cta_button": "${META_CTA_VALUES[3]}",
  "audience_hint": "",
  "primary_angle": "price"
}

## 엄격
- 배열 **정확히 5개**씩
- primary_texts 각 300자 이하, headlines 40자 이하, descriptions 30자 이하
- 박수/일수/가격 팩트 변경 금지
- JSON만 출력`;
}

function formatPrice(price: number): string {
  if (price >= 10000) {
    const man = Math.floor(price / 10000);
    const cheon = Math.round((price % 10000) / 1000);
    return cheon === 0 ? `${man}만원~` : `${man}만${cheon}천원~`;
  }
  return `${price.toLocaleString()}원~`;
}

function fallbackMetaAds(input: MetaAdsInput): MetaAds {
  const b = input.brief;
  const p = input.product;
  const priceText = p?.price ? formatPrice(p.price) : '특가';
  const dest = p?.destination ?? '여행지';

  return {
    primary_texts: [
      `${priceText} ${dest} 여행. 추가비용 없이 이 가격에 다 포함.`,
      `팁·옵션·쇼핑 0원. ${b.key_selling_points.slice(0, 3).join(', ')}`,
      `여소남 검증 상품. 예약 후기 다수. ${dest} 가성비 끝판왕.`,
      `[선착순 20석 한정] ${dest} ${priceText} 마감 임박. 댓글 주세요.`,
      `저도 처음엔 낚시인 줄 알았는데, 진짜 ${priceText} 였습니다. ${dest} 공유해요.`,
    ],
    headlines: [
      `${priceText} ${dest} 특가`,
      `${dest} 가본 분들 주목`,
      `[선착순] ${dest} ${priceText}`,
      `연차 없이 주말 ${dest}`,
      `${dest} 놓치면 후회할 가격`,
    ],
    descriptions: [
      '추가비용 0원 보장',
      '여소남 검증 상품',
      '팁·옵션·쇼핑 NO',
      '선착순 마감 임박',
      '주말 직항 특가',
    ],
    cta_button: 'BOOK_TRAVEL',
    audience_hint: `${b.target_audience} / ${dest} 여행 관심자`,
    primary_angle: input.angle ?? 'price',
  };
}
