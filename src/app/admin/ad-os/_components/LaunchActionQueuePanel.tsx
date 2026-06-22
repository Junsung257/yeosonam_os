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
  if (tone === 'good') return '추천';
  if (tone === 'warn') return '병목';
  if (tone === 'bad') return '안전 확인';
  return '검토';
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
      title: `지원하지 않는 작업: ${action.ui_action}`,
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
          <h2 className="text-admin-base font-semibold text-admin-text-2">오늘 할 일</h2>
          <p className="mt-1 text-admin-xs text-admin-muted">
            계정, 예산, 키워드, 안전 상태를 보고 지금 먼저 처리할 광고 작업을 정렬합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="neutral">{actions.length}개 작업</StatusPill>
          {topQueuedAction && (
            <Button
              size="sm"
              onClick={topQueuedActionState?.onClick}
              loading={topQueuedActionState?.loading}
              disabled={topQueuedActionState?.disabled}
              title={topQueuedActionState?.title}
            >
              <ArrowRight size={14} />
              1순위 실행
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
              <h3 className="text-admin-sm font-semibold text-admin-text">네이버 세팅 패킷</h3>
              <p className="mt-1 text-admin-2xs text-admin-muted">{naverSetupPacket.next_action}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill tone={naverSetupPacket.existing_assets.campaigns > 0 ? 'good' : 'warn'}>
                캠페인 {naverSetupPacket.existing_assets.campaigns}
              </StatusPill>
              <StatusPill tone={naverSetupPacket.existing_assets.adgroups > 0 ? 'good' : 'warn'}>
                광고그룹 {naverSetupPacket.existing_assets.adgroups}
              </StatusPill>
              <StatusPill tone={naverSetupPacket.existing_assets.channels > 0 ? 'good' : 'warn'}>
                채널 {naverSetupPacket.existing_assets.channels}
              </StatusPill>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
            <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
              <p className="text-admin-2xs text-admin-muted">캠페인</p>
              <p className="mt-1 text-admin-xs font-semibold text-admin-text">{naverSetupPacket.packet.campaign_name}</p>
            </div>
            <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
              <p className="text-admin-2xs text-admin-muted">광고그룹</p>
              <p className="mt-1 text-admin-xs font-semibold text-admin-text">{naverSetupPacket.packet.ad_group_name}</p>
            </div>
            <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
              <p className="text-admin-2xs text-admin-muted">일예산 / 최대 CPC</p>
              <p className="mt-1 text-admin-xs font-semibold text-admin-text">
                {naverSetupPacket.packet.daily_budget_krw.toLocaleString('ko-KR')}원 / {naverSetupPacket.packet.max_cpc_krw.toLocaleString('ko-KR')}원
              </p>
            </div>
            <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
              <p className="text-admin-2xs text-admin-muted">키워드 후보</p>
              <p className="mt-1 text-admin-xs font-semibold text-admin-text">{naverSetupPacket.packet.keyword_count.toLocaleString('ko-KR')}</p>
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-admin-sm border border-admin-border">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>키워드</th>
                  <th>일치</th>
                  <th>입찰가</th>
                  <th>랜딩</th>
                </tr>
              </thead>
              <tbody>
                {naverSetupPacket.packet.keyword_samples.slice(0, 6).map((keyword, index) => (
                  <tr key={`${keyword.keyword}-${index}`}>
                    <td className="font-semibold text-admin-text">{keyword.keyword || '-'}</td>
                    <td>{keyword.match_type || '-'}</td>
                    <td className="admin-num">{keyword.bid_krw.toLocaleString('ko-KR')}원</td>
                    <td className="max-w-xs truncate">{keyword.final_url || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-admin-sm font-semibold text-admin-text">네이버 키워드 CSV</p>
                <p className="mt-1 text-admin-2xs text-admin-muted">
                  업로드 또는 검수용 키워드, 일치 방식, 입찰가, 랜딩 URL입니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={onDownloadNaverKeywordCsv}>
                  <Download size={14} />
                  CSV 다운로드
                </Button>
                <Button size="sm" variant="secondary" onClick={onCopyNaverKeywordCsv}>
                  <Save size={14} />
                  CSV 복사
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
