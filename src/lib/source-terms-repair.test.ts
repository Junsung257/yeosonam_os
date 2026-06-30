import { describe, expect, it } from 'vitest';

import { buildSourceBackedTermsRepair } from './source-terms-repair';

describe('buildSourceBackedTermsRepair', () => {
  it('repairs empty include and exclude arrays when source sections are present', () => {
    const rawText = [
      '상품명: 장가계 4박5일',
      '포함내역',
      '왕복 항공료, 호텔(2인1실), 전용차량, 식사, 기사/가이드팁',
      '불포함내역',
      '개인경비, 매너팁, 유류변동분',
      '선택관광',
      '노옵션',
    ].join('\n');

    const result = buildSourceBackedTermsRepair({
      raw_text: rawText,
      inclusions: [],
      excludes: [],
    });

    expect(result.status).toBe('repaired');
    if (result.status !== 'repaired') throw new Error('expected repair');
    expect(result.inclusions).toEqual(['왕복 항공료', '호텔(2인1실)', '전용차량', '식사', '기사/가이드팁']);
    expect(result.excludes).toEqual(['개인경비', '매너팁', '유류변동분']);
  });

  it('repairs broken hotel parentheses and over-normalized customer terms from raw sections', () => {
    const rawText = [
      '포    함',
      '▶ 왕복국제선항공료 및 텍스, 유류할증료, 여행자보험',
      '▶ 호텔 숙박, 차량, 한국인 가이드, 관광지 입장료, 일정표 상의 식사',
      '▶ 호이안 관광, 바나산 국립공원 케이블카 체험 & 테마파크 이용',
      '불 포 함',
      '▶ 매너팁 및 마사지팁 (60분 $2, 90분 $3, 120분 $4)',
      'R M K',
    ].join('\n');

    const result = buildSourceBackedTermsRepair({
      raw_text: rawText,
      inclusions: ['왕복항공권', '호텔()'],
      excludes: ['가이드·기사·선장·말 안장 팁 등'],
    });

    expect(result.status).toBe('repaired');
    if (result.status !== 'repaired') throw new Error('expected repair');
    expect(result.inclusions).toContain('호텔 숙박');
    expect(result.inclusions).toContain('한국인 가이드');
    expect(result.inclusions).toContain('바나산 국립공원 케이블카 체험 & 테마파크 이용');
    expect(result.excludes).toEqual(['매너팁 및 마사지팁 (60분 $2, 90분 $3, 120분 $4)']);
  });

  it('does not change already source-backed terms', () => {
    const result = buildSourceBackedTermsRepair({
      raw_text: '상품 안내\n포함\n호텔 숙박\n불포함\n개인경비\n일정 및 항공 안내가 이어집니다. 충분한 원문 길이입니다.',
      inclusions: ['호텔 숙박'],
      excludes: ['개인경비'],
    });

    expect(result.status).toBe('not_needed');
  });
  it('filters html bullets and internal promotion notes before customer terms are saved', () => {
    const rawText = [
      '상품명 푸꾸옥 노옵션 패키지',
      '포함사항',
      '&#9830; 항공(유류택스 포함)',
      '호텔(2인1실 기준), 전용 차량, 여행자보험',
      '불포함사항',
      '&#9830; 개인경비',
      '타사비교필수★',
      '단독특전',
      'POINT① 4명 이상 예약 시 선셋사나토 풀빌라 무료 업그레이드 서비스 진행',
      '1인 당 망고도시락 1개 + 망고주스 1잔 서비스 제공',
      '옵션&쇼핑',
      '&#9830; 노옵션',
      '쇼핑 3회 (침향, 커피, 잡화-이미테이션)',
      '비고',
      '고객 화면에는 내부 비교 메모가 보이면 안 됩니다.',
    ].join('\n');

    const result = buildSourceBackedTermsRepair({
      raw_text: rawText,
      inclusions: ['&#9830; 항공(유류택스 포함)'],
      excludes: ['타사비교필수★'],
    });

    expect(result.status).toBe('repaired');
    if (result.status !== 'repaired') throw new Error('expected repair');
    expect(result.inclusions).toEqual([
      '항공(유류택스 포함)',
      '호텔(2인1실 기준)',
      '전용 차량',
      '여행자보험',
    ]);
    expect(result.excludes).toEqual(['개인경비']);
    expect(JSON.stringify(result)).not.toMatch(/&#9830;|타사비교|POINT|단독특전|옵션&쇼핑|노옵션|망고도시락/);
  });

  it('keeps non-term shopping and notice fragments out of excludes', () => {
    const rawText = [
      '상품명 다낭 패키지',
      '포함사항',
      '항공료, 호텔, 차량',
      '불포함사항',
      '싱글차지(알란씨 90,000원/3박/인)',
      '매너팁 및 개인경비',
      '쇼 핑',
      '3회 (침향노니, 커피과일, 잡화)',
      '비 고',
      '본 상품 쇼핑3회 / 노옵션 조건입니다.',
      '필 독 사 항',
      '확정 전 호텔 객실 가능여부 재확인 부탁드립니다.',
    ].join('\n');

    const result = buildSourceBackedTermsRepair({
      raw_text: rawText,
      inclusions: ['항공료'],
      excludes: ['쇼 핑'],
    });

    expect(result.status).toBe('repaired');
    if (result.status !== 'repaired') throw new Error('expected repair');
    expect(result.excludes).toEqual([
      '싱글차지(알란씨 90,000원/3박/인)',
      '매너팁 및 개인경비',
    ]);
    expect(JSON.stringify(result.excludes)).not.toMatch(/쇼\s*핑|비\s*고|필\s*독|본 상품|확정 전|침향|커피|잡화/);
  });

  it('keeps comma-formatted money amounts as one customer term', () => {
    const rawText = [
      '상품 안내',
      '포함',
      '항공료, 호텔, 차량',
      '불포함',
      '가이드경비($50/인), 써차지 안내 35,000원/인 (9/25~9/28 출발), 싱글차지 18만원/인',
      '선택관광',
    ].join('\n');

    const result = buildSourceBackedTermsRepair({
      raw_text: rawText,
      inclusions: ['항공료'],
      excludes: ['써차지 안내 35', '000원/인 (9/25~9/28 출발)'],
    });

    expect(result.status).toBe('repaired');
    if (result.status !== 'repaired') throw new Error('expected repair');
    expect(result.excludes).toContain('써차지 안내 35,000원/인 (9/25~9/28 출발)');
    expect(result.excludes).not.toContain('써차지 안내 35');
  });
});
