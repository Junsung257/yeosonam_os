import { describe, expect, it } from 'vitest';
import { romanize, slugifyTopic } from './slug-utils';

describe('slug-utils', () => {
  it('keeps compound destination boundaries in topic slugs', () => {
    expect(slugifyTopic('시모노세키/후쿠오카/벳부 여행 준비물 완벽 체크리스트')).toBe(
      'shimonoseki-fukuoka-beppu-preparation',
    );
  });

  it('romanizes compound destinations with hyphen separators', () => {
    expect(romanize('시모노세키/후쿠오카/벳부')).toBe('shimonoseki-fukuoka-beppu');
  });

  it('collapses repeated topic category terms', () => {
    expect(slugifyTopic('보홀 화폐·환전·팁 문화 총정리')).toBe('bohol-currency');
  });
  it('romanizes newer blog destinations used by automatic publishing', () => {
    expect(romanize('\uD074\uB77D')).toBe('clark');
    expect(romanize('\uC720\uB7FD')).toBe('europe');
    expect(slugifyTopic('\uD074\uB77D \uC5EC\uD589 \uC900\uBE44\uBB3C \uC644\uBCBD \uCCB4\uD06C\uB9AC\uC2A4\uD2B8')).toBe(
      'clark-preparation',
    );
  });
});
