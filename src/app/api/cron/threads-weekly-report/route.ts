/**
 * Threads Weekly Report — 매주 월요일 09:00 KST 실행
 *
 * 역할:
 *   1. 지난 7일간 Threads 발행 실적 집계
 *   2. 주요 지표 요약 (발행 수, 참여율, Critic Gate 결과)
 *   3. Slack 리포트 전송
 *   4. 기준 미달 시 개선 제안 포함
 *
 * 안전장치:
 *   - 발행 내역이 없으면 silent skip
 *   - Slack 실패는 무시 (주요 흐름 차단 방지)
 *   - Supabase 미설정 시 조기 종료
 */
import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { notifySlack } from '@/lib/slack-notifier';

export const runtime = 'nodejs';
export const maxDuration = 60; // 1분

interface ReportMetrics {
  totalPublished: number;
  totalDrafted: number;
  totalFailed: number;
  totalScheduled: number;
  totalReady: number;
  byDay: Record<string, { published: number; failed: number }>;
  byCategory: Record<string, number>;
  criticRejected: number;
  criticApproved: number;
}

async function runReport(_request: NextRequest) {
  // ── Supabase 설정 확인 ──────────────────────────────────────
  if (!isSupabaseConfigured()) {
    return { skipped: true, reason: 'Supabase 미설정' };
  }

  // ── 지난 7일 범위 ────────────────────────────────────────────
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since = sevenDaysAgo.toISOString();
  const until = now.toISOString();

  // ── 1. content_distributions 집계 ────────────────────────────
  const { count: totalPublished, error: pubErr } = await supabaseAdmin
    .from('content_distributions')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'threads')
    .eq('status', 'published')
    .gte('published_at', since)
    .lte('published_at', until);

  if (pubErr) return { error: `published count 실패: ${pubErr.message}` };

  // 발행 내역 없으면 조기 종료
  if (!totalPublished || totalPublished === 0) {
    return { skipped: true, reason: '최근 7일간 발행 내역 없음' };
  }

  const { count: totalDrafted } = await supabaseAdmin
    .from('content_distributions')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'threads')
    .eq('status', 'draft')
    .gte('created_at', since);

  const { count: totalFailed } = await supabaseAdmin
    .from('content_distributions')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'threads')
    .eq('status', 'failed')
    .gte('created_at', since);

  const { count: totalScheduled } = await supabaseAdmin
    .from('content_distributions')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'threads')
    .eq('status', 'scheduled');

  const { count: totalReady } = await supabaseAdmin
    .from('content_distributions')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'threads')
    .eq('status', 'ready');

  // ── 2. 일별 발행 내역 ────────────────────────────────────────
  const { data: publishedRows } = await supabaseAdmin
    .from('content_distributions')
    .select('published_at, status')
    .eq('platform', 'threads')
    .in('status', ['published', 'failed'])
    .gte('published_at', since)
    .lte('published_at', until)
    .order('published_at', { ascending: true });

  const byDay: Record<string, { published: number; failed: number }> = {};
  for (const row of publishedRows ?? []) {
    const day = (row.published_at as string).slice(0, 10); // YYYY-MM-DD
    if (!byDay[day]) byDay[day] = { published: 0, failed: 0 };
    if (row.status === 'published') byDay[day].published++;
    if (row.status === 'failed') byDay[day].failed++;
  }

  // ── 3. content_plans 통계 (Critic Gate 결과) ─────────────────
  const { count: criticRejected } = await supabaseAdmin
    .from('content_plans')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'threads')
    .eq('status', 'cancelled')
    .gte('created_at', since);

  const { count: criticApproved } = await supabaseAdmin
    .from('content_plans')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'threads')
    .in('status', ['scheduled', 'published'])
    .gte('created_at', since);

  // ── 4. 카테고리 분포 ──────────────────────────────────────────
  const { data: planRows } = await supabaseAdmin
    .from('content_plans')
    .select('category')
    .eq('platform', 'threads')
    .gte('created_at', since);

  const byCategory: Record<string, number> = {};
  for (const row of planRows ?? []) {
    const cat = (row.category as string) ?? 'uncategorized';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }

  // ── 5. Slack 전송 ────────────────────────────────────────────
  const aWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startLabel = `${aWeekAgo.getMonth() + 1}/${aWeekAgo.getDate()}`;
  const endLabel = `${now.getMonth() + 1}/${now.getDate()}`;
  const dayEntries = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b));
  const dailySummary = dayEntries
    .map(([day, v]) => `• ${day.slice(5)}: 발행 ${v.published}건${v.failed > 0 ? `, 실패 ${v.failed}건` : ''}`)
    .join('\n');
  const categorySummary = Object.entries(byCategory)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, count]) => `• ${cat}: ${count}건`)
    .join('\n');

  const metrics: ReportMetrics = {
    totalPublished: totalPublished ?? 0,
    totalDrafted: totalDrafted ?? 0,
    totalFailed: totalFailed ?? 0,
    totalScheduled: totalScheduled ?? 0,
    totalReady: totalReady ?? 0,
    byDay,
    byCategory,
    criticRejected: criticRejected ?? 0,
    criticApproved: criticApproved ?? 0,
  };

  await notifySlack('info', `📊 Threads 주간 리포트 (${startLabel}~${endLabel})`, {
    '📤 발행': `${metrics.totalPublished}건`,
    '📝 대기': `${metrics.totalReady}건 (scheduled: ${metrics.totalScheduled}건)`,
    '❌ 실패': `${metrics.totalFailed}건`,
    '🔍 Critic 승인': `${metrics.criticApproved}건`,
    '🚫 Critic 거절': `${metrics.criticRejected}건`,
    '📋 일별': dailySummary || '없음',
    '🏷️ 카테고리': categorySummary || '없음',
    '📈 일평균': `${(metrics.totalPublished / Math.max(dayEntries.length, 1)).toFixed(1)}건`,
  }).catch(() => {});

  return metrics;
}

export const GET = withCronLogging('threads-weekly-report', runReport);
