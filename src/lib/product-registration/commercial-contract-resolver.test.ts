import { describe, expect, it } from 'vitest';

import {
  resolveCommercialContractFromRows,
  type CommercialContractRow,
} from './commercial-contract-resolver';

function row(overrides: Partial<CommercialContractRow> = {}): CommercialContractRow {
  return {
    id: 'contract-1',
    land_operator_id: 'operator-1',
    contract_label: 'verified 2026 contract',
    commission_rate: 15,
    filename_markers: ['투어라운지-계약A'],
    source_label_markers: [],
    raw_text_markers: [],
    allow_operator_alias_match: false,
    valid_from: '2026-01-01',
    valid_to: '2026-12-31',
    evidence_url: 'https://contracts.example/verified-a',
    evidence_hash: null,
    verified_at: '2026-01-01T00:00:00.000Z',
    priority: 100,
    land_operators: { id: 'operator-1', name: '투어라운지', aliases: ['투어 라운지'], is_active: true },
    ...overrides,
  };
}

describe('commercial contract resolver', () => {
  it('resolves an in-date explicit filename marker', () => {
    const result = resolveCommercialContractFromRows({
      fileName: '2026 곤명 투어라운지-계약A.hwp',
      asOf: new Date('2026-07-31T00:00:00.000Z'),
    }, [row()]);
    expect(result).toMatchObject({
      status: 'resolved',
      landOperator: '투어라운지',
      commissionRate: 15,
      matchedBy: 'filename_marker',
    });
  });

  it('does not treat shorthand such as 15T or TL as contract evidence', () => {
    const result = resolveCommercialContractFromRows({
      fileName: '곤명 특가_투어라운지15T0728TL.hwp',
      asOf: new Date('2026-07-31T00:00:00.000Z'),
    }, [row()]);
    expect(result.status).toBe('not_found');
  });

  it('blocks same-priority contracts that disagree', () => {
    const result = resolveCommercialContractFromRows({
      fileName: '투어라운지-계약A.hwp',
      asOf: new Date('2026-07-31T00:00:00.000Z'),
    }, [
      row(),
      row({ id: 'contract-2', commission_rate: 10 }),
    ]);
    expect(result).toMatchObject({ status: 'ambiguous' });
  });

  it('ignores expired and inactive-operator contracts', () => {
    const expired = resolveCommercialContractFromRows({
      fileName: '투어라운지-계약A.hwp',
      asOf: new Date('2027-01-01T00:00:00.000Z'),
    }, [row()]);
    const inactive = resolveCommercialContractFromRows({
      fileName: '투어라운지-계약A.hwp',
      asOf: new Date('2026-07-31T00:00:00.000Z'),
    }, [row({ land_operators: { id: 'operator-1', name: '투어라운지', aliases: [], is_active: false } })]);
    expect(expired.status).toBe('not_found');
    expect(inactive.status).toBe('not_found');
  });
});
