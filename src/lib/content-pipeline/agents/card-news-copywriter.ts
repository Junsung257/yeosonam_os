/**
 * Card News Copywriter Agent
 *
 * 역할: structure-designer 가 확정한 구조에 **슬라이드 카피만** 채워넣음.
 *
 * 입력: StructureOutput (sections role/h2/hook_type 결정됨) + product
 * 출력: 각 section.card_slide + cta_slide (V2 슬롯 전체 채움)
 *
 * 이 에이전트는 오직 카피라이팅에만 집중:
 *   - headline (≤15자)
 *   - body (≤40자)
 *   - eyebrow (긴급성 대괄호)
 *   - trust_row, price_chip, social_proof, tip, warning
 *   - 토스 CTR + AIDA + Senior 7대 원칙 내재화
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { CardSlideV2Schema } from '@/lib/validators/content-brief';
import { TEMPLATE_IDS } from '@/lib/card-news/tokens';
import { BLOG_AI_MODEL } from '@/lib/prompt-version';
import type { StructureOutput, StructureInput } from './structure-designer';

/** Copywriter 출력: section 별 card_slide + cta_slide */
export const CardCopyOutputSchema = z.object({
  sections: z.array(z.object({
    position: z.number().int().min(1),
    card_slide: CardSlideV2Schema,
  })),
  cta_slide: CardSlideV2Schema,
});

export type CardCopyOutput = z.infer<typeof CardCopyOutputSchema>;

/**
 * Copywriter — structure 를 받아 슬라이드 카피를 채움
 */
export async function writeCardCopy(
  structure: StructureOutput,
  input: StructureInput,
): Promise<CardCopyOutput> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.warn('[card-copy] GOOGLE_AI_API_KEY 없음 → fallback');
    return fallbackCopy(structure, input);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: BLOG_AI_MODEL,
    generationConfig: { temperature: 0.75, responseMimeType: 'application/json' },
  });

  const prompt = buildCopywriterPrompt(structure, input);

  const tryGenerate = async (extra = ''): Promise<CardCopyOutput | null> => {
    try {
      const result = await model.generateContent(prompt + extra);
      const text = result.response.text().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      const jsonStr = match ? match[0] : text;
      const parsed = JSON.parse(jsonStr);
      const checked = CardCopyOutputSchema.safeParse(parsed);
      if (!checked.success) {
        console.warn('[card-copy] 스키마 검증 실패:', checked.error.errors.slice(0, 3));
        return null;
      }
      return checked.data;
    } catch (err) {
      console.warn('[card-copy] 호출/파싱 실패:', err instanceof Error ? err.message : err);
      return null;
    }
  };

  const first = await tryGenerate();
  if (first) return first;

  const retry = await tryGenerate(`\n\n## 재시도 — 글자수 엄수. headline 15자 이하, body 40자 이하.`);
  if (retry) return retry;

  return fallbackCopy(structure, input);
}

