import { describe, expect, it } from 'vitest';

import { goldenKey } from '../../scripts/audit-public-snapshot-generation-readiness';

describe('public snapshot generation audit golden set matching', () => {
  it('matches the required representative destinations by Korean aliases', () => {
    expect(goldenKey({ destination: '연길', title: '연길 백두산 노옵션 3박4일' })).toBe('yanji_baekdu');
    expect(goldenKey({ destination: '장가계', title: '장가계 노팁노옵션 3박4일' })).toBe('zhangjiajie');
    expect(goldenKey({ destination: '다낭/호이안', title: '다낭 호이안 3박5일' })).toBe('danang_hoian');
    expect(goldenKey({ destination: '나트랑/달랏', title: '나트랑 달랏 3박5일' })).toBe('nhatrang_dalat');
    expect(goldenKey({ destination: '푸꾸옥', title: '푸꾸옥 노옵션 3박5일' })).toBe('phuquoc');
    expect(goldenKey({ destination: '북해도', title: '삿포로 온천 3박4일' })).toBe('hokkaido');
    expect(goldenKey({ destination: '하노이/하롱베이', title: '하노이 하롱베이 옌뜨 3박5일' })).toBe('hanoi_halong');
    expect(goldenKey({ destination: '대마도', title: '쓰시마 당일 왕복' })).toBe('tsushima');
    expect(goldenKey({ destination: '세부', title: '세부 리조트 4박5일' })).toBe('cebu');
  });

  it('does not classify Nagasaki-only products as the Fukuoka golden sample', () => {
    expect(goldenKey({
      destination: '나가사키',
      title: 'BX나가사키 골프 패키지 3박4일',
      raw_text: '후쿠오카 공항 경유 안내가 포함된 원문',
    })).toBeNull();
    expect(goldenKey({ destination: '후쿠오카', title: '후쿠오카 북큐슈 온천 2박3일' })).toBe('fukuoka');
    expect(goldenKey({ destination: '규슈', title: '북큐슈 료칸팩 2박3일' })).toBe('fukuoka');
  });
});
