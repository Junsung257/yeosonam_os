import { describe, expect, it } from 'vitest';
import {
  calculateBlogReadingTimeFromHtml,
  readPersistedBlogReadingTime,
  withPersistedBlogReadingTime,
} from './blog-reading-time';

describe('blog reading time SSOT', () => {
  it('uses the final rendered text and enforces the public minimum', () => {
    expect(calculateBlogReadingTimeFromHtml('<p>짧은 글</p>')).toBe(3);
    expect(calculateBlogReadingTimeFromHtml(`<p>${'가'.repeat(2_600)}</p>`)).toBe(5);
  });

  it('persists and reads the same value from quality gate evidence', () => {
    const qualityGate = withPersistedBlogReadingTime({ passed: true }, 7);
    expect(qualityGate).toEqual({ passed: true, rendered_reading_time_minutes: 7 });
    expect(readPersistedBlogReadingTime(qualityGate)).toBe(7);
    expect(readPersistedBlogReadingTime({ rendered_reading_time_minutes: 0 })).toBeNull();
  });
});
