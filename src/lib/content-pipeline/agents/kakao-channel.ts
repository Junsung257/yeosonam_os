/**
 * Kakao Channel Message Agent
 *
 * 카카오톡 채널 친구톡 / 알림톡 / 광고성 메시지 포맷.
 *
 * 카카오 채널 메시지 특성:
 *   - 친구톡: 1000자 이내, 이미지 + 버튼 2~4개, 발송 대상 = 채널 친구
 *   - 광고성 알림톡: 카카오 심사 필요, 변수 {#{고객명}} 지원
 *   - 짧고 직설적. 이모지 적당히. 다수 링크 금지.
 *
 * 우리 출력: 친구톡 기준. main_text + buttons[2~4] + image_hint
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import type { ContentBrief } from '@/lib/validators/content-brief';
import { BLOG_AI_MODEL } from '@/lib/prompt-version';
import { getBrandVoiceBlock } from '../brand-voice';

export const KakaoChannelMessageSchema = z.object({
  message_text: z.string().min(30).max(1000),
  buttons: z.array(z.object({
    label: z.string().min(2).max(14),
    action: z.enum(['web_link', 'deep_link', 'chat']),
    url: z.string().max(500).optional().nullable(),
  })).min(1).max(4),
  image_hint: z.string().max(100).nullable(),   // 대표 이미지 방향 (채널에 업로드할 이미지)
  message_type: z.enum(['promo', 'info', 'event', 'reminder']),
  target_segment: z.string().max(100),          // 발송 대상 세그먼트 힌트
});

export type KakaoChannelMessage = z.infer<typeof KakaoChannelMessageSchema>;

export interface KakaoChannelInput {
  brief: ContentBrief;
  product?: {
    title: string;
    destination?: string;
    duration?: number;
    nights?: number;
    price?: number;
    product_summary?: string;
  };
  message_type?: 'promo' | 'info' | 'event' | 'reminder';
}

export async function generateKakaoChannelMessage(input: KakaoChannelInput): Promise<KakaoChannelMessage> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return fallbackKakao(input);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: BLOG_AI_MODEL,
    generationConfig: { temperature: 0.7, responseMimeType: 'application/json' },
  });

  const voiceBlock = await getBrandVoiceBlock('yeosonam', 'kakao_channel');
  const prompt = (voiceBlock ? voiceBlock + '\n\n' : '') + buildKakaoPrompt(input);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await model.generateContent(
        prompt + (attempt > 0 ? '\n\n## 재시도 — 본문 1000자 이하 엄수. 버튼 1~4개.' : ''),
      );
      const text = result.response.text().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      const jsonStr = match ? match[0] : text;
      const parsed = JSON.parse(jsonStr);
      const checked = KakaoChannelMessageSchema.safeParse(parsed);
      if (checked.success) return checked.data;
      console.warn('[kakao-channel] 검증 실패:', checked.error.errors.slice(0, 3));
    } catch (err) {
      console.warn(`[kakao-channel] 시도 ${attempt + 1} 실패:`, err instanceof Error ? err.message : err);
    }
  }

  return fallbackKakao(input);
}

function buildKakaoPrompt(input: KakaoChannelInput): string {
  const b = input.brief;
  const p = input.product;
  const priceText = p?.price ? formatPrice(p.price) : '';
  const dest = p?.destination ?? '';
  const messageType = input.message_type ?? 'promo';

  return `너는 **카카오톡 채널 마케팅 전문가**. 채널 친구톡 메시지를 작성한다.

## 소재
- H1: ${b.h1}
- 타겟: ${b.target_audience}
- 셀링: ${b.key_selling_points.join(', ')}
${p ? `- 상품: ${p.title}
- 목적지: ${dest}
- 가격: ${priceText}
- 기간: ${p.duration ? `${p.nights ?? p.duration - 1}박${p.duration}일` : ''}` : ''}

## 카카오 친구톡 공식

### message_text (30~1000자)
${messageType === 'promo'    ? '프로모션 알림: 가격·혜택·마감 강조. 친근한 톤.' : ''}
${messageType === 'info'     ? '정보 제공: 유용한 팁·가이드. 광고 톤 피하기.' : ''}
${messageType === 'event'    ? '이벤트 안내: 참여 방법·기간·혜택 명확히.' : ''}
${messageType === 'reminder' ? '재방문 유도: 찜/관심 상품 업데이트 알림.' : ''}

구조:
[인사] "안녕하세요, 여소남입니다 🏝️"
[본론] 핵심 1가지 (가격/혜택/마감)
[상세] 2~3줄
[CTA] 버튼 안내

이모지 3~5개 (과용 금지).
반말/이상한 은어 금지. 친근하되 정중.

### buttons (1~4개)
- label (14자 이내): "예약 상담", "자세히 보기", "카톡 문의"
- action: web_link (외부 URL), deep_link (앱), chat (카톡 채팅)
- url: web_link 면 필수

### image_hint
대표 이미지 방향 (한국어 1줄, 100자 이하)
"해질녘 보홀 해변, 밝은 햇살, 서퍼 실루엣" 같이 구체.

### message_type
${messageType}

### target_segment
발송 대상 세그먼트 힌트
"최근 30일 {목적지} 검색 이력 있는 친구" 같이.

## 출력 JSON
{
  "message_text": "",
  "buttons": [
    { "label": "예약 상담", "action": "chat", "url": null },
    { "label": "자세히 보기", "action": "web_link", "url": "/packages/..." }
  ],
  "image_hint": "",
  "message_type": "${messageType}",
  "target_segment": ""
}

## 엄격
- message_text 1000자 이하
- buttons 1~4개
- label 14자 이하
- 반말/은어/이모지 과용 금지
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

function fallbackKakao(input: KakaoChannelInput): KakaoChannelMessage {
  const p = input.product;
  const dest = p?.destination ?? '여행지';
  const priceText = p?.price ? formatPrice(p.price) : '특가';
  const dur = p?.duration ? `${p.nights ?? p.duration - 1}박${p.duration}일` : '';

  const text = `안녕하세요, 여소남입니다 🏝️

이번 주 ${dest} ${dur} 특가 안내드립니다.
- 가격: ${priceText}
- 추가 비용 0원 (팁·옵션·쇼핑 NO)
- 선착순 20석 한정

자세한 일정은 버튼을 눌러 확인하세요 👇
`;

  return {
    message_text: text.trim().slice(0, 1000),
    buttons: [
      { label: '자세히 보기', action: 'web_link', url: '/packages' },
      { label: '카톡 상담', action: 'chat', url: null },
    ],
    image_hint: `${dest} 해질녘 해변, 밝은 톤`,
    message_type: input.message_type ?? 'promo',
    target_segment: `${dest} 관심 세그먼트, 최근 30일 활동 친구`,
  };
}
