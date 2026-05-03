/**
 * 여소남 OS — Mem0 스타일 고객 팩트 추출/회수 엔진
 *
 * 레퍼런스:
 * - Mem0 (mem0ai/mem0): ADD/UPDATE/NOOP 의사결정으로 중복·상충 팩트 관리
 * - Generative Agents (Park+, Stanford 2023): importance 점수 + (recency × importance × relevance) 회수 공식
 * - MemGPT (Packer+, Berkeley 2023): 핫/콜드 티어, access_count 기반 승격
 * - Reflexion (Shinn+, NeurIPS 2023): 실패 루프 자기성찰 → 팩트화 (P2에서 확장 예정)
 *
 * 핵심 설계:
 * 1. 추출 시 기존 팩트를 프롬프트에 노출 → LLM이 ADD/UPDATE/NOOP 직접 결정 (llm-gateway: DeepSeek → Gemini)
 * 2. UPDATE면 기존 팩트를 superseded_by로 마킹 (감사추적 유지)
 * 3. importance는 0~1, 카테고리 기본값 × LLM 가중치로 산출
 * 4. 회수는 importance × recency × access_count 가중치로 TOP-N만 주입
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { llmCall } from '@/lib/llm-gateway';

export type FactCategory =
  | 'mobility' | 'dietary' | 'budget' | 'destination_interest'
  | 'timing' | 'party' | 'preference' | 'history' | 'constraint' | 'other';

const VALID_CATEGORIES: readonly FactCategory[] = [
  'mobility', 'dietary', 'budget', 'destination_interest',
  'timing', 'party', 'preference', 'history', 'constraint', 'other',
];

/** 카테고리별 기본 importance (Generative Agents 스타일) — LLM 출력 없을 때 fallback */
const CATEGORY_IMPORTANCE_DEFAULT: Record<FactCategory, number> = {
  mobility: 0.95,           // 거동 제약은 운영 크리티컬
  dietary: 0.85,            // 알레르기/종교식도 중요
  constraint: 0.85,
  budget: 0.80,
  party: 0.75,
  timing: 0.70,
  destination_interest: 0.60,
  history: 0.60,
  preference: 0.50,
  other: 0.40,
};

type MemoryAction = 'ADD' | 'UPDATE' | 'NOOP';

type ExtractedFact = {
  action: MemoryAction;
  replace_id?: string | null;
  text: string;
  category: FactCategory;
  confidence: number;
  importance?: number;
};

type ExistingFact = {
  id: string;
  fact_text: string;
  category: string;
  importance: number;
};

type ChatMsg = { role: string; content: string };

const FACT_EXTRACT_SYSTEM =
  '당신은 여행사 CRM의 고객 메모리 관리자입니다. 사용자 메시지의 지시만 따르고, JSON 배열만 출력하세요. 다른 설명 텍스트는 금지입니다.';

const EXTRACTION_PROMPT = `대화에서 **재방문 시 기억할 가치가 있는 팩트**를 추출하되, 기존 기억과 충돌/중복을 판단해 적절한 액션을 선택합니다.

## 오늘 날짜: {TODAY}

## 이미 기억하고 있는 팩트
{EXISTING_FACTS}

## 카테고리 (정확히 하나)
- mobility: 거동/건강 제약 (휠체어, 고령, 임산부)
- dietary: 음식 알레르기/선호/종교식
- budget: 예산 범위/가격 민감도
- destination_interest: 관심 목적지
- timing: 여행 시기/휴가 계획
- party: 동행 (인원/가족 구성)
- preference: 숙소/항공/관광 선호
- history: 과거 여행/예약
- constraint: 그 외 중요 제약
- other: 기타 유용한 맥락

## 액션 결정 규칙 (Mem0 패턴)
각 새 팩트에 대해 정확히 하나:
- **ADD**: 완전히 새로운 정보
- **UPDATE**: 기존 팩트를 더 정확/최신 정보로 교체 (예: 예산 50 → 80만원, 인원 4 → 6명). 반드시 replace_id에 교체할 기존 팩트의 id 지정
- **NOOP**: 이미 알고 있거나 사소함 — 무시

## Importance 산출 (0.0 ~ 1.0)
- 0.9+: 운영 크리티컬 (휠체어, 알레르기, 특수식)
- 0.7~0.9: 결정적 (예산, 인원, 여행시기)
- 0.5~0.7: 참고 (숙소 선호, 과거 여행)
- 0.3~0.5: 보조 (취향, 일회성 언급)
- 0.3 미만: NOOP로 버리기

## 추출 원칙
- 일회성 질문/인사는 무시
- 상대 시간은 절대 날짜로 ("다음달" → 오늘 기준 계산)
- confidence < 0.5면 NOOP
- 같은 사실 중복 금지

## 출력 (JSON 배열만)
\`\`\`json
[
  {
    "action": "ADD",
    "text": "어머니 휠체어 필요",
    "category": "mobility",
    "confidence": 0.95,
    "importance": 0.95
  },
  {
    "action": "UPDATE",
    "replace_id": "<기존 팩트의 id>",
    "text": "2026-05 가족 6인 여행 예정",
    "category": "timing",
    "confidence": 0.9,
    "importance": 0.85
  }
]
\`\`\`
아무것도 추출할 게 없으면 \`[]\`.

## 새 대화
{CONVERSATION}`;

