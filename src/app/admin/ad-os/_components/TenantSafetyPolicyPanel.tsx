import { ShieldCheck } from 'lucide-react';
import Button from '@/components/ui/Button';
import { fmtWon, PLATFORM_LABEL } from '../_lib/display';
import type { TenantPolicyDraft } from '../_lib/types';
import { StatusPill } from './StatusPill';

export function TenantSafetyPolicyPanel({
  policy,
  draft,
  saving,
  onSave,
  onUpdate,
  onTogglePlatform,
}: {
  policy?: TenantPolicyDraft;
  draft: TenantPolicyDraft | null;
  saving: boolean;
  onSave: () => void;
  onUpdate: (key: keyof TenantPolicyDraft, value: string | number | boolean) => void;
  onTogglePlatform: (platform: string) => void;
}) {
  if (!policy) return null;

  return (
    <section className="admin-card p-4">
      <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-admin-sm font-semibold text-admin-text">Tenant safety policy</p>
            <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">
              Controls allowed channels, spend caps, CPC limits, loss caps, automation level, and approval requirements.
              {policy.error ? 'Policy save failed.' : ''}
            </p>
          </div>
          <StatusPill tone={policy.configured ? 'good' : 'warn'}>
            {policy.configured ? 'Policy configured' : 'Default policy'}
          </StatusPill>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
          {[
            ['Channels', policy.allowed_platforms.join(', ')],
            ['Monthly cap', fmtWon(policy.monthly_budget_cap_krw)],
            ['Daily cap', fmtWon(policy.daily_budget_cap_krw)],
            ['Max CPC', fmtWon(policy.max_cpc_krw)],
            ['Test loss cap', fmtWon(policy.max_test_loss_krw)],
            ['Max level', `L${policy.max_automation_level}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
              <p className="text-admin-2xs text-admin-muted">{label}</p>
              <p className="mt-1 text-admin-xs font-semibold text-admin-text">{value}</p>
            </div>
          ))}
        </div>
        {draft && (
          <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-admin-sm font-semibold text-admin-text">Edit policy</p>
                <p className="mt-1 text-admin-2xs text-admin-muted">Adjust the limits that gate Ad OS automation for this tenant.</p>
              </div>
              <Button size="sm" onClick={onSave} loading={saving}>
                <ShieldCheck size={14} />
                Save policy
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-6">
              <label className="text-admin-2xs font-semibold text-admin-muted">
                Monthly cap
                <input
                  type="number"
                  min={0}
                  value={draft.monthly_budget_cap_krw}
                  onChange={(event) => onUpdate('monthly_budget_cap_krw', event.target.value)}
                  className="mt-1 h-9 w-full rounded-admin-xs border border-admin-border bg-admin-surface px-2 text-admin-xs text-admin-text"
                />
              </label>
              <label className="text-admin-2xs font-semibold text-admin-muted">
                Daily cap
                <input
                  type="number"
                  min={0}
                  value={draft.daily_budget_cap_krw}
                  onChange={(event) => onUpdate('daily_budget_cap_krw', event.target.value)}
                  className="mt-1 h-9 w-full rounded-admin-xs border border-admin-border bg-admin-surface px-2 text-admin-xs text-admin-text"
                />
              </label>
              <label className="text-admin-2xs font-semibold text-admin-muted">
                Max CPC
                <input
                  type="number"
                  min={0}
                  value={draft.max_cpc_krw}
                  onChange={(event) => onUpdate('max_cpc_krw', event.target.value)}
                  className="mt-1 h-9 w-full rounded-admin-xs border border-admin-border bg-admin-surface px-2 text-admin-xs text-admin-text"
                />
              </label>
              <label className="text-admin-2xs font-semibold text-admin-muted">
                Test loss cap
                <input
                  type="number"
                  min={0}
                  value={draft.max_test_loss_krw}
                  onChange={(event) => onUpdate('max_test_loss_krw', event.target.value)}
                  className="mt-1 h-9 w-full rounded-admin-xs border border-admin-border bg-admin-surface px-2 text-admin-xs text-admin-text"
                />
              </label>
              <label className="text-admin-2xs font-semibold text-admin-muted">
                Max automation level
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={draft.max_automation_level}
                  onChange={(event) => onUpdate('max_automation_level', event.target.value)}
                  className="mt-1 h-9 w-full rounded-admin-xs border border-admin-border bg-admin-surface px-2 text-admin-xs text-admin-text"
                />
              </label>
              <label className="text-admin-2xs font-semibold text-admin-muted">
                Risk status
                <select
                  value={draft.risk_status}
                  onChange={(event) => onUpdate('risk_status', event.target.value)}
                  className="mt-1 h-9 w-full rounded-admin-xs border border-admin-border bg-admin-surface px-2 text-admin-xs text-admin-text"
                >
                  <option value="normal">normal</option>
                  <option value="watch">watch</option>
                  <option value="restricted">restricted</option>
                  <option value="blocked">blocked</option>
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              {(['naver', 'google', 'meta', 'kakao'] as const).map((platform) => (
                <label key={platform} className="inline-flex items-center gap-1.5 text-admin-xs font-semibold text-admin-text">
                  <input
                    type="checkbox"
                    checked={(draft.allowed_platforms || []).includes(platform)}
                    onChange={() => onTogglePlatform(platform)}
                  />
                  {PLATFORM_LABEL[platform] || platform}
                </label>
              ))}
              <label className="inline-flex items-center gap-1.5 text-admin-xs font-semibold text-admin-text">
                <input
                  type="checkbox"
                  checked={draft.require_human_approval}
                  onChange={(event) => onUpdate('require_human_approval', event.target.checked)}
                />
                Require approval
              </label>
              <label className="inline-flex items-center gap-1.5 text-admin-xs font-semibold text-admin-text">
                <input
                  type="checkbox"
                  checked={draft.full_auto_enabled}
                  onChange={(event) => onUpdate('full_auto_enabled', event.target.checked)}
                />
                Allow full auto
              </label>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
