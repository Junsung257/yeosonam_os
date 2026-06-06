import type { Summary } from '../_lib/types';
import { StatusPill } from './StatusPill';

function getGuardrailStatusView(status: 'pass' | 'warn' | 'fail'): { tone: 'good' | 'warn' | 'bad'; label: string } {
  if (status === 'pass') return { tone: 'good', label: 'Pass' };
  if (status === 'warn') return { tone: 'warn', label: 'Warning' };
  return { tone: 'bad', label: 'Blocked' };
}

export function AutomationPolicyPanel({
  automationModes,
  tenantGuardrails,
  tenantAdReadiness,
}: {
  automationModes: Summary['automation_modes'];
  tenantGuardrails: Summary['tenant_guardrails'];
  tenantAdReadiness: Summary['tenant_ad_readiness'];
}) {
  return (
    <section className="admin-card p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-admin-base font-semibold text-admin-text-2">Automation policy</h2>
          <p className="mt-1 text-admin-xs text-admin-muted">
            Keeps Ad OS in recommendation and approval modes until budgets, credentials, and tenant safety rules are ready.
          </p>
        </div>
        <StatusPill tone="warn">Default: recommendation / approval</StatusPill>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
        {(automationModes || []).map((mode, index) => (
          <div key={mode.id} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="admin-num text-admin-2xs font-bold text-admin-muted">{index + 1} step</span>
              <StatusPill tone={index < 2 ? 'good' : index === 2 ? 'warn' : 'neutral'}>{mode.label}</StatusPill>
            </div>
            <p className="mt-2 text-admin-xs leading-5 text-admin-muted">{mode.description}</p>
            <p className="mt-2 text-admin-2xs text-admin-muted">
              L{mode.levelMin}{mode.levelMin !== mode.levelMax ? `-L${mode.levelMax}` : ''}
            </p>
          </div>
        ))}
      </div>
      {tenantGuardrails && (
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
          {tenantGuardrails.map((guardrail) => {
            const statusView = getGuardrailStatusView(guardrail.status);
            return (
              <div key={guardrail.id} className="rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-admin-xs font-semibold text-admin-text">{guardrail.label}</p>
                  <StatusPill tone={statusView.tone}>{statusView.label}</StatusPill>
                </div>
                <p className="mt-2 text-admin-2xs leading-5 text-admin-muted">{guardrail.detail}</p>
              </div>
            );
          })}
        </div>
      )}
      {tenantAdReadiness && (
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
          {tenantAdReadiness.map((item) => {
            const statusView = getGuardrailStatusView(item.status);
            return (
              <div key={item.id} className="rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-admin-xs font-semibold text-admin-text">{item.label}</p>
                  <StatusPill tone={statusView.tone}>{statusView.label}</StatusPill>
                </div>
                <p className="mt-2 text-admin-2xs leading-5 text-admin-muted">{item.detail}</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
