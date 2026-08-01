export function extractBookingsFromApi<T>(payload: unknown): T[] {
  if (!payload || typeof payload !== 'object') return [];

  const response = payload as { bookings?: unknown; data?: unknown };
  if (Array.isArray(response.bookings)) return response.bookings as T[];
  if (!response.data || typeof response.data !== 'object') return [];

  const nested = response.data as { bookings?: unknown };
  return Array.isArray(nested.bookings) ? nested.bookings as T[] : [];
}
