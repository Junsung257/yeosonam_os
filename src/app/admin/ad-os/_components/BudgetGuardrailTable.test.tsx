import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { BudgetDraft } from '../_lib/types';
import { BudgetGuardrailTable } from './BudgetGuardrailTable';

const budgets: BudgetDraft[] = [
  {
    platform: 'naver',
    configured: true,
    monthly_budget_krw: 100000,
    daily_budget_cap_krw: 10000,
    max_cpc_krw: 500,
    max_test_loss_krw: 20000,
    automation_level: 2,
    status: 'active',
    external_account_id: null,
    external_campaign_id: null,
    external_ad_group_id: 'ncc-adgroup-1',
    external_config_note: null,
  },
  {
    platform: 'google',
    configured: false,
    monthly_budget_krw: 0,
    daily_budget_cap_krw: 0,
    max_cpc_krw: 0,
    max_test_loss_krw: 0,
    automation_level: 1,
    status: 'paused',
    external_account_id: null,
    external_campaign_id: null,
    external_ad_group_id: null,
    external_config_note: null,
  },
];

describe('Ad OS BudgetGuardrailTable', () => {
  it('renders budget guardrails, editable fields, and status options', () => {
    const html = renderToStaticMarkup(
      <BudgetGuardrailTable budgets={budgets} onChange={vi.fn()} />,
    );

    expect(html).toContain('Channel budget guardrails');
    expect(html).toContain('Budget cap');
    expect(html).toContain('Monthly cap');
    expect(html).toContain('ncc-adgroup-1');
    expect(html).toContain('nccAdgroupId');
    expect(html).toContain('optional');
    expect(html).toContain('Paused');
    expect(html).toContain('Active');
  });

  it('keeps an empty table stable before drafts are loaded', () => {
    const html = renderToStaticMarkup(
      <BudgetGuardrailTable budgets={[]} onChange={vi.fn()} />,
    );

    expect(html).toContain('Channel');
    expect(html).toContain('Budget cap');
  });
});
