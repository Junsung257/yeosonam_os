import { AlertTriangle, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { LaunchActionHandlers, LaunchActionLoading } from './LaunchActionQueuePanel';
import type { BeginnerAdOpsModel, BeginnerAdOpsStatus } from '../_lib/beginner-mode-model';
import { StatusPill, type StatusPillTone } from './StatusPill';

function statusTone(status: BeginnerAdOpsStatus): StatusPillTone {
  if (status === 'ready') return 'good';
  if (status === 'attention') return 'warn';
  return 'bad';
}

function statusLabel(status: BeginnerAdOpsStatus) {
  if (status === 'ready') return '시작 가능';
  if (status === 'attention') return '확인 필요';
  return '시작 불가';
}

export function BeginnerAdOpsPanel({
  model,
  actionHandlers,
  actionLoading,
  onOpenSettings,
  onOpenAdvanced,
}: {
  model: BeginnerAdOpsModel;
  actionHandlers: LaunchActionHandlers;
  actionLoading: LaunchActionLoading;
  onOpenSettings: () => void;
  onOpenAdvanced: () => void;
}) {
  const Icon = model.status === 'ready' ? CheckCircle2 : model.status === 'attention' ? ShieldCheck : AlertTriangle;
  const primaryAction = model.primaryAction;

  return (
    <section className="admin-card overflow-hidden p-0">
      <div className="border-b border-admin-border bg-admin-surface p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-admin-md bg-admin-surface-2 text-admin-text">
              <Icon size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-admin-lg font-bold text-admin-text-2">{model.title}</h2>
                <StatusPill tone={statusTone(model.status)}>{statusLabel(model.status)}</StatusPill>
              </div>
              <p className="mt-1 text-admin-xs leading-5 text-admin-muted">{model.summary}</p>
              {model.status !== 'ready' && (
                <p className="mt-1 text-admin-2xs font-semibold text-amber-700">
                  광고 시작 전 확인 필요 항목을 먼저 정리하세요.
                </p>
              )}
              <p className="mt-2 rounded-admin-sm bg-emerald-50 px-3 py-2 text-admin-2xs font-semibold leading-5 text-emerald-800">
                {model.safetyNote}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            {primaryAction && (
              <Button
                size="sm"
                variant="primary"
                onClick={actionHandlers[primaryAction.ui_action]}
                loading={actionLoading[primaryAction.ui_action]}
              >
                <ArrowRight size={14} />
                {primaryAction.button_label}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={onOpenSettings}>상세 설정</Button>
            <Button size="sm" variant="secondary" onClick={onOpenAdvanced}>고급/감사</Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
          {model.metrics.map((metric) => (
            <div key={metric.label} className="rounded-admin-sm border border-admin-border bg-admin-surface-2 px-3 py-2">
              <p className="text-admin-2xs text-admin-muted">{metric.label}</p>
              <p className="mt-1 text-admin-sm font-bold text-admin-text">{metric.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="p-4">
          <p className="text-admin-sm font-semibold text-admin-text">지금 할 일</p>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            {model.visibleActions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={actionHandlers[action.ui_action]}
                disabled={actionLoading[action.ui_action]}
                className="min-h-[104px] rounded-admin-sm border border-admin-border bg-admin-surface px-3 py-3 text-left transition hover:border-admin-border-strong hover:bg-admin-surface-2 disabled:opacity-60"
              >
                <span className="text-admin-2xs font-bold text-admin-muted">#{action.priority}</span>
                <span className="mt-1 block text-admin-xs font-bold text-admin-text">{action.label}</span>
                <span className="mt-1 line-clamp-2 text-admin-2xs leading-5 text-admin-muted">{action.description}</span>
              </button>
            ))}
            {model.visibleActions.length === 0 && (
              <div className="rounded-admin-sm border border-admin-border bg-admin-surface px-3 py-3 text-admin-2xs text-admin-muted">
                지금 바로 실행할 초보자용 작업이 없습니다. 상세 설정에서 계정과 예산을 먼저 확인하세요.
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-admin-border bg-admin-surface-2 p-4 lg:border-l lg:border-t-0">
          <p className="text-admin-sm font-semibold text-admin-text">막힌 이유</p>
          <div className="mt-3 space-y-2">
            {model.nextSteps.map((step) => (
              <p key={step} className="rounded-admin-xs bg-admin-surface px-3 py-2 text-admin-2xs leading-5 text-admin-muted">
                {step}
              </p>
            ))}
          </div>
          <p className="mt-3 text-admin-2xs text-admin-muted">
            고급 작업 {model.hiddenAdvancedCount.toLocaleString('ko-KR')}개는 기본 화면에서 숨겼습니다.
          </p>
        </div>
      </div>
    </section>
  );
}
