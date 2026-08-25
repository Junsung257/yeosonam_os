export type BookingLifecycleTab = 'active' | 'done' | 'cancelled' | 'trash';

export type BookingActiveTab =
  | ''
  | 'unpaid_risk'
  | 'missing_info'
  | 'land_bomb'
  | 'prep_docs'
  | 'deposit_unpaid'
  | 'over_cost'
  | 'refund_pending'
  | 'settlement_pending';

export type BookingDoneSubTab = '' | 'settled' | 'unsettled';

export interface BookingFilterSelection {
  lifecycleTab: BookingLifecycleTab;
  activeTab: BookingActiveTab;
  doneSubTab: BookingDoneSubTab;
}

/**
 * Some smart filters describe work outside the active-booking lifecycle.
 * Route those filters to their owning lifecycle before applying the detail
 * predicate so their global badge count and visible rows cannot diverge.
 */
export function selectBookingSmartFilter(
  requestedTab: BookingActiveTab,
  currentTab: BookingActiveTab,
): BookingFilterSelection {
  if (requestedTab === 'settlement_pending') {
    return {
      lifecycleTab: 'done',
      activeTab: 'settlement_pending',
      doneSubTab: 'unsettled',
    };
  }

  if (requestedTab === 'refund_pending') {
    return {
      lifecycleTab: 'cancelled',
      activeTab: 'refund_pending',
      doneSubTab: '',
    };
  }

  return {
    lifecycleTab: 'active',
    activeTab: currentTab === requestedTab ? '' : requestedTab,
    doneSubTab: '',
  };
}
