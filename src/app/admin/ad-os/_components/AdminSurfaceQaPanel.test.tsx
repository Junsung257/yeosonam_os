import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminSurfaceQa } from '../_lib/types';
import { AdminSurfaceQaPanel } from './AdminSurfaceQaPanel';

const qaFixture: AdminSurfaceQa = {
  ok: true,
  generated_at: '2026-06-04T00:00:00.000Z',
  qa: {
    status: 'warn',
    readiness_score: 83,
    passed: 4,
    warnings: 1,
    failed: 1,
    top_gap: 'One admin surface needs evidence.',
    next_action: 'Open the failed surface and attach drilldown evidence.',
    surfaces: [
      {
        id: 'ad-os',
        path: '/admin/ad-os',
        label: 'Ad OS',
        status: 'pass',
        evidence: 'Summary and drilldown are present.',
        data_sources: ['ad_os_summary'],
        expected_states: ['summary', 'safety', 'drilldown'],
        drilldown_url: '/admin/ad-os',
        next_action: 'Keep monitoring safety labels.',
      },
    ],
    safety: {
      read_only: true,
      database_mutation: false,
      external_api_write: false,
      live_spend_krw: 0,
    },
  },
};

describe('Ad OS AdminSurfaceQaPanel', () => {
  it('renders QA status, metrics, surface evidence, and safety state', () => {
    const html = renderToStaticMarkup(
      <AdminSurfaceQaPanel adminSurfaceQa={qaFixture} checking={false} onRefresh={() => {}} />,
    );

    expect(html).toContain('관리자 화면 QA');
    expect(html).toContain('One admin surface needs evidence.');
    expect(html).toContain('83%');
    expect(html).toContain('Ad OS');
    expect(html).toContain('/admin/ad-os');
    expect(html).toContain('DB 변경 꺼짐 - 외부 반영 꺼짐');
  });

  it('renders the empty state before QA data is loaded', () => {
    const html = renderToStaticMarkup(
      <AdminSurfaceQaPanel adminSurfaceQa={null} checking={false} onRefresh={() => {}} />,
    );

    expect(html).toContain('미점검');
    expect(html).toContain('관리자 운영 화면 6개를 확인하세요.');
    expect(html).toContain('QA를 실행하면 6개 관리자 화면');
  });
});
