import { describe, expect, it } from 'vitest';
import { selectBookingSmartFilter } from './booking-list-filter-navigation';

describe('selectBookingSmartFilter', () => {
  it('opens settlement waiting rows in the completed/past lifecycle', () => {
    expect(selectBookingSmartFilter('settlement_pending', '')).toEqual({
      lifecycleTab: 'done',
      activeTab: 'settlement_pending',
      doneSubTab: 'unsettled',
    });
  });

  it('opens refund waiting rows in the cancelled lifecycle', () => {
    expect(selectBookingSmartFilter('refund_pending', '')).toEqual({
      lifecycleTab: 'cancelled',
      activeTab: 'refund_pending',
      doneSubTab: '',
    });
  });

  it('toggles an active-lifecycle smart filter without leaking other scopes', () => {
    expect(selectBookingSmartFilter('missing_info', '')).toEqual({
      lifecycleTab: 'active',
      activeTab: 'missing_info',
      doneSubTab: '',
    });
    expect(selectBookingSmartFilter('missing_info', 'missing_info')).toEqual({
      lifecycleTab: 'active',
      activeTab: '',
      doneSubTab: '',
    });
  });
});
