import { ContentBrief, parseAndValidateBrief, HookType } from '@/lib/validators/content-brief';
import { TEMPLATE_IDS, TEMPLATE_META } from '@/lib/card-news/tokens';
import { ANGLE_PRESETS } from '@/lib/content-generator';
import { designBriefStructure, type StructureInput } from './agents/structure-designer';
import { writeCardCopy } from './agents/card-news-copywriter';

/**
 * Call 1: Content Brief 설계자 (V2)
 *
 * 역할: 블로그+카드뉴스 공통 목차 설계 + V2 슬롯 풀 충전
 * 출력: ContentBrief (Zod 검증 통과) — V2 슬롯 포함
 *
 * V2 슬롯 (필수화):
 *   eyebrow      : 카테고리 태그 ("특가", "핵심 혜택", "TIP", "주의")
 *   tip          : tip role 섹션에만 (꿀팁 1줄)
 *   warning      : warning role 섹션에만 (주의사항 1줄)
 *   price_chip   : hook/cta/benefit 슬라이드 (product 모드만) — "41만9천원~"
 *   trust_row    : benefit/inclusion 섹션 — ["노팁","노옵션","5성급"] 3~4개
 *   accent_color : null (템플릿 기본 악센트 사용)
 *   photo_hint   : 구체적 사진 장소/분위기 힌트 (Pexels 힌트 외)
 *
 * template_family_suggestion: 상품 성격에 따라 선택
 *   - editorial: 정보성/가이드 (하얀 카드)
 *   - cinematic: 감성/풍경 (풀이미지+scrim)
 *   - premium:   럭셔리/신혼 (블랙+골드)
 *   - bold:      특가/가성비 (네이비→골드)
 */

export interface BriefInput {
  mode: 'product' | 'info';
  slideCount?: number;
  tone?: string;
  extraPrompt?: string;
  // Product mode
  product?: {
    title: string;
    destination?: string;
    duration?: number;
    nights?: number;
    price?: number;
    airline?: string;
    departure_airport?: string;
    inclusions?: string[];
    product_highlights?: string[];
    itinerary?: string[];
    product_summary?: string;
    special_notes?: string;
  };
  angle?: string;
  // Info mode
  topic?: string;
  category?: string;
}

const TEMPLATE_LIST = TEMPLATE_IDS.map(id => `  - ${id}: ${TEMPLATE_META[id].label} (${TEMPLATE_META[id].bestFor})`).join('\n');

/**
 * 2-stage 파이프라인:
 *   Stage 1 — Structure Designer: 뼈대 (role, hook_type, h2, template_family 등)
 *   Stage 2 — Card News Copywriter: 확정된 구조에 슬라이드 카피 채움
 *   Stage 3 — enricher: 결정론적 보정 (규칙 기반)
 *
 * 각 stage 는 독립 LLM 호출 또는 fallback.
 * 단일 mega-prompt 한계 돌파 + 각 에이전트 집중도 ↑.
 */
export async function generateContentBrief(input: BriefInput): Promise<ContentBrief> {
  const slideCount = input.slideCount ?? 6;
  const structureInput: StructureInput = {
    mode: input.mode,
    slideCount,
    tone: input.tone,
    extraPrompt: input.extraPrompt,
    product: input.product,
    angle: input.angle,
    topic: input.topic,
    category: input.category,
  };

  // Stage 1: Structure
  let structure;
  try {
    structure = await designBriefStructure(structureInput);
  } catch (err) {
    console.warn('[content-brief] structure-designer 실패 → mono fallback:', err instanceof Error ? err.message : err);
    return fallbackBrief(input);
  }

  // Stage 2: Copy
  let copy;
  try {
    copy = await writeCardCopy(structure, structureInput);
  } catch (err) {
    console.warn('[content-brief] card-news-copywriter 실패 → mono fallback:', err instanceof Error ? err.message : err);
    return fallbackBrief(input);
  }

  // Merge structure + copy → ContentBrief
  const merged: ContentBrief = {
    mode: structure.mode,
    h1: structure.h1,
    intro_hook: structure.intro_hook,
    target_audience: structure.target_audience,
    key_selling_points: structure.key_selling_points,
    template_family_suggestion: structure.template_family_suggestion,
    sections: structure.sections.map((s) => {
      const copyForSection = copy.sections.find((c) => c.position === s.position);
      const card_slide = copyForSection?.card_slide ?? {
        headline: s.h2.slice(0, 15),
        body: '여소남 추천 상품',
        template_suggestion: s.template_suggestion,
        pexels_keyword: s.pexels_keyword,
        badge: null,
        eyebrow: s.h2.slice(0, 20),
        tip: null,
        warning: null,
        price_chip: null,
        trust_row: null,
        accent_color: null,
        photo_hint: null,
        hook_type: s.hook_type ?? null,
        social_proof: null,
      };
      return {
        position: s.position,
        h2: s.h2,
        role: s.role,
        blog_paragraph_seed: s.blog_paragraph_seed,
        card_slide,
      };
    }),
    cta_slide: copy.cta_slide,
    seo: structure.seo,
  };

  // Stage 3: 결정론적 enricher
  return enrichBriefWithV2Slots(merged, input);
}

