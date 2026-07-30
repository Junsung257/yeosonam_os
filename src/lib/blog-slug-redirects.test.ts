import { describe, expect, it } from 'vitest';
import {
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
});
