export function extractBookingsFromApi<T>(payload: unknown): T[] {
  if (!payload || typeof payload !== 'object') return [];

  const response = payload as { bookings?: unknown; data?: unknown };
  if (Array.isArray(response.bookings)) return response.bookings as T[];
  if (!response.data || typeof response.data !== 'object') return [];

  const nested = response.data as { bookings?: unknown };
  return Array.isArray(nested.bookings) ? nested.bookings as T[] : [];
}

export function extractBookingFromApi<T>(payload: unknown): T | null {
  if (!payload || typeof payload !== 'object') return null;

  const response = payload as { booking?: unknown; data?: unknown };
  if (response.booking && typeof response.booking === 'object') return response.booking as T;
  if (!response.data || typeof response.data !== 'object') return null;

  const nested = response.data as { booking?: unknown };
  return nested.booking && typeof nested.booking === 'object' ? nested.booking as T : null;
}
