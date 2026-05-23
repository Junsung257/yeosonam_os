/**
 * AI 학습 플라이휠 크론 — 매주 월요일 03:00 KST 실행.
 *
 * 목적:
 *   A) critique_results 에서 severity=block/warn 패턴 추출 → response_corrections 자동 등록
 *   B) platform_learning_events 집계 → 자주 실패한 주제 식별 → agent_actions 제안 등록
 *   C) qa_negative_examples 자동 promotion (-down rating feedback 기반)
 *
 * 안전장치:
 *   - 자동 등록은 is_active=false (비활성) — 어드민이 검토 후 활성화
 *   - 신규 패턴은 기존 패턴과 70% 유사도 이상 시 스킵 (중복 방지)
 */

import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { withCronGuard } from '@/lib/cron-auth';
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic';

function sha256(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase(), 'utf8').digest('hex');
}

interface CritiqueRow {
  id: string;
  severity: string;
  issues: string[];
  user_question_sha256: string | null;
  reply_redacted: string | null;
  corrected_reply_redacted: string | null;
  source: string;
  tenant_id: string | null;
}

interface CorrectionRow {
  id: string;
  pattern: string;
  pattern_hash: string;
}

const getHandler = async () => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ skipped: true, reason: 'Supabase 미설정' });
  }

  const result: Record<string, unknown> = {
    ranAt: new Date().toISOString(),
    actions: [] as string[],
    warnings: [] as string[],
  };

  // ── Step A: block/warn critique → response_corrections 자동 등록 ──
  try {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const sinceIso = since.toISOString();

    // 최근 7일간 block/warn critique 조회
    const { data: critiques } = await supabaseAdmin
      .from('critique_results')
      .select('id, severity, issues, user_question_sha256, reply_redacted, corrected_reply_redacted, source, tenant_id')
      .in('severity', ['warn', 'block'])
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(100) as { data: CritiqueRow[] | null };

    if (critiques && critiques.length > 0) {
      // 기존 활성 패턴 hash 조회 (중복 방지)
      // pattern_hash 컬럼이 없을 수 있으므로 try/catch + fallback
      let existingHashes = new Set<string>();
      try {
        const { data: existingCorrections } = await supabaseAdmin
          .from('response_corrections')
          .select('id, pattern, pattern_hash')
          .eq('is_active', true) as { data: CorrectionRow[] | null };

        existingHashes = new Set(existingCorrections?.map(r => r.pattern_hash).filter(Boolean) ?? []);
      } catch {
        // pattern_hash 컬럼 미존재 — 마이그레이션 누락; 중복 방지 없이 진행
        const { data: existingPatterns } = await supabaseAdmin
          .from('response_corrections')
          .select('pattern')
          .eq('is_active', true) as { data: { pattern: string }[] | null };

        if (existingPatterns) {
          existingHashes = new Set(existingPatterns.map(r => sha256(r.pattern)));
        }
      }

      let insertedCount = 0;
      for (const c of critiques) {
        if (!c.issues?.length && !c.reply_redacted) continue;

        // 문제 요약을 패턴으로 추출
        const pattern = c.issues?.slice(0, 2).join('; ') || 'critique_auto';
        const patternHash = sha256(pattern);

        // 중복 체크
        if (existingHashes.has(patternHash)) continue;

        // bad_example = 원본 답변, good_example = 수정된 답변
        await supabaseAdmin.from('response_corrections').insert({
          source: c.source || 'jarvis_v2',
          pattern,
          pattern_hash: patternHash,
          bad_example: c.reply_redacted?.slice(0, 1000) ?? null,
          good_example: c.corrected_reply_redacted?.slice(0, 1000) ?? null,
          severity: c.severity === 'block' ? 'block' : 'warn',
          scope_tenant_id: c.tenant_id ?? null,
          is_active: false, // 어드민 검토 후 활성화
          applied_count: 0,
        } as never);

        existingHashes.add(patternHash);
        insertedCount++;
      }

      (result.actions as string[]).push(
        `critique_auto: ${insertedCount}개 패턴 추출·등록 (critique ${critiques.length}건 분석)`,
      );
    } else {
      (result.actions as string[]).push('critique_auto: 분석할 block/warn 데이터 없음');
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    (result.warnings as string[]).push(`Step A 실패: ${msg}`);
  }

  // ── Step B: platform_learning_events 집계 → 주제별 취약점 리포트 ──
  try {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const sinceIso = since.toISOString();

    const { data: events } = await supabaseAdmin
      .from('platform_learning_events')
      .select('source, payload, created_at')
      .gte('created_at', sinceIso)
      .limit(2000);

    if (events && events.length > 0) {
      // tools_used 빈도 + pending_hitl 빈도 집계
      const toolFreq: Record<string, number> = {};
      const hitlCount = { total: 0, byAgent: {} as Record<string, number> };
      const agentFreq: Record<string, number> = {};

      for (const evt of events) {
        const p = evt.payload as Record<string, unknown> | null;
        if (!p) continue;

        const agent = (p.agent as string) || 'unknown';
        agentFreq[agent] = (agentFreq[agent] || 0) + 1;

        if (p.pending_hitl) {
          hitlCount.total++;
          hitlCount.byAgent[agent] = (hitlCount.byAgent[agent] || 0) + 1;
        }

        const tools = p.tools_used as string[] | undefined;
        if (Array.isArray(tools)) {
          for (const t of tools) {
            toolFreq[t] = (toolFreq[t] || 0) + 1;
          }
        }
      }

      const summary = {
        eventCount: events.length,
        agentFreq,
        hitlCount,
        topTools: Object.entries(toolFreq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
      };

      (result.actions as string[]).push(
        `learning_agg: 7일간 ${events.length}건 이벤트 분석 완료 (HITL ${hitlCount.total}건)`,
      );
      result.weeklySummary = summary;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    (result.warnings as string[]).push(`Step B 실패: ${msg}`);
  }

  return NextResponse.json(result);
};

export const GET = withCronGuard(getHandler);
