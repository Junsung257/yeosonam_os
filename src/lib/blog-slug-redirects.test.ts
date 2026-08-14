import { describe, expect, it } from 'vitest';
import {
  isBlogSlugRedirectTombstone,
  isBlogSlugRedirectSource,
  resolveBlogSlugRedirect,
} from './blog-slug-redirects';

describe('blog slug redirects', () => {
  it('preserves the first Dubai publication URL after destination repair', () => {
    expect(resolveBlogSlugRedirect('weather-checklist-july')).toBe(
      'dubai-july-weather-preparation',
    );
  });

  it('consolidates the legacy Manila month-specific weather guide', () => {
    expect(resolveBlogSlugRedirect('manila-6-weather-complete-guide')).toBe(
      'manila-weather',
    );
    expect(isBlogSlugRedirectSource('manila-6-weather-complete-guide')).toBe(true);
    expect(resolveBlogSlugRedirect('manila-weather')).toBeNull();
  });

  it('tombstones unreviewed medication content and every legacy alias that resolves to it', () => {
    expect(isBlogSlugRedirectTombstone('travel-emergency-medicine-summer-checklist')).toBe(true);
    expect(isBlogSlugRedirectTombstone('post-hv01')).toBe(true);
    expect(resolveBlogSlugRedirect('post-hv01')).toBeNull();
  });
});
