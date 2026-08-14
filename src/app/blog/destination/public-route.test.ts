import { describe, expect, it } from 'vitest';
import { isObviouslyInvalidDestinationRoute } from './public-route';

describe('blog destination public route', () => {
  it.each(['top', 'undefined', 'null', 'unknown', '123', '1-2', ''])('blocks invalid destination %s', (value) => {
    expect(isObviouslyInvalidDestinationRoute(value)).toBe(true);
  });
  it.each(['오사카', 'New-York', '다낭'])('allows a plausible destination %s', (value) => {
    expect(isObviouslyInvalidDestinationRoute(value)).toBe(false);
  });
});
