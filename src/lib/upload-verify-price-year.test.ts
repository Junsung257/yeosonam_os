import { describe, expect, it } from 'vitest';

import { evaluateVerifyChecks } from './upload-verify';

function findCheck(result: ReturnType<typeof evaluateVerifyChecks>, id: string) {
  return result.checks.find(check => check.id === id);
}

describe('upload verify price year', () => {
  it('C12 uses source-backed product year before current-year rollover', () => {
    const rawText = `
regular fare distributed 2026.2.1
spot
7/2,9
999,-
1,159,-

PKG sample golf package 3n5d
`;

    const result = evaluateVerifyChecks({
      id: 'pkg-source-backed-year',
      title: 'sample golf package 3n5d',
      duration: 5,
      raw_text: rawText,
      accommodations: ['villa'],
      price_dates: [
        { date: '2026-07-02', price: 1159000 },
        { date: '2026-07-09', price: 1159000 },
      ],
    });

    expect(findCheck(result, 'C12')).toEqual(expect.objectContaining({
      status: 'pass',
    }));
  });

  it('C12 fails old wrong DB years against source-backed product year', () => {
    const rawText = `
regular fare distributed 2026.2.1
spot
7/2,9
999,-
1,159,-

PKG sample golf package 3n5d
`;

    const result = evaluateVerifyChecks({
      id: 'pkg-wrong-db-year',
      title: 'sample golf package 3n5d',
      duration: 5,
      raw_text: rawText,
      accommodations: ['villa'],
      price_dates: [
        { date: '2028-07-02', price: 1159000 },
        { date: '2028-07-09', price: 1159000 },
      ],
    });

    expect(findCheck(result, 'C12')).toEqual(expect.objectContaining({
      status: 'fail',
    }));
  });
});
