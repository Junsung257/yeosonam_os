/**
 * Threads Post Agent
 *
 * 역할: ContentBrief + product → Threads 대화형 포스트 + 후속 댓글 체인
 *
 * Threads 특성 (Instagram 과 다름):
 *   - 텍스트 중심 플랫폼 (Twitter/X 스타일)
 *   - 최대 500자, 대화형 / 솔직 / 첫-인칭 톤
 *   - 스레드 (thread) — 첫 포스트에 자기 답글로 연결
 *   - 해시태그 적게 (1~3개)
 *   - 이모지 적당히
 *   - 알고리즘이 "참여 유도 질문" 선호
 */
import { z } from 'zod';
import type { ContentBrief } from '@/lib/validators/content-brief';
import { callWithZodValidation } from '@/lib/llm-validate-retry';
import { generateBlogJSON, hasBlogApiKey } from '@/lib/blog-ai-caller';
import { getBrandVoiceBlock } from '../brand-voice';

export const ThreadsPostSchema = z.object({
  main: z.string().min(30).max(500),                  // 첫 포스트
  thread: z.array(z.string().min(20).max(500)).max(4),  // 후속 답글 (0~4개)
  hashtags: z.array(z.string().regex(/^#[^\s#]+$/)).max(3),
  cta_type: z.enum(['dm_keyword', 'reply_question', 'profile_link', 'none']),
});

export type ThreadsPost = z.infer<typeof ThreadsPostSchema>;

export interface ThreadsPostInput {
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
  style?: 'personal_story' | 'info_list' | 'question' | 'behind_the_scene';
}

export async function generateThreadsPost(input: ThreadsPostInput): Promise<ThreadsPost> {
  if (!hasBlogApiKey()) {
    console.warn('[threads-post] API 키 없음 → fallback');
    return fallbackThreadsPost(input);
  }

  const voiceBlock = await getBrandVoiceBlock('yeosonam', 'threads_post');
  const prompt = (voiceBlock ? voiceBlock + '\n\n' : '') + buildThreadsPrompt(input);

  const result = await callWithZodValidation({
    label: 'threads-post',
    schema: ThreadsPostSchema,
    maxAttempts: 3,
    fn: (feedback) => generateBlogJSON(prompt + (feedback ?? ''), { temperature: 0.9 }),
  });

  if (result.success) return result.value;
  console.warn('[threads-post] callWithZodValidation 실패 → fallback');
  return fallbackThreadsPost(input);
}

function buildThreadsPrompt(input: ThreadsPostInput): string {
  const b = input.brief;
  const p = input.product;
  const priceText = p?.price ? formatPriceChipSimple(p.price) : '';
  const style = input.style ?? 'personal_story';

  return `너는 **Threads 크리에이터**다. 여행 경험을 솔직/1인칭/대화형으로 풀어낸다. Instagram 캡션처럼 단정하지 않고, 진짜 친구한테 카톡 쓰듯이.

## 소재
- H1: ${b.h1}
- target_audience: ${b.target_audience}
${p ? `- 상품: ${p.title}
- 목적지: ${p.destination ?? ''}
- 기간: ${p.duration ? `${p.nights ?? p.duration - 1}박${p.duration}일` : ''}
- 가격: ${priceText}
- 하이라이트: ${(p.product_highlights ?? []).slice(0, 3).join(', ')}` : ''}

## Threads 포스트 공식

### 1. main (첫 포스트, 500자 이내)
스타일 옵션 중 하나:
- **personal_story**: "저 지난달에 보홀 다녀왔거든요. 근데..." 1인칭 + 구체 에피소드
- **info_list**: "보홀 가실 분 체크리스트 3개" 번호 나열
- **question**: "보홀 4박에 얼마 쓰셨어요? 저 최근 ${priceText} 나왔는데 ..." 질문 유도
- **behind_the_scene**: "여행사 내부 공유: 이번 분기 가장 반응 좋은 루트는 ..."

공통:
- 1인칭 "저"/"제가" 사용
- 한 문장 짧게 + 줄바꿈 리듬
- 이모지 1~2개 최대
- 첫 1줄 훅이 핵심

### 2. thread (후속 답글, 0~4개)
첫 포스트 아래 자기답글로 연결. 각 500자 이내.
알고리즘은 thread 길이를 좋아함. 3~4개 권장.

진행 패턴:
1/4: 상황·문제 제시
2/4: 구체 정보 (가격·일정·포함)
3/4: 개인적 느낌·팁
4/4: CTA (댓글·DM 유도)

### 3. 해시태그 (0~3개)
Threads는 해시태그 적게. 꼭 필요한 것만:
- #여행 #보홀 #가성비 #여소남 중 1~3개

### 4. CTA 유형 (1개)
- **dm_keyword**: "DM으로 '보홀' 보내주시면 자료 공유" (전환 최고)
- **reply_question**: "보홀 가본 분 있으시면 꼭 들려야 할 곳 알려주세요" (engagement)
- **profile_link**: "프로필 보시면 자세한 정보 있어요" (약함, 비추)
- **none**: CTA 없이 순수 공유

## 출력 JSON
{
  "main": "첫 포스트 (500자 이하, 1인칭, 이모지 최소)",
  "thread": [
    "2/N 후속 (500자)",
    "3/N 후속",
    "4/N CTA"
  ],
  "hashtags": ["#여행"],
  "cta_type": "dm_keyword|reply_question|profile_link|none"
}

## 엄격
- main 500자 이하
- thread 배열 0~4개, 각 500자 이하, 20자 이상
- hashtags 0~3개
- 이모지 main+thread 합쳐 6개 이내
- JSON만 출력
- 스타일: ${style}`;
}

function formatPriceChipSimple(price: number): string {
  if (price >= 10000) {
    const man = Math.floor(price / 10000);
    const cheon = Math.round((price % 10000) / 1000);
    return cheon === 0 ? `${man}만원~` : `${man}만${cheon}천원~`;
  }
  return `${price.toLocaleString()}원~`;
}

function fallbackThreadsPost(input: ThreadsPostInput): ThreadsPost {
  const b = input.brief;
  const p = input.product;
  const dest = p?.destination ?? '여행지';
  const priceText = p?.price ? formatPriceChipSimple(p.price) : '특가';

  const main = `저 최근에 ${dest} 패키지 찾다가 ${priceText} 견적 받았는데요.

진짜 이 가격에 이게 다 들어간다고? 싶어서 공유해요.

${p?.duration ? `${p.nights ?? p.duration - 1}박${p.duration}일` : ''} · 왕복항공 · 숙박 · 현지 투어 다 포함.`;

  const thread = [
    `2/4. 구체적으로는 이렇습니다:
- ${b.key_selling_points[0] ?? '노팁 노옵션'}
- ${b.key_selling_points[1] ?? '5성급 숙박'}
- ${b.key_selling_points[2] ?? '왕복 항공 포함'}`,

    `3/4. 저도 처음엔 '낚시 아닌가?' 싶었는데, 여소남에서 실제로 확인 가능한 상품.
추가 비용 없이 ${priceText} 에서 끝나는 거 맞고요.`,

    `4/4. 궁금하신 분은 DM으로 "${dest.slice(0, 2) || '여행'}" 한 단어만 보내주세요.
자료 정리해서 쏴드림. 여유 있을 때 천천히 읽어보셔도 됨 🌊`,
  ];

  return {
    main: main.slice(0, 500),
    thread: thread.map((t) => t.slice(0, 500)),
    hashtags: ['#여행', `#${dest}`, '#여소남'],
    cta_type: 'dm_keyword',
  };
}
