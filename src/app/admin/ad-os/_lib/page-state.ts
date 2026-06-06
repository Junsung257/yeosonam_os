'use client';

import { useCallback, useReducer } from 'react';
import type { BudgetDraft, Summary, TenantPolicyDraft } from './types';

export type AdOsPageState = {
  summary: Summary | null;
  budgetDrafts: BudgetDraft[];
  loading: boolean;
  error: string | null;
  tenantPolicyDraft: TenantPolicyDraft | null;
};

export type AdOsPageStateAction =
  | { type: 'loading'; loading: boolean }
  | { type: 'error'; error: string | null }
  | { type: 'summary-loaded'; summary: Summary }
  | { type: 'update-budget-draft'; platform: string; key: keyof BudgetDraft; value: string | number }
  | { type: 'update-tenant-policy-draft'; key: keyof TenantPolicyDraft; value: unknown }
  | { type: 'toggle-tenant-platform'; platform: string };

export const INITIAL_AD_OS_PAGE_STATE: AdOsPageState = {
  summary: null,
  budgetDrafts: [],
  loading: true,
  error: null,
  tenantPolicyDraft: null,
};

const BUDGET_NUMERIC_KEYS: ReadonlyArray<keyof BudgetDraft> = [
  'monthly_budget_krw',
  'daily_budget_cap_krw',
  'max_cpc_krw',
  'max_test_loss_krw',
  'automation_level',
];

const TENANT_POLICY_NUMERIC_KEYS: ReadonlyArray<keyof TenantPolicyDraft> = [
  'monthly_budget_cap_krw',
  'daily_budget_cap_krw',
  'max_cpc_krw',
  'max_test_loss_krw',
  'max_automation_level',
];

export function reduceAdOsPageState(
  state: AdOsPageState,
  action: AdOsPageStateAction,
): AdOsPageState {
  switch (action.type) {
    case 'loading':
      if (state.loading === action.loading) return state;
      return { ...state, loading: action.loading };
    case 'error':
      if (state.error === action.error) return state;
      return { ...state, error: action.error };
    case 'summary-loaded':
      return {
        ...state,
        summary: action.summary,
        budgetDrafts: action.summary.channel_budgets,
        tenantPolicyDraft: action.summary.tenant_policy || null,
      };
    case 'update-budget-draft':
      return {
        ...state,
        budgetDrafts: state.budgetDrafts.map((budget) => {
          if (budget.platform !== action.platform) return budget;
          return {
            ...budget,
            [action.key]: BUDGET_NUMERIC_KEYS.includes(action.key)
              ? Number(action.value || 0)
              : action.value,
          };
        }),
      };
    case 'update-tenant-policy-draft':
      if (!state.tenantPolicyDraft) return state;
      return {
        ...state,
        tenantPolicyDraft: {
          ...state.tenantPolicyDraft,
          [action.key]: TENANT_POLICY_NUMERIC_KEYS.includes(action.key)
            ? Number(action.value || 0)
            : action.value,
        },
      };
    case 'toggle-tenant-platform': {
      if (!state.tenantPolicyDraft) return state;
      const current = new Set(state.tenantPolicyDraft.allowed_platforms || []);
      if (current.has(action.platform)) current.delete(action.platform);
      else current.add(action.platform);
      return {
        ...state,
        tenantPolicyDraft: {
          ...state.tenantPolicyDraft,
          allowed_platforms: current.size > 0 ? Array.from(current) : ['naver'],
        },
      };
    }
  }
}

export function useAdOsPageState() {
  const [state, dispatch] = useReducer(reduceAdOsPageState, INITIAL_AD_OS_PAGE_STATE);

  return {
    ...state,
    setLoading: useCallback((loading: boolean) => {
      dispatch({ type: 'loading', loading });
    }, []),
    setError: useCallback((error: string | null) => {
      dispatch({ type: 'error', error });
    }, []),
    loadSummary: useCallback((summary: Summary) => {
      dispatch({ type: 'summary-loaded', summary });
    }, []),
    updateBudgetDraft: useCallback((platform: string, key: keyof BudgetDraft, value: string | number) => {
      dispatch({ type: 'update-budget-draft', platform, key, value });
    }, []),
    updateTenantPolicyDraft: useCallback((key: keyof TenantPolicyDraft, value: unknown) => {
      dispatch({ type: 'update-tenant-policy-draft', key, value });
    }, []),
    toggleTenantPlatform: useCallback((platform: string) => {
      dispatch({ type: 'toggle-tenant-platform', platform });
    }, []),
  };
}
