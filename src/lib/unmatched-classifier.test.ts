import { describe, expect, it } from 'vitest';
import { classifyUnmatchedActivity } from './unmatched-classifier';

describe('classifyUnmatchedActivity', () => {
  it('auto-closes meal and transfer rows as structured non-attraction entities', () => {
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
    expect(classifyUnmatchedActivity('석-한 식')).toMatchObject({
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
  });

  it('classifies common non-attraction itinerary entities without making attraction masters', () => {
    expect(classifyUnmatchedActivity('준비물 : 수영복, 모자, 선크림, 여벌 옷, 아쿠아슈즈')).toMatchObject({
      category: 'notice',
      terminalStatus: 'pending',
      suggestedAction: 'needs_review',
    });
    expect(classifyUnmatchedActivity('호텔 투숙 및 휴식')).toMatchObject({
      category: 'hotel',
      terminalStatus: 'pending',
      suggestedAction: 'suggest_alias',
    });
    expect(classifyUnmatchedActivity('호화호특 쇼핑센터 방문')).toMatchObject({
      category: 'shopping',
      terminalStatus: 'added',
      suggestedAction: 'structure_non_master',
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

  it('auto-closes normal Korean HWP noise, transfer, option, and shopping fragments', () => {
    expect(classifyUnmatchedActivity('상기 일정은 현지 사정에 의하여 변동될 수 있사오니 양해 바랍니다')).toMatchObject({
      category: 'notice',
    });
    expect(classifyUnmatchedActivity('부산-광저우')).toMatchObject({
      category: 'transfer',
      terminalStatus: 'added',
    });
    expect(classifyUnmatchedActivity('대기시간 최소화')).toMatchObject({
      category: 'free_time',
      terminalStatus: 'ignored',
    });
    expect(classifyUnmatchedActivity('왕복케이블카')).toMatchObject({
      category: 'optional_tour',
      terminalStatus: 'added',
      suggestedAction: 'structure_non_master',
    });
    expect(classifyUnmatchedActivity('【추천옵션】')).toMatchObject({
      category: 'free_time',
      terminalStatus: 'ignored',
      suggestedAction: 'auto_ignore_noise',
    });
    expect(classifyUnmatchedActivity('#다색골프')).toMatchObject({
      category: 'optional_tour',
      terminalStatus: 'added',
      suggestedAction: 'structure_non_master',
    });
    expect(classifyUnmatchedActivity('명품샵 방문')).toMatchObject({
      category: 'shopping',
      terminalStatus: 'added',
      suggestedAction: 'structure_non_master',
    });
  });

  it('auto-closes destination labels and schedule fragments without making attraction masters', () => {
    expect(classifyUnmatchedActivity('타이베이')).toMatchObject({
      category: 'transfer',
      terminalStatus: 'added',
    });
    expect(classifyUnmatchedActivity('상동')).toMatchObject({
      category: 'free_time',
      terminalStatus: 'ignored',
    });
    expect(classifyUnmatchedActivity('정규)')).toMatchObject({
      category: 'free_time',
      terminalStatus: 'ignored',
    });
    expect(classifyUnmatchedActivity('1,320엔)')).toMatchObject({
      category: 'price_noise',
      terminalStatus: 'ignored',
    });
    expect(classifyUnmatchedActivity('정식')).toMatchObject({
      category: 'meal',
      terminalStatus: 'added',
    });
    expect(classifyUnmatchedActivity('하이디라오)')).toMatchObject({
      category: 'meal',
      terminalStatus: 'added',
    });
    expect(classifyUnmatchedActivity('크라운')).toMatchObject({
      category: 'free_time',
      terminalStatus: 'ignored',
    });
    expect(classifyUnmatchedActivity('3박4일')).toMatchObject({
      category: 'free_time',
      terminalStatus: 'ignored',
    });
    expect(classifyUnmatchedActivity('공중전원 $40 / 중국전통 발+전신 맛사지(90분) $50')).toMatchObject({
      category: 'optional_tour',
      terminalStatus: 'added',
    });
    expect(classifyUnmatchedActivity('* 싱글카트비 18홀 기준 빈펄 450,000동 / 에스츄리 500,000동 추가 됩니다.')).toMatchObject({
      category: 'optional_tour',
      terminalStatus: 'added',
    });
    expect(classifyUnmatchedActivity('커피 1잔제공-위즐또는코코넛)')).toMatchObject({
      category: 'meal',
      terminalStatus: 'added',
    });
    expect(classifyUnmatchedActivity('민소매티+반바지 가능 / 옷 대여 가능 / 간단한 샤워용품+속옷 준비)')).toMatchObject({
      category: 'notice',
      terminalStatus: 'pending',
    });
    expect(classifyUnmatchedActivity('또는')).toMatchObject({
      category: 'free_time',
      terminalStatus: 'ignored',
    });
    expect(classifyUnmatchedActivity('00:10+1')).toMatchObject({
      category: 'free_time',
      terminalStatus: 'ignored',
    });
    expect(classifyUnmatchedActivity('호이안 디저트 - 반짱느엉 + 못 주스(베트남식 피자, 호이안 전통음료)')).toMatchObject({
      category: 'meal',
      terminalStatus: 'added',
    });
    expect(classifyUnmatchedActivity('전통식')).toMatchObject({
      category: 'meal',
      terminalStatus: 'added',
    });
    expect(classifyUnmatchedActivity('여행경비')).toMatchObject({
      category: 'price_noise',
      terminalStatus: 'ignored',
    });
    expect(classifyUnmatchedActivity('& 마감일')).toMatchObject({
      category: 'free_time',
      terminalStatus: 'ignored',
    });
    expect(classifyUnmatchedActivity('출 발 일 자')).toMatchObject({
      category: 'free_time',
      terminalStatus: 'ignored',
    });
    expect(classifyUnmatchedActivity('OR 룩락')).toMatchObject({
      category: 'meal',
      terminalStatus: 'added',
    });
    expect(classifyUnmatchedActivity('랍스터½)')).toMatchObject({
      category: 'meal',
      terminalStatus: 'added',
    });
    expect(classifyUnmatchedActivity('생수')).toMatchObject({
      category: 'meal',
      terminalStatus: 'added',
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

  it('does not ignore real optional activities only because they mention inclusion', () => {
    expect(classifyUnmatchedActivity('천등 날리기 체험 포함(4인 기준)')).toMatchObject({
      category: 'optional_tour',
      terminalStatus: 'added',
      suggestedAction: 'structure_non_master',
    });
  });
});
