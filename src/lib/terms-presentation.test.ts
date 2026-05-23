import { describe, it, expect } from 'vitest';
import type { NoticeBlock } from './standard-terms';
import {
  classifyNoticeGroup,
  dedupeNoticesForDisplay,
  expandCompositeNotice,
  groupNoticesForPresentation,
  isVagueExternalCancelReference,
  stripNoticeTitleEmoji,
} from './terms-presentation';

const n = (overrides: Partial<NoticeBlock> & Pick<NoticeBlock, 'type' | 'text'>): NoticeBlock => ({
  title: overrides.type,
  ...overrides,
});

describe('classifyNoticeGroup', () => {
  it('AUTO_TICKETING → cancel', () => {
    expect(classifyNoticeGroup(n({ type: 'AUTO_TICKETING', text: '발권 후 실비' }))).toBe('cancel');
  });

  it('tier 4 추가요금/할증 → surcharge', () => {
    expect(classifyNoticeGroup(n({
      type: 'POLICY',
      title: '추가요금/할증',
      text: '4만4천원/박',
      _tier: 4,
    }))).toBe('surcharge');
  });

  it('tier 4 취소/환불 제목 → cancel', () => {
    expect(classifyNoticeGroup(n({
      type: 'CRITICAL',
      title: '취소/환불/여권/쇼핑',
      text: '취소수수료 안내',
      _tier: 4,
    }))).toBe('cancel');
  });

  it('LIABILITY → liability', () => {
    expect(classifyNoticeGroup(n({ type: 'LIABILITY', text: '면책' }))).toBe('liability');
  });
});

describe('groupNoticesForPresentation', () => {
  it('빈 그룹 제외하고 순서 유지', () => {
    const groups = groupNoticesForPresentation([
      n({ type: 'AUTO_TICKETING', text: '실비' }),
      n({ type: 'SURCHARGE', text: '유류' }),
      n({ type: 'PASSPORT', text: '6개월' }),
    ]);
    expect(groups.map(g => g.id)).toEqual(['cancel', 'surcharge', 'customer']);
  });
});

describe('dedupeNoticesForDisplay', () => {
  it('동일 type·title·text 중복 제거', () => {
    const dup = n({ type: 'PASSPORT', title: '여권', text: '6개월' });
    const r = dedupeNoticesForDisplay([dup, dup, n({ type: 'PASSPORT', title: '여권', text: '1년' })]);
    expect(r).toHaveLength(2);
  });
});

describe('expandCompositeNotice', () => {
  it('취소/환불/여권/쇼핑 블록을 취소·고객으로 분리', () => {
    const composite = n({
      type: 'CRITICAL',
      title: '취소/환불/여권/쇼핑',
      text: '취소수수료 규정 안내서 참고\n발권·파이널 확정 후 실비 위약금(최대 100%)\n여권은 출발일 기준 6개월\n쇼핑 2회',
      _tier: 4,
    });
    const parts = expandCompositeNotice(composite);
    expect(parts).toHaveLength(2);
    expect(parts[0].title).toBe('취소·환불');
    expect(parts[0].text).toContain('100%');
    expect(parts[0].text).not.toContain('안내서 참고');
    expect(parts[1].title).toBe('여권·쇼핑·현장');
    expect(parts[1].text).toContain('6개월');
  });
});

describe('isVagueExternalCancelReference', () => {
  it('안내서 참고만 있는 줄은 제외', () => {
    expect(isVagueExternalCancelReference('취소수수료 규정 안내서 참고')).toBe(true);
  });

  it('최대 100% 등 구체 한도가 있으면 유지', () => {
    expect(isVagueExternalCancelReference('발권 후 실비 위약금 최대 100% 청구')).toBe(false);
  });
});

describe('stripNoticeTitleEmoji', () => {
  it('복합 이모지·변형 선택자 제거', () => {
    expect(stripNoticeTitleEmoji('✈️ 자동 발권')).toBe('자동 발권');
    expect(stripNoticeTitleEmoji('⚖️ 천재지변')).toBe('천재지변');
  });
});

describe('groupNoticesForPresentation semantic dedupe', () => {
  it('tier1 여권과 tier4 여권 문장 중복 제거', () => {
    const groups = groupNoticesForPresentation([
      n({ type: 'PASSPORT', title: '여권·비자 안내', text: '여권 유효기간은 출발일 기준 6개월 이상' }),
      n({
        type: 'CRITICAL',
        title: '취소/환불/여권/쇼핑',
        text: '취소수수료 안내\n여권은 출발일 기준 6개월 이상\n쇼핑 2회',
        _tier: 4,
      }),
    ]);
    const customer = groups.find(g => g.id === 'customer');
    const allText = customer?.notices.map(x => x.text).join('\n') ?? '';
    expect(allText.match(/6개월/g)?.length ?? 0).toBe(1);
  });
});
