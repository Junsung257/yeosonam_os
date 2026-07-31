import { describe, expect, it } from 'vitest';
import {
  consentStateToPreferences,
  preferencesToConsentState,
} from './consent';

describe('Consent Mode v2 mapping', () => {
  it('maps analytics and advertising choices to all four consent signals', () => {
    const state = preferencesToConsentState({ analytics: true, advertising: false });
    expect(state).toMatchObject({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      decided: true,
    });
    expect(consentStateToPreferences(state)).toEqual({
      analytics: true,
      advertising: false,
    });
  });
});
