import { CheckCircle2, Rocket } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { Summary } from '../_lib/types';
import { PLATFORM_LABEL } from '../_lib/display';
import { StatusPill } from './StatusPill';

export type LaunchChecklistStep = {
  label: string;
  done: boolean;
  value: string;
  next: string;
};

export type LaunchWizardStep = {
  label: string;
  status: string;
  done: boolean;
  body: string;
};

export function LaunchWizardPanel({
  launchSteps,
  launchWizardSteps,
  externalLaunchStatus,
  onRunPilotSetup,
  runningPilotSetup,
  onRunLaunchAudit,
  runningLaunchAudit,
}: {
  launchSteps: LaunchChecklistStep[];
  launchWizardSteps: LaunchWizardStep[];
  externalLaunchStatus: Summary['external_launch_status'];
  onRunPilotSetup: () => void;
  runningPilotSetup: boolean;
  onRunLaunchAudit: () => void;
  runningLaunchAudit: boolean;
}) {
  const launchReadyCount = launchSteps.filter((step) => step.done).length;
  const nextLaunchStep = launchSteps.find((step) => !step.done);

  return (
    <section className="admin-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-admin-base font-semibold text-admin-text-2">집행 전 체크</h2>
            <StatusPill tone={launchReadyCount >= launchSteps.length ? 'good' : launchReadyCount >= 3 ? 'warn' : 'bad'}>
              {launchReadyCount}/{launchSteps.length} 준비
            </StatusPill>
          </div>
          <p className="mt-1 text-admin-xs text-admin-muted">
            외부 광고 집행은 API 연동, 예산, 승인, 드라이런 근거가 통과해야 열립니다.
          </p>
        </div>
        <div className="rounded-admin-sm bg-admin-surface-2 px-3 py-2 text-admin-xs text-admin-muted">
          다음: <span className="font-semibold text-admin-text">{nextLaunchStep ? nextLaunchStep.next : '파일럿 예산과 L2 실행 준비가 끝났습니다.'}</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-5">
        {launchSteps.map((step) => (
          <div key={step.label} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-admin-xs font-semibold text-admin-text">{step.label}</p>
              <StatusPill tone={step.done ? 'good' : 'warn'}>{step.done ? '완료' : '대기'}</StatusPill>
            </div>
            <p className="mt-2 admin-num text-admin-lg font-semibold text-admin-text">{step.value}</p>
            <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">{step.next}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h3 className="text-admin-sm font-semibold text-admin-text">4단계 시작 흐름</h3>
            <p className="mt-1 text-admin-2xs text-admin-muted">
              준비 작업만 실행합니다. 계정, 예산, 승인, 드라이런 확인 전에는 외부 집행을 막습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onRunPilotSetup} loading={runningPilotSetup}>
              <Rocket size={14} />
              파일럿 준비
            </Button>
            <Button size="sm" variant="secondary" onClick={onRunLaunchAudit} loading={runningLaunchAudit}>
              <CheckCircle2 size={14} />
              집행 점검
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
          {launchWizardSteps.map((step) => (
            <div key={step.label} className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-admin-xs font-semibold text-admin-text">{step.label}</p>
                <StatusPill tone={step.done ? 'good' : 'warn'}>{step.status}</StatusPill>
              </div>
              <p className="mt-1 text-admin-2xs text-admin-muted">{step.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {(['naver', 'google'] as const).map((platform) => {
            const status = externalLaunchStatus?.[platform];
            if (!status) return null;
            return (
              <div key={platform} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                <p className="text-admin-sm font-semibold text-admin-text">{PLATFORM_LABEL[platform]} 집행 준비</p>
                    <p className="mt-1 text-admin-2xs text-admin-muted">{status.next_action}</p>
                  </div>
                  <StatusPill tone={status.ready ? 'good' : status.pass >= status.total - 1 ? 'warn' : 'bad'}>
                    {status.pass}/{status.total}
                  </StatusPill>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {status.checks.map((check) => (
                    <div key={check.id} className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-admin-xs font-semibold text-admin-text">{check.label}</span>
                        <StatusPill tone={check.done ? 'good' : 'warn'}>{check.done ? '완료' : '대기'}</StatusPill>
                      </div>
                      {!check.done && <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">{check.next}</p>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
