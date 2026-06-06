import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Summary } from '../_lib/types';
import { LearningLoopPanel } from './LearningLoopPanel';

const learningLoop: NonNullable<Summary['learning_loop']> = {
  scope: ['naver'],
  metrics: {
    clicks: 120,
    cta_clicks: 12,
    conversions: 3,
    spend_krw: 50000,
    conversion_value_krw: 200000,
    cpa_krw: 16667,
    roas_pct: 400,
    cta_rate_pct: 10,
    conversion_rate_pct: 2.5,
    bounce_rate_pct: 45,
    engagement_sessions_30d: 90,
    avg_time_on_page_seconds: 83,
    avg_scroll_depth_pct: 62,
  },
  status: {
    has_click_signal: true,
    has_booking_signal: true,
  },
  next_action: 'Promote the best converting keyword cluster.',
};

describe('Ad OS LearningLoopPanel', () => {
  it('renders learning metrics and next action', () => {
    const html = renderToStaticMarkup(<LearningLoopPanel learningLoop={learningLoop} />);

    expect(html).toContain('Performance learning loop');
    expect(html).toContain('Booking learning ready');
    expect(html).toContain('120');
    expect(html).toContain('10%');
    expect(html).toContain('400%');
    expect(html).toContain('Promote the best converting keyword cluster.');
  });
});
