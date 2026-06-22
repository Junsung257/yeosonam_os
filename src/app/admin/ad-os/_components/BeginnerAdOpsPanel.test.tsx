import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BeginnerAdOpsModel } from '../_lib/beginner-mode-model';
import { LAUNCH_ACTION_KEYS, type LaunchActionHandlers, type LaunchActionLoading } from './LaunchActionQueuePanel';
import { BeginnerAdOpsPanel } from './BeginnerAdOpsPanel';

const handlers: LaunchActionHandlers = Object.fromEntries(
  LAUNCH_ACTION_KEYS.map((key) => [key, () => {}]),
) as LaunchActionHandlers;

const loading: LaunchActionLoading = Object.fromEntries(
  LAUNCH_ACTION_KEYS.map((key) => [key, false]),
) as LaunchActionLoading;

const model: BeginnerAdOpsModel = {
  status: 'attention',
  title: '광고 시작 전 확인 필요',
  summary: '초보자 화면에서는 승인 요청까지만 진행합니다.',
  primaryAction: {
    id: 'audit',
    priority: 1,
    label: '집행 점검',
    description: '안전 상태를 확인합니다.',
    button_label: '점검',
    ui_action: 'runLaunchAudit',
    tone: 'warn',
  },
  visibleActions: [],
  hiddenAdvancedCount: 12,
  blockers: ['광고 계정 연결 필요'],
  nextSteps: ['네이버/구글 광고 계정 API 연결이 필요합니다.'],
  metrics: [
    { label: '광고 계정', value: '미연결', tone: 'blocked' },
    { label: '외부 쓰기', value: '0건', tone: 'ready' },
  ],
  safetyNote: '기본 화면은 승인 전용입니다.',
};

describe('BeginnerAdOpsPanel', () => {
  it('renders beginner-first safety copy and hidden advanced count', () => {
    const html = renderToStaticMarkup(
      <BeginnerAdOpsPanel
        model={model}
        actionHandlers={handlers}
        actionLoading={loading}
        onOpenSettings={() => {}}
        onOpenAdvanced={() => {}}
      />,
    );

    expect(html).toContain('광고 시작 전 확인 필요');
    expect(html).toContain('승인 전용');
    expect(html).toContain('상세 설정');
    expect(html).toContain('고급/감사');
    expect(html).toContain('고급 작업 12개');
  });
});
