const INVALID_DESTINATION_ROUTE_TOKENS = new Set([
  'top', 'best', 'popular', 'all', 'undefined', 'null', 'unknown', '0',
  '대학생', '가족', '커플', '신혼부부', '시니어', '혼자', '친구', '여행자',
]);

function safeDecodePathSegment(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function isObviouslyInvalidDestinationRoute(value: string): boolean {
  const decoded = safeDecodePathSegment(value).normalize('NFKC').trim();
  if (!decoded) return true;
  if (/[/\\?#]/.test(decoded)) return true;
  if (/^\d+(?:[-_.]\d+)*$/.test(decoded)) return true;
  if (INVALID_DESTINATION_ROUTE_TOKENS.has(decoded.toLowerCase())) return true;
  if (/^[a-z]+$/i.test(decoded) && decoded.length > 24) return true;
  return false;
}
