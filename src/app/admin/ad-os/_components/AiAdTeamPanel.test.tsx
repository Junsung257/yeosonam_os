import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdOsAgentOperatingModel } from '../_lib/agent-operating-model';
import { AiAdTeamPanel } from './AiAdTeamPanel';

const model: AdOsAgentOperatingModel = {
  teamScore: 90,
  overallStatus: 'ready',
  roles: [
    {
      id: 'campaign_planner',
      label: 'Campaign planner',
      status: 'ready',
      inputSummary: 'Products and budgets.',
      evidence: ['12 keyword candidates'],
      decision: 'draft plan available',
      nextAction: 'Approve safe drafts.',
      needsHumanApproval: true,
    },
    {
      id: 'performance_analyst',
      label: 'Performance analyst',
      status: 'attention',
      inputSummary: 'ROAS and search terms.',
      evidence: ['ROAS 240%'],
      decision: 'diagnosis evidence available',
      nextAction: 'Review terms.',
      needsHumanApproval: true,
    },
  ],
  roasDiagnostic: {
    status: 'attention',
    score: 70,
    hypotheses: [
      {
        id: 'low-roas',
        priority: 'high',
        reason: 'ROAS is below target.',
        evidence: 'ROAS 240%.',
        immediateAction: 'Review CPA and landing CTA.',
        holdReason: 'Margin incomplete.',
        needsHumanApproval: true,
      },
    ],
  },
  campaignMemory: {
    status: 'ready',
    score: 88,
    facts: [
      { label: 'Campaign purpose', value: 'Search demand capture' },
      { label: 'Approval rule', value: 'Human approval required' },
    ],
    nextTests: ['Run search-term growth.'],
  },
};

describe('Ad OS AiAdTeamPanel', () => {
  it('renders team roles, ROAS diagnosis, and campaign memory', () => {
    const html = renderToStaticMarkup(<AiAdTeamPanel model={model} />);

    expect(html).toContain('AI ad team');
    expect(html).toContain('Campaign planner');
    expect(html).toContain('Performance analyst');
    expect(html).toContain('ROAS diagnosis');
    expect(html).toContain('ROAS is below target.');
    expect(html).toContain('Campaign memory');
    expect(html).toContain('Human approval required');
  });
});
