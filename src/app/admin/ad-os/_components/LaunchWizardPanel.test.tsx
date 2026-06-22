import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Summary } from '../_lib/types';
import { LaunchWizardPanel, type LaunchChecklistStep, type LaunchWizardStep } from './LaunchWizardPanel';

const launchSteps: LaunchChecklistStep[] = [
  {
    label: '광고 API',
    done: true,
    value: '네이버',
    next: '외부 광고를 켜기 전에 네이버/구글 API 키를 연결하세요.',
  },
  {
    label: '검색광고 예산',
    done: false,
    value: '대기',
    next: '예산 한도를 설정하세요.',
  },
];

const wizardSteps: LaunchWizardStep[] = [
  {
    label: '1. 광고 API',
    status: '준비',
    done: true,
    body: '외부 캠페인을 켜기 전에 광고 계정 인증을 연결합니다.',
  },
  {
    label: '2. 예산 한도',
    status: '대기',
    done: false,
    body: '예산 안전장치를 유지합니다.',
  },
];

const externalLaunchStatus: Summary['external_launch_status'] = {
  naver: {
    ready: false,
    pass: 2,
    total: 3,
    next_action: 'Store Naver ad group id.',
    checks: [
      { id: 'key', label: 'API key', done: true, next: 'done' },
      { id: 'budget', label: 'Budget', done: false, next: 'Set budget cap.' },
    ],
  },
  google: {
    ready: true,
    pass: 3,
    total: 3,
    next_action: 'Ready for dry run.',
    checks: [
      { id: 'key', label: 'API key', done: true, next: 'done' },
    ],
  },
};

describe('Ad OS LaunchWizardPanel', () => {
  it('renders launch readiness, actions, wizard steps, and platform checks', () => {
    const html = renderToStaticMarkup(
      <LaunchWizardPanel
        launchSteps={launchSteps}
        launchWizardSteps={wizardSteps}
        externalLaunchStatus={externalLaunchStatus}
        onRunPilotSetup={() => {}}
        runningPilotSetup={false}
        onRunLaunchAudit={() => {}}
        runningLaunchAudit={false}
      />,
    );

    expect(html).toContain('집행 전 체크');
    expect(html).toContain('1/2 준비');
    expect(html).toContain('파일럿 준비');
    expect(html).toContain('집행 점검');
    expect(html).toContain('광고 API');
    expect(html).toContain('집행 준비');
    expect(html).toContain('Store Naver ad group id.');
    expect(html).toContain('Set budget cap.');
  });

  it('renders an all-ready next message when no step is pending', () => {
    const html = renderToStaticMarkup(
      <LaunchWizardPanel
        launchSteps={launchSteps.map((step) => ({ ...step, done: true }))}
        launchWizardSteps={wizardSteps}
        externalLaunchStatus={{}}
        onRunPilotSetup={() => {}}
        runningPilotSetup={false}
        onRunLaunchAudit={() => {}}
        runningLaunchAudit={false}
      />,
    );

    expect(html).toContain('2/2 준비');
    expect(html).toContain('파일럿 예산과 L2 실행 준비가 끝났습니다.');
  });
});
