/**
 * ══════════════════════════════════════════════════════════
 * Copy Generator — 슬라이드별 마케팅 카피 생성 (Gemini AI)
 * ══════════════════════════════════════════════════════════
 * - 슬라이드 역할별 전용 프롬프트 (hook/benefit/highlight/meal/cta)
 * - hook_type별 톤 차별화 (urgency/benefit/scene/question/price)
 * - winning_patterns RAG 주입 (베스트 카피 예시)
 * - post-processing: headline ≤20자, body ≤40자, pexels_keyword ≤5단어
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { SlideRole } from './design-slides';
import type { ParsedProductData } from './parse-product';

// ── 타입 ───────────────────────────────────────────────────

export interface GeneratedCopy {
  headline: string;
  body: string;
  pexels_keyword: string;
}

export interface WinningPattern {
  hook_type: string;
  avg_ctr: number;
  best_headline: string | null;
  best_body: string | null;
}

// ── 시스템 프롬프트 ────────────────────────────────────────

const SYSTEM = `You must output ONLY valid JSON. No markdown, no explanation, no code blocks.

당신은 한국 패키지 여행 카드뉴스 카피라이터입니다.
타겟: 40~60대 한국 중장년 (고모님/이모/부부여행)
클리셰 절대 금지: 파격, 놓치세요, 함께해요, 특별한, 소중한

## 글자 수 제한 (반드시 준수, 초과하면 틀린 답)
- headline: 반드시 20자 이내. 20자 넘으면 잘라서 출력.
- body: 반드시 40자 이내. 40자 넘으면 잘라서 출력. 긴 문장 금지, 명사 나열 위주.
- pexels_keyword: 영문 3~5단어

출력 형식 (이 형식만 출력, 다른 텍스트 일절 금지):
{"headline":"...","body":"...","pexels_keyword":"..."}`;

// ── JSON 추출 유틸 ─────────────────────────────────────────

function extractJSON(text: string): string {
  // 1. ```json ... ``` 블록 추출 시도
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  // 2. { ... } 첫 번째 JSON 객체 추출
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) return jsonMatch[0];
  // 3. 그래도 없으면 원문 반환 (기존 fallback이 처리)
  return text.trim();
}

// ── Post-processing: 글자 수 강제 제한 ─────────────────────

function enforceLength(copy: GeneratedCopy): GeneratedCopy {
  return {
    headline: copy.headline.slice(0, 20),
    body: copy.body.slice(0, 40),
    pexels_keyword: copy.pexels_keyword.split(' ').slice(0, 5).join(' '),
  };
}

// ── 역할별 프롬프트 ────────────────────────────────────────

type RolePromptFn = (role: SlideRole, hookType?: string, example?: WinningPattern) => string;

const ROLE_PROMPTS: Record<string, RolePromptFn> = {
  hook: (role, hookType, example) => {
    const d = role.data!;
    const priceStr = d.base_price > 0 ? d.base_price.toLocaleString() + '원' : '';
    let hookGuide = '';

    switch (hookType) {
      case 'urgency':
        hookGuide = `긴급감 중심. 잔여 ${d.seats_left ?? '소수'}석 / ${d.deadline ?? '선착순'} 마감 필수 포함`;
        break;
      case 'benefit':
        hookGuide = '노팁·노옵션·5성급 혜택 중심';
        break;
      case 'scene':
        hookGuide = `최고 시각 장면: ${d.highlights[0]?.hook ?? d.destination} 중심으로 장면 묘사`;
        break;
      case 'question':
        hookGuide = '타겟 페인포인트 질문형. "팁 걱정?", "혼자 알아보기 어렵다면?" 등';
        break;
      case 'price':
        hookGuide = `${priceStr} 가격 대비 가치 중심`;
        break;
      default:
        hookGuide = '스크롤 멈추게 하는 강한 첫 문장';
    }

    const exampleGuide = example?.best_headline
      ? `\n참고 (CTR ${example.avg_ctr}% 기록):\nheadline: ${example.best_headline}`
      : '';

    return `[훅 슬라이드] 스크롤 멈추게 하는 첫 문장
훅 타입: ${hookType}
${hookGuide}
${exampleGuide}
headline: 반드시 20자 이내 (잔여석+출발일+마감 조합)
body: 반드시 40자 이내 (핵심 혜택 한 줄)
pexels_keyword: 구체적 감성 장면 영문 3-5단어 (금지: "vietnam travel", "nha trang city")

출력은 반드시 {"headline":"...","body":"...","pexels_keyword":"..."} JSON 객체만. 다른 텍스트 일절 금지.`;
  },

  benefit: (role) => {
    const d = role.data!;
    return `[혜택 슬라이드] 명사/숫자 나열만. 문장형 금지.
반드시 활용: 노팁=${d.no_tip} / 노옵션=${d.no_option} / ${d.hotel_stars ?? '?'}성급 / 한식 ${d.meals.korean.length}회
호텔명: ${d.hotels.join(', ') || '정보없음'}
특전: ${d.special_gifts?.join(', ') || '없음'}
headline: 반드시 20자 이내. "노팁·노옵션·5성급·한식매일" 형태
body: 반드시 40자 이내. 호텔명+한식메뉴 나열만. 문장 금지.
pexels_keyword: 영문 3-5단어

출력은 반드시 {"headline":"...","body":"...","pexels_keyword":"..."} JSON 객체만. 다른 텍스트 일절 금지.`;
  },

  highlight_scene: (role) => {
    const h = role.highlight;
    return `[하이라이트 슬라이드] 1장면을 영화처럼
장면: ${h?.name ?? '관광지'} — ${h?.hook ?? ''}
headline: 반드시 20자 이내. 숫자나 고유명사 포함
body: 반드시 40자 이내. 장소명 2~3개 나열
pexels_keyword: 해당 장면 구체적 영문 3-5단어

출력은 반드시 {"headline":"...","body":"...","pexels_keyword":"..."} JSON 객체만. 다른 텍스트 일절 금지.`;
  },

  highlights_combined: (role) => {
    const hs = role.highlights ?? [];
    return `[하이라이트 압축] 3개 핵심 경험 한 슬라이드에
하이라이트: ${hs.map(h => `${h.name}(${h.hook})`).join(' / ') || '정보없음'}
headline: 반드시 20자 이내. 가장 임팩트 1개 중심
body: 반드시 40자 이내. 3개 장소명 나열만
pexels_keyword: 가장 시각적인 장면 영문 3-5단어

출력은 반드시 {"headline":"...","body":"...","pexels_keyword":"..."} JSON 객체만. 다른 텍스트 일절 금지.`;
  },

  itinerary: (role) => {
    return `[일정 슬라이드] ${role.region ?? ''} 지역
장소: ${role.key_points?.join(', ') || '정보없음'}
하이라이트: ${role.highlights?.map(h => h.hook).join(', ') || '없음'}
headline: 반드시 20자 이내. 지역 최고 장면
body: 반드시 40자 이내. 장소 3~4개 나열만
pexels_keyword: ${role.region ?? ''} 지역 영문 3-5단어

출력은 반드시 {"headline":"...","body":"...","pexels_keyword":"..."} JSON 객체만. 다른 텍스트 일절 금지.`;
  },

  meal: (role) => {
    const d = role.data!;
    return `[식사 슬라이드] 한식 보장 — 중장년 핵심 불안 해소
한식: ${d.meals.korean.join(', ') || '정보없음'}
현지식: ${d.meals.local.join(', ') || '정보없음'}
headline: 반드시 20자 이내. 실제 메뉴명. (예: "삼겹이·제육·소부고기")
body: 반드시 40자 이내. 메뉴 나열만.
pexels_keyword: 영문 3-5단어

출력은 반드시 {"headline":"...","body":"...","pexels_keyword":"..."} JSON 객체만. 다른 텍스트 일절 금지.`;
  },

  cta: (role) => {
    const d = role.data!;
    const priceStr = d.base_price > 0 ? d.base_price.toLocaleString() + '원' : '';
    return `[CTA 슬라이드] 지금 바로 행동하게 만드는 긴급감
반드시 포함: 잔여 ${d.seats_left ?? '소수'}석 / ${d.deadline ?? '선착순'} / ${priceStr}
headline: 반드시 20자 이내. 잔여석+마감 조합 (예: "잔여 2석, 3/30 마감")
body: 반드시 40자 이내. 가격+포함 요약
pexels_keyword: 영문 3-5단어

출력은 반드시 {"headline":"...","body":"...","pexels_keyword":"..."} JSON 객체만. 다른 텍스트 일절 금지.`;
  },
};

// ── 메인 함수 ──────────────────────────────────────────────

export async function generateCopies(
  slideRoles: SlideRole[],
  hookType: string,
  patternExample?: WinningPattern,
): Promise<GeneratedCopy[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;

  if (!apiKey) {
    return slideRoles.map(role => enforceLength(buildFallbackCopy(role, hookType)));
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.8 },
  });

  // 병렬 생성
  const results = await Promise.allSettled(
    slideRoles.map(async (role) => {
      const promptFn = ROLE_PROMPTS[role.type];
      if (!promptFn) return enforceLength(buildFallbackCopy(role, hookType));

      const rolePrompt = promptFn(
        role,
        role.type === 'hook' ? hookType : undefined,
        role.type === 'hook' ? patternExample : undefined,
      );

      try {
        const prompt = `${SYSTEM}\n\n${rolePrompt}`;
        const result = await model.generateContent(prompt);
        const rawText = result.response.text();
        const jsonStr = extractJSON(rawText);
        const parsed = JSON.parse(jsonStr) as GeneratedCopy;
        return enforceLength(parsed);
      } catch (err) {
        console.warn(`[generateCopy] ${role.type} 실패:`, err instanceof Error ? err.message : err);
        return enforceLength(buildFallbackCopy(role, hookType));
      }
    })
  );

  return results.map(r =>
    r.status === 'fulfilled'
      ? r.value
      : enforceLength({ headline: '', body: '', pexels_keyword: 'travel destination' })
  );
}

// ── Fallback ───────────────────────────────────────────────

function buildFallbackCopy(role: SlideRole, hookType: string): GeneratedCopy {
  const d = role.data;
  const dest = d?.destination ?? '여행지';
  const priceStr = d?.base_price ? d.base_price.toLocaleString() + '원' : '';
  const dur = d?.nights ? `${d.nights}박${d.days}일` : '';

  switch (role.type) {
    case 'hook':
      if (hookType === 'urgency') return { headline: `잔여 ${d?.seats_left ?? '소수'}석 마감임박`, body: `${dest} ${dur} ${priceStr}`, pexels_keyword: `${dest} aerial beach sunset` };
      if (hookType === 'benefit') return { headline: '노팁·노옵션·5성급', body: `${dest} ${dur} 완벽 포함`, pexels_keyword: `luxury resort pool ${dest}` };
      return { headline: `${dest} ${dur}`, body: priceStr ? `${priceStr}부터` : dest, pexels_keyword: `${dest} landscape beautiful` };

    case 'benefit':
      return { headline: '노팁·노옵션·5성급', body: `${d?.hotels[0] ?? '특급호텔'}+한식매일`, pexels_keyword: 'luxury hotel pool tropical' };

    case 'highlight_scene':
      return { headline: role.highlight?.name ?? '특별한 장면', body: role.highlight?.hook ?? '', pexels_keyword: `${dest} scenic viewpoint` };

    case 'highlights_combined':
      return { headline: role.highlights?.[0]?.name ?? '핵심 일정', body: role.highlights?.map(h => h.name).join(', ') ?? '', pexels_keyword: `${dest} tourism culture` };

    case 'itinerary':
      return { headline: `${role.region ?? dest} 핵심 코스`, body: role.key_points?.join(', ') ?? '', pexels_keyword: `${role.region ?? dest} street market temple` };

    case 'meal':
      return { headline: d?.meals.korean[0] ?? '한식 매일', body: d?.meals.korean.join(', ') ?? '', pexels_keyword: 'korean bbq grilled pork' };

    case 'cta':
      return { headline: `${d?.seats_left ?? '소수'}석, 마감임박`, body: `${priceStr} ${dest} ${dur}`, pexels_keyword: 'travel booking couple phone' };

    default:
      return { headline: dest, body: dur, pexels_keyword: `${dest} travel` };
  }
}