// ──────────────────────────────────────────────────────
// V2 슬롯 보강 — LLM 출력이 모호해도 3 레이어 공식 사후 보정
// (토스 CTR + PostNitro AIDA + 국내외 여행사 베스트 패턴)
// ──────────────────────────────────────────────────────
function enrichBriefWithV2Slots(brief: ContentBrief, input: BriefInput): ContentBrief {
  if (input.mode !== 'product' || !input.product) return brief;
  const p = input.product;

  const priceChip = p.price ? formatPriceChip(p.price) : null;
  const trustSignals = extractTrustSignals(p);
  const family = brief.template_family_suggestion ?? deriveFamily(p, input.angle);
  const recommendedHookType = deriveHookType(p, input.angle);
  const socialProofText = deriveSocialProof(p);

  const urgencyEyebrowForHook = pickUrgencyEyebrow(p, 'hook');
  const urgencyEyebrowForCta = pickUrgencyEyebrow(p, 'cta');

  // hook 섹션에서 question 타입이 감지되면 cta 가 답을 제공 (information gap)
  let hookIsQuestion = false;

  const enrichedSections = brief.sections.map((s) => {
    const cs = { ...s.card_slide };

    // ▣ 이모지 sanitize — 폰트 미지원 글리프 제거
    cs.headline = sanitizeEmojis(cs.headline) ?? cs.headline;
    cs.body = sanitizeEmojis(cs.body) ?? cs.body;
    if (cs.eyebrow) cs.eyebrow = sanitizeEmojis(cs.eyebrow);
    if (cs.tip) cs.tip = sanitizeEmojis(cs.tip);
    if (cs.warning) cs.warning = sanitizeEmojis(cs.warning);
    if (cs.social_proof) cs.social_proof = sanitizeEmojis(cs.social_proof);
    if (cs.badge) cs.badge = sanitizeEmojis(cs.badge);

    // ▣ Hook 섹션 특수 처리 (AIDA Attention) ────────────
    if (s.role === 'hook') {
      // hook_type 없으면 product 성격으로 추천
      if (!cs.hook_type) cs.hook_type = recommendedHookType;

      // hook_type 별 eyebrow 자동 재구성 (generic 이거나 없을 때)
      if (!cs.eyebrow || isGenericEyebrow(cs.eyebrow)) {
        cs.eyebrow = eyebrowForHookType(cs.hook_type ?? 'urgency', p);
      }

      // question 타입 기록 — cta 에서 활용
      if (cs.hook_type === 'question') {
        hookIsQuestion = true;
      }
    } else if (!cs.eyebrow || isGenericEyebrow(cs.eyebrow)) {
      // ▣ 비-hook 섹션 eyebrow 자동 주입
      if (s.role === 'benefit') cs.eyebrow = '[0원] 추가 비용';
      else if (s.role === 'tourist_spot') cs.eyebrow = `[${p.destination || '현지'}] 핵심`;
      else if (s.role === 'inclusion') cs.eyebrow = '[0원] 포함';
      else if (s.role === 'tip') cs.eyebrow = 'PRO TIP';
      else if (s.role === 'warning') cs.eyebrow = 'WATCH OUT';
      else if (s.role === 'detail') cs.eyebrow = '핵심 디테일';
    }

    // ▣ hook eyebrow 에 대괄호 강제
    if (s.role === 'hook' && cs.eyebrow && !/\[.*\]/.test(cs.eyebrow)) {
      cs.eyebrow = `[${cs.eyebrow}]`;
    }

    // ▣ price_chip — hook/benefit 자동
    if (!cs.price_chip && (s.role === 'hook' || s.role === 'benefit') && priceChip) {
      cs.price_chip = priceChip;
    }

    // ▣ trust_row — benefit/inclusion 자동
    if (trustSignals.length > 0 && (s.role === 'benefit' || s.role === 'inclusion')) {
      const existing = Array.isArray(cs.trust_row) ? cs.trust_row : [];
      if (existing.length < 3) {
        const merged = Array.from(new Set([...existing, ...trustSignals])).slice(0, 4);
        cs.trust_row = merged;
      }
    }

    // ▣ social_proof — benefit/detail 섹션에 자동 (마이리얼트립/Airbnb 공식)
    if (!cs.social_proof && (s.role === 'benefit' || s.role === 'detail')) {
      cs.social_proof = socialProofText;
    }

    // ▣ body "/" → "," (토스 가독성 공식)
    if (cs.body && cs.body.includes(' / ') && !cs.body.includes(',')) {
      cs.body = cs.body.replace(/\s*\/\s*/g, ', ');
    }

    return { ...s, card_slide: cs };
  });

  const enrichedCta = { ...brief.cta_slide };

  // ▣ CTA 이모지 sanitize
  enrichedCta.headline = sanitizeEmojis(enrichedCta.headline) ?? enrichedCta.headline;
  enrichedCta.body = sanitizeEmojis(enrichedCta.body) ?? enrichedCta.body;
  if (enrichedCta.eyebrow) enrichedCta.eyebrow = sanitizeEmojis(enrichedCta.eyebrow);
  if (enrichedCta.social_proof) enrichedCta.social_proof = sanitizeEmojis(enrichedCta.social_proof);
  if (enrichedCta.badge) enrichedCta.badge = sanitizeEmojis(enrichedCta.badge);

  // ▣ hook이 question이었으면 CTA body를 "답" 형태로 시작 (information gap)
  if (hookIsQuestion && priceChip && enrichedCta.body && !/\d만.*원/.test(enrichedCta.body)) {
    const shortAnswer = `답: ${priceChip}`;
    // body 앞에 답 prefix 붙이되 40자 넘지 않게
    const merged = `${shortAnswer} · ${enrichedCta.body}`.slice(0, 40);
    enrichedCta.body = merged;
  }

  if (!enrichedCta.eyebrow || isGenericEyebrow(enrichedCta.eyebrow)) {
    enrichedCta.eyebrow = urgencyEyebrowForCta;
  } else if (!/\[.*\]/.test(enrichedCta.eyebrow)) {
    enrichedCta.eyebrow = `[${enrichedCta.eyebrow}]`;
  }
  if (!enrichedCta.price_chip && priceChip) enrichedCta.price_chip = priceChip;

  // engagement 유도 CTA (CreatorFlow 공식 — 전환율 8~15%)
  if (!enrichedCta.badge || enrichedCta.badge === '지금 예약') {
    // 상품 가격 기반 CTA 선택 — 고가(100만원+) 상담 유도, 저가 즉시 예약
    if (p.price && p.price >= 1000000) {
      enrichedCta.badge = 'DM 상담 1분';
    } else {
      enrichedCta.badge = '지금 예약';
    }
  }
  // body 가 generic("지금 예약하기")이면 댓글 유도형으로 교체
  if (enrichedCta.body && isGenericCtaBody(enrichedCta.body)) {
    enrichedCta.body = priceChip
      ? `댓글 '예약' 남기세요, ${priceChip} DM 발송`
      : `댓글 '예약' 남기세요, 특가 DM 발송`;
    if (enrichedCta.body.length > 40) {
      enrichedCta.body = enrichedCta.body.slice(0, 39) + '…';
    }
  }

  if ((!enrichedCta.trust_row || enrichedCta.trust_row.length === 0) && trustSignals.length > 0) {
    enrichedCta.trust_row = trustSignals.slice(0, 3);
  }
  if (!enrichedCta.social_proof) enrichedCta.social_proof = socialProofText;

  // ▣ H1 어순 교정 — 가격 숫자가 뒤에 있으면 앞으로 재배치 (Senior 원칙 [1])
  const enrichedH1 = reorderH1WithPriceFront(brief.h1, priceChip);

  // ▣ SEO 설명 마감 뉘앙스 보정 (Senior 원칙 [7])
  const enrichedSeoDescription = ensureScarcityClosing(brief.seo.description, priceChip);

  return {
    ...brief,
    h1: enrichedH1,
    sections: enrichedSections,
    cta_slide: enrichedCta,
    template_family_suggestion: family,
    seo: {
      ...brief.seo,
      description: enrichedSeoDescription,
    },
  };
}

