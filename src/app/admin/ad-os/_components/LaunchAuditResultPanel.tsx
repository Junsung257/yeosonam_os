import type { LaunchAudit } from '../_lib/types';
import { auditTone } from '../_lib/display';
import { StatusPill } from './StatusPill';

export function LaunchAuditResultPanel({ launchAudit }: { launchAudit: LaunchAudit | null }) {
  if (!launchAudit) return null;

  return (
    <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-admin-sm font-semibold text-admin-text">Launch audit result</p>
          <p className="mt-1 text-admin-2xs text-admin-muted">{launchAudit.readiness.next_action}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="good">pass {launchAudit.readiness.pass}</StatusPill>
          <StatusPill tone="warn">warn {launchAudit.readiness.warn}</StatusPill>
          <StatusPill tone="bad">fail {launchAudit.readiness.fail}</StatusPill>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
        {launchAudit.items.map((check) => (
          <div key={check.id} className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-admin-xs font-semibold text-admin-text">{check.label}</p>
              <StatusPill tone={auditTone(check.status)}>{check.status}</StatusPill>
            </div>
            <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">{check.evidence}</p>
            <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">{check.next_action}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
