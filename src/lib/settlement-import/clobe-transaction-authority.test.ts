import { describe, expect, it } from 'vitest';

import { resolveClobeTransactionAuthority } from './clobe-transaction-authority';

describe('Clobe transaction authority', () => {
  it('separates the latest provider memo from the memo applied in OS', () => {
    expect(resolveClobeTransactionAuthority({
      source: 'clobe_mcp',
      external_provider: 'clobe',
      memo: '260813_김주연_투어코코넛',
      source_metadata: {
        clobe_mcp: {
          memo: '260813_최주연_투어코코넛',
          settlement_key: '260813_최주연_투어코코넛',
        },
      },
    })).toEqual(expect.objectContaining({
      providerMemoSeen: true,
      effectiveMemo: '260813_최주연_투어코코넛',
      providerSettlementKey: '260813_최주연_투어코코넛',
      appliedSettlementKey: '260813_김주연_투어코코넛',
      applicationPending: true,
    }));
  });

  it('treats a provider memo removal as pending until OS reconciles it', () => {
    expect(resolveClobeTransactionAuthority({
      source: 'clobe_mcp',
      memo: '260715_정지해_투어폰',
      source_metadata: { clobe_mcp: { memo: '', settlement_key: null } },
    })).toEqual(expect.objectContaining({
      providerMemoSeen: true,
      effectiveMemo: null,
      providerSettlementKey: null,
      appliedSettlementKey: '260715_정지해_투어폰',
      applicationPending: true,
    }));
  });

  it('falls back to the stored memo before provider evidence exists', () => {
    expect(resolveClobeTransactionAuthority({
      source: 'clobe_mcp',
      memo: '260715_정지해_투어폰',
      source_metadata: { bulk_import: { memo: 'ignored' } },
    })).toEqual(expect.objectContaining({
      providerMemoSeen: false,
      effectiveMemo: '260715_정지해_투어폰',
      applicationPending: false,
    }));
  });
});
