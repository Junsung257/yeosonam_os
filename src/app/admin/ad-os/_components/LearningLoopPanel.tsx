import type { Summary } from '../_lib/types';
import { fmtWon } from '../_lib/display';
import { MetricGrid } from './MetricGrid';
import { StatusPill } from './StatusPill';

type LearningLoop = NonNullable<Summary['learning_loop']>;

export function LearningLoopPanel({ learningLoop }: { learningLoop: LearningLoop }) {
  const status = learningLoop.status;
  const metrics = learningLoop.metrics;

  return (
    <section className="admin-card p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-admin-base font-semibold text-admin-text-2">Performance learning loop</h2>
          <p className="mt-1 text-admin-xs text-admin-muted">
            Combines click, CTA, booking, and engagement signals to prepare optimization candidates.
          </p>
        </div>
        <StatusPill tone={status.has_booking_signal ? 'good' : status.has_click_signal ? 'warn' : 'neutral'}>
          {status.has_booking_signal ? 'Booking learning ready' : status.has_click_signal ? 'Click learning active' : 'Waiting for signal'}
        </StatusPill>
      </div>

      <MetricGrid
        columns="md:grid-cols-4"
        metrics={[
          { label: 'Clicks', value: metrics.clicks.toLocaleString('ko-KR') },
          { label: 'CTA rate', value: `${metrics.cta_rate_pct}%` },
          { label: 'Conversion rate', value: `${metrics.conversion_rate_pct}%` },
          { label: 'CPA', value: metrics.cpa_krw ? fmtWon(metrics.cpa_krw) : '-' },
          { label: 'ROAS', value: metrics.roas_pct ? `${metrics.roas_pct}%` : '-' },
          { label: '30d sessions', value: metrics.engagement_sessions_30d.toLocaleString('ko-KR') },
          { label: 'Bounce rate', value: metrics.bounce_rate_pct === null ? '-' : `${metrics.bounce_rate_pct}%` },
          { label: 'Avg time', value: `${metrics.avg_time_on_page_seconds}s` },
          { label: 'Scroll depth', value: `${metrics.avg_scroll_depth_pct}%` },
        ]}
      />

      <p className="mt-3 rounded-admin-sm bg-admin-surface-2 px-3 py-2 text-admin-2xs leading-5 text-admin-muted">
        {learningLoop.next_action}
      </p>
    </section>
  );
}
