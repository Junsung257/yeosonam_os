import { describe, expect, it } from 'vitest';

import { hasClobeTravelMemo, splitClobeOperationalRows } from './clobe-operational-scope';

describe('Clobe operational scope', () => {
  it('accepts only parseable travel-key memos into the booking workflow', () => {
    expect(hasClobeTravelMemo({ memo: '261011_홍길동_투어폰' })).toBe(true);
    expect(hasClobeTravelMemo({ memo: '260706_김도연_투어폰_환불' })).toBe(true);
    expect(hasClobeTravelMemo({ memo: '261011_홍길동-투어폰' })).toBe(true);
    expect(hasClobeTravelMemo({ memo: '' })).toBe(false);
    expect(hasClobeTravelMemo({ memo: '기타' })).toBe(false);
    expect(hasClobeTravelMemo({ memo: '딥시크' })).toBe(false);
    expect(hasClobeTravelMemo({ memo: 'VA비용' })).toBe(false);
  });

  it('keeps noncanonical evidence while removing it from travel operations', () => {
    const rows = [
      { id: 'travel', memo: '261011_홍길동_투어폰' },
      { id: 'blank', memo: null },
      { id: 'expense', memo: '기타' },
    ];

    expect(splitClobeOperationalRows(rows)).toEqual({
      travel: [rows[0]],
      memoReview: [rows[1], rows[2]],
    });
  });
});
