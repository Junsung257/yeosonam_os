/**
 * Google Ads RSA Agent (Responsive Search Ads)
 *
 * Google 광고의 새 기본 포맷. 다수 헤드라인·설명 조합을 알고리즘이 자동 최적화.
 *
 * 스펙 (Google 공식):
 *   - Headlines: 3~15개, 각 30자 이내
 *     · 최소 3개는 핵심 키워드 포함 필수
 *     · "Pin" 옵션으로 위치 고정 가능 (H1/H2/H3)
 *   - Descriptions: 2~4개, 각 90자 이내
 *   - Paths (URL): 2개, 각 15자 이내 (예: /travel /bohol-4d)
 *   - Final URL: 랜딩 페이지
 *
 * 우리 출력: 15 headlines + 4 descriptions + 2 paths + final_url
 */
import { z } from 'zod';
import type { ContentBrief } from '@/lib/validators/content-brief';
import { callWithZodValidation } from '@/lib/llm-validate-retry';
import { generateBlogJSON, hasBlogApiKey } from '@/lib/blog-ai-caller';
import { getBrandVoiceBlock } from '../brand-voice';

export const GoogleAdsRSASchema = z.object({
  headlines: z.array(z.string().min(3).max(30)).min(3).max(15),
  descriptions: z.array(z.string().min(10).max(90)).min(2).max(4),
  paths: z.array(z.string().min(1).max(15).regex(/^[a-z0-9가-힣-]+$/)).length(2),
  final_url_suggestion: z.string().max(500),    // 권장 랜딩 URL (상대경로 또는 절대)
  core_keywords: z.array(z.string().max(20)).min(3).max(10),   // 사용된 핵심 키워드
  pinning_hint: z.object({
    h1: z.string().max(30).optional().nullable(),    // 1번 위치 고정 제안
    h2: z.string().max(30).optional().nullable(),
    h3: z.string().max(30).optional().nullable(),
  }),
});

export type GoogleAdsRSA = z.infer<typeof GoogleAdsRSASchema>;

export interface GoogleAdsRSAInput {
  brief: ContentBrief;
  product?: {
    title: string;
    destination?: string;
    duration?: number;
    nights?: number;
    price?: number;
    airline?: string;
    departure_airport?: string;
    product_summary?: string;
    product_highlights?: string[];
  };
  target_keywords?: string[];   // SEO 팀이 미리 정한 핵심 키워드
}

export async function generateGoogleAdsRSA(input: GoogleAdsRSAInput): Promise<GoogleAdsRSA> {
  if (!hasBlogApiKey()) return fallbackRSA(input);

  const voiceBlock = await getBrandVoiceBlock('yeosonam', 'google_ads_rsa');
  const prompt = (voiceBlock ? voiceBlock + '\n\n' : '') + buildRSAPrompt(input);

  const result = await callWithZodValidation({
    label: 'google-ads-rsa',
    schema: GoogleAdsRSASchema,
    maxAttempts: 3,
    fn: (feedback) => generateBlogJSON(prompt + (feedback ?? ''), { temperature: 0.75 }),
  });

  if (result.success) return result.value;
  console.warn('[google-ads-rsa] callWithZodValidation 실패 → fallback');
  return fallbackRSA(input);
}

