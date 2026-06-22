import { describe, expect, it } from 'vitest';
import { loadInitialReadinessPanels } from './initial-readiness-loader';
import type { AdminSurfaceQa, OperatingInventory, StagingSmoke, StagingValidation } from './types';

const smoke = { ok: true, source: 'fixture' } as StagingSmoke;
const inventory = { ok: true, generated_at: '2026-06-05' } as OperatingInventory;
const validation = { ok: true, generated_at: '2026-06-05' } as StagingValidation;
const surfaceQa = { ok: true, generated_at: '2026-06-05' } as AdminSurfaceQa;

function createHandlers(applied: string[]) {
  return {
    setStagingSmoke: () => { applied.push('smoke'); },
    setOperatingInventory: () => { applied.push('inventory'); },
    setStagingValidation: () => { applied.push('validation'); },
    setAdminSurfaceQa: () => { applied.push('surface'); },
  };
}

describe('initial Ad OS readiness loader', () => {
  it('loads and applies every initial readiness panel in dashboard order', async () => {
    const applied: string[] = [];

    await loadInitialReadinessPanels({
      fetchers: {
        fetchStagingSmoke: async () => smoke,
        fetchOperatingInventory: async () => inventory,
        fetchStagingValidation: async () => validation,
        fetchAdminSurfaceQa: async () => surfaceQa,
      },
      handlers: createHandlers(applied),
    });

    expect(applied).toEqual(['smoke', 'inventory', 'validation', 'surface']);
  });

  it('applies fulfilled panels and reports rejected panels as non-blocking errors', async () => {
    const applied: string[] = [];
    const errors: string[] = [];

    await loadInitialReadinessPanels({
      fetchers: {
        fetchStagingSmoke: async () => smoke,
        fetchOperatingInventory: async () => { throw new Error('inventory failed'); },
        fetchStagingValidation: async () => validation,
        fetchAdminSurfaceQa: async () => surfaceQa,
      },
      handlers: createHandlers(applied),
      onNonBlockingError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    });

    expect(applied).toEqual(['smoke', 'validation', 'surface']);
    expect(errors).toEqual(['inventory failed']);
  });

  it('reports multiple initial load failures without blocking fulfilled panels', async () => {
    const applied: string[] = [];
    const errors: string[] = [];

    await loadInitialReadinessPanels({
      fetchers: {
        fetchStagingSmoke: async () => { throw new Error('smoke failed'); },
        fetchOperatingInventory: async () => { throw new Error('inventory failed'); },
        fetchStagingValidation: async () => validation,
        fetchAdminSurfaceQa: async () => surfaceQa,
      },
      handlers: createHandlers(applied),
      onNonBlockingError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    });

    expect(applied).toEqual(['validation', 'surface']);
    expect(errors).toEqual(['smoke failed', 'inventory failed']);
  });

  it('skips state writes and failure surfacing after the page is unmounted', async () => {
    const applied: string[] = [];

    await loadInitialReadinessPanels({
      fetchers: {
        fetchStagingSmoke: async () => { throw new Error('smoke failed'); },
        fetchOperatingInventory: async () => inventory,
        fetchStagingValidation: async () => validation,
        fetchAdminSurfaceQa: async () => surfaceQa,
      },
      handlers: createHandlers(applied),
      shouldApply: () => false,
    });

    expect(applied).toEqual([]);
  });
});
