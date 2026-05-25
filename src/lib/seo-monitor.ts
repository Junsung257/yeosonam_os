import { createClient } from '@supabase/supabase-js';
import { fetchGscSearchAnalytics } from '@/lib/keyword-research';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SLACK_WEBHOOK_URL = process.env.SLACK_CWV_WEBHOOK_URL || process.env.SLACK_ALERTS_WEBHOOK_URL;

export interface DailyGscSnapshot {
  date: string;
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
  topKeywords: { query: string; clicks: number; position: number }[];
}

/** 오늘의 GSC 데이터 스냅샷 저장 */
export async function captureDailyGscSnapshot(): Promise<DailyGscSnapshot | null> {
  try {
    const gscMap = await fetchGscSearchAnalytics('query', 500);
    if (gscMap.size === 0) return null;

    let totalClicks = 0;
    let totalImpressions = 0;
    let totalCtr = 0;
    let totalPosition = 0;
    const topKeywords: { query: string; clicks: number; position: number }[] = [];

    for (const [query, row] of gscMap) {
      totalClicks += row.clicks;
      totalImpressions += row.impressions;
      totalCtr += row.ctr;
      totalPosition += row.position;
      topKeywords.push({ query, clicks: row.clicks, position: row.position });
    }

    topKeywords.sort((a, b) => b.clicks - a.clicks);

    const today = new Date().toISOString().split('T')[0];
    const snapshot: DailyGscSnapshot = {
      date: today,
      totalClicks,
      totalImpressions,
      avgCtr: totalClicks > 0 ? totalCtr / totalClicks : 0,
      avgPosition: gscMap.size > 0 ? totalPosition / gscMap.size : 0,
      topKeywords: topKeywords.slice(0, 20),
    };

    // DB 저장
    const { error } = await supabase.from('seo_daily_snapshots').upsert(
      {
        date: snapshot.date,
        total_clicks: snapshot.totalClicks,
        total_impressions: snapshot.totalImpressions,
        avg_ctr: snapshot.avgCtr,
        avg_position: snapshot.avgPosition,
        top_keywords: snapshot.topKeywords,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'date' },
    );

    if (error) {
      console.error('[SeoMonitor] snapshot save error:', error.message);
    }

    return snapshot;
  } catch (err) {
    console.error('[SeoMonitor] capture error:', err instanceof Error ? err.message : err);
    return null;
  }
}

export interface SeoAlert {
  type: 'traffic_drop' | 'ranking_drop' | 'algorithm_update';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  metrics?: Record<string, number>;
}

/** 전일 대비 트래픽/순위 변동 감지 */
export async function detectSeoAnomalies(
  todaySnapshot: DailyGscSnapshot,
): Promise<SeoAlert[]> {
  const alerts: SeoAlert[] = [];

  // 어제 스냅샷 조회
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const { data: yesterdayData } = await supabase
    .from('seo_daily_snapshots')
    .select('*')
    .eq('date', yesterdayStr)
    .single();

  if (!yesterdayData) return alerts; // 기준 데이터 없음

  // 1. 트래픽 급감 감지 (전일 대비 30% 이상 감소)
  const clickChange =
    yesterdayData.total_clicks > 0
      ? ((todaySnapshot.totalClicks - yesterdayData.total_clicks) / yesterdayData.total_clicks) * 100
      : 0;

  if (clickChange < -30) {
    alerts.push({
      type: 'traffic_drop',
      severity: clickChange < -50 ? 'critical' : 'warning',
      title: '🔻 트래픽 급감 감지',
      message: `전일 대비 클릭 ${clickChange.toFixed(1)}% 감소 (${yesterdayData.total_clicks} → ${todaySnapshot.totalClicks})`,
      metrics: { clickChange },
    });
  }

  // 2. 평균 포지션 하락 감지 (0.5 이상 상승 = 순위 하락)
  const positionChange = todaySnapshot.avgPosition - yesterdayData.avg_position;
  if (positionChange > 0.5) {
    alerts.push({
      type: 'ranking_drop',
      severity: positionChange > 2 ? 'critical' : 'warning',
      title: '📉 평균 순위 하락 감지',
      message: `평균 포지션 ${positionChange.toFixed(1)} 하락 (${yesterdayData.avg_position.toFixed(1)} → ${todaySnapshot.avgPosition.toFixed(1)})`,
      metrics: { positionChange },
    });
  }

  // 3. 알고리즘 업데이트 의심 (트래픽 + 포지션 동시 급변)
  if ((clickChange < -20 || clickChange > 50) && Math.abs(positionChange) > 0.3) {
    alerts.push({
      type: 'algorithm_update',
      severity: 'warning',
      title: '🔄 Google 알고리즘 업데이트 의심',
      message: `클릭 ${clickChange > 0 ? '+' : ''}${clickChange.toFixed(1)}% · 포지션 ${positionChange > 0 ? '+' : ''}${positionChange.toFixed(1)} — 전일 대비 큰 변동`,
      metrics: { clickChange, positionChange },
    });
  }

  return alerts;
}

/** 감지된 알림 Slack 전송 */
export async function sendSeoAlerts(alerts: SeoAlert[]): Promise<void> {
  if (!SLACK_WEBHOOK_URL || alerts.length === 0) return;

  // 같은 타입의 알림은 24시간 내 중복 전송 방지
  for (const alert of alerts) {
    const { error: recentError } = await supabase
      .from('seo_alerts')
      .insert({
        type: alert.type,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        metrics: alert.metrics || {},
      });
    if (recentError) continue; // unique constraint = 이미 같은 타입 전송됨

    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: [
          `${alert.title}`,
          `· ${alert.message}`,
          `· 심각도: ${alert.severity}`,
          `· 시간: ${new Date().toLocaleString('ko-KR')}`,
        ].join('\n'),
      }),
    });
  }
}

/** 전체 모니터링 파이프라인 실행 */
export async function runSeoMonitoring(): Promise<{ snapshot: DailyGscSnapshot | null; alerts: SeoAlert[] }> {
  const snapshot = await captureDailyGscSnapshot();
  if (!snapshot) return { snapshot: null, alerts: [] };

  const alerts = await detectSeoAnomalies(snapshot);
  await sendSeoAlerts(alerts);

  return { snapshot, alerts };
}