function formatExistingFacts(facts: ExistingFact[]): string {
  if (facts.length === 0) return '(없음)';
  return facts
    .map((f) => `- [id: ${f.id}] [${f.category}] ${f.fact_text} (importance: ${f.importance})`)
    .join('\n');
}

async function loadExistingForExtraction(params: {
  conversationId?: string;
  customerId?: string | null;
  tenantId?: string | null;
}): Promise<ExistingFact[]> {
  if (!isSupabaseConfigured) return [];
  const { conversationId, customerId, tenantId } = params;

  let query = supabaseAdmin
    .from('customer_facts')
    .select('id, fact_text, category, importance')
    .eq('is_active', true)
    .is('superseded_by', null)
    .order('importance', { ascending: false })
    .limit(50);

  if (tenantId !== undefined) {
    query = tenantId === null ? query.is('tenant_id', null) : query.eq('tenant_id', tenantId);
  }
  if (customerId) {
    query = query.eq('customer_id', customerId);
  } else if (conversationId) {
    query = query.eq('conversation_id', conversationId);
  } else {
    return [];
  }

  const { data } = await query;
  return (data as ExistingFact[]) ?? [];
}

export async function extractAndStoreFacts(params: {
  conversationId: string;
  customerId?: string | null;
  tenantId?: string | null;
  recentMessages: ChatMsg[];
  sourceMessageIdx?: number;
}): Promise<{ added: number; updated: number; noop: number }> {
  const zero = { added: 0, updated: 0, noop: 0 };
  if (!isSupabaseConfigured) return zero;

  const { conversationId, customerId = null, tenantId = null, recentMessages, sourceMessageIdx } = params;
  if (recentMessages.length < 2) return zero;

  // 1) 기존 팩트 로드 (Mem0 의사결정용)
  const existing = await loadExistingForExtraction({ conversationId, customerId, tenantId });

  // 2) 프롬프트 조립
  const conversationText = recentMessages
    .map((m) => `${m.role === 'user' ? '고객' : '상담원'}: ${m.content}`)
    .join('\n');
  const today = new Date().toISOString().slice(0, 10);
  const prompt = EXTRACTION_PROMPT
    .replace('{TODAY}', today)
    .replace('{EXISTING_FACTS}', formatExistingFacts(existing))
    .replace('{CONVERSATION}', conversationText);

  // 3) LLM 호출 (DeepSeek primary, Gemini fallback)
  let facts: ExtractedFact[];
  try {
    const res = await llmCall({
      task: 'customer-fact-extract',
      systemPrompt: FACT_EXTRACT_SYSTEM,
      userPrompt: prompt,
      temperature: 0.1,
      maxTokens: 2000,
      autoEscalate: false,
    });
    if (!res.success || !res.rawText?.trim()) {
      console.warn('[FactExtractor] LLM 실패:', res.errors?.join('; '));
      return zero;
    }
    const cleaned = res.rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    facts = JSON.parse(cleaned);
  } catch (e) {
    console.warn('[FactExtractor] 호출/파싱 실패:', e);
    return zero;
  }

  if (!Array.isArray(facts) || facts.length === 0) return zero;

  // 4) 유효성 필터
  const valid = facts.filter((f): f is ExtractedFact => {
    if (!f || typeof f !== 'object') return false;
    if (!['ADD', 'UPDATE', 'NOOP'].includes(f.action)) return false;
    if (f.action === 'NOOP') return true;
    return (
      typeof f.text === 'string' && f.text.trim().length > 0 &&
      VALID_CATEGORIES.includes(f.category as FactCategory) &&
      typeof f.confidence === 'number' && f.confidence >= 0.5
    );
  });

  const noopCount = valid.filter((f) => f.action === 'NOOP').length;
  const writable = valid.filter((f) => f.action !== 'NOOP');
  if (writable.length === 0) return { added: 0, updated: 0, noop: noopCount };

  // 5) importance 결정 (LLM 값 우선, 없으면 카테고리 기본값)
  const existingIdSet = new Set(existing.map((e) => e.id));
  let added = 0;
  let updated = 0;

  for (const fact of writable) {
    const importance =
      typeof fact.importance === 'number'
        ? Math.min(1, Math.max(0, fact.importance))
        : CATEGORY_IMPORTANCE_DEFAULT[fact.category];

    const newRow = {
      tenant_id: tenantId,
      customer_id: customerId,
      conversation_id: conversationId,
      fact_text: fact.text.trim(),
      category: fact.category,
      confidence: Math.min(1, Math.max(0, fact.confidence)),
      importance,
      source_message_idx: sourceMessageIdx ?? null,
    };

    try {
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('customer_facts')
        .insert(newRow)
        .select('id')
        .limit(1);

      if (insertErr) {
        console.warn('[FactExtractor] insert 실패:', insertErr.message);
        continue;
      }

      const newId = (inserted as Array<{ id: string }>)?.[0]?.id;

      if (fact.action === 'UPDATE' && fact.replace_id && existingIdSet.has(fact.replace_id) && newId) {
        // 기존 팩트를 superseded_by로 마킹 — 감사추적 유지
        await supabaseAdmin
          .from('customer_facts')
          .update({ superseded_by: newId, is_active: false })
          .eq('id', fact.replace_id);
        updated++;
      } else {
        added++;
      }
    } catch (e) {
      console.warn('[FactExtractor] upsert 예외:', e);
    }
  }

  return { added, updated, noop: noopCount };
}

