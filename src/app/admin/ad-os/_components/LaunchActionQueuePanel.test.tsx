import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NaverSetupPacket, Summary } from '../_lib/types';
import {
  LAUNCH_ACTION_KEYS,
  LaunchActionQueuePanel,
  type LaunchActionHandlers,
  type LaunchActionLoading,
} from './LaunchActionQueuePanel';

const actions: Summary['launch_action_queue'] = [
  {
    id: 'pilot',
    priority: 1,
    label: 'Pilot setup',
    description: 'Prepare a limited launch packet.',
    button_label: 'Prepare pilot',
    ui_action: 'runPilotSetup',
    tone: 'good',
  },
  {
    id: 'audit',
    priority: 2,
    label: 'Launch audit',
    description: 'Check safety gates before launch.',
    button_label: 'Run audit',
    ui_action: 'runLaunchAudit',
    tone: 'warn',
  },
];

const naverPacket: NaverSetupPacket = {
  existing_assets: {
    campaigns: 1,
    adgroups: 0,
    channels: 1,
    stored_adgroup_id: null,
  },
  required_external: [],
  packet: {
    campaign_name: 'YNM Pilot',
    ad_group_name: 'Bohol Parents',
    daily_budget_krw: 30000,
    monthly_budget_krw: 500000,
    max_cpc_krw: 500,
    landing_url: '/packages/bohol',
    final_url: '/packages/bohol',
    keyword_count: 2,
    keyword_csv: 'keyword,bid\nbohol,500',
    keyword_samples: [
      {
        keyword: 'bohol package',
        match_type: 'phrase',
        bid_krw: 500,
        final_url: '/packages/bohol',
      },
    ],
  },
  next_action: 'Review and upload the packet.',
};

const handlers: LaunchActionHandlers = Object.fromEntries(
  LAUNCH_ACTION_KEYS.map((key) => [key, () => {}]),
) as LaunchActionHandlers;

const loading: LaunchActionLoading = Object.fromEntries(
  LAUNCH_ACTION_KEYS.map((key) => [key, false]),
) as LaunchActionLoading;

describe('Ad OS LaunchActionQueuePanel', () => {
  it('renders queued actions, top action, and Naver setup packet controls', () => {
    const html = renderToStaticMarkup(
      <LaunchActionQueuePanel
        actions={actions}
        actionHandlers={handlers}
        actionLoading={{ ...loading, runLaunchAudit: true }}
        naverSetupPacket={naverPacket}
        onDownloadNaverKeywordCsv={() => {}}
        onCopyNaverKeywordCsv={() => {}}
      />,
    );

    expect(html).toContain('Today queue');
    expect(html).toContain('2 actions');
    expect(html).toContain('Run top action');
    expect(html).toContain('Pilot setup');
    expect(html).toContain('Recommended');
    expect(html).toContain('Naver setup packet');
    expect(html).toContain('bohol package');
    expect(html).toContain('Download CSV');
    expect(html).toContain('Copy CSV');
  });

  it('renders without the optional Naver setup packet', () => {
    const html = renderToStaticMarkup(
      <LaunchActionQueuePanel
        actions={actions.slice(0, 1)}
        actionHandlers={handlers}
        actionLoading={loading}
        naverSetupPacket={null}
        onDownloadNaverKeywordCsv={() => {}}
        onCopyNaverKeywordCsv={() => {}}
      />,
    );

    expect(html).toContain('1 actions');
    expect(html).not.toContain('Naver setup packet');
  });

  it('supports the degraded summary refresh action', () => {
    const html = renderToStaticMarkup(
      <LaunchActionQueuePanel
        actions={[{
          id: 'data_plane_recover',
          priority: 1,
          label: 'Data recovery',
          description: 'Refresh the Ad OS data plane.',
          button_label: 'Refresh status',
          ui_action: 'refresh',
          tone: 'bad',
        }]}
        actionHandlers={handlers}
        actionLoading={{ ...loading, refresh: true }}
        naverSetupPacket={null}
        onDownloadNaverKeywordCsv={() => {}}
        onCopyNaverKeywordCsv={() => {}}
      />,
    );

    expect(html).toContain('Refresh status');
    expect(html).toContain('Run top action');
    expect(html).toContain('disabled=""');
  });

  it('disables unsupported server-provided actions instead of wiring an undefined click handler', () => {
    const html = renderToStaticMarkup(
      <LaunchActionQueuePanel
        actions={[{
          id: 'unknown',
          priority: 1,
          label: 'Unknown action',
          description: 'Server sent an unsupported action key.',
          button_label: 'Run unsupported',
          ui_action: 'newServerAction',
          tone: 'warn',
        } as unknown as Summary['launch_action_queue'][number]]}
        actionHandlers={handlers}
        actionLoading={loading}
        naverSetupPacket={null}
        onDownloadNaverKeywordCsv={() => {}}
        onCopyNaverKeywordCsv={() => {}}
      />,
    );

    expect(html).toContain('Run unsupported');
    expect(html).toContain('Unsupported action: newServerAction');
    expect((html.match(/disabled=""/g) || []).length).toBe(2);
  });
});
