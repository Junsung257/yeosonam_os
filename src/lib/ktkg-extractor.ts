/**
 * KTKG Extractor — PII-stripped 카톡 대화 → entity·aspect·sentiment·demographic 트리플 + booking draft.
 *
 * V3 (2026-05-01): DeepSeek V4-Pro + Zod feedback loop (callWithZodValidation).
 * 입력은 반드시 redactKoreanPII 통과 후. 이 함수는 raw PII를 보지 않는 설계.
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { callWithZodValidation } from './llm-validate-retry';

const ENTITY_TYPES = [
  'hotel', 'tour', 'attraction', 'airline', 'restaurant',
  'activity', 'destination', 'land_operator', 'package',
] as const;

const SENTIMENT_LABELS = ['positive', 'negative', 'neutral', 'mixed', 'concern'] as const;
type SentimentLabel = typeof SENTIMENT_LABELS[number];

// LLM이 출력하는 비표준 sentiment 변형을 표준으로 매핑
const SENTIMENT_ALIASES: Record<string, SentimentLabel> = {
  slightly_positive: 'positive',
  very_positive: 'positive',
  somewhat_positive: 'positive',
  slightly_negative: 'negative',
  very_negative: 'negative',
  somewhat_negative: 'negative',
  worried: 'concern',
  anxious: 'concern',
  uncertain: 'mixed',
};
function normalizeSentimentLabel(val: unknown): SentimentLabel | null {
  if (val == null || typeof val !== 'string') return null;
  const v = val.toLowerCase().trim().replace(/[\s-]/g, '_');
  if ((SENTIMENT_LABELS as readonly string[]).includes(v)) return v as SentimentLabel;
  return SENTIMENT_ALIASES[v] ?? null;
}

const DEMOGRAPHICS = [
  'honeymoon', 'family_with_toddler', 'family_with_kids', 'family_with_teens',
  'senior', 'friend_group', 'solo', 'business', 'three_generation',
] as const;
type Demographic = typeof DEMOGRAPHICS[number];

// 자유 형식 demographic 설명 → 표준 enum 매핑
const DEMOGRAPHIC_KEYWORDS: Array<[RegExp, Demographic]> = [
  [/신혼|허니문|honeymoon/i, 'honeymoon'],
  [/영아|영유아|유아|toddler|infant|개월/i, 'family_with_toddler'],
  [/아동|초등|어린이|kids|child/i, 'family_with_kids'],
  [/청소년|중학|고등|teen/i, 'family_with_teens'],
  [/시니어|노인|어르신|senior|부모님/i, 'senior'],
  [/친구|friend|동기|지인/i, 'friend_group'],
  [/혼자|solo|혼행|1인/i, 'solo'],
  [/비즈|출장|business/i, 'business'],
  [/3대|삼대|three_generation|할머니|할아버지/i, 'three_generation'],
  [/가족|family/i, 'family_with_kids'],  // 기본 가족 fallback
];
function normalizeDemographic(val: unknown): Demographic | null {
  if (val == null || typeof val !== 'string') return null;
  const v = val.toLowerCase().trim();
  if ((DEMOGRAPHICS as readonly string[]).includes(v)) return v as Demographic;
  for (const [pattern, label] of DEMOGRAPHIC_KEYWORDS) {
    if (pattern.test(v)) return label;
  }
  return null;
}

const PHASES = [
  'pre_inquiry', 'objection', 'decision_driver', 'price_negotiation',
  'booking', 'decided', 'mid_trip', 'post_trip',
  'failure', 'praise', 'cancellation', 'follow_up',
] as const;

type Phase = typeof PHASES[number];

const PHASE_ALIASES: Record<string, Phase> = {
  booked: 'decided',
  inquiry: 'pre_inquiry',
  inquiring: 'pre_inquiry',
  cancelled: 'cancellation',
  cancel: 'cancellation',
  paying: 'booking',
  paid: 'decided',
  negotiation: 'price_negotiation',
  decision: 'decision_driver',
};

function normalizePhase(val: unknown): Phase | null {
  if (val == null || typeof val !== 'string') return null;
  const v = val.toLowerCase().trim();
  if ((PHASES as readonly string[]).includes(v)) return v as Phase;
  return PHASE_ALIASES[v] ?? null;
}

const BOOKING_STATUSES = ['inquiry', 'pending', 'waiting_deposit', 'deposit_paid', 'waiting_balance', 'fully_paid', 'cancelled'] as const;
type BookingStatus = typeof BOOKING_STATUSES[number];
const BOOKING_STATUS_ALIASES: Record<string, BookingStatus> = {
  booked: 'deposit_paid',
  paid: 'fully_paid',
  completed: 'fully_paid',
  paying: 'waiting_deposit',
  cancel: 'cancelled',
};
function normalizeBookingStatus(val: unknown): BookingStatus | null {
  if (val == null || typeof val !== 'string') return null;
  const v = val.toLowerCase().trim();
  if ((BOOKING_STATUSES as readonly string[]).includes(v)) return v as BookingStatus;
  return BOOKING_STATUS_ALIASES[v] ?? null;
}

const CONVERSATION_PHASES = ['inquiry_only', 'negotiation', 'booking_in_progress', 'booked', 'post_trip', 'cancelled'] as const;
type ConversationPhase = typeof CONVERSATION_PHASES[number];
const CONVERSATION_PHASE_ALIASES: Record<string, ConversationPhase> = {
  inquiry: 'inquiry_only',
  pre_inquiry: 'inquiry_only',
  decision_driver: 'negotiation',
  price_negotiation: 'negotiation',
  objection: 'negotiation',
  booking: 'booking_in_progress',
  decided: 'booked',
  paid: 'booked',
  completed: 'post_trip',
  cancel: 'cancelled',
  cancellation: 'cancelled',
};
function normalizeConversationPhase(val: unknown): ConversationPhase | null {
  if (val == null || typeof val !== 'string') return null;
  const v = val.toLowerCase().trim();
  if ((CONVERSATION_PHASES as readonly string[]).includes(v)) return v as ConversationPhase;
  return CONVERSATION_PHASE_ALIASES[v] ?? null;
}

export const KtkgTripleSchema = z.object({
  entity_name: z.string().min(1).max(120),
  entity_type: z.enum(ENTITY_TYPES),
  aspect: z.string().max(40).nullable(),
  sentiment_score: z.number().min(-3).max(3),
  sentiment_label: z.enum(SENTIMENT_LABELS),
  demographic: z.enum(DEMOGRAPHICS).nullable(),
  phase: z.string().nullable(),
  snippet: z.string().max(200),
  confidence: z.number().min(0).max(1),
  source_message_idx: z.number().int().nonnegative().nullable(),
});

export const BookingDraftSchema = z.object({
  destination: z.string().nullable(),
  departure_region: z.string().nullable(),
  departure_date: z.string().nullable(),
  return_date: z.string().nullable(),
  duration_nights: z.number().int().nullable(),
  adult_count: z.number().int().nullable(),
  child_count: z.number().int().nullable(),
  unit_price_krw: z.number().int().nullable(),
  total_price_krw: z.number().int().nullable(),
  deposit_krw: z.number().int().nullable(),
  balance_krw: z.number().int().nullable(),
  status: z.string().nullable(),
  land_operator_hint: z.string().nullable(),
  product_title_hint: z.string().nullable(),
  passenger_names_count: z.number().int().nullable(),
  notes: z.string().nullable(),
});

export const ExtractionResultSchema = z.object({
  triples: z.array(KtkgTripleSchema).max(50),
  booking_draft: BookingDraftSchema.nullable(),
  detected_demographic: z.enum(DEMOGRAPHICS).nullable(),
  conversation_phase: z.string().nullable(),
  summary: z.string().max(500),
});

export type KtkgTriple = z.infer<typeof KtkgTripleSchema>;
export type BookingDraft = z.infer<typeof BookingDraftSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

const SYSTEM_PROMPT = `당신은 한국 여행사의 카카오톡 상담 대화를 분석해 (1) entity-aspect-sentiment 트리플과 (2) 예약 draft 를 추출하는 전문 NLP 분석가다.

엄격한 규칙:
1. **PII는 이미 [PHONE], [NAME], [PASSPORT], [ACCOUNT], [EMAIL] 로 마스킹되어 있다. 마스킹 토큰을 entity 로 추출하지 마라.**
2. **추측 금지** — 원문에 명시된 정보만 추출. 환각하면 즉시 실격.
3. entity_type 9종 (hotel/tour/attraction/airline/restaurant/activity/destination/land_operator/package) 중 정확히 1개.
4. sentiment_score: -3 (매우 부정) ~ +3 (매우 긍정), 0=neutral. 사실 진술은 0.
5. snippet 은 원문에서 30~80자 범위로 인용 (PII 마스킹 토큰 포함 OK).
6. booking_draft 의 모든 금액은 KRW 정수. 명시 안 된 필드는 null.
7. 출력은 순수 JSON (코드펜스 금지).

**🚨 sentiment_label — 반드시 아래 5종 중 정확히 1개:**
  positive | negative | neutral | mixed | concern
  → "slightly_positive", "slightly_negative", "very_positive" 등 변형 절대 금지.
  → 약한 긍정은 positive (score +0.5~+1), 약한 부정은 negative (score -0.5~-1) 로 표현.

**🚨 demographic — 반드시 아래 9종 중 정확히 1개 또는 null:**
  honeymoon | family_with_toddler | family_with_kids | family_with_teens | senior | friend_group | solo | business | three_generation
  → "유아 동반", "성인 4명", "유아 포함 가족" 등 자유 형식 문자열 절대 금지.
  → 유아(만 2세 미만) 포함 가족 → family_with_toddler
  → 소아(만 2~12세) 포함 가족 → family_with_kids
  → 단서 없으면 null.

**phase 와 conversation_phase 는 다른 컨셉이다 — 절대 혼용 금지:**

phase (트리플 단위, 메시지 차원):
  - pre_inquiry: 문의 단계 ("자리 있나요", "얼마예요")
  - objection: 거절 요인 ("팁 부담돼요")
  - decision_driver: 결정에 영향 준 요소 ("발권 임박이라 결정")
  - price_negotiation: 가격 조율 협상
  - booking: 예약 확정 의사 표현 시점 ("예약확정할게요")
  - decided: 입금 후 확정된 상태 ("이체했습니다")
  - mid_trip: 여행 중
  - post_trip: 여행 후
  - failure: 부정적 후기·실패 사례
  - praise: 칭찬·만족 사례
  - cancellation: 취소 시점
  - follow_up: 사후 문의 (현금영수증 등)

conversation_phase (대화 전체 단위, 한 통의 카톡 전체가 어느 단계인가):
  - inquiry_only: 문의만 하고 끝남
  - negotiation: 협상·고민 단계 (계약금 미입금)
  - booking_in_progress: 예약 진행 중 (계약금 입금 후 잔금 전)
  - booked: 잔금까지 완납
  - post_trip: 여행 후
  - cancelled: 취소

**올바른 enum 값만 사용. 잘못된 값 ('booked' 을 phase 에, 'decision_driver' 를 conversation_phase 에 넣는 등) 절대 금지.**`;

const USER_PROMPT_TEMPLATE = `다음은 PII가 이미 제거된 카카오톡 대화 전문이다.
대화에서 entity-aspect-sentiment 트리플 + 예약 draft 를 추출하라.

대화 시작 ▼
{{CONVERSATION}}
대화 끝 ▲

출력 schema:
{
  "triples": [
    {
      "entity_name": "치앙마이",
      "entity_type": "destination",
      "aspect": null,
      "sentiment_score": 0,
      "sentiment_label": "neutral",
      "demographic": null,
      "phase": "pre_inquiry",
      "snippet": "5월14일 치앙마이 노팁노옵션가로 잔여석있을까요",
      "confidence": 0.95,
      "source_message_idx": 1
    }
  ],
  "booking_draft": {
    "destination": "치앙마이",
    "departure_region": "부산",
    "departure_date": "2026-05-07",
    "return_date": null,
    "duration_nights": 3,
    "adult_count": 2,
    "child_count": 0,
    "unit_price_krw": 619000,
    "total_price_krw": 1238000,
    "deposit_krw": 400000,
    "balance_krw": 838000,
    "status": "fully_paid",
    "land_operator_hint": null,
    "product_title_hint": "치앙마이 골든트라이앵글 3박5일",
    "passenger_names_count": 2,
    "notes": "노팁노옵션, 가이드팁 50달러, 김해 미팅"
  },
  "detected_demographic": null,
  "conversation_phase": "booked",
  "summary": "5/14→5/7 변경 후 619K x 2 = 1,238,000원 완납. 부산 출발 치앙마이 3박5일."
}`;

function getDeepSeek(): OpenAI {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY 미설정 — KTKG 추출 불가');
  }
  return new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' });
}

export interface ExtractKtkgArgs {
  redactedConversation: string;
  label?: string;
  model?: string;
}

export async function extractKtkg(args: ExtractKtkgArgs): Promise<ExtractionResult> {
  const client = getDeepSeek();
  const model = args.model ?? 'deepseek-v4-pro';
  const userPrompt = USER_PROMPT_TEMPLATE.replace('{{CONVERSATION}}', args.redactedConversation);

  const result = await callWithZodValidation({
    label: args.label ?? 'ktkg-extract',
    schema: ExtractionResultSchema,
    maxAttempts: 3,
    fn: async (feedback) => {
      const finalUser = feedback ? `${userPrompt}\n${feedback}` : userPrompt;
      const response = await client.chat.completions.create({
        model,
        max_tokens: 4096,
        temperature: 0.1,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: finalUser },
        ],
        response_format: { type: 'json_object' },
      });
      return response.choices?.[0]?.message?.content || '';
    },
  });

  if (!result.success) {
    const reason = result.attemptErrors?.join(' | ') ?? (result.error instanceof Error ? result.error.message : 'unknown');
    throw new Error(`KTKG 추출 실패: ${reason}`);
  }
  const normalized = result.value;
  return {
    ...normalized,
    triples: normalized.triples.map(t => ({
      ...t,
      phase: normalizePhase(t.phase),
      sentiment_label: normalizeSentimentLabel(t.sentiment_label) ?? 'neutral',
      demographic: normalizeDemographic(t.demographic),
    })),
    booking_draft: normalized.booking_draft
      ? { ...normalized.booking_draft, status: normalizeBookingStatus(normalized.booking_draft.status) }
      : null,
    conversation_phase: normalizeConversationPhase(normalized.conversation_phase),
    detected_demographic: normalizeDemographic(normalized.detected_demographic),
  };
}

export function normalizeEntityKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(/[·\-_,.()[\]]/g, '');
}

export function hashSnippet(snippet: string): string {
  let h = 5381;
  for (let i = 0; i < snippet.length; i++) {
    h = ((h << 5) + h) + snippet.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16);
}
