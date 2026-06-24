import { describe, expect, it } from 'vitest';
import { classifyUnmatchedActivity } from './unmatched-classifier';

describe('classifyUnmatchedActivity', () => {
  it('auto-closes meal and transfer rows as added', () => {
    expect(classifyUnmatchedActivity('호텔 조식 후 전용차량 이동')).toMatchObject({
      category: 'meal',
      terminalStatus: 'added',
      suggestedAction: 'auto_resolve_existing',
    });
    expect(classifyUnmatchedActivity('(제육+찌개)')).toMatchObject({
      category: 'meal',
      terminalStatus: 'added',
      suggestedAction: 'auto_resolve_existing',
    });
    expect(classifyUnmatchedActivity('석-한  식')).toMatchObject({
      category: 'meal',
      terminalStatus: 'added',
      suggestedAction: 'auto_resolve_existing',
    });
    expect(classifyUnmatchedActivity('부산 김해공항 미팅 및 transfer')).toMatchObject({
      category: 'transfer',
      terminalStatus: 'added',
      suggestedAction: 'auto_resolve_existing',
    });
    expect(classifyUnmatchedActivity('PUS-FSZ')).toMatchObject({
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
    expect(classifyUnmatchedActivity('호텔 조식 후 오전 자유시간')).toMatchObject({
      category: 'meal',
      terminalStatus: 'added',
      suggestedAction: 'auto_resolve_existing',
    });
    expect(classifyUnmatchedActivity('오후 자유시간')).toMatchObject({
      category: 'free_time',
      terminalStatus: 'ignored',
      suggestedAction: 'auto_ignore_noise',
    });
    expect(classifyUnmatchedActivity('오 전')).toMatchObject({
      category: 'free_time',
      terminalStatus: 'ignored',
      suggestedAction: 'auto_ignore_noise',
    });
    expect(classifyUnmatchedActivity('준비물 : 수영복, 모자, 선크림, 여벌 옷, 아쿠아슈즈')).toMatchObject({
      category: 'notice',
      terminalStatus: 'pending',
      suggestedAction: 'needs_review',
    });
  });

  it('classifies common non-attraction itinerary entities without making attraction masters', () => {
    expect(classifyUnmatchedActivity('호텔 투숙 및 휴식')).toMatchObject({
      category: 'hotel',
      terminalStatus: 'pending',
      suggestedAction: 'suggest_alias',
    });
    expect(classifyUnmatchedActivity('호화호특 쇼핑센터 방문')).toMatchObject({
      category: 'shopping',
      terminalStatus: 'pending',
      suggestedAction: 'needs_review',
    });
    expect(classifyUnmatchedActivity('항공 및 현지 사정에 따라 일정이 변경될 수 있습니다')).toMatchObject({
      category: 'notice',
      terminalStatus: 'pending',
      suggestedAction: 'needs_review',
    });
    expect(classifyUnmatchedActivity('상기 일정은 항공')).toMatchObject({
      category: 'notice',
      terminalStatus: 'pending',
      suggestedAction: 'needs_review',
    });
  });

  it('keeps probable new attractions pending for master-candidate handling', () => {
    expect(classifyUnmatchedActivity('푸꾸옥 야시장')).toMatchObject({
      category: 'attraction',
      terminalStatus: 'pending',
      suggestedAction: 'needs_new_master',
    });
    expect(classifyUnmatchedActivity('계림 관광지명')).toMatchObject({
      category: 'attraction',
      terminalStatus: 'pending',
      suggestedAction: 'needs_new_master',
    });
  });

  it('does not ignore real activities only because they mention inclusion', () => {
    expect(classifyUnmatchedActivity('천등 날리기 체험 포함(4인 기준)')).toMatchObject({
      category: 'optional_tour',
      terminalStatus: 'pending',
    });
  });
});
