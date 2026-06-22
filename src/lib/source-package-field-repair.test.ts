import { describe, expect, it } from 'vitest';

import { buildSourceBackedFieldRepair } from './source-package-field-repair';

describe('buildSourceBackedFieldRepair', () => {
  it('repairs an airline code when the title has a source-backed code', () => {
    const result = buildSourceBackedFieldRepair({
      title: 'PKG ZE Phu Quoc golf 4N6D',
      raw_text: 'PKG ZE Phu Quoc golf 4N6D',
      airline: 'BX',
    });

    expect(result).toMatchObject({
      status: 'repaired',
      airline: 'ZE',
    });
  });

  it('keeps an already source-backed airline code', () => {
    const result = buildSourceBackedFieldRepair({
      title: 'Shizuoka BX1645',
      raw_text: 'BX1645 Busan Shizuoka',
      airline: 'BX',
    });

    expect(result.status).toBe('not_needed');
  });
});
