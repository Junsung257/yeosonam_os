import type { AdminSurfaceQa, OperatingInventory, StagingSmoke, StagingValidation, Summary } from './types';

async function readJson<T>(res: Response): Promise<T> {
  try {
    return await res.json() as T;
  } catch {
    throw new Error(`HTTP ${res.status}`);
  }
}

export async function fetchSummary(): Promise<Summary> {
  const res = await fetch('/api/admin/ad-os/summary');
  const json = await readJson<Summary & { error?: string }>(res);
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function fetchStagingSmoke(): Promise<StagingSmoke> {
  const res = await fetch('/api/admin/ad-os/staging-smoke');
  const json = await readJson<StagingSmoke & { error?: string }>(res);
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function fetchOperatingInventory(): Promise<OperatingInventory> {
  const res = await fetch('/api/admin/ad-os/operating-inventory');
  const json = await readJson<OperatingInventory & { error?: string }>(res);
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function fetchStagingValidation(): Promise<StagingValidation> {
  const res = await fetch('/api/admin/ad-os/staging-validation');
  const json = await readJson<StagingValidation & { error?: string }>(res);
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function fetchAdminSurfaceQa(): Promise<AdminSurfaceQa> {
  const res = await fetch('/api/admin/ad-os/admin-surface-qa');
  const json = await readJson<AdminSurfaceQa & { error?: string }>(res);
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}