function buildRSAPrompt(input: GoogleAdsRSAInput): string {
  const b = input.brief;
  const p = input.product;
  const priceText = p?.price ? formatPrice(p.price) : '';
  const dest = p?.destination ?? '';
  const core = input.target_keywords?.join(', ') ?? `${dest}, ${dest} 여행, ${dest} 패키지, ${priceText}`;

  return `너는 **Google Ads 전문가**. RSA(Responsive Search Ad) 15개 헤드라인 + 4개 설명 + 2개 paths 생성. Google 알고리즘이 조합 최적화.

## 소재
- H1: ${b.h1}
- 타겟: ${b.target_audience}
- 셀링포인트: ${b.key_selling_points.join(', ')}
${p ? `- 상품: ${p.title}
- 목적지: ${dest}
- 가격: ${priceText}
- 기간: ${p.duration ? `${p.nights ?? p.duration - 1}박${p.duration}일` : ''}` : ''}

## 핵심 키워드 (이 중 3개 이상 헤드라인에 필수)
${core}

## RSA 공식

### Headlines 15개 (각 30자 이내)
각기 다른 **구조** 사용:
1~3. 핵심 키워드 포함 (SEO 매칭)
4~5. 가격 강조
6~7. 혜택 (노팁·노옵션 등)
8~9. 자기관련성 ("주말 출발", "직항")
10~11. 긴급성 (선착순·한정)
12~13. 지역·브랜드 ("여소남")
14~15. CTA ("지금 예약", "견적 받기")

### Descriptions 4개 (각 90자 이내)
보조 설명. 기능+혜택+증거+CTA 순.
예:
- "부산 직항 4박6일 ${priceText} 추가비용 0원. 여소남 검증 패키지."
- "왕복항공 · 5성급 · 전식사 포함 · 선착순 20석 한정."

### Paths (2개, 각 15자 이내)
URL 꾸미기용. 소문자·하이픈·한글 OK.
- path1: "여행" 또는 "${dest}"
- path2: "${priceText}" 또는 "slim-package" 같은 상품 카테고리

### pinning_hint
헤드라인 15개 중 위치 고정할 만한 것:
- h1: 가장 강력한 훅 (가격 또는 긴급성)
- h2: 브랜드 또는 핵심 혜택
- h3: CTA

### core_keywords
실제 헤드라인/설명에 사용된 핵심 키워드 (광고 품질점수 추적용).

## 출력 JSON
{
  "headlines": ["headline1", ..., "headline15"],
  "descriptions": ["desc1", "desc2", "desc3", "desc4"],
  "paths": ["path1", "path2"],
  "final_url_suggestion": "/packages/{product_id}",
  "core_keywords": ["${dest}", "${dest} 여행", "${priceText}"],
  "pinning_hint": { "h1": "", "h2": "", "h3": "" }
}

## 엄격
- headlines 3~15개 (권장 15), 각 30자 이하
- descriptions 2~4개 (권장 4), 각 90자 이하
- paths 정확히 2개, 각 15자 이하 (a-z, 0-9, 한글, 하이픈만)
- 헤드라인 중 최소 3개에 핵심 키워드 포함
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

function fallbackRSA(input: GoogleAdsRSAInput): GoogleAdsRSA {
  const p = input.product;
  const dest = p?.destination ?? '여행지';
  const priceText = p?.price ? formatPrice(p.price) : '특가';
  const dur = p?.duration ? `${p.nights ?? p.duration - 1}박${p.duration}일` : '';

  return {
    headlines: [
      `${dest} 패키지 ${priceText}`,
      `${dest} ${dur} 특가`,
      `${dest} 직항 여행`,
      `${priceText} ${dest} 여행`,
      `가성비 ${dest} 패키지`,
      `${dest} 노팁·노옵션`,
      `${dest} 5성급 ${priceText}`,
      `주말 ${dest} ${priceText}`,
      `직항 ${dest} 4박6일`,
      `[선착순 20석] ${dest}`,
      `${dest} 한정 ${priceText}`,
      `여소남 ${dest} 패키지`,
      `여소남 검증 상품`,
      `지금 ${dest} 예약`,
      `${dest} 견적 받기`,
    ].map((h) => h.slice(0, 30)),
    descriptions: [
      `부산 직항 ${dur} ${priceText} 추가비용 0원 보장. 여소남 검증 패키지.`.slice(0, 90),
      `왕복항공 · 호텔 · 전식사 포함. 팁·옵션·쇼핑 NO. [선착순 20석] 한정.`.slice(0, 90),
      `${dest} 가성비 끝판왕. 실사용자 후기 기반 추천. 지금 문의하세요.`.slice(0, 90),
      `안심 비교·예약. 여소남 브랜드 정식 상품. 항공권 오르기 전 예약.`.slice(0, 90),
    ],
    paths: [
      dest.replace(/\s+/g, '-').slice(0, 15) || '여행',
      (priceText.replace(/[^\d가-힣]/g, '').slice(0, 15) || 'deal'),
    ],
    final_url_suggestion: '/packages',
    core_keywords: [dest, `${dest} 여행`, `${dest} 패키지`, priceText].filter((k): k is string => !!k).slice(0, 10),
    pinning_hint: {
      h1: `${priceText} ${dest} 여행`.slice(0, 30),
      h2: `여소남 검증 상품`.slice(0, 30),
      h3: `지금 ${dest} 예약`.slice(0, 30),
    },
  };
}
