// ─── 통합 Tool Dispatcher ─────────────────────────────────────────────────────
// Gemini function call 이름 → 실제 실행 함수 라우팅

import type { UIComponent } from '../ui-types';
import { handleSearchPackages, handleGetPriceQuote, handleFindCheapestDates, handleGenerateItinerary } from './product-tools';
import { handleFindCustomer, handleCreateCustomer, handleCreateBooking, handleGetBookings, handleUpdateBooking, handleDeleteBooking } from './booking-tools';
import { handleGetBookingStats, handleBulkProcessReservations } from './finance-tools';

export interface ToolResult {
  result: unknown;
  action?: { type: string; data: unknown };
  actions?: { type: string; data: unknown }[];
  uiComponents?: UIComponent[];
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  injectedContext: Record<string, string> = {}
): Promise<ToolResult> {
  switch (name) {
    // ── Product ──────────────────────────────────────────────────────────────
    case 'search_packages':
      return handleSearchPackages(args);

    case 'get_price_quote':
      return handleGetPriceQuote(args);

    case 'find_cheapest_dates':
      return handleFindCheapestDates(args);

    case 'generate_itinerary':
      return handleGenerateItinerary(args);

    // ── Booking ──────────────────────────────────────────────────────────────
    case 'find_customer':
      return handleFindCustomer(args);

    case 'create_customer':
      return handleCreateCustomer(args);

    case 'create_booking':
      return handleCreateBooking(args, injectedContext);

    case 'get_bookings':
      return handleGetBookings(args, injectedContext);

    case 'update_booking':
      return handleUpdateBooking(args, injectedContext);

    case 'delete_booking':
      return handleDeleteBooking(args, injectedContext);

    // ── Finance ──────────────────────────────────────────────────────────────
    case 'get_booking_stats':
      return handleGetBookingStats();

    case 'bulk_process_reservations':
      return handleBulkProcessReservations(args);

    default:
      return { result: { error: `알 수 없는 도구: ${name}` } };
  }
}
