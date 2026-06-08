import { describe, expect, it, vi } from 'vitest';

import {
  buildUploadSectionJobKey,
  claimUploadProductSection,
  updateUploadProductSectionJob,
} from './upload-section-idempotency';

function createClaimSupabaseMock() {
  const insertSingle = vi.fn(async () => ({
    data: null,
    error: { code: '23505', message: 'duplicate key value violates unique constraint' },
  }));
  const insertSelect = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn(() => ({ select: insertSelect }));
  const maybeSingle = vi.fn(async () => ({
    data: {
      id: 'job-1',
      status: 'completed',
      product_id: 'PUS-ETC-CEB-05-0001',
      package_id: 'pkg-1',
    },
    error: null,
  }));
  const eq4 = vi.fn(() => ({ maybeSingle }));
  const eq3 = vi.fn(() => ({ eq: eq4 }));
  const eq2 = vi.fn(() => ({ eq: eq3 }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ insert, select }));
  return {
    client: { from },
    calls: { from, insert, insertSelect, insertSingle, select, eq1, eq2, eq3, eq4, maybeSingle },
  };
}

describe('upload section idempotency', () => {
  it('builds stable normalized keys for text-equivalent sections', () => {
    const a = buildUploadSectionJobKey({
      documentRawText: '  Cebu   Hotel Matrix ',
      sectionRawText: 'Title: Cebu   Hotel',
      supplierCode: 'etc',
      title: ' Cebu Hotel ',
    });
    const b = buildUploadSectionJobKey({
      documentRawText: 'Cebu Hotel Matrix',
      sectionRawText: 'Title: Cebu Hotel',
      supplierCode: 'ETC',
      title: 'cebu hotel',
    });

    expect(a.rawTextHash).toBe(b.rawTextHash);
    expect(a.sectionRawTextHash).toBe(b.sectionRawTextHash);
    expect(a.supplierCode).toBe('ETC');
    expect(a.normalizedTitle).toBe('cebu hotel');
  });

  it('skips already completed section jobs after unique conflicts', async () => {
    const supabase = createClaimSupabaseMock();

    const claim = await claimUploadProductSection({
      supabase: supabase.client as never,
      isSupabaseConfigured: true,
      forceReprocess: false,
      uploadId: 'upload-1',
      documentRawText: 'Cebu Hotel Matrix',
      sectionRawText: 'Cebu Hotel Matrix / Solea',
      supplierCode: 'ETC',
      title: 'Cebu Hotel',
    });

    expect(claim).toEqual(expect.objectContaining({
      shouldProcess: false,
      reason: 'completed',
      jobId: 'job-1',
      productId: 'PUS-ETC-CEB-05-0001',
      packageId: 'pkg-1',
    }));
    expect(supabase.calls.insert).toHaveBeenCalledTimes(1);
    expect(supabase.calls.select).toHaveBeenCalledWith('id, status, product_id, package_id, attempt_count, updated_at');
  });

  it('reclaims failed section jobs for automatic retry', async () => {
    const insertSingle = vi.fn(async () => ({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    }));
    const insertSelect = vi.fn(() => ({ single: insertSingle }));
    const insert = vi.fn(() => ({ select: insertSelect }));
    const maybeSingle = vi.fn(async () => ({
      data: {
        id: 'job-failed',
        status: 'failed',
        product_id: null,
        package_id: null,
        attempt_count: 2,
        updated_at: new Date().toISOString(),
      },
      error: null,
    }));
    const lookupEq4 = vi.fn(() => ({ maybeSingle }));
    const lookupEq3 = vi.fn(() => ({ eq: lookupEq4 }));
    const lookupEq2 = vi.fn(() => ({ eq: lookupEq3 }));
    const lookupEq1 = vi.fn(() => ({ eq: lookupEq2 }));
    const lookupSelect = vi.fn(() => ({ eq: lookupEq1 }));
    const updateSingle = vi.fn(async () => ({
      data: {
        id: 'job-failed',
        status: 'processing',
        product_id: null,
        package_id: null,
        attempt_count: 3,
        updated_at: new Date().toISOString(),
      },
      error: null,
    }));
    const updateSelect = vi.fn(() => ({ single: updateSingle }));
    const updateEq = vi.fn(() => ({ select: updateSelect }));
    const update = vi.fn(() => ({ eq: updateEq }));
    const from = vi.fn(() => ({ insert, select: lookupSelect, update }));

    const claim = await claimUploadProductSection({
      supabase: { from } as never,
      isSupabaseConfigured: true,
      forceReprocess: false,
      uploadId: 'upload-retry',
      documentRawText: 'Cebu Hotel Matrix',
      sectionRawText: 'Cebu Hotel Matrix / Solea',
      supplierCode: 'ETC',
      title: 'Cebu Hotel',
    });

    expect(claim).toEqual(expect.objectContaining({
      shouldProcess: true,
      reason: 'reclaimed',
      jobId: 'job-failed',
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      upload_id: 'upload-retry',
      status: 'processing',
      attempt_count: 3,
      error_message: null,
      completed_at: null,
    }));
    expect(updateEq).toHaveBeenCalledWith('id', 'job-failed');
  });

  it('updates section job status with persisted identifiers', async () => {
    const eq = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));

    await expect(updateUploadProductSectionJob({
      supabase: { from } as never,
      isSupabaseConfigured: true,
      jobId: 'job-1',
      status: 'completed',
      productId: 'PUS-ETC-CEB-05-0001',
      packageId: 'pkg-1',
    })).resolves.toEqual({ ok: true });

    expect(from).toHaveBeenCalledWith('product_registration_section_jobs');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      product_id: 'PUS-ETC-CEB-05-0001',
      package_id: 'pkg-1',
      error_message: null,
    }));
    expect(eq).toHaveBeenCalledWith('id', 'job-1');
  });
});
