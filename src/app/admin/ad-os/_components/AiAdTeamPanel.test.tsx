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
      label: '기획 담당',
      status: 'ready',
      inputSummary: '상품과 예산을 봅니다.',
      evidence: ['키워드 후보 12개'],
      decision: '기획 초안 있음',
      nextAction: '안전한 초안만 승인하세요.',
      needsHumanApproval: true,
    },
    {
      id: 'performance_analyst',
      label: '성과 분석 담당',
      status: 'attention',
      inputSummary: 'ROAS와 검색어를 봅니다.',
      evidence: ['ROAS 240%'],
      decision: '진단 근거 있음',
      nextAction: '검색어를 검수하세요.',
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
        reason: 'ROAS가 기준보다 낮습니다.',
        evidence: 'ROAS 240%.',
        immediateAction: 'CPA와 랜딩 CTA를 확인하세요.',
        holdReason: '마진 근거 부족.',
        needsHumanApproval: true,
      },
    ],
  },
  campaignMemory: {
    status: 'ready',
    score: 88,
    facts: [
      { label: '캠페인 목적', value: '검색 수요 포착' },
      { label: '승인 기준', value: '사람 승인 필요' },
    ],
    nextTests: ['검색어 확장을 실행하세요.'],
  },
};

describe('Ad OS AiAdTeamPanel', () => {
  it('renders team roles, ROAS diagnosis, and campaign memory', () => {
    const html = renderToStaticMarkup(<AiAdTeamPanel model={model} />);

    expect(html).toContain('AI 광고팀');
    expect(html).toContain('기획 담당');
    expect(html).toContain('성과 분석 담당');
    expect(html).toContain('ROAS 진단');
    expect(html).toContain('ROAS가 기준보다 낮습니다.');
    expect(html).toContain('캠페인 메모리');
    expect(html).toContain('사람 승인 필요');
  });
});
