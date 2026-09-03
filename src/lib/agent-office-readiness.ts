import {
  getRoleDefinition,
  getRuntimeProfile,
  getTaskDefinition,
  getToolProfile,
  ROLE_OPERATIONAL_BINDINGS,
} from '@/lib/agent/contracts';
import { CODEX_READ_ONLY_PERMISSION_PROFILE } from '@/lib/agent/runtime';

export type AgentOfficeReadiness = {
  route: '/admin/agent-mas';
  phase: 'foundation-shadow' | 'blocked';
  label: 'Foundation · Shadow 읽기 전용' | 'Foundation 계약 확인 필요';
  description: string;
  canWrite: false;
  autonomousLoop: false;
  productionCommandCount: 0;
  externalInstallCount: 0;
  technologyScout: {
    roleKey: 'research.technology_scout';
    taskKey: 'research.technology_scout';
    runtimeKey: 'codex_subscription_worker';
    permissionProfile: typeof CODEX_READ_ONLY_PERMISSION_PROFILE;
    executionEnabled: false;
  };
};

/**
 * Derives the Office entry badge from the checked-in contract registry. This
 * is deliberately read-only and has no database or runtime side effects.
 */
export function getAgentOfficeReadiness(): AgentOfficeReadiness {
  const role = getRoleDefinition('research.technology_scout');
  const task = getTaskDefinition('research.technology_scout');
  const runtime = getRuntimeProfile('codex_subscription_worker');
  const toolProfile = getToolProfile('research.technology_scout_no_tools');
  const binding = ROLE_OPERATIONAL_BINDINGS['research.technology_scout'];

  const safeShadowContract = !!role && !!task && !!runtime && !!toolProfile
    && role.contractStatus === 'active'
    && task.contractStatus === 'active'
    && runtime.contractStatus === 'active'
    && toolProfile.contractStatus === 'active'
    && runtime.implementationStatus === 'contract_only'
    && runtime.productionAccess === false
    && runtime.rawPromptTrace === false
    && runtime.rawToolArgumentTrace === false
    && binding.state === 'contract_only'
    && binding.executionEnabled === false
    && toolProfile.toolNames.length === 0
    && toolProfile.commandRefs.length === 0
    && toolProfile.externalWrites === false
    && toolProfile.repositoryWrites === false
    && toolProfile.productionAccess === false
    && toolProfile.destructiveOperations === false
    && task.sideEffectPolicy.mode === 'forbidden'
    && task.sideEffectPolicy.allowedCommandRefs.length === 0;

  return {
    route: '/admin/agent-mas',
    phase: safeShadowContract ? 'foundation-shadow' : 'blocked',
    label: safeShadowContract ? 'Foundation · Shadow 읽기 전용' : 'Foundation 계약 확인 필요',
    description: safeShadowContract
      ? 'Technology Scout 1개 역할의 계약·차단 상태를 확인하는 관찰 전용 Foundation입니다.'
      : '계약·권한 경계가 확인되지 않아 AI 운영실 실행을 잠갔습니다.',
    canWrite: false,
    autonomousLoop: false,
    productionCommandCount: 0,
    externalInstallCount: 0,
    technologyScout: {
      roleKey: 'research.technology_scout',
      taskKey: 'research.technology_scout',
      runtimeKey: 'codex_subscription_worker',
      permissionProfile: CODEX_READ_ONLY_PERMISSION_PROFILE,
      executionEnabled: false,
    },
  };
}