// ──────────────────────────────────────────────────────
// H1 가격 앞으로 이동 — 숫자 훅은 0.25초 정지 결정 요인
// "부터/특가/한정" 같이 가격 직후 suffix 는 같이 뽑아서 어색한 끊김 방지
// ──────────────────────────────────────────────────────
function reorderH1WithPriceFront(h1: string, priceChip: string | null): string {
  if (!priceChip) return h1;
  // 가격 + 선택적 suffix (부터|~|특가) 까지 한 덩어리로 매칭
  const pricePattern = /(\d+만(?:\d+천)?원|\d{1,3}(?:,\d{3})+원|\d+,?\d{3,6}원)\s*(부터|~|특가)?/g;
  const matchArr = h1.match(pricePattern);
  if (!matchArr) return h1;
  const matchStr = matchArr[0];
  const priceIdx = h1.indexOf(matchStr);
  if (priceIdx < 15) return h1; // 이미 15자 이내(앞쪽)에 있으면 무시

  const beforePrice = h1.slice(0, priceIdx).replace(/[,\s·!?]+$/, '').trim();
  const afterPrice = h1.slice(priceIdx + matchStr.length).replace(/^[,\s·!?]+/, '').trim();
  const priceBlock = matchStr.trim();
  
  const reordered = `${priceBlock} ${beforePrice}${afterPrice ? ' ' + afterPrice : ''}`.trim();
  return reordered.slice(0, 70);
}

// ──────────────────────────────────────────────────────
// SEO 설명 마감 뉘앙스 보장 — 한정/마감/시효 단어가 없으면 추가
// ──────────────────────────────────────────────────────
function ensureScarcityClosing(description: string, priceChip: string | null): string {
  if (!description) return description;
  // 이미 한정/마감/선착순/임박 포함이면 OK
  if (/한정|마감|선착순|임박|D-\d|\d+석/.test(description)) return description;

  // 마지막 문장에 scarcity 추가
  const priceHint = priceChip ? `${priceChip} 혜택은 [선착순 한정]. ` : '';
  const addon = `${priceHint}항공권 오르기 전 지금 예약하세요.`;
  const combined = description.replace(/[.。!]$/, '').trim() + '. ' + addon;
  return combined.slice(0, 200);
}

// ──────────────────────────────────────────────────────
// Hook type 자동 추천 — product 성격 기반
// ──────────────────────────────────────────────────────
function deriveHookType(p: BriefInput['product'], angle?: string): HookType {
  if (!p) return 'urgency';
  const text = [
    p.title,
    p.product_summary,
    p.special_notes,
    ...(p.product_highlights ?? []),
  ].filter(Boolean).join(' ');

  // angle 명시 우선
  if (angle === 'value' || angle === 'deal') return 'urgency';
  if (angle === 'info' || angle === 'guide') return 'number';
  if (angle === 'emotional' || angle === 'honeymoon') return 'story';
  if (angle === 'premium' || angle === 'luxury') return 'story';

  // 키워드 추론
  if (/특가|가성비|반값|최저가|마감|선착순/i.test(text)) return 'urgency';
  if (/한정|이번주|오늘만|\d+명|\d+석/i.test(text)) return 'fomo';
  if (/프리미엄|럭셔리|허니문|신혼|품격|5성급/i.test(text)) return 'story';
  if (/꿀팁|가이드|TOP|체크리스트|알아야/i.test(text)) return 'number';
  return 'question';  // 기본값 — 호기심 유발
}

// hook_type 별 eyebrow
function eyebrowForHookType(hookType: HookType, p: BriefInput['product']): string {
  const month = new Date().getMonth() + 1;
  switch (hookType) {
    case 'urgency':  return '[선착순 20석]';
    case 'question': return `진짜 최저가는?`;
    case 'number':   return `TOP 7 꿀팁`;
    case 'fomo':     return '[이번 주만 사라짐]';
    case 'story':    return 'REAL STORY';
    default:         return `[${month}월 특가]`;
  }
}

// ──────────────────────────────────────────────────────
// Social proof 생성 (product 데이터 기반, fallback 은 브랜드 신뢰 문구)
// ──────────────────────────────────────────────────────
function deriveSocialProof(p: BriefInput['product']): string {
  if (!p) return '✓ 여소남 검증';
  // Pretendard 폰트에 글리프 있는 기호만 사용 (✓ ★ · 지원, ⭐🏝️ 미지원)
  const keywords = [
    p.title,
    p.product_summary,
    ...(p.product_highlights ?? []),
  ].filter(Boolean).join(' ');
  if (/인기|베스트|추천/i.test(keywords)) {
    return '★ 이달의 추천 · 여소남 검증';
  }
  if (/5\s*성급|프리미엄|럭셔리/i.test(keywords)) {
    return '★ 5성급 · 여소남 프리미엄 인증';
  }
  if (/가성비|특가|노팁|노옵션/i.test(keywords)) {
    return '✓ 추가비용 0원 보장';
  }
  return '✓ 여소남 검증 상품';
}

/** LLM 출력 sanitizer — 폰트 미지원 이모지를 안전한 유니코드 기호로 치환 */
function sanitizeEmojis(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  return text
    .replace(/⭐/g, '★')
    .replace(/🏝️/g, '·')
    .replace(/🏝/g, '·')
    .replace(/👉/g, '→')
    .replace(/👀/g, '')
    .replace(/🔥/g, '★')
    .replace(/💎/g, '★')
    .replace(/🎁/g, '')
    .replace(/✨/g, '★')
    .trim() || null;
}

// 긴급성 eyebrow 선택 — destination/duration 기반
function pickUrgencyEyebrow(p: BriefInput['product'], role: 'hook' | 'cta'): string {
  if (!p) return role === 'hook' ? '[이번 주 특가]' : '[오늘만]';
  const month = new Date().getMonth() + 1;
  if (role === 'cta') {
    return '[오늘만 이 가격]';
  }
  // hook 은 상품 성격별
  if (p.product_summary && /특가|가성비|최저가|마감/i.test(p.product_summary)) {
    return '[선착순 20석]';
  }
  if (/5\s*성급|프리미엄|럭셔리|허니문/i.test(`${p.title} ${p.product_summary ?? ''}`)) {
    return '[VIP 20석 한정]';
  }
  return `[${month}월 특가]`;
}

// eyebrow 가 너무 일반적이면 재생성 대상
function isGenericEyebrow(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length <= 2) return true;
  return /^(여행|정보|안내|카테고리|카드뉴스)$/.test(trimmed);
}

