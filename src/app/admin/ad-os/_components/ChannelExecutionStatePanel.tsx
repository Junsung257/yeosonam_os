import type { Summary } from '../_lib/types';
import { StatusPill } from './StatusPill';

type ExecutionStateEntry = NonNullable<Summary['channel_execution_states']>[string];
type ActiveMode = NonNullable<Summary['active_automation_modes']>[number];

function formatMode(mode?: ActiveMode): string {
  if (mode?.mode === 'full_auto') return 'Full auto';
  if (mode?.mode === 'limited_auto') return 'Limited auto';
  if (mode?.mode === 'approval') return 'Approval';
  return 'Recommendation';
}

export function ChannelExecutionStatePanel({
  entries,
  activeModeByPlatform,
}: {
  entries: Array<[string, ExecutionStateEntry]>;
  activeModeByPlatform: Map<string, ActiveMode>;
}) {
  const canSpend = entries.some(([, state]) => state.canSpend);

  return (
    <section className="admin-card p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-admin-base font-semibold text-admin-text-2">Channel execution state</h2>
          <p className="mt-1 text-admin-xs text-admin-muted">
            Shows whether each search channel is credentialed, blocked, missing campaigns, or ready to spend.
          </p>
        </div>
        <StatusPill tone={canSpend ? 'good' : 'warn'}>
          Spend {canSpend ? 'allowed' : 'blocked'}
        </StatusPill>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {entries.map(([platform, state]) => {
          const activeMode = activeModeByPlatform.get(platform);
          return (
            <div key={platform} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-admin-sm font-semibold text-admin-text">
                    {platform === 'naver' ? 'Naver publisher' : 'Google publisher'}
                  </p>
                  <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">{state.summary}</p>
                </div>
                <StatusPill tone={state.tone}>{state.label}</StatusPill>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
                  <p className="text-admin-2xs text-admin-muted">Mode</p>
                  <p className="mt-1 text-admin-xs font-semibold text-admin-text">{formatMode(activeMode)}</p>
                </div>
                <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
                  <p className="text-admin-2xs text-admin-muted">Level</p>
                  <p className="mt-1 text-admin-xs font-semibold text-admin-text">L{activeMode?.level ?? 1}</p>
                </div>
                <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
                  <p className="text-admin-2xs text-admin-muted">Spend</p>
                  <p className="mt-1 text-admin-xs font-semibold text-admin-text">
                    {state.canSpend ? 'Allowed' : 'Blocked'}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-admin-2xs leading-5 text-admin-muted">Next: {state.nextAction}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
