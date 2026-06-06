import { Bot, PauseCircle, Rocket, ShieldCheck } from 'lucide-react';

export function OperatingModesPanel() {
  return (
    <section className="admin-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-admin-base font-semibold text-admin-text-2">Operating modes</h2>
          <p className="mt-1 text-admin-xs text-admin-muted">
            Starts with AI recommendations and guarded approvals, then expands only after safety evidence is available.
          </p>
        </div>
        <ShieldCheck className="text-brand" size={20} />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
          <Bot size={16} className="text-brand" />
          <p className="mt-2 text-admin-sm font-semibold text-admin-text">AI recommendation</p>
          <p className="mt-1 text-admin-2xs text-admin-muted">
            Generates product scenarios, long-tail keywords, and landing candidates without external spend.
          </p>
        </div>
        <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
          <PauseCircle size={16} className="text-amber-600" />
          <p className="mt-2 text-admin-sm font-semibold text-admin-text">Safety gate</p>
          <p className="mt-1 text-admin-2xs text-admin-muted">
            Blocks live execution when budgets, products, keys, or risk rules are not ready.
          </p>
        </div>
        <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
          <Rocket size={16} className="text-emerald-600" />
          <p className="mt-2 text-admin-sm font-semibold text-admin-text">Automation scale-up</p>
          <p className="mt-1 text-admin-2xs text-admin-muted">
            Moves from low-risk tests to bid and pause automation only after performance data accumulates.
          </p>
        </div>
      </div>
    </section>
  );
}
