import { describe, expect, it } from 'vitest';
import { isManagedBlogFallback } from './worker';

describe('isManagedBlogFallback', () => {
  it('allows only empty or Yeosonam-managed publication fallbacks', () => {
    expect(isManagedBlogFallback(null, null)).toBe(true);
    expect(isManagedBlogFallback('https://www.yeosonam.com/og-image.png', null)).toBe(true);
    expect(isManagedBlogFallback(
      'https://cdn.example.com/media-assets/code_rendered/blog/blog_cover/aa/hash.webp',
      null,
    )).toBe(true);
  });

  it('allows the exact fallback captured when the job was enqueued', () => {
    const captured = 'https://cdn.example.com/managed/captured.webp';
    expect(isManagedBlogFallback(captured, captured)).toBe(true);
  });

  it('refuses supplier, official, manual, or concurrently changed covers', () => {
    expect(isManagedBlogFallback(
      'https://supplier.example.com/hotel-room.jpg',
      'https://www.yeosonam.com/og-image.png',
    )).toBe(false);
    expect(isManagedBlogFallback(
      'https://cdn.example.com/operator-selected-cover.webp',
      null,
    )).toBe(false);
  });
});
