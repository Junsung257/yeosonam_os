import { describe, expect, it } from 'vitest';
import {
  extractDestination,
  romanize,
  slugifyTopic,
  slugIncludesDestination,
} from './slug-utils';

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

  it('keeps mapped destination identity in weather slugs', () => {
    expect(romanize('멜버른')).toBe('melbourne');
    expect(romanize('이스탄불')).toBe('istanbul');
    expect(slugifyTopic('멜버른 7월 날씨와 옷차림 준비물 체크')).toBe(
      'melbourne-7-weather-preparation',
    );
  });

  it('detects when a generated slug loses its destination identity', () => {
    expect(slugIncludesDestination('melbourne-7-weather-preparation', '멜버른')).toBe(true);
    expect(slugIncludesDestination('travel-preparation-budget-cost-checklist-2026', '멜버른')).toBe(false);
  });

  it('romanizes newer blog destinations used by automatic publishing', () => {
    expect(romanize('\uD074\uB77D')).toBe('clark');
    expect(romanize('\uC720\uB7FD')).toBe('europe');
    expect(slugifyTopic('\uD074\uB77D \uC5EC\uD589 \uC900\uBE44\uBB3C \uC644\uBCBD \uCCB4\uD06C\uB9AC\uC2A4\uD2B8')).toBe(
      'clark-preparation',
    );
  });

  it('extracts a specific Canadian Rockies scope before the broad country name', () => {
    expect(extractDestination('캐나다 로키산맥 7월 여행 대중교통')).toBe('캐나다 로키산맥');
    expect(romanize('캐나다 로키산맥')).toBe('canada-rockies');
  });
});