/**
 * 회수: Generative Agents 공식 근사
 *   score = importance * recency_weight * (1 + log(1 + access_count))
 * DB에서 직접 ORDER BY 로 근사 — importance × is_active × 최근성.
 * access_count 업데이트는 회수 직후 비동기 (레이스 허용).
 */
export async function loadActiveFacts(params: {
  conversationId?: string;
  customerId?: string;
  tenantId?: string | null;
  limit?: number;
  minImportance?: number;
}): Promise<string[]> {
  if (!isSupabaseConfigured) return [];
  const { conversationId, customerId, tenantId, limit = 20, minImportance = 0.4 } = params;
  if (!conversationId && !customerId) return [];

  let query = supabaseAdmin
    .from('customer_facts')
    .select('id, fact_text, category, importance, extracted_at, access_count')
    .eq('is_active', true)
    .is('superseded_by', null)
    .gte('importance', minImportance)
    .order('importance', { ascending: false })
    .order('extracted_at', { ascending: false })
    .limit(limit);

  if (tenantId !== undefined) {
    query = tenantId === null ? query.is('tenant_id', null) : query.eq('tenant_id', tenantId);
  }
  if (customerId) {
    query = query.eq('customer_id', customerId);
  } else if (conversationId) {
    query = query.eq('conversation_id', conversationId);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const rows = data as Array<{
    id: string; fact_text: string; category: string; importance: number;
  }>;

  // access_count 업데이트 (fire-and-forget — MemGPT 핫 승격)
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    void supabaseAdmin.rpc('bump_customer_facts_access', { fact_ids: ids }).then(
      undefined,
      () => {
        // RPC 없으면 조용히 무시 (v1에선 옵션)
      },
    );
  }

  return rows.map((row) => `[${row.category}] ${row.fact_text}`);
}
