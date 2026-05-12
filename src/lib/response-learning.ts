/**
 * 응답 품질 학습 모듈 (Phase 2 — Closed Loop)
 *
 * 적재만 되던 critique/feedback 데이터를 다음 LLM 호출에 다시 흘려보냅니다.
 *
 *   ┌──────────┐    INSERT    ┌──────────────────┐    SELECT(active)    ┌─────────────┐
 *   │ QA chat  │ ──critique──▶│ critique_results │ ─────────────────────│  buildXxx() │
 *   │ jarvis   │ ──feedback──▶│ response_feedback│                       │ Few-shot 주입│
 *   │ admin UI │ ──fix──────▶│ response_corrections│                    └─────────────┘
 *   └──────────┘              └──────────────────┘
 *
 * 모든 INSERT 는 fire-and-forget. SELECT 는 5분 메모리 캐시 (모듈 단위).
 */

import { supabaseAdmin, isSupabaseConfigured } from './supabase';
import { createHash } from 'node:crypto';

// ─── 공통 유틸 ──────────────────────────────────────────────────

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** PII 위험 영역 마스킹 — 응답 보존 시 사용 */
function redactPII(text: string): string {
  if (!text) return text;
  return text
    .replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g, '[전화]')
    .replace(/\d{6}[-\s]?[1-4]\d{6}/g, '[주민]')
    .replace(/\d{2,4}[-\s]\d{2,4}[-\s]\d{2,4}/g, '[전화/번호]')
    .replace(/[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[이메일]');
}

// ─── critique_results INSERT ────────────────────────────────────

export interface RecordCritiqueInput {
  source: 'qa_chat' | 'jarvis_v1' | 'jarvis_v2' | 'card_news' | 'blog' | 'free_travel' | 'other';
  sessionId?: string | null;
  conversationId?: string | null;
  traceId?: string | null;
  agentTaskId?: string | null;
  tenantId?: string | null;
  affiliateId?: string | null;
  llmProvider?: string | null;
  llmModel?: string | null;
  severity: 'ok' | 'warn' | 'block';
  issues: string[];
  userQuestion: string;
  reply: string;
  correctedReply?: string | null;
  wasGated: boolean;
  metadata?: Record<string, unknown>;
}

export async function recordCritiqueResult(input: RecordCritiqueInput): Promise<void> {
  if (!isSupabaseConfigured) return;
  // ok 신호의 적재량은 매우 크므로 샘플링 (10%). warn/block 은 전부 저장.
  if (input.severity === 'ok' && Math.random() > 0.1) return;
  try {
    await supabaseAdmin.from('critique_results').insert({
      source: input.source,
      session_id: input.sessionId ?? null,
      conversation_id: input.conversationId ?? null,
      trace_id: input.traceId ?? null,
      agent_task_id: input.agentTaskId ?? null,
      tenant_id: input.tenantId ?? null,
      affiliate_id: input.affiliateId ?? null,
      llm_provider: input.llmProvider ?? null,
      llm_model: input.llmModel ?? null,
      severity: input.severity,
      issues: input.issues ?? [],
      user_question_sha256: input.userQuestion ? sha256(input.userQuestion) : null,
      reply_sha256: input.reply ? sha256(input.reply) : null,
      reply_redacted: input.severity === 'ok' ? null : redactPII(input.reply).slice(0, 2000),
      corrected_reply_redacted: input.correctedReply
        ? redactPII(input.correctedReply).slice(0, 2000)
        : null,
      was_gated: input.wasGated,
      metadata: input.metadata ?? {},
    } as never);
  } catch (e) {
    console.warn('[critique-record] insert 실패:', e);
  }
}

// ─── response_feedback INSERT ───────────────────────────────────

export interface RecordFeedbackInput {
  source: 'qa_chat' | 'jarvis_v1' | 'jarvis_v2' | 'card_news' | 'blog' | 'other';
  sessionId?: string | null;
  conversationId?: string | null;
  reply: string;
  rating: -1 | 0 | 1;
  raterType: 'customer' | 'admin' | 'partner' | 'auto_critic';
  raterId?: string | null;
  reasonCategory?: string | null;
  comment?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordResponseFeedback(input: RecordFeedbackInput): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    await supabaseAdmin.from('response_feedback').insert({
      source: input.source,
      session_id: input.sessionId ?? null,
      conversation_id: input.conversationId ?? null,
      reply_sha256: input.reply ? sha256(input.reply) : null,
      rating: input.rating,
      rater_type: input.raterType,
      rater_id: input.raterId ?? null,
      reason_category: input.reasonCategory ?? null,
      comment: input.comment ?? null,
      metadata: input.metadata ?? {},
    } as never);
  } catch (e) {
    console.warn('[feedback-record] insert 실패:', e);
  }
}

// ─── response_corrections SELECT (Reflexion 일반화) ─────────────

interface CorrectionRow {
  id: string;
  source: string;
  scope_destination: string | null;
  scope_tenant_id: string | null;
  pattern: string;
  bad_example: string | null;
  good_example: string | null;
  severity: string;
  applied_count: number;
}

