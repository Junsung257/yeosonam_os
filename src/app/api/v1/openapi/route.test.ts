import { describe, expect, it } from 'vitest';
import { dynamic } from './route';

describe('OpenAPI route deployment contract', () => {
  it('uses a serverless handler for Vercel output conversion', () => {
    expect(dynamic).toBe('force-dynamic');
  });
});
