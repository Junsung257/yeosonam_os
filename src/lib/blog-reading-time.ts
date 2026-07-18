export const BLOG_READING_TIME_MINIMUM_MINUTES = 3;

export function calculateBlogReadingTimeFromHtml(html: string): number {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, ' ')
    .replace(/\s+/g, '')
    .trim();
  return Math.max(BLOG_READING_TIME_MINIMUM_MINUTES, Math.round(text.length / 500));
}

export function readPersistedBlogReadingTime(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const minutes = (value as Record<string, unknown>).rendered_reading_time_minutes;
  return typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 1 && minutes <= 180
    ? minutes
    : null;
}

export function withPersistedBlogReadingTime(
  qualityGate: unknown,
  readingTimeMinutes: number,
): Record<string, unknown> {
  const base = qualityGate && typeof qualityGate === 'object' && !Array.isArray(qualityGate)
    ? qualityGate as Record<string, unknown>
    : {};
  return {
    ...base,
    rendered_reading_time_minutes: readingTimeMinutes,
  };
}
