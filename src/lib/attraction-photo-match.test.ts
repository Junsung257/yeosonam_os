import { describe, expect, it } from 'vitest';

import {
  buildAttractionPhotoSearchPlan,
  inferPexelsLocale,
  scorePexelsPhoto,
} from './attraction-photo-match';
import type { PexelsPhoto } from './pexels';

describe('attraction photo match search planning', () => {
  it('uses local locale and English aliases for Japanese attractions', () => {
    const plan = buildAttractionPhotoSearchPlan({
      name: '니혼다이라 로프웨이',
      aliases: ['Nihondaira Ropeway', '日本平ロープウェイ'],
      country: 'JP',
      region: '시즈오카',
    });

    expect(plan.some(item => item.query.includes('Nihondaira Ropeway') && item.locale == null)).toBe(true);
    expect(plan.some(item => item.query.includes('日本平ロープウェイ') && item.locale === 'ja-JP')).toBe(true);
    expect(plan.some(item => item.query.includes('니혼다이라 로프웨이') && item.locale === 'ja-JP')).toBe(true);
  });

  it('adds known English aliases for photo quality when the master label is Korean', () => {
    const plan = buildAttractionPhotoSearchPlan({
      name: '백두산 천지',
      country: 'CN',
      region: '연길/백두산',
    });

    expect(plan.some(item => item.query.includes('Changbai Mountain Tianchi'))).toBe(true);
    expect(plan.some(item => item.query.includes('Heaven Lake Changbai Mountain'))).toBe(true);
    expect(plan[0].query).toContain('Changbai Mountain Tianchi');
  });

  it('infers locale from common package destination context', () => {
    expect(inferPexelsLocale({ region: '연길/백두산' })).toBe('zh-CN');
    expect(inferPexelsLocale({ region: '다낭' })).toBe('vi-VN');
    expect(inferPexelsLocale({ region: '후쿠오카' })).toBe('ja-JP');
  });

  it('scores high-resolution landscape photos above weak small photos', () => {
    const strong = {
      id: 1,
      width: 1800,
      height: 1000,
      url: 'https://www.pexels.com/photo/1',
      photographer: 'A',
      photographer_url: '',
      alt: 'Nihondaira Ropeway Mount Fuji view',
      src: {
        original: '',
        large2x: '',
        large: '',
        medium: '',
        small: '',
        portrait: '',
        landscape: '',
        tiny: '',
      },
    } satisfies PexelsPhoto;
    const weak = { ...strong, id: 2, width: 400, height: 900, alt: 'generic city street' } satisfies PexelsPhoto;
    const query = {
      query: 'Nihondaira Ropeway attraction',
      source: 'alias' as const,
      priority: 80,
    };

    expect(scorePexelsPhoto({ photo: strong, query, labels: ['Nihondaira Ropeway'] }))
      .toBeGreaterThan(scorePexelsPhoto({ photo: weak, query, labels: ['Nihondaira Ropeway'] }));
  });

  it('rejects generic Pexels results for non-English exact-name queries without alt overlap', () => {
    const photo = {
      id: 1,
      width: 1800,
      height: 1000,
      url: 'https://www.pexels.com/photo/1',
      photographer: 'A',
      photographer_url: '',
      alt: 'Colorful carousel and Ferris wheel light up a night-time amusement park.',
      src: {
        original: '',
        large2x: '',
        large: '',
        medium: '',
        small: '',
        portrait: '',
        landscape: '',
        tiny: '',
      },
    } satisfies PexelsPhoto;

    expect(scorePexelsPhoto({
      photo,
      query: { query: '백두산 천지 attraction', locale: 'zh-CN', source: 'name', priority: 70 },
      labels: ['백두산 천지', 'Changbai Mountain Tianchi'],
    })).toBeLessThan(0.45);
  });
});
