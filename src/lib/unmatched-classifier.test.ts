import { describe, expect, it } from 'vitest';
import { classifyUnmatchedActivity } from './unmatched-classifier';

describe('classifyUnmatchedActivity', () => {
  it('auto-closes meal and transfer rows as added', () => {
    expect(classifyUnmatchedActivity('호텔 조식 후 전용차량 이동')).toMatchObject({
      category: 'meal',
      terminalStatus: 'added',
      suggestedAction: 'auto_resolve_existing',
    });
    expect(classifyUnmatchedActivity('부산 김해공항 미팅 및 transfer')).toMatchObject({
      category: 'transfer',
      terminalStatus: 'added',
      suggestedAction: 'auto_resolve_existing',
    });
  });

  it('auto-ignores price and free-time noise', () => {
    expect(classifyUnmatchedActivity('성인 1,200,000원')).toMatchObject({
      category: 'price_noise',
      terminalStatus: 'ignored',
      suggestedAction: 'auto_ignore_noise',
    });
    expect(classifyUnmatchedActivity('오후 자유시간')).toMatchObject({
      category: 'free_time',
      terminalStatus: 'ignored',
      suggestedAction: 'auto_ignore_noise',
    });
  });

  it('classifies common non-attraction itinerary entities', () => {
    expect(classifyUnmatchedActivity('관람대주점 또는 동급 준5성 호텔')).toMatchObject({
      category: 'hotel',
      terminalStatus: 'pending',
    });
    expect(classifyUnmatchedActivity('기념품 및 토산품점 방문')).toMatchObject({
      category: 'shopping',
      terminalStatus: 'pending',
    });
    expect(classifyUnmatchedActivity('여권 유효기간은 6개월 이상 남아 있어야 합니다')).toMatchObject({
      category: 'notice',
      terminalStatus: 'pending',
    });
  });

  it('keeps probable new attractions pending for master-candidate handling', () => {
    expect(classifyUnmatchedActivity('쌍양동 먹거리와 볼거리가 있는 지하거리')).toMatchObject({
      category: 'attraction',
      terminalStatus: 'pending',
      suggestedAction: 'needs_new_master',
    });
  });

  it('does not ignore real activities only because they mention inclusion', () => {
    expect(classifyUnmatchedActivity('천등 날리기 체험 포함(4인1개)')).toMatchObject({
      category: 'optional_tour',
      terminalStatus: 'pending',
    });
  });
});
