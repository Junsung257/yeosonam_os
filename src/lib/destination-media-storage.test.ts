import { describe, expect, it } from 'vitest';

import {
  buildDestinationMediaStoragePath,
  destinationMediaKey,
} from './destination-media-storage';

describe('destination media storage key', () => {
  it('returns one stable ASCII key for canonically equivalent Unicode', () => {
    const composed = '가오슝';
    const decomposed = composed.normalize('NFD');

    expect(destinationMediaKey(composed)).toBe(destinationMediaKey(decomposed));
    expect(destinationMediaKey(`  ${composed}  `)).toBe(destinationMediaKey(composed));
    expect(destinationMediaKey(composed)).toMatch(/^[a-f0-9]{24}$/);
  });

  it('does not leak Korean, slashes, spaces, percent escapes, or emoji into the path', () => {
    const path = buildDestinationMediaStoragePath({
      destination: '  삿포로/니세코 ✈️  ',
      provider: 'wikimedia_commons',
      extension: 'jpg',
    });

    expect(path).toMatch(
      /^destination-[a-f0-9]{24}\/hero-wikimedia_commons\.jpg$/,
    );
    expect(path).not.toMatch(/[^\x20-\x7e]/);
    expect(path).not.toContain('%');
  });

  it('keeps different destination labels isolated', () => {
    expect(destinationMediaKey('나리타')).not.toBe(destinationMediaKey('시즈오카'));
    expect(destinationMediaKey('천진/진황도')).not.toBe(destinationMediaKey('진황도'));
  });

  it('rejects empty destinations and unsupported runtime values', () => {
    expect(() => destinationMediaKey(' \n ')).toThrow(
      'Destination is required for media storage.',
    );
    expect(() => buildDestinationMediaStoragePath({
      destination: '괌',
      provider: 'other' as 'pexels',
      extension: 'jpg',
    })).toThrow('Unsupported destination photo provider.');
    expect(() => buildDestinationMediaStoragePath({
      destination: '괌',
      provider: 'pexels',
      extension: 'gif' as 'jpg',
    })).toThrow('Unsupported destination photo extension.');
  });
});
