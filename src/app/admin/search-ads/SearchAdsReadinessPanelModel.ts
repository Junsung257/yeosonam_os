export type SearchAdsReadinessTone = 'good' | 'warn' | 'bad' | 'neutral';
export type SearchAdsReadinessMode = 'recommendation' | 'approval' | 'limited_auto' | 'full_auto';
export type SearchAdsChannel = 'naver' | 'google';

export interface SearchAdsReadinessSummary {
  ok?: boolean;
  channel_execution_states?: Record<string, {
    label: string;
    tone: SearchAdsReadinessTone;
    canSpend: boolean;
    summary: string;
    nextAction: string;
  }>;
  active_automation_modes?: Array<{
    platform: string;
    level: number;
    mode: SearchAdsReadinessMode;
    status: string;
  }>;
}

export const SEARCH_ADS_CHANNELS: SearchAdsChannel[] = ['naver', 'google'];

export function getSearchAdsModeLabel(mode?: SearchAdsReadinessMode) {
  if (mode === 'full_auto') return '완전자동';
  if (mode === 'limited_auto') return '제한 예산 자동집행';
  if (mode === 'approval') return '승인';
  return '추천';
}

export function getSearchAdsChannelName(channel: SearchAdsChannel) {
  return channel === 'naver' ? '네이버 검색광고' : 'Google Ads';
}

export function getSearchAdsReadinessCards(summary: SearchAdsReadinessSummary | null) {
  return SEARCH_ADS_CHANNELS.map((channel) => {
    const state = summary?.channel_execution_states?.[channel];
    const mode = summary?.active_automation_modes?.find((item) => item.platform === channel);

    return {
      channel,
      name: getSearchAdsChannelName(channel),
      label: state?.label || '연동 필요',
      tone: state?.tone || 'neutral',
      summary: state?.summary || '아직 채널 상태 데이터가 없습니다.',
      nextAction: state?.nextAction || '계정 연결과 캠페인 상태를 확인하세요.',
      canSpend: Boolean(state?.canSpend),
      spendLabel: state?.canSpend ? '집행 가능' : '차단',
      modeLabel: getSearchAdsModeLabel(mode?.mode),
      levelLabel: `L${mode?.level ?? 1}`,
    };
  });
}

export function getSearchAdsPanelErrorMessage(error: string) {
  return `Ad OS 상태를 불러오지 못했습니다. ${error}`;
}
