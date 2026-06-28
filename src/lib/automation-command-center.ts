import type { AllScenarioReadinessSummary } from './jarvis/eval/all-scenarios-readiness';
import type { MarketingDeepScorecard } from './marketing-deep-scorecard';

export type AutomationCommandCenterStatus = 'ready' | 'watch' | 'blocked';

export type AutomationCommandCenterBlocker = {
  domain: 'jarvis' | 'ad_os' | 'approval_queue' | 'system';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  next_action: string;
};

export type AutomationCommandCenterTopPacket = {
  id: string;
  agent_type: string;
  action_type: string;
  summary: string;
  priority: string;
  status: string;
  created_at: string | null;
};

export type AutomationCommandCenterSnapshot = {
  generated_at: string;
  status: AutomationCommandCenterStatus;
  score: number;
  jarvis: {
    status: AutomationCommandCenterStatus;
    score: number;
    max_score: number;
    blocking_sections: string[];
    warning_sections: string[];
    next_action: string;
  };
  ad_os: {
    status: AutomationCommandCenterStatus;
    current_lowest_score: number;
    ready_fixture_lowest_score: number;
    gap_count: number;
    p0_gap_count: number;
    top_repair_actions: string[];
    next_action: string;
  };
  approval_queue: {
    status: AutomationCommandCenterStatus;
    pending_count: number;
    high_risk_count: number;
    top_packets: AutomationCommandCenterTopPacket[];
    next_action: string;
  };
  blockers: AutomationCommandCenterBlocker[];
  one_click_recommendation: {
    label: string;
    action_type: 'navigate' | 'refresh';
    target_href: string;
    safe: true;
    requires_approval: boolean;
  };
  safety: {
    read_only: true;
    database_mutation: false;
    external_api_write: false;
    live_spend_krw: 0;
    full_auto_allowed: false;
  };
};

export type BuildAutomationCommandCenterInput = {
  generatedAt?: string;
  jarvisSummary: AllScenarioReadinessSummary | null;
  adOsCurrentScorecard: MarketingDeepScorecard | null;
  adOsReadyFixtureScorecard: MarketingDeepScorecard | null;
  approvalQueue: {
    pending_count: number;
    high_risk_count: number;
    top_packets: AutomationCommandCenterTopPacket[];
    unavailable_reason?: string | null;
  };
};

function boundedScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function statusFromJarvis(summary: AllScenarioReadinessSummary | null): AutomationCommandCenterStatus {
  if (!summary) return 'blocked';
  if (summary.status === 'fail' && summary.blockingSections.length === 0 && summary.warningSections.length > 0) {
    return 'watch';
  }
  if (summary.status === 'fail') return 'blocked';
  if (summary.status === 'warn') return 'watch';
  return summary.score >= summary.passThreshold ? 'ready' : 'blocked';
}

function statusFromAdOs(scorecard: MarketingDeepScorecard | null): AutomationCommandCenterStatus {
  if (!scorecard) return 'blocked';
  if (scorecard.summary.p0_gaps > 0) return 'blocked';
  if (scorecard.score_gate.passed && scorecard.summary.gap_subcategories === 0) return 'ready';
  return 'watch';
}

function statusFromApprovalQueue(input: BuildAutomationCommandCenterInput['approvalQueue']): AutomationCommandCenterStatus {
  if (input.unavailable_reason) return 'watch';
  if (input.high_risk_count > 0) return 'watch';
  if (input.pending_count > 0) return 'watch';
  return 'ready';
}

function firstAdOsRepairActions(scorecard: MarketingDeepScorecard | null): string[] {
  if (!scorecard) return ['Ad OS evidence snapshot을 다시 불러오세요.'];
  return scorecard.repair_queue
    .slice(0, 3)
    .map((item) => item.action || item.title)
    .filter(Boolean);
}

function buildBlockers(input: BuildAutomationCommandCenterInput): AutomationCommandCenterBlocker[] {
  const blockers: AutomationCommandCenterBlocker[] = [];

  if (!input.jarvisSummary) {
    blockers.push({
      domain: 'jarvis',
      severity: 'critical',
      message: 'Jarvis scenario readiness snapshot is unavailable.',
      next_action: 'Run npm run verify:jarvis-all-scenarios and open /admin/jarvis.',
    });
  } else {
    for (const section of input.jarvisSummary.blockingSections) {
      blockers.push({
        domain: 'jarvis',
        severity: 'critical',
        message: `Jarvis blocking section: ${section}`,
        next_action: 'Open /admin/jarvis and inspect the readiness card.',
      });
    }
    for (const section of input.jarvisSummary.warningSections) {
      blockers.push({
        domain: 'jarvis',
        severity: 'warning',
        message: `Jarvis warning section: ${section}`,
        next_action: 'Run the full CLI gate before rollout.',
      });
    }
  }

  if (!input.adOsCurrentScorecard) {
    blockers.push({
      domain: 'ad_os',
      severity: 'critical',
      message: 'Ad OS deep scorecard is unavailable.',
      next_action: 'Open /admin/ad-os and rerun the deep scorecard.',
    });
  } else if (!input.adOsCurrentScorecard.score_gate.passed || input.adOsCurrentScorecard.summary.gap_subcategories > 0) {
    const severity = input.adOsCurrentScorecard.summary.p0_gaps > 0 ? 'critical' : 'warning';
    blockers.push({
      domain: 'ad_os',
      severity,
      message: `Ad OS current evidence has ${input.adOsCurrentScorecard.summary.gap_subcategories} gap subcategories.`,
      next_action: firstAdOsRepairActions(input.adOsCurrentScorecard)[0] || 'Review the Ad OS repair queue.',
    });
  }

  if (input.approvalQueue.unavailable_reason) {
    blockers.push({
      domain: 'approval_queue',
      severity: 'warning',
      message: input.approvalQueue.unavailable_reason,
      next_action: 'Check Supabase/admin approval queue access.',
    });
  } else if (input.approvalQueue.high_risk_count > 0) {
    blockers.push({
      domain: 'approval_queue',
      severity: 'warning',
      message: `${input.approvalQueue.high_risk_count} high-risk approval packet(s) are waiting.`,
      next_action: 'Open /admin/jarvis?tab=actions and approve or reject the packets.',
    });
  }

  return blockers;
}

