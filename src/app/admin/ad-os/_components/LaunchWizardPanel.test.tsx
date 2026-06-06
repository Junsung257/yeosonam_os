import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Summary } from '../_lib/types';
import { LaunchWizardPanel, type LaunchChecklistStep, type LaunchWizardStep } from './LaunchWizardPanel';

const launchSteps: LaunchChecklistStep[] = [
  {
    label: 'Publisher API',
    done: true,
    value: 'naver',
    next: 'Connect publisher API credentials before external activation.',
  },
  {
    label: 'Search budget',
    done: false,
    value: 'pending',
    next: 'Set budget caps.',
  },
];

const wizardSteps: LaunchWizardStep[] = [
  {
    label: '1. Publisher API',
    status: 'ready',
    done: true,
    body: 'Connect publisher credentials before launch.',
  },
  {
    label: '2. Budget cap',
    status: 'pending',
    done: false,
    body: 'Keep budget guardrails configured.',
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

    expect(html).toContain('Launch checklist');
    expect(html).toContain('1/2 ready');
    expect(html).toContain('Prepare pilot');
    expect(html).toContain('Launch audit');
    expect(html).toContain('Publisher API');
    expect(html).toContain('launch readiness');
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

    expect(html).toContain('2/2 ready');
    expect(html).toContain('Pilot budget and L2 execution are ready.');
  });
});
