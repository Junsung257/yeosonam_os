export interface BlogProductFactLabelInput {
  airline?: string | null;
  departureAirport?: string | null;
  duration?: string | number | null;
  nights?: number | null;
}

function cleanLabelPart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 && cleaned.length <= 40 ? cleaned : null;
}

function durationLabel(
  duration: BlogProductFactLabelInput['duration'],
  nights: BlogProductFactLabelInput['nights'],
): string | null {
  const durationDays = typeof duration === 'number'
    ? duration
    : typeof duration === 'string' && /^\d+$/.test(duration.trim())
      ? Number(duration.trim())
      : null;
  const safeNights = typeof nights === 'number' && Number.isInteger(nights) && nights >= 0
    ? nights
    : null;

  if (durationDays != null && Number.isInteger(durationDays) && durationDays > 0 && durationDays <= 60) {
    return safeNights != null ? `${safeNights}박 ${durationDays}일` : `${durationDays}일`;
  }

  return cleanLabelPart(duration);
}

/**
 * Builds neutral labels only from persisted package facts.
 * It intentionally never adds inferred claims such as "verified", "direct",
 * or "no optional tours" when the underlying package row does not prove them.
 */
export function buildBlogProductFactLabels(
  input: BlogProductFactLabelInput,
): string[] {
  const airline = cleanLabelPart(input.airline);
  const departureAirport = cleanLabelPart(input.departureAirport)?.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const duration = durationLabel(input.duration, input.nights);

  return [...new Set([
    airline ? `${airline} 항공` : null,
    departureAirport ? `${departureAirport} 출발` : null,
    duration,
  ].filter((value): value is string => Boolean(value)))].slice(0, 3);
}
