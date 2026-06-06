import { ArrowRight, Download, Save } from 'lucide-react';
import Button from '@/components/ui/Button';
import {
  LAUNCH_ACTION_KEYS,
  type LaunchActionKey,
  type NaverSetupPacket,
  type Summary,
} from '../_lib/types';
import { actionTone } from '../_lib/display';
import { StatusPill } from './StatusPill';

type LaunchAction = Summary['launch_action_queue'][number];

export { LAUNCH_ACTION_KEYS };

export type LaunchActionHandlers = Record<LaunchActionKey, () => void>;
export type LaunchActionLoading = Record<LaunchActionKey, boolean>;

const LAUNCH_ACTION_KEY_SET = new Set<string>(LAUNCH_ACTION_KEYS);

function actionToneLabel(tone: LaunchAction['tone']): string {
  if (tone === 'good') return 'Recommended';
  if (tone === 'warn') return 'Bottleneck';
  if (tone === 'bad') return 'Safety';
  return 'Review';
}

function isLaunchActionKey(value: string): value is LaunchActionKey {
  return LAUNCH_ACTION_KEY_SET.has(value);
}

function getLaunchActionState(
  action: LaunchAction,
  actionHandlers: LaunchActionHandlers,
  actionLoading: LaunchActionLoading,
) {
  if (!isLaunchActionKey(action.ui_action)) {
    return {
      disabled: true,
      loading: false,
      onClick: undefined,
      title: `Unsupported action: ${action.ui_action}`,
    };
  }

  return {
    disabled: false,
    loading: actionLoading[action.ui_action],
    onClick: actionHandlers[action.ui_action],
    title: undefined,
  };
}

export function LaunchActionQueuePanel({
  actions,
  actionHandlers,
  actionLoading,
  naverSetupPacket,
  onDownloadNaverKeywordCsv,
  onCopyNaverKeywordCsv,
}: {
  actions: LaunchAction[];
  actionHandlers: LaunchActionHandlers;
  actionLoading: LaunchActionLoading;
  naverSetupPacket: NaverSetupPacket | null;
  onDownloadNaverKeywordCsv: () => void;
  onCopyNaverKeywordCsv: () => void;
}) {
  const topQueuedAction = actions[0] || null;
  const topQueuedActionState = topQueuedAction
    ? getLaunchActionState(topQueuedAction, actionHandlers, actionLoading)
    : null;

  return (
    <section className="admin-card p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-admin-base font-semibold text-admin-text-2">Today queue</h2>
          <p className="mt-1 text-admin-xs text-admin-muted">
            Orders the next Ad OS actions from current account, budget, keyword, and safety state.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="neutral">{actions.length} actions</StatusPill>
          {topQueuedAction && (
            <Button
              size="sm"
              onClick={topQueuedActionState?.onClick}
              loading={topQueuedActionState?.loading}
              disabled={topQueuedActionState?.disabled}
              title={topQueuedActionState?.title}
            >
              <ArrowRight size={14} />
              Run top action
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
        {actions.map((action) => {
          const actionState = getLaunchActionState(action, actionHandlers, actionLoading);

          return (
            <div key={action.id} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-admin-2xs font-bold text-admin-muted admin-num">#{action.priority}</p>
                  <p className="mt-1 text-admin-xs font-semibold text-admin-text">{action.label}</p>
                </div>
                <StatusPill tone={actionTone(action.tone)}>{actionToneLabel(action.tone)}</StatusPill>
              </div>
              <p className="mt-2 min-h-10 text-admin-2xs leading-5 text-admin-muted">{action.description}</p>
              <Button
                className="mt-3 w-full"
                size="sm"
                variant={action.tone === 'good' ? 'primary' : 'secondary'}
                onClick={actionState.onClick}
                loading={actionState.loading}
                disabled={actionState.disabled}
                title={actionState.title}
              >
                <ArrowRight size={14} />
                {action.button_label}
              </Button>
            </div>
          );
        })}
      </div>

      {naverSetupPacket && (
        <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="text-admin-sm font-semibold text-admin-text">Naver setup packet</h3>
              <p className="mt-1 text-admin-2xs text-admin-muted">{naverSetupPacket.next_action}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill tone={naverSetupPacket.existing_assets.campaigns > 0 ? 'good' : 'warn'}>
                campaigns {naverSetupPacket.existing_assets.campaigns}
              </StatusPill>
              <StatusPill tone={naverSetupPacket.existing_assets.adgroups > 0 ? 'good' : 'warn'}>
                ad groups {naverSetupPacket.existing_assets.adgroups}
              </StatusPill>
              <StatusPill tone={naverSetupPacket.existing_assets.channels > 0 ? 'good' : 'warn'}>
                channels {naverSetupPacket.existing_assets.channels}
              </StatusPill>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
            <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
              <p className="text-admin-2xs text-admin-muted">Campaign</p>
              <p className="mt-1 text-admin-xs font-semibold text-admin-text">{naverSetupPacket.packet.campaign_name}</p>
            </div>
            <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
              <p className="text-admin-2xs text-admin-muted">Ad group</p>
              <p className="mt-1 text-admin-xs font-semibold text-admin-text">{naverSetupPacket.packet.ad_group_name}</p>
            </div>
            <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
              <p className="text-admin-2xs text-admin-muted">Daily budget / Max CPC</p>
              <p className="mt-1 text-admin-xs font-semibold text-admin-text">
                {naverSetupPacket.packet.daily_budget_krw.toLocaleString('ko-KR')} KRW / {naverSetupPacket.packet.max_cpc_krw.toLocaleString('ko-KR')} KRW
              </p>
            </div>
            <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
              <p className="text-admin-2xs text-admin-muted">Keyword candidates</p>
              <p className="mt-1 text-admin-xs font-semibold text-admin-text">{naverSetupPacket.packet.keyword_count.toLocaleString('ko-KR')}</p>
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-admin-sm border border-admin-border">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Keyword</th>
                  <th>Match</th>
                  <th>Bid</th>
                  <th>Landing</th>
                </tr>
              </thead>
              <tbody>
                {naverSetupPacket.packet.keyword_samples.slice(0, 6).map((keyword, index) => (
                  <tr key={`${keyword.keyword}-${index}`}>
                    <td className="font-semibold text-admin-text">{keyword.keyword || '-'}</td>
                    <td>{keyword.match_type || '-'}</td>
                    <td className="admin-num">{keyword.bid_krw.toLocaleString('ko-KR')} KRW</td>
                    <td className="max-w-xs truncate">{keyword.final_url || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-admin-sm font-semibold text-admin-text">Naver keyword CSV</p>
                <p className="mt-1 text-admin-2xs text-admin-muted">
                  Keyword, match type, bid, and landing URL rows for upload or review.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={onDownloadNaverKeywordCsv}>
                  <Download size={14} />
                  Download CSV
                </Button>
                <Button size="sm" variant="secondary" onClick={onCopyNaverKeywordCsv}>
                  <Save size={14} />
                  Copy CSV
                </Button>
              </div>
            </div>
            <textarea
              className="mt-3 h-32 w-full resize-y rounded-admin-xs border border-admin-border bg-admin-surface px-3 py-2 font-mono text-admin-2xs text-admin-text"
              readOnly
              value={naverSetupPacket.packet.keyword_csv}
            />
          </div>
        </div>
      )}
    </section>
  );
}