function buildCopywriterPrompt(structure: StructureOutput, input: StructureInput): string {
  const priceChip = input.product?.price ? formatPriceChip(input.product.price) : '';
  const dest = input.product?.destination ?? '';

  // 섹션 요약 (copywriter 는 role/hook_type/h2 만 알면 됨)
  const sectionBrief = structure.sections.map((s) => {
    const hookNote = s.role === 'hook' && s.hook_type
      ? ` [hook_type=${s.hook_type}]`
      : '';
    return `  ${s.position}. [${s.role}]${hookNote} ${s.h2}`;
  }).join('\n');

  return `너는 **인스타그램 카드뉴스 성과형 카피라이터 10년차**다. 구조는 이미 확정됐다. **슬라이드 카피만** 작성한다.

## 상품 정보
${input.product ? `- 상품명: ${input.product.title}
- 목적지: ${dest}
- 가격: ${priceChip || (input.product.price ? input.product.price.toLocaleString() + '원~' : '')}
- 기간: ${input.product.duration ? `${(input.product.nights ?? input.product.duration - 1)}박${input.product.duration}일` : ''}
- 하이라이트: ${(input.product.product_highlights ?? []).slice(0, 3).join(', ')}
- 요약: ${input.product.product_summary ?? ''}` : `- 주제: ${input.topic}`}

- target_audience: ${structure.target_audience}
- key_selling_points: ${structure.key_selling_points.join(', ')}

## 확정된 슬라이드 구조 (각 섹션에 카피 채워넣기)
${sectionBrief}

## ⚡ 카피 공식 (필수 체화)

### A. 토스 CTR 4공식
- 긴급성: [선착순 N석] [오늘만] [마감 D-N]
- 자기관련성: ~이신 분, ~이라면, 연차 없이, 주말만
- 혜택성: [0원] [5성급] [팁·옵션·쇼핑 0]
- 구체성: "바나산" → "[구름 위 판타지] 바나산"

### B. hook_type 별 헤드라인 규칙
- urgency:    eyebrow=[선착순 N석] / headline=간결 상품+기간 / price_chip 필수
- question:   eyebrow=진짜 최저가? / headline="목적지 N박, 얼마?" / body="답은 마지막에"
- number:     eyebrow=TOP N / headline="목적지 N박 꿀팁 N가지"
- fomo:       eyebrow=[이번 주만] / headline=한정 재고 강조
- story:      eyebrow=REAL STORY / headline=1인칭 스토리 시작
- contrarian: eyebrow=[반전] 또는 [실화] / headline=상식 정면 반박 ("보홀은 비싸다는 거짓말") / body=근거 1줄

### C. 슬라이드 유형별 카피
- benefit: "이 가격에 이게 다?" 놀람 프레이밍 + trust_row 3~4개
- tourist_spot: "[감성 수식어] 장소명" (시간·온도·색 중 1개) 예: "해질녘 팡라오 해변"
- inclusion: "[0원] 포함" + 아이템 쉼표 나열
- detail: 호텔/항공/주의/차량 중 1개 subtype 고정
- tip: eyebrow=PRO TIP, tip 필드에 80자 팁
- warning: eyebrow=WATCH OUT, warning 필드에 80자 주의
- objection (V4): eyebrow=[의심 해소] / headline=고객 속내 ("이거 싼 게 비지떡?") / body=약관·포함사항 근거 1줄 방어
- save_hook (V4): eyebrow=[체크리스트] / headline="저장해두고 보는 OOO N" / body=4~5개 항목 쉼표 나열 / badge="SAVE"
- cta: eyebrow=[오늘만] 긴급성, body=**DM 마이크로 커밋먼트** (결제 강요 금지. "댓글 'O' 남기면 일정표 DM" 형식)

### D. 작성 제약
- headline ≤ 15자
- body ≤ 40자
- eyebrow ≤ 20자 (대괄호 포함)
- trust_row 각 ≤ 12자, 배열 3~4개 (benefit/inclusion 섹션 필수)
- price_chip = "${priceChip}" (hook/benefit/cta 필수, 나머지 null)
- social_proof = "★ 4.9 · 예약 N건" 같은 수치 (benefit/detail 에 추천)
- photo_hint 한국어 1줄 (100자)

### E. V4 글로벌 베스트프랙티스 (필수 준수)

**1. Open-loop (스와이프 강제)**
각 슬라이드 body 끝을 마침표로 끝내지 말고 **"…"** 로 끊어 다음 장으로 유도.
예: 1장 "호구 안 잡히려면…" → 2장 "이 3가지만 기억"
마지막 슬라이드(cta)만 예외.

**2. 금지어 리스트 (네거티브 프롬프팅)**
다음 단어·표현 절대 사용 금지 — AI 티 나는 진부한 표현:
- 형용사: "매력적인 / 아름다운 / 특별한 / 완벽한 / 잊지 못할 / 환상적인 / 놀라운 / 인상적인"
- 문구: "놓치지 마세요 / 지금 바로 / 절대 후회 없는"
- 거짓 경험: "다녀왔는데 / 가봤어요 / 직접 체크했어요"
대신: **숫자, 구체적 장소명, 감각 묘사(온도·색·시간·소리)** 만 사용.

**3. 1 슬라이드 1 아이디어**
한 슬라이드에 핵심 메시지 1개만. 혜택 3개면 슬라이드 3개로 쪼갤 것.

**4. Bionic reading 힌트 (photo_hint 활용)**
photo_hint 필드 맨 끝에 "BOLD:단어1,단어2" 형식으로 1~2개 강조할 단어 표기.
예: photo_hint="팡라오 일몰, 투명한 에메랄드빛 / BOLD:일몰,에메랄드빛"

**5. 쉬운 단어만**
한자어·업계용어 금지 ("체크아웃" OK / "이용료 정산" 금지). 초등 5학년이 1초 만에 이해 수준. 한 문장 어절 8개 이하.

**6. CTA 마이크로 커밋먼트 고정**
마지막 cta 슬라이드는 반드시 **DM 유도** (결제 압박 금지). badge="DM 받기" 고정.
body 템플릿: "댓글 '[키워드]' → DM 발송" (결제/예약 링크 금지)

## 출력 JSON (정확히 이 형식)
{
  "sections": [
    {
      "position": 1,
      "card_slide": {
        "headline": "",
        "body": "",
        "template_suggestion": "${TEMPLATE_IDS[0]}",
        "pexels_keyword": "영문",
        "badge": null,
        "eyebrow": "",
        "tip": null,
        "warning": null,
        "price_chip": null,
        "trust_row": null,
        "accent_color": null,
        "photo_hint": null,
        "hook_type": null,
        "social_proof": null
      }
    }
  ],
  "cta_slide": {
    "headline": "",
    "body": "댓글 '예약' 남기세요, ${priceChip || '특가'} DM 발송",
    "template_suggestion": "${TEMPLATE_IDS[0]}",
    "pexels_keyword": "영문",
    "badge": "DM 받기",
    "eyebrow": "[오늘만]",
    "tip": null,
    "warning": null,
    "price_chip": "${priceChip}",
    "trust_row": ["노팁","노옵션","5성급"],
    "accent_color": null,
    "photo_hint": "일몰 커플",
    "hook_type": null,
    "social_proof": null
  }
}

## 엄격
1. sections 배열 정확히 ${structure.sections.length}개, position 순서
2. 각 section 의 hook_type 을 structure 에서 그대로 복사
3. JSON 만 출력
4. 박수/일수/가격 팩트 변경 금지`;
}

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

