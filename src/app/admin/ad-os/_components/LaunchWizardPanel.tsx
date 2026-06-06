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
            <h2 className="text-admin-base font-semibold text-admin-text-2">Launch checklist</h2>
            <StatusPill tone={launchReadyCount >= launchSteps.length ? 'good' : launchReadyCount >= 3 ? 'warn' : 'bad'}>
              {launchReadyCount}/{launchSteps.length} ready
            </StatusPill>
          </div>
          <p className="mt-1 text-admin-xs text-admin-muted">
            Keeps external ad launch gated by publisher API, budget, approval, and dry-run evidence.
          </p>
        </div>
        <div className="rounded-admin-sm bg-admin-surface-2 px-3 py-2 text-admin-xs text-admin-muted">
          Next: <span className="font-semibold text-admin-text">{nextLaunchStep ? nextLaunchStep.next : 'Pilot budget and L2 execution are ready.'}</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-5">
        {launchSteps.map((step) => (
          <div key={step.label} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-admin-xs font-semibold text-admin-text">{step.label}</p>
              <StatusPill tone={step.done ? 'good' : 'warn'}>{step.done ? 'OK' : 'Waiting'}</StatusPill>
            </div>
            <p className="mt-2 admin-num text-admin-lg font-semibold text-admin-text">{step.value}</p>
            <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">{step.next}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h3 className="text-admin-sm font-semibold text-admin-text">Four-step start flow</h3>
            <p className="mt-1 text-admin-2xs text-admin-muted">
              Runs preparation only. External publishing remains gated until credentials, budget, approval, and dry-run checks pass.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onRunPilotSetup} loading={runningPilotSetup}>
              <Rocket size={14} />
              Prepare pilot
            </Button>
            <Button size="sm" variant="secondary" onClick={onRunLaunchAudit} loading={runningLaunchAudit}>
              <CheckCircle2 size={14} />
              Launch audit
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
                    <p className="text-admin-sm font-semibold text-admin-text">{PLATFORM_LABEL[platform]} launch readiness</p>
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
                        <StatusPill tone={check.done ? 'good' : 'warn'}>{check.done ? 'OK' : 'Waiting'}</StatusPill>
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
