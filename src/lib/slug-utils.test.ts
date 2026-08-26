import { describe, expect, it } from 'vitest';
import {
  extractDestination,
  romanize,
  slugifyTopic,
  slugIncludesDestination,
  slugMatchesExpectedTopic,
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
    expect(romanize('\uB450\uBC14\uC774')).toBe('dubai');
    expect(romanize('\uD074\uB77D')).toBe('clark');
    expect(romanize('\uC13C\uB2E4\uC774')).toBe('sendai');
    expect(romanize('\uC720\uB7FD')).toBe('europe');
    expect(slugifyTopic('\uC13C\uB2E4\uC774 7\uC6D4 \uB0A0\uC528\uC640 \uC637\uCC28\uB9BC \uC900\uBE44\uBB3C \uCCB4\uD06C')).toBe(
      'sendai-7-weather-preparation',
    );
    expect(slugifyTopic('\uD074\uB77D \uC5EC\uD589 \uC900\uBE44\uBB3C \uC644\uBCBD \uCCB4\uD06C\uB9AC\uC2A4\uD2B8')).toBe(
      'clark-preparation',
    );
    expect(slugifyTopic('\uB450\uBC14\uC774 7\uC6D4 \uB0A0\uC528\uC640 \uC637\uCC28\uB9BC \uC900\uBE44\uBB3C \uCCB4\uD06C')).toBe(
      'dubai-7-weather-preparation',
    );
    expect(slugIncludesDestination('weather-checklist-july', '\uB450\uBC14\uC774')).toBe(false);
  });

  it('extracts a specific Canadian Rockies scope before the broad country name', () => {
    expect(extractDestination('캐나다 로키산맥 7월 여행 대중교통')).toBe('캐나다 로키산맥');
    expect(romanize('캐나다 로키산맥')).toBe('canada-rockies');
  });

  it('keeps current queue destinations distinct when topics share a month and intent', () => {
    expect(romanize('리옹')).toBe('lyon');
    expect(romanize('오슬로')).toBe('oslo');
    expect(romanize('스톡홀름')).toBe('stockholm');
    expect(slugifyTopic('오슬로 8월 날씨와 옷차림 준비물 체크')).toBe(
      'oslo-8-weather-preparation',
    );
    expect(slugIncludesDestination('weather-checklist-august', '오슬로')).toBe(false);
  });

  it('rejects a generic generated slug that loses the queue topic contract', () => {
    expect(slugMatchesExpectedTopic(
      'guam-family-itinerary',
      'guam-lodging-area-decision-v13',
    )).toBe(false);
    expect(slugMatchesExpectedTopic(
      'guam-lodging-area-guide',
      'guam-lodging-area-decision-v13',
    )).toBe(true);
  });
});
