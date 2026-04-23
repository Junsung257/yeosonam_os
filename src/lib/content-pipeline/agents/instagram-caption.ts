/**
 * Instagram Caption Agent
 *
 * 역할: ContentBrief + product → Instagram 피드 캡션 + 해시태그 + 첫 댓글
 *
 * Instagram 알고리즘 특성:
 *   - 캡션 최대 2200자, 첫 125자가 "... 더보기" 앞 프리뷰
 *   - 해시태그 20~30개 권장, 대중+니치 조합
 *   - 첫 댓글에 해시태그 몰아넣기 전략 (본문 가독성 확보)
 *   - 줄바꿈 2~3번으로 시각적 리듬
 *   - CTA 1개 (댓글·DM·저장·공유 중 하나 명확)
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import type { ContentBrief } from '@/lib/validators/content-brief';
import { BLOG_AI_MODEL } from '@/lib/prompt-version';
import { getBrandVoiceBlock } from '../brand-voice';

export const InstagramCaptionSchema = z.object({
  caption: z.string().min(50).max(2200),
  preview_hook: z.string().min(10).max(125),   // 첫 125자 프리뷰 (알고리즘 중요)
  hashtags: z.array(z.string().regex(/^#[^\s#]+$/).max(30)).min(10).max(30),
  first_comment: z.string().max(1000).nullable(),   // 해시태그 뭉치 댓글 (옵션)
  cta_type: z.enum(['dm_keyword', 'save', 'share', 'link_click', 'comment_question']),
});

export type InstagramCaption = z.infer<typeof InstagramCaptionSchema>;

export interface InstagramCaptionInput {
  brief: ContentBrief;
  product?: {
    title: string;
    destination?: string;
    duration?: number;
    nights?: number;
    price?: number;
    airline?: string;
    product_summary?: string;
    product_highlights?: string[];
  };
  tone?: 'friendly' | 'premium' | 'urgent' | 'informative';
}

export async function generateInstagramCaption(input: InstagramCaptionInput): Promise<InstagramCaption> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.warn('[instagram-caption] GOOGLE_AI_API_KEY 없음 → fallback');
    return fallbackCaption(input);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: BLOG_AI_MODEL,
    generationConfig: { temperature: 0.85, responseMimeType: 'application/json' },
  });

  const voiceBlock = await getBrandVoiceBlock('yeosonam', 'instagram_caption');
  const prompt = (voiceBlock ? voiceBlock + '\n\n' : '') + buildCaptionPrompt(input);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await model.generateContent(
        prompt + (attempt > 0 ? '\n\n## 재시도 — JSON 스키마 엄수, 해시태그 10~30개, 첫 125자 프리뷰 훅 필수.' : ''),
      );
      const text = result.response.text().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      const jsonStr = match ? match[0] : text;
      const parsed = JSON.parse(jsonStr);
      const checked = InstagramCaptionSchema.safeParse(parsed);
      if (checked.success) return checked.data;
      console.warn('[instagram-caption] 스키마 검증 실패:', checked.error.errors.slice(0, 3));
    } catch (err) {
      console.warn(`[instagram-caption] 시도 ${attempt + 1} 실패:`, err instanceof Error ? err.message : err);
    }
  }

  return fallbackCaption(input);
}

function buildCaptionPrompt(input: InstagramCaptionInput): string {
  const b = input.brief;
  const p = input.product;
  const priceText = p?.price ? formatPriceChipSimple(p.price) : '';

  return `너는 **인스타그램 성과 마케터 10년차**. 카드뉴스 1장과 함께 게시될 **피드 캡션 + 해시태그**를 작성한다.

## 소재 정보
- H1: ${b.h1}
- target_audience: ${b.target_audience}
- intro_hook: ${b.intro_hook}
- key_selling_points: ${b.key_selling_points.join(', ')}
${p ? `- 상품명: ${p.title}
- 목적지: ${p.destination ?? ''}
- 기간: ${p.duration ? `${p.nights ?? p.duration - 1}박${p.duration}일` : ''}
- 가격: ${priceText}
- 하이라이트: ${(p.product_highlights ?? []).slice(0, 3).join(', ')}` : ''}

## 인스타그램 캡션 공식

### 1. 첫 125자 (preview_hook) = 알고리즘 결정
- "... 더보기" 클릭 전 프리뷰
- 자기관련성 + 숫자/혜택 반드시 포함
- ❌ "여행 떠나요" (막연함)
- ✅ "연차 없이 주말만, ${priceText || '41만원대'} 보홀 4박 (조건 ↓)"

### 2. 캡션 본문 구조 (총 500~1500자 권장)
[훅] 한 줄 질문 또는 반전
[공백]
[문제/공감] 2~3줄 (모두투어 "참지마요" 톤)
[해답 소개] 혜택 3~5개 이모지 불릿
[신뢰] ⭐평점 / 예약수 / 재방문율 (가능하면)
[CTA] 1개 명확한 행동 (댓글 키워드 권장)

### 3. 해시태그 20~30개 (큰것+중간+니치 믹스)
- 대중 (>100만): #여행 #국내여행 #해외여행
- 카테고리 (10~100만): #보홀여행 #보홀4박 #보홀패키지 #보홀특가
- 니치 (<10만): #보홀솔레아 #부산출발여행 #주말여행
- 브랜드/고정: #여소남 #여소남os

### 4. CTA 유형 (1개 선택)
- **dm_keyword** (전환율 최고): "댓글에 '보홀' 남기면 41만원대 특가 DM으로 쏴드림"
- save: "💾 저장해두고 여행 계획 세우실 때 꺼내보세요"
- share: "친구 태그하고 같이 떠나요"
- comment_question: "보홀 가본 분들, 꼭 가야 할 곳 있으면 댓글로 알려주세요"

### 5. 이모지 규칙
- 본문: ✨🏝️☀️🌊 같은 감성 이모지 2~4개만
- 과용 금지 (알고리즘 감점)

## 출력 JSON
{
  "caption": "전체 캡션 (500~1500자, 줄바꿈 \\n\\n 포함)",
  "preview_hook": "첫 125자 (125자 이하)",
  "hashtags": ["#대중", "#카테고리1", "#카테고리2", "#니치1", "#니치2", "#여소남"],
  "first_comment": "해시태그 15~20개를 첫 댓글에 몰아넣은 문자열 (본문 깔끔 유지 전략). 없으면 null",
  "cta_type": "dm_keyword|save|share|link_click|comment_question"
}

## 엄격
- preview_hook 정확히 125자 이하
- hashtags 배열 10~30개, 각 "#" 시작
- 캡션 내 이모지 5개 이하
- JSON만 출력`;
}

function formatPriceChipSimple(price: number): string {
  if (price >= 10000) {
    const man = Math.floor(price / 10000);
    const cheon = Math.round((price % 10000) / 1000);
    return cheon === 0 ? `${man}만원~` : `${man}만${cheon}천원~`;
  }
  return `${price.toLocaleString()}원~`;
}

function fallbackCaption(input: InstagramCaptionInput): InstagramCaption {
  const b = input.brief;
  const p = input.product;
  const dest = p?.destination ?? '여행지';
  const priceText = p?.price ? formatPriceChipSimple(p.price) : '특가';

  const preview = `연차 없이 주말 출발, ${priceText} ${dest} 여행. 여소남이 엄선한 패키지.`.slice(0, 125);
  const caption = `${preview}

🏝️ ${b.h1}

💡 이 여행 어때?
- ${b.key_selling_points[0] ?? '노팁 · 노옵션'}
- ${b.key_selling_points[1] ?? '5성급 숙박'}
- ${b.key_selling_points[2] ?? '왕복 항공 포함'}

💬 예약 방법
댓글에 "${dest.slice(0, 2) || '여행'}" 남겨주세요!
${priceText} 특가 링크를 DM으로 1분 내 발송합니다.

✅ 여소남 검증 상품`;

  return {
    caption: caption.slice(0, 2200),
    preview_hook: preview,
    hashtags: [
      '#여행', '#해외여행', '#패키지여행',
      `#${dest}`, `#${dest}여행`, `#${dest}패키지`,
      '#가성비여행', '#주말여행', '#직항여행',
      '#여소남', '#여소남os',
    ],
    first_comment: null,
    cta_type: 'dm_keyword',
  };
}