function buildOneClickRecommendation(input: {
  jarvisStatus: AutomationCommandCenterStatus;
  adOsStatus: AutomationCommandCenterStatus;
  approvalStatus: AutomationCommandCenterStatus;
  approvalPendingCount: number;
}): AutomationCommandCenterSnapshot['one_click_recommendation'] {
  if (input.jarvisStatus === 'blocked' || input.jarvisStatus === 'watch') {
    return {
      label: '자비스 readiness 확인',
      action_type: 'navigate',
      target_href: '/admin/jarvis',
      safe: true,
      requires_approval: false,
    };
  }
  if (input.adOsStatus === 'blocked' || input.adOsStatus === 'watch') {
    return {
      label: 'Ad OS 수리 계획 보기',
      action_type: 'navigate',
      target_href: '/admin/ad-os',
      safe: true,
      requires_approval: false,
    };
  }
  if (input.approvalPendingCount > 0 || input.approvalStatus === 'watch') {
    return {
      label: '승인 대기 패킷 검토',
      action_type: 'navigate',
      target_href: '/admin/jarvis?tab=actions',
      safe: true,
      requires_approval: true,
    };
  }
  return {
    label: '운영 상태 새로고침',
    action_type: 'refresh',
    target_href: '/admin/control-tower',
    safe: true,
    requires_approval: false,
  };
}

export function buildAutomationCommandCenterSnapshot(
  input: BuildAutomationCommandCenterInput,
): AutomationCommandCenterSnapshot {
  const jarvisStatus = statusFromJarvis(input.jarvisSummary);
  const adOsStatus = statusFromAdOs(input.adOsCurrentScorecard);
  const approvalStatus = statusFromApprovalQueue(input.approvalQueue);
  const statuses = [jarvisStatus, adOsStatus, approvalStatus];
  const status: AutomationCommandCenterStatus = statuses.includes('blocked')
    ? 'blocked'
    : statuses.includes('watch')
      ? 'watch'
      : 'ready';

  const jarvisScore = boundedScore(input.jarvisSummary?.score ?? 0);
  const adOsScore = boundedScore(input.adOsCurrentScorecard?.score_gate.lowest_score ?? 0);
  const approvalScore = input.approvalQueue.unavailable_reason
    ? 70
    : input.approvalQueue.high_risk_count > 0
      ? 60
      : input.approvalQueue.pending_count > 0
        ? 80
        : 100;
  const score = boundedScore((jarvisScore * 0.45) + (adOsScore * 0.45) + (approvalScore * 0.1));
  const adOsTopRepairActions = firstAdOsRepairActions(input.adOsCurrentScorecard);

  return {
    generated_at: input.generatedAt ?? new Date().toISOString(),
    status,
    score,
    jarvis: {
      status: jarvisStatus,
      score: jarvisScore,
      max_score: input.jarvisSummary?.maxScore ?? 100,
      blocking_sections: input.jarvisSummary?.blockingSections ?? ['snapshot_unavailable'],
      warning_sections: input.jarvisSummary?.warningSections ?? [],
      next_action: jarvisStatus === 'ready'
        ? '자비스는 운영 승인 패킷을 생성할 수 있습니다.'
        : '자비스 readiness와 RAG evidence를 먼저 확인하세요.',
    },
    ad_os: {
      status: adOsStatus,
      current_lowest_score: adOsScore,
      ready_fixture_lowest_score: boundedScore(input.adOsReadyFixtureScorecard?.score_gate.lowest_score ?? 0),
      gap_count: input.adOsCurrentScorecard?.summary.gap_subcategories ?? 0,
      p0_gap_count: input.adOsCurrentScorecard?.summary.p0_gaps ?? 0,
      top_repair_actions: adOsTopRepairActions,
      next_action: adOsStatus === 'ready'
        ? 'Ad OS current evidence meets the 95+ gate.'
        : adOsTopRepairActions[0] || 'Ad OS repair queue를 먼저 확인하세요.',
    },
    approval_queue: {
      status: approvalStatus,
      pending_count: input.approvalQueue.pending_count,
      high_risk_count: input.approvalQueue.high_risk_count,
      top_packets: input.approvalQueue.top_packets,
      next_action: input.approvalQueue.pending_count > 0
        ? '승인 대기 패킷을 검토하세요.'
        : '현재 승인 대기 패킷은 없습니다.',
    },
    blockers: buildBlockers(input),
    one_click_recommendation: buildOneClickRecommendation({
      jarvisStatus,
      adOsStatus,
      approvalStatus,
      approvalPendingCount: input.approvalQueue.pending_count,
    }),
    safety: {
      read_only: true,
      database_mutation: false,
      external_api_write: false,
      live_spend_krw: 0,
      full_auto_allowed: false,
    },
  };
}
