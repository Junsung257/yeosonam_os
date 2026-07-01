import { describe, expect, it } from 'vitest';
import { resolveBlogIndexingBaseUrl } from './blog-indexing-worker';

describe('blog indexing worker', () => {
  it('prefers the public job URL origin over localhost options', () => {
    expect(resolveBlogIndexingBaseUrl(
      'https://www.yeosonam.com/blog/6-fukuoka',
      'http://localhost:3000',
    )).toBe('https://www.yeosonam.com');
  });

  it('uses an explicit public base URL when provided', () => {
    expect(resolveBlogIndexingBaseUrl(
      'https://preview.example.com/blog/6-fukuoka',
      'https://www.yeosonam.com',
    )).toBe('https://www.yeosonam.com');
  });
});