/** 결정론적 fallback — AI 실패 시 section 별 generic 카피 */
function fallbackCopy(structure: StructureOutput, input: StructureInput): CardCopyOutput {
  const priceChip = input.product?.price ? formatPriceChip(input.product.price) : '';
  const dest = input.product?.destination ?? '';
  const trustDefault = extractTrustSignalsSimple(input.product);

  const sections = structure.sections.map((s) => {
    const slide = {
      headline: (s.h2 || `[${s.role}]`).slice(0, 15),
      body: (input.product?.product_summary ?? '여소남 추천 여행').slice(0, 40),
      template_suggestion: s.template_suggestion,
      pexels_keyword: s.pexels_keyword,
      badge: null as string | null,
      eyebrow: (s.role === 'hook' ? `[${dest || '여행'}]` : s.h2).slice(0, 20),
      tip: s.role === 'tip' ? '출발 3개월 전 예약 시 평균 25% 절약' : null,
      warning: s.role === 'warning' ? '여권 유효기간 6개월 이상 필수' : null,
      price_chip: (s.role === 'hook' || s.role === 'benefit') ? priceChip || null : null,
      trust_row: (s.role === 'benefit' || s.role === 'inclusion') && trustDefault.length > 0 ? trustDefault.slice(0, 4) : null,
      accent_color: null,
      photo_hint: `${dest} 분위기`,
      hook_type: s.hook_type ?? null,
      social_proof: (s.role === 'benefit' || s.role === 'detail') ? '✓ 여소남 검증' : null,
    };
    return { position: s.position, card_slide: slide };
  });

  const cta = {
    headline: '지금 예약하기',
    body: priceChip ? `댓글 '예약' 남기세요, ${priceChip} DM 발송`.slice(0, 40) : `댓글 '예약' 남기세요, 특가 DM 발송`,
    template_suggestion: structure.cta_meta.template_suggestion,
    pexels_keyword: structure.cta_meta.pexels_keyword,
    badge: input.product?.price && input.product.price >= 1_000_000 ? 'DM 상담 1분' : 'DM 받기',
    eyebrow: '[오늘만 이 가격]',
    tip: null,
    warning: null,
    price_chip: priceChip || null,
    trust_row: trustDefault.slice(0, 3).length > 0 ? trustDefault.slice(0, 3) : null,
    accent_color: null,
    photo_hint: `${dest} 일몰 커플`,
    hook_type: null,
    social_proof: '✓ 여소남 검증',
  };

  return { sections, cta_slide: cta };
}

function extractTrustSignalsSimple(p: StructureInput['product']): string[] {
  if (!p) return [];
  const haystack = [p.title, p.product_summary, p.special_notes, ...(p.inclusions ?? []), ...(p.product_highlights ?? [])].filter(Boolean).join(' ');
  const signals: string[] = [];
  const rules: Array<[RegExp, string]> = [
    [/노\s*팁/i, '노팁'],
    [/노\s*옵션/i, '노옵션'],
    [/노\s*쇼핑/i, '노쇼핑'],
    [/5\s*성급|파이브\s*스타|5\*/i, '5성급'],
    [/전\s*식사|전식|호텔\s*조식/i, '전식사'],
    [/과일\s*도시락/i, '과일도시락'],
    [/왕복\s*항공/i, '왕복항공'],
    [/마사지/i, '마사지'],
  ];
  for (const [re, label] of rules) {
    if (re.test(haystack) && !signals.includes(label)) signals.push(label);
    if (signals.length >= 4) break;
  }
  return signals;
}
