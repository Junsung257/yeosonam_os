import { describe, expect, it } from 'vitest';

import {
  isPublicPublicationState,
  PUBLIC_CUSTOMER_STATES,
} from './types';

describe('customer publication states', () => {
  it('treats only published as customer-public', () => {
    expect(PUBLIC_CUSTOMER_STATES).toEqual(['published']);
    expect(isPublicPublicationState('published')).toBe(true);
    expect(isPublicPublicationState('approved')).toBe(false);
    expect(isPublicPublicationState('active')).toBe(false);
    expect(isPublicPublicationState(null)).toBe(false);
  });
});
