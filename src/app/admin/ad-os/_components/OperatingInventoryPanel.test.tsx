import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OperatingInventory } from '../_lib/types';
import { OperatingInventoryPanel } from './OperatingInventoryPanel';

const inventoryFixture: OperatingInventory = {
  ok: true,
  generated_at: '2026-06-05T00:00:00.000Z',
  inventory: {
    status: 'partial',
    readiness_score: 75,
    operational: 6,
    partial: 2,
    blocked: 1,
    top_gap: 'Runtime execution needs operator evidence.',
    next_action: 'Attach execution evidence before limited automation.',
    items: [
      {
        id: 'runtime',
        label: 'Runtime execution',
        status: 'partial',
        evidence: 'Executor queue is ready but not confirmed.',
        next_action: 'Confirm dry-run execution.',
        risk: 'medium',
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

describe('Ad OS OperatingInventoryPanel', () => {
  it('renders inventory status, metrics, evidence, and live-spend safety', () => {
    const html = renderToStaticMarkup(
      <OperatingInventoryPanel operatingInventory={inventoryFixture} checking={false} onRefresh={() => {}} />,
    );

    expect(html).toContain('운영 항목 점검');
    expect(html).toContain('Runtime execution needs operator evidence.');
    expect(html).toContain('75%');
    expect(html).toContain('Runtime execution');
    expect(html).toContain('Executor queue is ready but not confirmed.');
    expect(html).toContain('실제 광고비');
  });

  it('renders the empty state before inventory data is loaded', () => {
    const html = renderToStaticMarkup(
      <OperatingInventoryPanel operatingInventory={null} checking={false} onRefresh={() => {}} />,
    );

    expect(html).toContain('미점검');
    expect(html).toContain('광고 운영 항목을 점검하세요.');
    expect(html).toContain('운영 항목 점검을 실행하면');
  });
});
