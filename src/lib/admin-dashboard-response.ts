export interface AdminDashboardListResponse<T> {
  data?: T[];
  packages?: T[];
  pagination?: { total?: number };
}

export interface AdminDashboardList<T> {
  rows: T[];
  total: number;
}

/**
 * Normalizes the current listResponse contract and the legacy dashboard shape.
 * Keeping this at the API boundary prevents a successful refresh from clearing
 * the server-prefetched product review queue.
 */
export function readAdminDashboardList<T>(response: AdminDashboardListResponse<T>): AdminDashboardList<T> {
  const rows = Array.isArray(response.data)
    ? response.data
    : Array.isArray(response.packages)
      ? response.packages
      : [];
  return {
    rows,
    total: response.pagination?.total ?? rows.length,
  };
}
