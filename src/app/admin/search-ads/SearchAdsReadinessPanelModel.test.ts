import { describe, expect, it } from 'vitest';
import {
  getSearchAdsPanelErrorMessage,
  getSearchAdsReadinessCards,
  type SearchAdsReadinessSummary,
} from './SearchAdsReadinessPanelModel';

describe('SearchAdsReadinessPanelModel', () => {
  it('builds separate Naver and Google spend readiness cards', () => {
    const summary: SearchAdsReadinessSummary = {
      channel_execution_states: {
        naver: {
          label: '집행 가능',
          tone: 'good',
          canSpend: true,
          summary: '네이버 캠페인과 광고그룹이 준비됐습니다.',
          nextAction: '승인된 change request만 집행하세요.',
        },
        google: {
          label: '권한 없음',
          tone: 'bad',
          canSpend: false,
          summary: 'Google Ads API 권한이 거부됐습니다.',
          nextAction: 'OAuth/customer 권한을 확인하세요.',
        },
      },
      active_automation_modes: [
        { platform: 'naver', level: 2, mode: 'approval', status: 'active' },
        { platform: 'google', level: 1, mode: 'recommendation', status: 'blocked' },
      ],
    };

    expect(getSearchAdsReadinessCards(summary)).toEqual([
      {
        channel: 'naver',
        name: '네이버 검색광고',
        label: '집행 가능',
        tone: 'good',
        summary: '네이버 캠페인과 광고그룹이 준비됐습니다.',
        nextAction: '승인된 change request만 집행하세요.',
        canSpend: true,
        spendLabel: '집행 가능',
        modeLabel: '승인',
        levelLabel: 'L2',
      },
      {
        channel: 'google',
        name: 'Google Ads',
        label: '권한 없음',
        tone: 'bad',
        summary: 'Google Ads API 권한이 거부됐습니다.',
        nextAction: 'OAuth/customer 권한을 확인하세요.',
        canSpend: false,
        spendLabel: '차단',
        modeLabel: '추천',
        levelLabel: 'L1',
      },
    ]);
  });

  it('builds a clear degraded state message when Ad OS summary fails', () => {
    expect(getSearchAdsPanelErrorMessage('HTTP 401')).toBe('Ad OS 상태를 불러오지 못했습니다. HTTP 401');
  });
});
