import type { BudgetDraft } from '../_lib/types';
import { PLATFORM_LABEL } from '../_lib/display';
import { StatusPill } from './StatusPill';

export function BudgetGuardrailTable({
  budgets,
  onChange,
}: {
  budgets: BudgetDraft[];
  onChange: (platform: string, key: keyof BudgetDraft, value: string | number) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-admin-base font-semibold text-admin-text-2">Channel budget guardrails</h2>
        <StatusPill tone={budgets.some((budget) => budget.configured) ? 'good' : 'warn'}>Budget cap</StatusPill>
      </div>
      <div className="mt-3 overflow-hidden rounded-admin-sm border border-admin-border">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Monthly cap</th>
              <th>Daily cap</th>
              <th>Max CPC</th>
              <th>External group ID</th>
              <th>Level</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {budgets.map((budget) => (
              <tr key={budget.platform}>
                <td className="font-semibold text-admin-text">{PLATFORM_LABEL[budget.platform]}</td>
                <td>
                  <input
                    className="w-24 rounded-admin-xs border border-admin-border bg-admin-surface px-2 py-1 text-right text-admin-xs admin-num"
                    type="number"
                    min={0}
                    value={budget.monthly_budget_krw}
                    onChange={(event) => onChange(budget.platform, 'monthly_budget_krw', event.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="w-24 rounded-admin-xs border border-admin-border bg-admin-surface px-2 py-1 text-right text-admin-xs admin-num"
                    type="number"
                    min={0}
                    value={budget.daily_budget_cap_krw}
                    onChange={(event) => onChange(budget.platform, 'daily_budget_cap_krw', event.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="w-20 rounded-admin-xs border border-admin-border bg-admin-surface px-2 py-1 text-right text-admin-xs admin-num"
                    type="number"
                    min={0}
                    value={budget.max_cpc_krw}
                    onChange={(event) => onChange(budget.platform, 'max_cpc_krw', event.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="w-44 rounded-admin-xs border border-admin-border bg-admin-surface px-2 py-1 text-admin-xs"
                    type="text"
                    placeholder={budget.platform === 'naver' ? 'nccAdgroupId' : 'optional'}
                    value={budget.external_ad_group_id || ''}
                    onChange={(event) => onChange(budget.platform, 'external_ad_group_id', event.target.value)}
                  />
                </td>
                <td>
                  <select
                    className="rounded-admin-xs border border-admin-border bg-admin-surface px-2 py-1 text-admin-xs admin-num"
                    value={budget.automation_level}
                    onChange={(event) => onChange(budget.platform, 'automation_level', event.target.value)}
                  >
                    {[1, 2, 3, 4, 5].map((level) => (
                      <option key={level} value={level}>L{level}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="rounded-admin-xs border border-admin-border bg-admin-surface px-2 py-1 text-admin-xs"
                    value={budget.status}
                    onChange={(event) => onChange(budget.platform, 'status', event.target.value)}
                  >
                    <option value="paused">Paused</option>
                    <option value="active">Active</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