// cta body가 generic 이거나 "프로필 링크" 같은 3단계 요구 문구면 교체 대상
function isGenericCtaBody(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length <= 8) return true;
  // 앞쪽 generic opening
  if (/^(지금\s*예약|안심\s*예약|특별가\s*예약|바로\s*예약|여행\s*준비)/.test(trimmed)) return true;
  // 문장 내 generic 동사 (어디 있든 포함)
  if (/(떠나요!?|즐겨\s*보세요|떠나\s*보세요|놓치지\s*마세요)/.test(trimmed)) return true;
  // 프로필 링크 유도 — 3단계 이탈 유발 (CreatorFlow 공식)
  if (/프로필\s*링크|링크\s*클릭|바이오\s*링크/.test(trimmed)) return true;
  return false;
}

// ──────────────────────────────────────────────────────
// 신뢰 시그널 추출 (노팁, 노옵션, 5성급, 전식사 포함, ...)
// ──────────────────────────────────────────────────────
function extractTrustSignals(p: BriefInput['product']): string[] {
  if (!p) return [];
  const signals: string[] = [];
  const haystack = [
    p.title,
    p.product_summary,
    p.special_notes,
    ...(p.inclusions ?? []),
    ...(p.product_highlights ?? []),
  ].filter(Boolean).join(' ');

  const rules: Array<[RegExp, string]> = [
    [/노\s*팁|no\s*tip/i, '노팁'],
    [/노\s*옵션|no\s*option/i, '노옵션'],
    [/노\s*쇼핑|no\s*shop/i, '노쇼핑'],
    [/5\s*성급|파이브\s*스타|5\*/i, '5성급'],
    [/전\s*식사|전식|호텔\s*조식/i, '전식사'],
    [/과일\s*도시락/i, '과일도시락'],
    [/왕복\s*항공/i, '왕복항공'],
    [/마사지|맛사지|massage/i, '마사지'],
    [/전용\s*차량|단독\s*차량/i, '전용차량'],
    [/가이드\s*팁\s*포함|가이드팁\s*포함/i, '가이드팁포함'],
    [/수화물|위탁수하물/i, '수하물 포함'],
    [/허니문|신혼/i, '허니문 특화'],
    [/효도|부모님/i, '효도여행'],
    [/무비자/i, '무비자'],
  ];
  for (const [re, label] of rules) {
    if (re.test(haystack) && !signals.includes(label)) signals.push(label);
    if (signals.length >= 4) break;
  }
  return signals;
}

// ──────────────────────────────────────────────────────
// 가격 → "41만9천원~" 스타일
// ──────────────────────────────────────────────────────
function formatPriceChip(price: number): string {
  if (price >= 10000) {
    const man = Math.floor(price / 10000);
    const remainder = price % 10000;
    if (remainder === 0) return `${man}만원~`;
    const cheon = Math.round(remainder / 1000);
    if (cheon === 0) return `${man}만원~`;
    return `${man}만${cheon}천원~`;
  }
  return `${price.toLocaleString()}원~`;
}

// ──────────────────────────────────────────────────────
// 상품 성격 → family 자동 선택
// ──────────────────────────────────────────────────────
function deriveFamily(
  p: BriefInput['product'],
  angle?: string,
): 'editorial' | 'cinematic' | 'premium' | 'bold' {
  if (!p) return 'editorial';
  const text = [
    p.title,
    p.product_summary,
    ...(p.product_highlights ?? []),
  ].filter(Boolean).join(' ');

  // 1순위: 명시적 angle
  if (angle === 'value' || angle === 'deal') return 'bold';
  if (angle === 'emotional' || angle === 'honeymoon') return 'cinematic';
  if (angle === 'premium' || angle === 'luxury') return 'premium';
  if (angle === 'info' || angle === 'guide') return 'editorial';

  // 2순위: 키워드 추론
  if (/5\s*성급|프리미엄|럭셔리|허니문|신혼|품격/i.test(text)) return 'premium';
  if (/특가|가성비|반값|최저가|마감|임박/i.test(text)) return 'bold';
  if (/자연|풍경|야경|감성|모험|트래킹|오로라|해변/i.test(text)) return 'cinematic';
  return 'editorial';
}

