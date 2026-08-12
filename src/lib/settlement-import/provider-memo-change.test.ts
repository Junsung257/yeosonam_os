import { describe, expect, it } from 'vitest';

import { evaluateProviderMemoChange, getProviderMemoObservation } from './provider-memo-change';

describe('provider memo observation', () => {
  it('uses the latest provider evidence instead of the legacy transaction memo', () => {
    expect(getProviderMemoObservation({
      source: 'clobe_mcp',
      storedMemo: '260611_창원대_투어폰',
      sourceMetadata: {
        clobe_mcp: {
          memo: '260715_정지해_투어폰',
          settlement_key: '260715_정지해_투어폰',
        },
      },
    })).toEqual({
      seen: true,
      settlementKey: '260715_정지해_투어폰',
    });
  });

  it('remembers that a provider removed a travel memo', () => {
    expect(getProviderMemoObservation({
      source: 'clobe_mcp',
      storedMemo: '260715_정지해_투어폰',
      sourceMetadata: {
        clobe_mcp: {
          memo: '',
          settlement_key: null,
        },
      },
    })).toEqual({
      seen: true,
      settlementKey: null,
    });
  });

  it('falls back to the stored memo before the provider has been observed', () => {
    expect(getProviderMemoObservation({
      source: 'clobe_mcp',
      storedMemo: '260715_정지해_투어폰',
      sourceMetadata: { bulk_import: { memo: '260715_정지해_투어폰' } },
    })).toEqual({
      seen: false,
      settlementKey: '260715_정지해_투어폰',
    });
  });

  it('does not repeat a review for an already observed provider memo', () => {
    expect(evaluateProviderMemoChange({
      source: 'clobe_mcp',
      storedMemo: '260611_창원대_투어폰',
      incomingMemo: '260715_정지해_투어폰',
      processed: true,
      sourceMetadata: {
        clobe_mcp: {
          memo: '260715_정지해_투어폰',
          settlement_key: '260715_정지해_투어폰',
        },
      },
    })).toEqual(expect.objectContaining({
      memoChanged: false,
      declassificationNeedsReview: false,
    }));
  });

  it('reviews a travel memo removal once, then treats the same provider evidence as merged', () => {
    expect(evaluateProviderMemoChange({
      source: 'clobe_mcp',
      storedMemo: '260715_정지해_투어폰',
      incomingMemo: '',
      processed: true,
      sourceMetadata: null,
    })).toEqual(expect.objectContaining({
      memoChanged: true,
      declassificationNeedsReview: true,
    }));

    expect(evaluateProviderMemoChange({
      source: 'clobe_mcp',
      storedMemo: '260715_정지해_투어폰',
      incomingMemo: '',
      processed: true,
      sourceMetadata: {
        clobe_mcp: { memo: '', settlement_key: null },
      },
    })).toEqual(expect.objectContaining({
      memoChanged: false,
      declassificationNeedsReview: false,
    }));
  });
});