const CORR_CACHE = new Map<string, { rows: CorrectionRow[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 응답 정정 메모리 회수. 우선순위: tenant+dest > dest > global
 * 모든 활성(active) 항목을 가져온 뒤 JS 측에서 점수화 (작은 데이터셋 가정).
 */
export async function getRelevantCorrections(params: {
  source: string;
  destination?: string | null;
  tenantId?: string | null;
  limit?: number;
}): Promise<CorrectionRow[]> {
  if (!isSupabaseConfigured) return [];
  const cacheKey = `${params.source}:${params.tenantId ?? '-'}:${params.destination ?? '-'}`;
  const cached = CORR_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;

  try {
    const { data } = await supabaseAdmin
      .from('response_corrections')
      .select('id, source, scope_destination, scope_tenant_id, pattern, bad_example, good_example, severity, applied_count')
      .eq('source', params.source)
      .eq('is_active', true)
      .order('severity', { ascending: false })
      .order('applied_count', { ascending: false })
      .limit(50);

    const rows = (data ?? []) as CorrectionRow[];
    // 우선순위 점수
    const score = (r: CorrectionRow): number => {
      let s = 0;
      if (params.tenantId && r.scope_tenant_id === params.tenantId) s += 10;
      else if (!r.scope_tenant_id) s += 1;
      if (params.destination && r.scope_destination === params.destination) s += 5;
      else if (!r.scope_destination) s += 1;
      if (r.severity === 'block') s += 3;
      else if (r.severity === 'warn') s += 1;
      return s;
    };
    const ranked = rows
      .map((r) => ({ r, s: score(r) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, params.limit ?? 5)
      .map((x) => x.r);

    CORR_CACHE.set(cacheKey, { rows: ranked, expiresAt: Date.now() + CACHE_TTL_MS });

    // applied_count 가벼운 증가 (fire-and-forget) — 정확성 보다 트래픽 빈도 추적용
    if (ranked.length > 0) {
      void supabaseAdmin
        .from('response_corrections')
        .update({ last_applied_at: new Date().toISOString() } as never)
        .in('id', ranked.map((r) => r.id));
    }
    return ranked;
  } catch (e) {
    console.warn('[corrections] fetch 실패:', e);
    return [];
  }
}

/** 시스템 프롬프트에 주입할 텍스트 fragment 생성. 빈 문자열 = 주입 안 함. */
export function buildCorrectionsPromptFragment(rows: CorrectionRow[]): string {
  if (!rows.length) return '';
  const lines = rows.map((r, idx) => {
    const head = r.severity === 'block' ? '🛑 절대 금지' : '⚠️ 주의';
    let body = `[${idx + 1}] ${head}: ${r.pattern}`;
    if (r.bad_example) body += `\n  ❌ ${r.bad_example.slice(0, 200)}`;
    if (r.good_example) body += `\n  ✅ ${r.good_example.slice(0, 200)}`;
    return body;
  });
  return `\n## 과거 응답에서 박제된 교훈 (반드시 준수)\n${lines.join('\n')}\n`;
}

// ─── qa_negative_examples SELECT (Few-shot negative) ────────────

interface NegExampleRow {
  id: string;
  destination: string | null;
  question_pattern: string | null;
  bad_reply_excerpt: string;
  issue_category: string | null;
  severity: string;
}

const NEG_CACHE = new Map<string, { rows: NegExampleRow[]; expiresAt: number }>();

export async function getNegativeExamples(params: {
  destination?: string | null;
  limit?: number;
}): Promise<NegExampleRow[]> {
  if (!isSupabaseConfigured) return [];
  const cacheKey = `neg:${params.destination ?? '-'}`;
  const cached = NEG_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;

  try {
    let query = supabaseAdmin
      .from('qa_negative_examples')
      .select('id, destination, question_pattern, bad_reply_excerpt, issue_category, severity')
      .eq('is_active', true)
      .order('severity', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20);

    if (params.destination) {
      query = query.or(`destination.eq.${params.destination},destination.is.null`);
    }
    const { data } = await query;
    const rows = (data ?? []) as NegExampleRow[];
    const limited = rows.slice(0, params.limit ?? 3);
    NEG_CACHE.set(cacheKey, { rows: limited, expiresAt: Date.now() + CACHE_TTL_MS });
    return limited;
  } catch (e) {
    console.warn('[neg-examples] fetch 실패:', e);
    return [];
  }
}

export function buildNegativePromptFragment(rows: NegExampleRow[]): string {
  if (!rows.length) return '';
  const lines = rows.map((r, idx) =>
    `[${idx + 1}] ❌ 이런 답변 금지: "${r.bad_reply_excerpt.slice(0, 220)}"${
      r.issue_category ? ` (사유: ${r.issue_category})` : ''
    }`,
  );
  return `\n## 과거 부정평가 답변 (반드시 회피)\n${lines.join('\n')}\n`;
}

/**
 * 부정 피드백 누적 → 자동으로 negative_examples 후보 등록.
 * down rating(-1) 이거나 severity=block 인 critique 결과를 1주 1회 cron 으로 배치 처리하는 게 정석이지만,
 * 이 함수는 어드민이 1-click 으로 등록할 때 사용.
 */
export async function promoteToNegativeExample(input: {
  destination?: string | null;
  questionPattern?: string | null;
  badReplyExcerpt: string;
  issueCategory?: string | null;
  severity?: 'info' | 'warn' | 'block';
  sourceFeedbackId?: string | null;
  sourceCritiqueId?: string | null;
}): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    await supabaseAdmin.from('qa_negative_examples').insert({
      destination: input.destination ?? null,
      question_pattern: input.questionPattern ?? null,
      bad_reply_excerpt: input.badReplyExcerpt.slice(0, 1500),
      issue_category: input.issueCategory ?? null,
      severity: input.severity ?? 'warn',
      source_feedback_id: input.sourceFeedbackId ?? null,
      source_critique_id: input.sourceCritiqueId ?? null,
    } as never);
    // 캐시 무효화
    NEG_CACHE.clear();
  } catch (e) {
    console.warn('[promote-negative] 실패:', e);
  }
}
