'use client';

import { useCallback, useReducer } from 'react';
import type {
  AdminSurfaceQa,
  LaunchAudit,
  NaverSetupPacket,
  OperatingInventory,
  StagingSmoke,
  StagingValidation,
} from './types';

export type AdOsResultState = {
  automationMessage: string | null;
  launchAudit: LaunchAudit | null;
  naverSetupPacket: NaverSetupPacket | null;
  tenantReport: Record<string, unknown> | null;
  opsPlan: Record<string, unknown> | null;
  keywordBrainResult: Record<string, unknown> | null;
  naverAssetPlan: Record<string, unknown> | null;
  stagingSmoke: StagingSmoke | null;
  operatingInventory: OperatingInventory | null;
  stagingValidation: StagingValidation | null;
  adminSurfaceQa: AdminSurfaceQa | null;
};

export type AdOsResultStateAction =
  | { type: 'patch'; patch: Partial<AdOsResultState> }
  | { type: 'reset' };

export const INITIAL_AD_OS_RESULT_STATE: AdOsResultState = {
  automationMessage: null,
  launchAudit: null,
  naverSetupPacket: null,
  tenantReport: null,
  opsPlan: null,
  keywordBrainResult: null,
  naverAssetPlan: null,
  stagingSmoke: null,
  operatingInventory: null,
  stagingValidation: null,
  adminSurfaceQa: null,
};

export function reduceAdOsResultState(
  state: AdOsResultState,
  action: AdOsResultStateAction,
): AdOsResultState {
  if (action.type === 'reset') return INITIAL_AD_OS_RESULT_STATE;
  return { ...state, ...action.patch };
}

export function useAdOsResultState() {
  const [state, dispatch] = useReducer(reduceAdOsResultState, INITIAL_AD_OS_RESULT_STATE);

  const setResultState = useCallback((patch: Partial<AdOsResultState>) => {
    dispatch({ type: 'patch', patch });
  }, []);

  return {
    ...state,
    setAutomationMessage: useCallback(
      (automationMessage: string | null) => setResultState({ automationMessage }),
      [setResultState],
    ),
    setLaunchAudit: useCallback(
      (launchAudit: LaunchAudit | null) => setResultState({ launchAudit }),
      [setResultState],
    ),
    setNaverSetupPacket: useCallback(
      (naverSetupPacket: NaverSetupPacket | null) => setResultState({ naverSetupPacket }),
      [setResultState],
    ),
    setTenantReport: useCallback(
      (tenantReport: Record<string, unknown> | null) => setResultState({ tenantReport }),
      [setResultState],
    ),
    setOpsPlan: useCallback(
      (opsPlan: Record<string, unknown> | null) => setResultState({ opsPlan }),
      [setResultState],
    ),
    setKeywordBrainResult: useCallback(
      (keywordBrainResult: Record<string, unknown> | null) => setResultState({ keywordBrainResult }),
      [setResultState],
    ),
    setNaverAssetPlan: useCallback(
      (naverAssetPlan: Record<string, unknown> | null) => setResultState({ naverAssetPlan }),
      [setResultState],
    ),
    setStagingSmoke: useCallback(
      (stagingSmoke: StagingSmoke | null) => setResultState({ stagingSmoke }),
      [setResultState],
    ),
    setOperatingInventory: useCallback(
      (operatingInventory: OperatingInventory | null) => setResultState({ operatingInventory }),
      [setResultState],
    ),
    setStagingValidation: useCallback(
      (stagingValidation: StagingValidation | null) => setResultState({ stagingValidation }),
      [setResultState],
    ),
    setAdminSurfaceQa: useCallback(
      (adminSurfaceQa: AdminSurfaceQa | null) => setResultState({ adminSurfaceQa }),
      [setResultState],
    ),
    resetResultState: useCallback(() => dispatch({ type: 'reset' }), []),
  };
}