function buildBriefPrompt(input: BriefInput): string {
  const slideCount = input.slideCount ?? 6;
  const tone = input.tone ?? 'professional';

  let contextBlock = '';
  let angleBlock = '';
  let priceHint = '';
  let trustHint = '';

  if (input.mode === 'product' && input.product) {
    const p = input.product;
    const nights = p.nights ?? (p.duration ? p.duration - 1 : 0);
    const dur = p.duration ? `${nights}박${p.duration}일` : '';
    const priceStr = p.price ? `${p.price.toLocaleString()}원~` : '';
    priceHint = p.price ? formatPriceChip(p.price) : '';
    const autoSignals = extractTrustSignals(p);
    trustHint = autoSignals.length > 0 ? autoSignals.slice(0, 4).join(', ') : '';

    contextBlock = `## 상품 정보
- 상품명: ${p.title}
- 목적지: ${p.destination ?? '여행지'}
- 기간: ${dur} (박수/일수는 이대로 유지)
- 가격: ${priceStr}
- 항공: ${p.airline ?? ''}
- 출발: ${p.departure_airport ?? ''}
- 포함사항: ${(p.inclusions ?? []).slice(0, 6).join(', ')}
- 하이라이트: ${(p.product_highlights ?? []).slice(0, 5).join(', ')}
- 주요 일정: ${(p.itinerary ?? []).slice(0, 4).join(' / ')}
- 요약: ${p.product_summary ?? ''}
- 특이사항: ${p.special_notes ?? ''}`;

    if (input.angle && ANGLE_PRESETS[input.angle as keyof typeof ANGLE_PRESETS]) {
      const a = ANGLE_PRESETS[input.angle as keyof typeof ANGLE_PRESETS];
      angleBlock = `## 앵글 (핵심 소구 방향)\n- ${a.label}: ${a.description}`;
    }
  } else {
    contextBlock = `## 정보성 콘텐츠 주제
- 주제: ${input.topic ?? '여행 정보'}
- 카테고리: ${input.category ?? '일반'}`;
  }

  return `너는 **인스타그램 카드뉴스 성과형 카피라이터 10년차**다. 토스애즈 실데이터 기반 CTR 공식을 완벽히 체화하고 있다. 블로그 + 카드뉴스 Brief(설계도) 를 JSON으로 짜내라.

${contextBlock}

${angleBlock}

## 슬라이드 수 / 톤
- 슬라이드 수: ${slideCount}장 (= sections + cta_slide 1개 = ${slideCount - 1}개 섹션 + 마지막 cta_slide)
- 톤: ${tone}
${input.extraPrompt ? `- 추가 지시: ${input.extraPrompt}` : ''}

## 템플릿 Family (상품 성격에 맞게 1개)
- editorial: 정보성/가이드 (하얀 카드)
- cinematic: 감성/풍경 (풀이미지 + scrim)
- premium:   럭셔리/신혼 (블랙 + 골드)
- bold:      특가/가성비 (그라디언트 + 장식)

## ⚡ 카드뉴스 3 레이어 공식 (종합 — 토스 CTR + PostNitro AIDA + 국내외 여행사 베스트)

### [레이어 A] 토스 CTR 4대 공식
1. **긴급성 +20~30%**: "[선착순 N석]", "[오늘만]", "[마감 D-N]"
2. **자기관련성 +15%**: "~이라면", "~이신 분"
3. **혜택성 +25%**: "[0원] 추가비용, 팁·옵션·쇼핑 전부 포함"
4. **구체성**: "바나산" → "[구름 위 판타지] 바나산"

### [레이어 B] PostNitro AIDA 배치 (22M 포스트 연구)
- 슬라이드 1 (Attention): 훅 타입 1개 적용, 0.25초 내 정지
- 슬라이드 2~3 (Interest): 문제 명명 + 수치
- 슬라이드 4~5 (Desire): 단계별 해법 + 증거 (trust_row, social_proof)
- 마지막 (Action): **단 하나의** 명확한 CTA

### [레이어 C] 국내외 여행사 패턴
- **하나투어 ("의외성")**: 발리 마사지 → "전기 통닭" 밈 → 700만뷰 + 발리 검색 +1378
- **모두투어 ("공감")**: "여행, 참지마요" 시리즈 (PAS 공식)
- **마이리얼트립 ("1인칭 후기")**: "실제 간 사람들 얘기" 톤
- **Airbnb ("mood")**: 방 사진 → "여기서 자고 싶다" 감각 어필
- **Klook/Booking**: 별점 · 예약수 · 리뷰 수치 전면

## 🎯 Hook Type 5종 (hook 섹션에 반드시 1개 선택)

상품 성격에 맞게 hook_type 필드에 정확히 하나 지정:

| 타입 | 예시 headline | eyebrow | 언제 |
|---|---|---|---|
| **urgency**  | 4박5일 호캉스      | [선착순 20석]         | 특가·마감 |
| **question** | 보홀 3박, 얼마?     | 진짜 최저가는?        | 가성비·정보성 |
| **number**   | 다낭 4박 꿀팁 7     | TOP 7                 | 정보성 가이드 |
| **fomo**     | 이번주만 TOP 3      | [D-3 마감]            | 재고 한정 |
| **story**    | 작년 눈물흘린 이유  | REAL STORY            | 프리미엄·신혼 |

❌ BAD: hook headline "다낭 4박5일 패키지" (상품명 복제)
✅ GOOD urgency: eyebrow "[선착순 20석]" / headline "4박5일 호캉스" / price_chip "77만9천원~"
✅ GOOD question: eyebrow "진짜 최저가?" / headline "보홀 3박, 얼마?" / body "답은 마지막 슬라이드에"
✅ GOOD story: eyebrow "REAL STORY" / headline "작년 보홀 이 실수" / body "여소남 고객은 이렇게"

## 📊 Social Proof (신뢰 증거 수치)

AIRBNB/마이리얼트립이 압도하는 축. **benefit 또는 detail** 섹션에 1개 필수:
- "⭐ 4.9 · 예약 50건 · 재방문 32%"
- "🏆 2025 고객만족 1위"
- "✓ 후기 245건 · 평균 만족도 98%"

social_proof 필드에 채움. product 모드에서만. 없으면 "여소남 검증 상품".

## 🔄 Information Gap (캐러셀 전용 트릭)

hook_type이 question이면 → **cta slide에 답 배치** (사용자가 마지막까지 스와이프).
예: hook "보홀 3박 얼마?" → cta body "답: 41만9천원~ [선착순 10석]"

## 📱 CTA Engagement Prompt (CreatorFlow 2026: 전환율 1~3% → 8~15%)

**cta_slide.body** 는 단순 "지금 예약"보다 **인스타 액션 유도형** 이 8배 효과적.

❌ BAD: "프로필 링크 예약" — 프로필 이동 → 링크 → 상품 찾기 3단계 = 90% 이탈
✅ GOOD: "댓글 '보홀' 남기세요, 특가 DM 1초 발송"
       → 댓글 1번 → 자동 DM = 이탈 최소

| 전략 | 예시 body |
|---|---|
| DM 유도 (최고 전환) | "댓글 '예약' 남기세요, 41만9천원 DM 발송" |
| 저장 유도 | "저장 → 공유, 동행에게 알려주세요" |
| 고가 상품 상담 | "DM 상담 1분, 맞춤 견적 즉시 회신" |

## 🏆 Senior 카피 7대 원칙 (현업 피드백 반영)

### [1] H1 어순 — 가격/숫자가 문장 **맨 앞**
❌ BAD: "부산 직항 주말 출발, 솔레아 4박, 419,000원 특가" (가격 뒤)
✅ GOOD: "419,000원 주말 보홀 4박, 부산 직항" (숫자 앞)
✅ BEST: "연차 없이 주말 출발! 부산→보홀 4박 419,000원" (자기관련성 + 숫자)

### [2] 자기관련성 — 타겟을 2인칭으로 직접 호명
hook 헤드라인 또는 H1에 반드시 **1개 이상**:
- "연차 없이" (직장인)
- "주말만 출발" (근무자)
- "첫 동남아" (초보 여행자)
- "부모님 모시고" (효도)
- "커플 여행" (2인)
❌ "보홀 4박5일 패키지" (불특정)
✅ "연차 없이 주말 보홀 4박" (직장인 호명)

### [3] tourist_spot — 감성 수식어 = 구체적 장면 / 시간대 / 온도
❌ "여유로운", "멋진", "아름다운" (전부 generic)
✅ "해질녘 팡라오 해변", "새벽 일출 초콜릿힐", "밤 10시 루프탑 바",
   "30도 한낮 호핑투어", "석양 황금빛 바나산", "물 위 수상 방갈로"
구체 장소명 + 시간·온도·색 중 1개 이상 결합.

### [4] inclusion — 차별점 "이게 다?" 프레이밍
❌ "왕복 항공 + 호텔 4박" (나열, 여행사 언어)
✅ "이 가격에 왕복 항공 + 4박 5성급이라고?" (놀람)
✅ "41만9천원에 이게 다 포함" (가격 앵커 + 가치 강조)
질문형 또는 가격 앵커 헤드라인 + 포함 아이템 쉼표 나열 body.

### [5] detail — 역할 명시 (5가지 중 1개 고정)
detail role 은 모호. 반드시 **하나의 하위 주제**만 다룸:
- 일정표 요약 (1일차 / 2일차 / ...)
- 호텔 스펙 (룸 타입, 편의시설, 전망)
- 항공편 스펙 (항공사, 편명, 시각)
- 주의사항 (여권/비자/환전)
- 차량/가이드 서비스
headline 과 body 가 어느 subtype 인지 드러나게 작성.
❌ "솔레아 코스트 4박 숙박" + "슈페리어 가든뷰, 주말 직항" (호텔+항공 섞임)
✅ "[호텔] 솔레아 슈페리어 가든뷰" + "팡라오 해변 도보 3분, 인피니티 풀"

### [6] CTA — 구체 출발일 + 자리수 + 행동
출발일 데이터 있으면 **날짜 명시**: "5/17, 5/31 잔여 3석"
날짜 없으면 행동+혜택: "댓글 '보홀' → 41만9천원 DM 1초"

### [7] SEO 설명 마감 뉘앙스
❌ "...즐겨보세요" (막연)
✅ "...41만9천원 혜택은 [선착순 20석] 한정. 항공권 오르기 전 지금 예약."
마지막 문장에 **한정·마감·시효** 중 1개.

## V2 슬롯 생성 규칙 (슬롯마다 명시적 역할)

| 슬롯 | 내용 | 제한 | 예시 |
|---|---|---|---|
| eyebrow | 카테고리 태그 (대괄호 OK) | 20자 | "[선착순 20석]", "핵심 혜택", "주요 관광지" |
| headline | 슬라이드 메인 | 15자 | "호캉스 4박5일", "구름 위 다낭" |
| body | 본문 (쉼표 OK) | 40자 | "팁·옵션·쇼핑 0원, 5성급 조식까지" |
| tip | role=tip만 꿀팁 | 80자 | "출발 3개월 전 예약 시 평균 25% 절약" |
| warning | role=warning만 | 80자 | "여권 유효기간 6개월 미만 시 출국 거부" |
| price_chip | hook + cta 필수 | 20자 | "${priceHint || '41만9천원~'}" |
| trust_row | benefit/inclusion | 각 12자 × 3~4개 | ["노팁","노옵션","5성급","전식사"] |
| photo_hint | Pexels 힌트 외 추가 | 100자 | "해질 무렵 팜트리 실루엣" |
| badge | 작은 라벨 | 10자 | "핵심", "TIP", "특가" |
| pexels_keyword | 영문 명사 1~2개 | 40자 | "bohol beach" |
| accent_color | 기본 null | #RRGGBB | null |

## 슬라이드 역할별 카피 설계 (토스 공식 적용)

### Role: hook (1장, 후킹)
- eyebrow: 긴급성 [ ] 필수 — "[선착순 N석]" 또는 "[D-N 마감]" 또는 "[N월 특가]"
- headline: 자기관련성 포함 — "~이신 분 주목" 또는 destination+duration 임팩트 조합
- body: 핵심 혜택 1줄 + 쉼표 가독성 — "A, B, C"
- price_chip: **필수** "${priceHint || '41만9천원~'}"
- trust_row: 3~4개 시그널 (있으면)
- ❌ BAD: headline "다낭 4박5일" / eyebrow "다낭"
- ✅ GOOD: eyebrow "[선착순 20석]" / headline "4박5일 호캉스" / body "팁·옵션·쇼핑 0원, 5성급 포함"

### Role: benefit (핵심 혜택)
- eyebrow: "[0원] 추가비용" 또는 "핵심 혜택" + 대괄호
- headline: 가장 강력한 1가지 혜택 (수치화)
- body: 구체 포함 아이템 쉼표 나열
- trust_row: **필수** 3~4개
- ✅ GOOD: headline "[0원] 추가비용" / body "팁·옵션·쇼핑 전부 포함, 5성급 조식 매일"

### Role: tourist_spot (관광지)
- eyebrow: "주요 관광지" 또는 "[도시] 핵심"
- headline: **감성 수식어 + 장소명**
- body: 구체 체험/특징 쉼표 나열
- ❌ BAD: headline "바나산" / body "바나산 국립공원"
- ✅ GOOD: headline "[구름 위 다낭]" / body "바나산 국립공원, 황금다리 SKY 워크"

### Role: inclusion (포함사항)
- eyebrow: "포함 사항" or "[0원] 포함"
- headline: 가장 가치 높은 포함물
- body: 체크리스트 스타일 쉼표 나열
- trust_row: **필수** 3~4개
- ✅ GOOD: body "왕복항공, 5성급 숙박, 전 식사, 전용차량"

### Role: detail (디테일)
- 일정/스케줄/호텔 등 구체 정보
- headline: 시간·횟수·등급 포함
- body: 실제 이름/장소 구체 언급

### Role: tip (꿀팁, 해당 슬라이드만)
- tip 필드에 실용 팁 1줄 (수치 포함)
- headline: 간결한 질문/후킹

### Role: warning (주의, 해당 슬라이드만)
- warning 필드에 구체 주의사항 (수치·기간 포함)

### Role: cta (마지막, 예약 유도)
- eyebrow: 긴급성 [ ] — "[오늘만]" "[마감 D-3]" "[선착순 N석]"
- headline: 행동 동사 + 감정 — "지금 바로 출발" "놓치면 후회"
- body: 요약 한 줄 + 쉼표
- badge: "지금 예약" 또는 "상담 신청"
- price_chip: **필수**
- trust_row: 3개
- ✅ GOOD: eyebrow "[오늘만]" / headline "지금 예약 놓치지 마세요" / body "팁·옵션 0원, 5성급"

## 출력 JSON 스키마 (정확히 이 형식)
{
  "mode": "${input.mode}",
  "h1": "블로그 H1 (최대 70자, SEO + 클릭 유도)",
  "intro_hook": "인트로 후킹 2~3줄 (100~200자)",
  "target_audience": "구체적 타겟 (예: '30대 커플 3박5일 첫 동남아 여행자', '50대 부모님 효도여행 자녀')",
  "key_selling_points": ["수치 포함 셀링포인트1","2","3"],
  "template_family_suggestion": "editorial|cinematic|premium|bold",
  "sections": [
    {
      "position": 1,
      "h2": "블로그 H2",
      "role": "hook|benefit|detail|tip|warning|tourist_spot|inclusion",
      "blog_paragraph_seed": "블로그 본문 씨앗 2~3줄 (구체 팩트 포함)",
      "card_slide": {
        "headline": "최대 15자",
        "body": "최대 40자",
        "template_suggestion": "${TEMPLATE_IDS[0]}",
        "pexels_keyword": "영문 명사 1~2개",
        "badge": "선택 배지",
        "eyebrow": "[긴급성 또는 카테고리] 최대 20자",
        "tip": "role=tip만, 아니면 null",
        "warning": "role=warning만, 아니면 null",
        "price_chip": "hook이면 '${priceHint || '41만9천원~'}'",
        "trust_row": ["노팁","노옵션","5성급","전식사"],
        "accent_color": null,
        "photo_hint": "사진 분위기 1줄",
        "hook_type": "hook 섹션이면 urgency|question|number|fomo|story 중 1개, 아니면 null",
        "social_proof": "benefit/detail 섹션에 '⭐ 4.9 · 예약 N건' 같은 수치, 없으면 null"
      }
    }
  ],
  "cta_slide": {
    "headline": "행동 유도 15자",
    "body": "마감·혜택 요약 40자 (hook이 question이었으면 여기가 답)",
    "template_suggestion": "${TEMPLATE_IDS[0]}",
    "pexels_keyword": "영문 명사",
    "badge": "지금 예약",
    "eyebrow": "[오늘만] 또는 [마감 D-N]",
    "price_chip": "${priceHint || '41만9천원~'}",
    "trust_row": ["노팁","노옵션","5성급"],
    "social_proof": "⭐ 4.9 · 예약 N건",
    "tip": null, "warning": null, "accent_color": null, "photo_hint": "일몰 커플", "hook_type": null
  },
  "seo": {
    "title": "SEO 타이틀 (10~70자)",
    "description": "SEO 설명 (30~200자)",
    "slug_suggestion": "영문 slug"
  }
}

## 템플릿 ID
${TEMPLATE_LIST}

## 엄격 규칙 (위반 시 카드뉴스 광고 효율 50% 이하)
1. sections 배열은 정확히 ${slideCount - 1}개
2. position은 1부터 순서대로
3. headline 15자, body 40자 엄수
4. **hook + cta 의 eyebrow 에 [대괄호] 긴급성 필수** (예: [선착순 N], [오늘만], [마감 D-N])
5. **headline 은 상품명 단순 복제 금지** — 감성 수식어, 수치, 자기관련성 중 1개 필수
6. **body 는 "완벽한 휴식" 같은 모호한 표현 금지** — 구체 혜택/장소/수치 포함 필수
7. tourist_spot section headline 은 **"[감성 수식어]" 포함 필수**
8. price_chip 은 hook 과 cta 에 반드시. ("${priceHint || '41만9천원~'}")
9. trust_row 는 benefit/inclusion 섹션과 cta 에 반드시 3~4개
10. 박수/일수/가격 팩트 변경 금지
11. JSON만 출력, 마크다운 코드블록 금지

위 11개 규칙 모두 준수해서 JSON 출력.`;
}

