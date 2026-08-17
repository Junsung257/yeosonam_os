import { describe, expect, it, vi } from 'vitest';

import { persistUploadRegistrationRows, rollbackInsertedUploadProduct } from './upload-persistence';

describe('retired mutable upload persistence', () => {
  it('fails closed before touching products or travel_packages', async () => {
    const from = vi.fn();

    await expect(persistUploadRegistrationRows({
      supabase: { from } as never,
      isSupabaseConfigured: true,
      internalCode: 'LEGACY-1',
      rows: {
        productRow: { internal_code: 'LEGACY-1' },
        productPriceRows: [],
        travelPackageRow: { title: 'legacy candidate' },
      },
    })).rejects.toThrow('LEGACY_UPLOAD_PERSISTENCE_RETIRED_USE_REGISTRATION_KERNEL_WORKFLOW');

    expect(from).not.toHaveBeenCalled();
  });

  it('never rollback-deletes immutable product history', async () => {
    const from = vi.fn();
    const result = await rollbackInsertedUploadProduct({
      supabase: { from } as never,
      isSupabaseConfigured: true,
      internalCode: 'LEGACY-1',
      productInserted: true,
    });

    expect(result).toEqual({
      rolledBack: false,
      error: 'LEGACY_UPLOAD_ROLLBACK_RETIRED_IMMUTABLE_REVISION_REQUIRES_NEW_CORRECTION',
    });
    expect(from).not.toHaveBeenCalled();
  });
});
