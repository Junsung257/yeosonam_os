/**
 * 자유여행 일정 LLM 조립·폴백 단위 테스트 (DB·실제 API 미호출)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActivityResult, StayResult } from '@/lib/travel-providers/types';
import { assembleDayPlansFromLlm, generateDayPlansWithLlmOrFallback } from './itinerary-llm';

vi.mock('@/lib/llm-gateway', () => ({
  llmCall: vi.fn(),
}));

import { llmCall } from '@/lib/llm-gateway';

const hotel: StayResult = {
  providerId: 'h1',
  provider: 'mrt',
  providerUrl: 'https://example.com/h',
  name: '테스트 호텔',
  pricePerNight: 120_000,
  currency: 'KRW',
  bookableViaYeosonam: true,
};

const tour: ActivityResult = {
  providerId: 'act-1',
  provider: 'mrt',
  providerUrl: '',
  name: '다낭 시내 투어',
  price: 55_000,
  currency: 'KRW',
  bookableViaYeosonam: true,
};

describe('assembleDayPlansFromLlm', () => {
  it('3일치 LLM 슬롯을 DayPlan으로 조립하고 mrtProviderId 예약 슬롯을 반영한다', () => {
    const plans = assembleDayPlansFromLlm(
      {
        days: [
          { day: 1, slots: [{ timeHint: '오후', label: '도착 후 휴식' }] },
          {
            day: 2,
            slots: [{ timeHint: '오전', label: '시내 투어', mrtProviderId: 'act-1' }],
          },
          { day: 3, slots: [{ timeHint: '오전', label: '체크아웃·공항' }] },
        ],
      },
      {
        destination: '다낭',
        dateFrom: '2026-06-01',
        totalDays: 3,
        hotels: [hotel],
        activities: [tour],
        travelPace: '보통',
        companionType: '커플/부부',
      },
    );

    expect(plans).toHaveLength(3);
    const mid = plans.find(p => p.day === 2);
    expect(mid?.activities.some(a => a.activityProviderId === 'act-1')).toBe(true);
    expect(mid?.highlight).toContain('동행: 커플/부부');
  });
});

describe('generateDayPlansWithLlmOrFallback', () => {
  beforeEach(() => {
    vi.mocked(llmCall).mockReset();
  });

  it('LLM 호출 실패 시 템플릿 일정으로 폴백하고 source·error를 채운다', async () => {
    vi.mocked(llmCall).mockResolvedValue({
      success: false,
      data: undefined,
      errors: ['NETWORK'],
    });

    const result = await generateDayPlansWithLlmOrFallback({
      destination: '다낭',
      dateFrom: '2026-06-01',
      nights: 2,
      hotels: [hotel],
      activities: [tour],
      userMessage: '다낭 2박',
    });

    expect(result.source).toBe('template');
    expect(result.error).toBeDefined();
    expect(result.dayPlans.length).toBeGreaterThanOrEqual(2);
  });

  it('유효한 LLM JSON이면 source=llm 이다', async () => {
    vi.mocked(llmCall).mockResolvedValue({
      success: true,
      data: {
        days: [
          { day: 1, slots: [{ timeHint: '오후', label: '도착' }] },
          { day: 2, slots: [{ timeHint: '종일', label: '관광' }] },
          { day: 3, slots: [{ timeHint: '오전', label: '귀국' }] },
        ],
      },
    });

    const result = await generateDayPlansWithLlmOrFallback({
      destination: '다낭',
      dateFrom: '2026-06-01',
      nights: 2,
      hotels: [hotel],
      activities: [tour],
      userMessage: '다낭 2박',
    });

    expect(result.source).toBe('llm');
    expect(result.error).toBeUndefined();
    expect(result.dayPlans).toHaveLength(3);
  });
});
