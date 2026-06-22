import { describe, expect, it } from 'vitest';
import { buildBeginnerAdOpsModel } from './beginner-mode-model';
import type { Summary } from './types';

function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    ok: true,
    generated_at: '2026-06-22T00:00:00Z',
    kpis: {
      keyword_candidates: 20,
      draft_campaigns: 2,
      active_campaigns: 0,
    },
    counts: {
      mappings_by_status: {},
      keyword_plans_by_status: { approved: 2, testing: 1 },
    },
    channel_budgets: [
      {
        platform: 'naver',
        configured: true,
        monthly_budget_krw: 300000,
        daily_budget_cap_krw: 30000,
        max_cpc_krw: 700,
        max_test_loss_krw: 50000,
        automation_level: 2,
        status: 'active',
      },
    ],
    integration_status: { naver: true, google: false },
    integration_details: {},
    external_launch_status: {
      naver: { ready: true, pass: 5, total: 5, next_action: 'ready', checks: [] },
    },
    launch_action_queue: [
      {
        id: 'safe-1',
        priority: 1,
        label: '키워드 후보 생성',
        description: '초보자에게 안전한 내부 작업입니다.',
        button_label: '후보 생성',
        ui_action: 'generateCandidates',
        tone: 'good',
      },
      {
        id: 'advanced-1',
        priority: 2,
        label: '네이버 자산 동기화',
        description: '고급 탭에만 있어야 합니다.',
        button_label: '동기화',
        ui_action: 'syncNaverAssets',
        tone: 'warn',
      },
      {
        id: 'safe-2',
        priority: 3,
        label: '런칭 점검',
        description: '읽기 중심 점검입니다.',
        button_label: '점검',
        ui_action: 'runLaunchAudit',
        tone: 'good',
      },
    ],
    recent_decisions: [],
    readiness_audit: { score: 0, maxScore: 0, grade: 'n/a', summary: '', items: [] },
    expiring_packages: [],
    samples: {
      mappings: [],
      keyword_plans: [],
      learning_events: [],
      search_term_candidates: [],
      product_scenarios: [],
      landing_evolution_queue: [],
      budget_pacing: [],
      tenant_ad_accounts: [],
      change_requests: [],
    },
    automation_ladder: [],
    enterprise_layer: {
      platform_job_queue: {
        total: 0,
        blocked: 0,
        approved_or_running: 0,
        external_api_write_count: 0,
        safety_note: 'safe',
      },
    },
    ...overrides,
  } as Summary;
}

describe('beginner Ad OS model', () => {
  it('shows ready state and hides advanced launch actions', () => {
    const model = buildBeginnerAdOpsModel(makeSummary(), { teamScore: 90 } as never);

    expect(model.status).toBe('ready');
    expect(model.visibleActions.map((action) => action.ui_action)).toEqual(['generateCandidates', 'runLaunchAudit']);
    expect(model.hiddenAdvancedCount).toBeGreaterThan(0);
    expect(model.safetyNote).toContain('승인 전용');
  });

  it('blocks beginner launch when account, budget, and approvals are missing', () => {
    const model = buildBeginnerAdOpsModel(makeSummary({
      integration_status: {},
      channel_budgets: [],
      kpis: { keyword_candidates: 0, draft_campaigns: 0, active_campaigns: 0 },
      counts: { mappings_by_status: {}, keyword_plans_by_status: {} },
      external_launch_status: {},
    }), null);

    expect(model.status).toBe('blocked');
    expect(model.blockers).toEqual(expect.arrayContaining([
      '네이버/구글 광고 계정 API 연결이 필요합니다.',
      '월예산, 일한도, 최대 CPC가 설정된 검색광고 예산이 필요합니다.',
    ]));
  });
});
