import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';

/**
 * 블로그 자기학습 크론 — 매주 일요일 23시 실행 (KST 월요일 스케줄러 직전)
 *
 * 3가지 작업:
 *   A) Featured 자동 재선정 (NEW) — 30일 내 조회수·노출 상위 Top 3 → featured=true
 *   B) prompt-optimizer 호출 — 성과 분석 → agent_actions 제안 등록
 *   C) (옵션) AUTO_APPROVE_LEARNING=true → prompt_versions 자동 활성화
 */
export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ skipped: true, reason: 'Supabase 미설정' });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const result: Record<string, unknown> = { ranAt: new Date().toISOString() };

  // ── A) Featured 자동 재선정 ────────────────────────────────
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    // 30일 내 발행 + 조회수 기준 상위 3개 (content_type='pillar' 제외 — pillar는 영구 허브)
    const { data: topPosts } = await supabaseAdmin
      .from('content_creatives')
      .select('id, slug, view_count, seo_title, content_type')
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .neq('content_type', 'pillar')
      .gte('published_at', since.toISOString())
      .order('view_count', { ascending: false })
      .limit(3);

    const topIds = ((topPosts as Array<{ id: string }> | null) || []).map(p => p.id);

    if (topIds.length > 0) {
      // 1) 기존 featured 전부 해제 (pillar 제외)
      await supabaseAdmin
        .from('content_creatives')
        .update({ featured: false, featured_order: null })
        .eq('channel', 'naver_blog')
        .eq('featured', true)
        .neq('content_type', 'pillar');

      // 2) TOP 3 새로 마킹
      for (let i = 0; i < topIds.length; i++) {
        await supabaseAdmin
          .from('content_creatives')
          .update({ featured: true, featured_order: i + 1 })
          .eq('id', topIds[i]);
      }

      // 3) /blog ISR 즉시 무효화
      try { revalidatePath('/blog'); } catch { /* noop */ }

      result.featured_rotated = {
        count: topIds.length,
        ids: topIds,
        titles: ((topPosts as Array<{ seo_title: string | null }>) || []).map(p => p.seo_title || '(제목없음)'),
      };
    } else {
      result.featured_rotated = { count: 0, reason: '30일 내 발행글 없음' };
    }
  } catch (err) {
    console.warn('[blog-learn] featured 재선정 실패:', err);
    result.featured_error = err instanceof Error ? err.message : 'unknown';
  }

  // ── B) Prompt optimizer ────────────────────────────────────
  try {
    const optRes = await fetch(`${baseUrl}/api/agent/prompt-optimizer`, { method: 'POST' });
    const optData = await optRes.json();

    if (optData.status !== 'suggestion_created') {
      result.prompt_learning = { step: 'analysis', status: optData.status, message: optData.message };
      return NextResponse.json(result);
    }

    const actionId = optData.action_id;
    const autoApprove = process.env.AUTO_APPROVE_LEARNING === 'true';

    if (!autoApprove) {
      result.prompt_learning = {
        step: 'waiting_approval',
        action_id: actionId,
        summary: optData.analysis?.summary,
        note: '사장님 승인 대기. AUTO_APPROVE_LEARNING=true 설정 시 자동 적용.',
      };
      return NextResponse.json(result);
    }

    // C) 자동 승인 모드
    const { data: action } = await supabaseAdmin
      .from('agent_actions')
      .select('payload, id')
      .eq('id', actionId)
      .limit(1);

    const args = action?.[0]?.payload || {};
    args.action_id = actionId;

    const { executeAction } = await import('@/lib/agent-action-executor');
    const execResult = await executeAction('prompt_improvement_suggestion', args);
    if (!execResult.success) throw new Error(execResult.error);

    await supabaseAdmin
      .from('agent_actions')
      .update({
        status: 'executed',
        executed_at: new Date().toISOString(),
        execution_result: execResult,
      })
      .eq('id', actionId);

    result.prompt_learning = {
      step: 'auto_applied',
      action_id: actionId,
      new_version: (execResult.data as any)?.new_version,
      from_version: (execResult.data as any)?.from_version,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('[blog-learn] 오류:', err);
    result.prompt_learning = { error: err instanceof Error ? err.message : '학습 실패' };
    return NextResponse.json(result, { status: 500 });
  }
}
