import { describe, expect, it } from 'vitest';
import { resolvePrimaryAttraction } from './attraction-reference';
import type { AttractionData } from './attraction-matcher';

const attractions: AttractionData[] = [
  { id: 'a-1', name: '도이인타논 산', aliases: ['도이인타논'], short_desc: '치앙마이 최고봉' },
  { id: 'a-2', name: '베치라탄 폭포', short_desc: '시원한 폭포 명소' },
];

describe('resolvePrimaryAttraction', () => {
  it('attraction_ids를 최우선으로 사용', () => {
    const found = resolvePrimaryAttraction(
      {
        activity: '▶도이인타논으로 이동',
        attraction_ids: ['a-2'],
      },
      attractions,
      '치앙마이',
    );
    expect(found?.name).toBe('베치라탄 폭포');
  });

  it('id가 없으면 attraction_names로 매칭', () => {
    const found = resolvePrimaryAttraction(
      {
        activity: '▶도이인타논으로 이동',
        attraction_names: ['도이인타논 산'],
      },
      attractions,
      '치앙마이',
    );
    expect(found?.id).toBe('a-1');
  });
});