/**
 * AI 실패 시 결정론적 Fallback Brief (V2 슬롯 풀 채움)
 */
function fallbackBrief(input: BriefInput): ContentBrief {
  const slideCount = input.slideCount ?? 6;
  const contentCount = slideCount - 1;
  const year = new Date().getFullYear();

  if (input.mode === 'product' && input.product) {
    const p = input.product;
    const nights = p.nights ?? (p.duration ? p.duration - 1 : 0);
    const dur = p.duration ? `${nights}박${p.duration}일` : '';
    const price = p.price ? `${Math.round(p.price / 10000)}만원~` : '';
    const priceChip = p.price ? formatPriceChip(p.price) : null;
    const trustSignals = extractTrustSignals(p);
    const family = deriveFamily(p, input.angle);
    const angleLabel = input.angle && ANGLE_PRESETS[input.angle as keyof typeof ANGLE_PRESETS]
      ? ANGLE_PRESETS[input.angle as keyof typeof ANGLE_PRESETS].label
      : '추천';
    const dest = p.destination || '여행지';
    const firstHighlight = (p.product_highlights ?? ['올인클루시브'])[0] ?? '완벽 포함';
    const firstSpot = (p.itinerary ?? ['알찬 일정'])[0] ?? '핵심 코스';

    type SectionTpl = {
      h2: string;
      role: 'hook' | 'benefit' | 'tourist_spot' | 'inclusion' | 'detail';
      seed: string;
      headline: string;
      body: string;
      eyebrow: string;
      trust?: boolean;
      price?: boolean;
    };
    const sectionTemplates: SectionTpl[] = ([
      {
        h2: `${dest} ${dur} ${angleLabel}`,
        role: 'hook',
        seed: `${dest} ${dur} ${angleLabel} 패키지. 여소남이 엄선한 ${price} 특별가.`,
        headline: `${dest} ${dur}`.slice(0, 15),
        body: `${price} ${angleLabel} 특별가`.slice(0, 40),
        eyebrow: dest,
        price: true,
      },
      {
        h2: `핵심 혜택 · ${angleLabel}`,
        role: 'benefit',
        seed: '주요 포함사항과 차별화 포인트.',
        headline: '핵심 혜택',
        body: firstHighlight.slice(0, 40),
        eyebrow: '핵심 혜택',
        trust: true,
      },
      {
        h2: `일정 하이라이트`,
        role: 'tourist_spot',
        seed: '주요 관광지와 일정 소개.',
        headline: '핵심 일정',
        body: firstSpot.slice(0, 40),
        eyebrow: '주요 관광지',
      },
      {
        h2: `포함 사항 체크리스트`,
        role: 'inclusion',
        seed: '모든 포함 혜택 체크리스트.',
        headline: '포함 사항',
        body: '항공+호텔+식사+관광',
        eyebrow: '포함 사항',
        trust: true,
      },
      {
        h2: `왜 여소남인가`,
        role: 'detail',
        seed: '여소남 플랫폼 신뢰성과 장점.',
        headline: '여소남 선택 이유',
        body: '안심 비교 예약',
        eyebrow: '여소남 신뢰',
      },
    ] as SectionTpl[]).slice(0, contentCount);

    const hookType = deriveHookType(p, input.angle);
    const socialProof = deriveSocialProof(p);
    const ctaBodyText = priceChip
      ? `댓글 '예약' 남기세요, ${priceChip} DM 발송`.slice(0, 40)
      : `댓글 '예약' 남기세요, 특가 DM 발송`.slice(0, 40);

    return {
      mode: 'product',
      h1: `${dest} ${dur} ${angleLabel} 패키지 ${price} | 여소남 ${year}`.slice(0, 70),
      intro_hook: `${dest} ${dur} ${angleLabel} 여행을 찾고 계신가요? 여소남이 제안하는 ${price} 알찬 패키지를 만나보세요.`,
      target_audience: `${angleLabel}를 중시하는 여행객`,
      key_selling_points: (p.product_highlights ?? [`${dest} 필수 코스`, `${dur} 알찬 일정`, '노팁 노옵션']).slice(0, 3),
      template_family_suggestion: family,
      sections: sectionTemplates.map((s, i) => ({
        position: i + 1,
        h2: s.h2,
        role: s.role,
        blog_paragraph_seed: s.seed,
        card_slide: {
          headline: s.headline.slice(0, 15),
          body: s.body.slice(0, 40),
          template_suggestion: TEMPLATE_IDS[0],
          pexels_keyword: dest.replace(/\//g, ' '),
          badge: null,
          eyebrow: s.eyebrow,
          tip: null,
          warning: null,
          price_chip: s.price && priceChip ? priceChip : null,
          trust_row: s.trust && trustSignals.length > 0 ? trustSignals.slice(0, 4) : null,
          accent_color: null,
          photo_hint: `${dest} 풍경`,
          hook_type: s.role === 'hook' ? hookType : null,
          social_proof: (s.role === 'benefit' || s.role === 'detail') ? socialProof : null,
        },
      })),
      cta_slide: {
        headline: '지금 예약하기',
        body: ctaBodyText,
        template_suggestion: TEMPLATE_IDS[0],
        pexels_keyword: 'travel booking',
        badge: p.price && p.price >= 1000000 ? 'DM 상담 1분' : '지금 예약',
        eyebrow: '[오늘만 이 가격]',
        tip: null,
        warning: null,
        price_chip: priceChip,
        trust_row: trustSignals.slice(0, 3).length > 0 ? trustSignals.slice(0, 3) : null,
        accent_color: null,
        photo_hint: `${dest} 일몰 커플`,
        hook_type: null,
        social_proof: socialProof,
      },
      seo: {
        title: `${dest} ${dur} ${angleLabel} 패키지 ${price} | 여소남 ${year}`.slice(0, 70),
        description: `${dest} ${dur} ${angleLabel} 패키지. ${price} 특별가. 여소남에서 안심 비교·예약하세요.`.slice(0, 160),
        slug_suggestion: `${dest.replace(/[\/\s]/g, '-').toLowerCase()}-${dur}-${input.angle || 'travel'}`.replace(/[^a-z0-9가-힣-]/g, '-').slice(0, 80),
      },
    };
  }

  // Info mode fallback
  const topic = input.topic || '여행 정보';
  type InfoTpl = {
    h2: string;
    role: 'hook' | 'benefit' | 'detail' | 'tip' | 'warning';
    seed: string;
    headline: string;
    body: string;
    eyebrow: string;
    tip?: string;
    warning?: string;
  };
  const infoSections: InfoTpl[] = ([
    { h2: `${topic} 핵심 요약`, role: 'hook', seed: `${topic} 핵심 정리.`, headline: topic.slice(0, 15), body: '완벽 가이드', eyebrow: 'OVERVIEW' },
    { h2: '주요 포인트', role: 'benefit', seed: '반드시 알아야 할 주요 사항.', headline: '핵심 포인트', body: '꼭 알아야 할 내용', eyebrow: 'KEY POINTS' },
    { h2: '준비 체크리스트', role: 'detail', seed: '여행 전 준비할 사항.', headline: '준비물', body: '체크리스트', eyebrow: '준비사항' },
    { h2: 'PRO TIP', role: 'tip', seed: '알면 도움 되는 팁.', headline: '꿀팁', body: '실속 꿀팁', eyebrow: 'PRO TIP',
      tip: '여행 3개월 전 예약 시 평균 25% 절약' },
    { h2: '주의사항', role: 'warning', seed: '실수 방지 주의사항.', headline: '주의사항', body: '이것 놓치면 낭패', eyebrow: 'WATCH OUT',
      warning: '여권 유효기간 6개월 미만이면 출국 거부될 수 있음' },
  ] as InfoTpl[]).slice(0, contentCount);

  return {
    mode: 'info',
    h1: `${topic} 완벽 가이드 ${year}`.slice(0, 70),
    intro_hook: `${topic}에 대해 알아야 할 모든 것을 여소남이 정리했습니다.`,
    target_audience: '여행 준비 중인 일반 여행객',
    key_selling_points: ['실용 정보', `최신 ${year} 기준`, '여소남 검증'],
    template_family_suggestion: 'editorial',
    sections: infoSections.map((s, i) => ({
      position: i + 1,
      h2: s.h2,
      role: s.role,
      blog_paragraph_seed: s.seed,
      card_slide: {
        headline: s.headline.slice(0, 15),
        body: s.body.slice(0, 40),
        template_suggestion: TEMPLATE_IDS[1],
        pexels_keyword: 'travel',
        badge: null,
        eyebrow: s.eyebrow,
        tip: s.tip ?? null,
        warning: s.warning ?? null,
        price_chip: null,
        trust_row: null,
        accent_color: null,
        photo_hint: `${topic} 분위기 사진`,
        hook_type: s.role === 'hook' ? 'number' : null,
        social_proof: s.role === 'benefit' ? '✓ 여소남 검증' : null,
      },
    })),
    cta_slide: {
      headline: '여소남과 함께',
      body: "댓글 '여행' 남기세요, DM 상담",
      template_suggestion: TEMPLATE_IDS[1],
      pexels_keyword: 'travel booking',
      badge: 'DM 상담',
      eyebrow: '[지금 시작]',
      tip: null,
      warning: null,
      price_chip: null,
      trust_row: null,
      accent_color: null,
      photo_hint: '여행 시작 분위기',
      hook_type: null,
      social_proof: '✓ 여소남 검증',
    },
    seo: {
      title: `${topic} 완벽 가이드 ${year} | 여소남`.slice(0, 70),
      description: `${topic}에 대한 완벽 가이드. 실용 정보와 팁을 여소남에서 확인하세요.`.slice(0, 160),
      slug_suggestion: topic.toLowerCase().replace(/[^a-z0-9가-힣]/g, '-').replace(/-+/g, '-').slice(0, 80),
    },
  };
}
