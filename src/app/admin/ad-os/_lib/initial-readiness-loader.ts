import type { AdminSurfaceQa, OperatingInventory, StagingSmoke, StagingValidation } from './types';

export type InitialReadinessFetchers = {
  fetchStagingSmoke: () => Promise<StagingSmoke>;
  fetchOperatingInventory: () => Promise<OperatingInventory>;
  fetchStagingValidation: () => Promise<StagingValidation>;
  fetchAdminSurfaceQa: () => Promise<AdminSurfaceQa>;
};

export type InitialReadinessHandlers = {
  setStagingSmoke: (json: StagingSmoke) => void;
  setOperatingInventory: (json: OperatingInventory) => void;
  setStagingValidation: (json: StagingValidation) => void;
  setAdminSurfaceQa: (json: AdminSurfaceQa) => void;
};

export type InitialReadinessLoaderOptions = {
  fetchers: InitialReadinessFetchers;
  handlers: InitialReadinessHandlers;
  shouldApply?: () => boolean;
};

export async function loadInitialReadinessPanels({
  fetchers,
  handlers,
  shouldApply = () => true,
}: InitialReadinessLoaderOptions): Promise<void> {
  const [smokeResult, inventoryResult, validationResult, surfaceQaResult] = await Promise.allSettled([
    fetchers.fetchStagingSmoke(),
    fetchers.fetchOperatingInventory(),
    fetchers.fetchStagingValidation(),
    fetchers.fetchAdminSurfaceQa(),
  ] as const);

  if (!shouldApply()) return;

  if (smokeResult.status === 'fulfilled') handlers.setStagingSmoke(smokeResult.value);
  if (inventoryResult.status === 'fulfilled') handlers.setOperatingInventory(inventoryResult.value);
  if (validationResult.status === 'fulfilled') handlers.setStagingValidation(validationResult.value);
  if (surfaceQaResult.status === 'fulfilled') handlers.setAdminSurfaceQa(surfaceQaResult.value);

  if (smokeResult.status === 'rejected') throw smokeResult.reason;
  if (inventoryResult.status === 'rejected') throw inventoryResult.reason;
  if (validationResult.status === 'rejected') throw validationResult.reason;
  if (surfaceQaResult.status === 'rejected') throw surfaceQaResult.reason;
}
