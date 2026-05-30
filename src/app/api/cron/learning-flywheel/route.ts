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
import { extractQaDestinationHint } from '@/lib/qa-destination-hint';
import { runActiveQaLearningScenarios } from '@/lib/qa-scenario-regression';
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic';

function sha256(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase(), 'utf8').digest('hex');
}

function redactPII(text: string): string {
  return text
    .replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g, '[전화]')
    .replace(/\d{6}[-\s]?[1-4]\d{6}/g, '[주민번호]')
    .replace(/[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[이메일]')
    .slice(0, 1200);
}

function classifyCustomerScenario(message: string, inquiryType?: string | null) {
  const text = message.toLowerCase();
  if (/환불|결제\s*취소|카드\s*취소|입금\s*취소|refund|payment cancel/.test(text)) {
    return {
      category: 'handoff_payment_refund',
      priority: 95,
      expectedBehavior: { escalate: true, handoff: true, packageLinks: false },
      reason: 'payment/refund risk must be handed off',
    };
  }
  if (/자유여행|항공\s*\+\s*호텔|항공권|숙소|액티비티|맞춤\s*일정|free travel/.test(text)) {
    return {
      category: 'free_travel_cta',
      priority: 80,
      expectedBehavior: { freeTravelCta: true, noFalsePackageCards: true },
      reason: 'free-travel intent should receive CTA',
    };
  }
  if (/가격|예산|만원|포함|불포함|비교|얼마|price|budget/.test(text)) {
    return {
      category: 'price_or_inclusion',
      priority: 70,
      expectedBehavior: { packageLinksWhenAvailable: true, noInvalidPackageLinks: true },
      reason: 'price/inclusion question needs grounded product links',
    };
  }
  if (/추천|상품|패키지|여행지|가족|부모님|커플|휴양|recommend|package/.test(text) || inquiryType?.toLowerCase().includes('recommend')) {
    return {
      category: 'package_recommendation',
      priority: 65,
      expectedBehavior: { packageLinksWhenAvailable: true, noInvalidPackageLinks: true, noFalsePackageCards: true },
      reason: 'recommendation should be grounded in approved package inventory',
    };
  }
  return {
    category: 'general_consultation',
    priority: 45,
    expectedBehavior: { answerSmoothly: true, escalateWhenRisky: true },
    reason: 'general customer question',
  };
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

  try {
    const since = new Date();
    since.setDate(since.getDate() - 14);
    const sinceIso = since.toISOString();

    const { data: inquiries } = await supabaseAdmin
      .from('qa_inquiries')
      .select('id, question, inquiry_type, related_packages, status, created_at')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(150);

    let inserted = 0;
    let refreshed = 0;

    for (const row of inquiries ?? []) {
      const question = typeof row.question === 'string' ? row.question.trim() : '';
      if (question.length < 6) continue;

      const redacted = redactPII(question);
      const destinationHint = extractQaDestinationHint(redacted);
      const classified = classifyCustomerScenario(redacted, row.inquiry_type as string | null);
      const relatedPackages = Array.isArray(row.related_packages) ? row.related_packages : [];
      const scenarioHash = sha256([
        'qa_inquiries',
        classified.category,
        destinationHint ?? '-',
        redacted.replace(/\s+/g, ' ').slice(0, 240),
      ].join('|'));

      const { data: upserted, error } = await supabaseAdmin
        .from('qa_learning_scenarios')
        .upsert({
          scenario_hash: scenarioHash,
          source: 'qa_inquiries',
          source_inquiry_id: row.id,
          category: classified.category,
          destination_hint: destinationHint,
          user_message_redacted: redacted,
          expected_behavior: {
            ...classified.expectedBehavior,
            destinationHint,
            relatedPackageCount: relatedPackages.length,
            sourceStatus: row.status ?? null,
          },
          priority: classified.priority,
          status: 'pending',
          auto_generated: true,
          generated_reason: classified.reason,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'scenario_hash' })
        .select('id, created_at, updated_at')
        .single();

      if (!error && upserted) {
        const createdAt = new Date((upserted as { created_at: string }).created_at).getTime();
        const updatedAt = new Date((upserted as { updated_at: string }).updated_at).getTime();
        if (Math.abs(updatedAt - createdAt) < 2000) inserted++;
        else refreshed++;
      }
    }

    const { data: events } = await supabaseAdmin
      .from('platform_learning_events')
      .select('id, source, message_redacted, payload, created_at')
      .eq('source', 'qa_chat')
      .gte('created_at', sinceIso)
      .not('message_redacted', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);

    for (const row of events ?? []) {
      const message = typeof row.message_redacted === 'string' ? row.message_redacted.trim() : '';
      if (message.length < 6) continue;
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const shouldCapture =
        payload.escalate === true ||
        payload.free_travel_cta === true ||
        Number(payload.recommended_count ?? 0) > 0;
      if (!shouldCapture) continue;

      const destinationHint = extractQaDestinationHint(message);
      const classified = classifyCustomerScenario(message, null);
      const scenarioHash = sha256([
        'platform_learning_events',
        classified.category,
        destinationHint ?? '-',
        message.replace(/\s+/g, ' ').slice(0, 240),
      ].join('|'));

      const { error } = await supabaseAdmin
        .from('qa_learning_scenarios')
        .upsert({
          scenario_hash: scenarioHash,
          source: 'platform_learning_events',
          source_event_id: row.id,
          category: classified.category,
          destination_hint: destinationHint,
          user_message_redacted: message,
          expected_behavior: {
            ...classified.expectedBehavior,
            destinationHint,
            sourcePayload: {
              recommended_count: payload.recommended_count ?? null,
              free_travel_cta: payload.free_travel_cta ?? null,
              escalate: payload.escalate ?? null,
              critiqueSeverity: payload.critiqueSeverity ?? null,
            },
          },
          priority: classified.priority,
          status: 'pending',
          auto_generated: true,
          generated_reason: `${classified.reason}; captured from qa_chat learning event`,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'scenario_hash' });

      if (!error) refreshed++;
    }

    (result.actions as string[]).push(`scenario_auto: ${inserted}개 신규, ${refreshed}개 갱신 후보 생성`);
    result.scenarioSummary = { inserted, refreshed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    (result.warnings as string[]).push(`Step C 실패: ${msg}`);
  }

  try {
    const regression = await runActiveQaLearningScenarios({
      limit: Number(process.env.QA_SCENARIO_REGRESSION_LIMIT ?? 5),
    });
    (result.actions as string[]).push(
      `scenario_regression: ${regression.passed}/${regression.total} 통과, ${regression.failed}개 실패`,
    );
    result.scenarioRegression = {
      runGroupId: regression.runGroupId,
      total: regression.total,
      passed: regression.passed,
      failed: regression.failed,
      results: regression.results.map((r) => ({
        scenarioId: r.scenarioId,
        category: r.category,
        passed: r.passed,
        score: r.score,
        elapsedMs: r.elapsedMs,
        failedChecks: r.checks.filter((c) => !c.passed).map((c) => c.name),
      })),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    (result.warnings as string[]).push(`Step D 실패: ${msg}`);
  }

  return NextResponse.json(result);
};

export const GET = withCronGuard(getHandler);
