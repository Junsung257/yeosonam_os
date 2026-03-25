/**
 * 자비스 AI 비서 API — Smart Router + Generative UI
 *
 * 아키텍처:
 *   0. Bulk 테이블 감지 → Gemini 완전 우회 (기존 로직 유지)
 *   1. Intent 분류 (0ms, 정규식) → PRODUCT / BOOKING / FINANCE / MULTI
 *   2. 모드별 도구 + 프롬프트 조립 (토큰 ~60% 절감)
 *   3. ScreenContext → 지시대명사 해석 ("이 사람 예약 잡아줘")
 *   4. Gemini 멀티턴 function calling
 */

import { NextRequest, NextResponse } from 'next/server';
import { parseBulkTable, processBulkReservations } from '@/lib/bulk-reservations';
import { isSupabaseConfigured } from '@/lib/supabase';
import { classifyIntent, type ScreenContext } from '@/lib/jarvis/router';
import { buildAgentConfig } from '@/lib/jarvis/agents';
import { runGemini } from '@/lib/jarvis/gemini';

function formatBulkResult(result: {
  total: number;
  success_count: number;
  failed_count: number;
  success_list: { name: string; destination: string; booking_no?: string }[];
  failed_list: { name: string; reason: string }[];
}): string {
  const lines = [
    `총 ${result.total}건 중 ${result.success_count}건 성공, ${result.failed_count}건 실패했습니다.`,
  ];
  if (result.success_list.length > 0) {
    lines.push('');
    lines.push(`✅ 성공 (${result.success_count}건):`);
    for (const s of result.success_list) {
      lines.push(`  • ${s.name}(${s.destination})${s.booking_no ? ` — 예약번호 ${s.booking_no}` : ''}`);
    }
  }
  if (result.failed_list.length > 0) {
    lines.push('');
    lines.push(`⚠️ 보류 — 후처리 필요 (${result.failed_count}건):`);
    for (const f of result.failed_list) {
      lines.push(`  • ${f.name} (사유: ${f.reason})`);
    }
  }
  return lines.join('\n');
}

export async function POST(request: NextRequest) {
  try {
    const { message, history = [], screenContext = {} as ScreenContext } = await request.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: '메시지가 필요합니다.' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI API 키가 설정되지 않았습니다.' }, { status: 500 });
    }
    if (!isSupabaseConfigured) {
      return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
    }

    // ── 0. Bulk 테이블 감지 → Gemini 완전 우회 ────────────────────────────────
    const bulkItems = parseBulkTable(message);
    if (bulkItems) {
      const bulkResult = await processBulkReservations(bulkItems);
      const reply = formatBulkResult(bulkResult);
      const actions = bulkResult.success_list.map(b => ({ type: 'booking_created', data: b }));
      return NextResponse.json({ reply, actions, uiState: null, mode: 'BULK' });
    }

    // ── 1. Intent 분류 (0ms, 정규식) ──────────────────────────────────────────
    const { mode, resolvedMessage, injectedContext } = classifyIntent(message, screenContext);

    // ── 2. Mode별 도구 + 시스템 프롬프트 조립 ─────────────────────────────────
    const { tools, systemPrompt } = buildAgentConfig(mode);

    // ── 3. 대화 히스토리 → Gemini contents 형식 변환 ──────────────────────────
    const contents = [
      ...(history as { role: string; content: string }[])
        .slice(-10)
        .map(h => ({
          role: h.role === 'user' ? 'user' : 'model',
          parts: [{ text: h.content }],
        })),
      { role: 'user', parts: [{ text: resolvedMessage }] },
    ];

    // ── 4. Gemini 호출 ────────────────────────────────────────────────────────
    const { reply, actions, uiState } = await runGemini({
      apiKey,
      contents,
      systemPrompt,
      tools,
      injectedContext,
    });

    return NextResponse.json({ reply, actions, uiState, mode });

  } catch (error) {
    console.error('[자비스] 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI 처리 실패' },
      { status: 500 }
    );
  }
}
