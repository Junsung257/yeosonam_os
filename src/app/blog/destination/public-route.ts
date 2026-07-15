const INVALID_DESTINATION_ROUTE_TOKENS = new Set([
  'top',
  'best',
  'popular',
  'all',
  '대학생',
  '가족',
  '커플',
  '신혼부부',
  '시니어',
  '혼자',
  '친구',
  '여행자',
]);

function safeDecodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isObviouslyInvalidDestinationRoute(value: string): boolean {
  const decoded = safeDecodePathSegment(value).trim();
  if (!decoded) return true;
  if (/[/\\?#]/.test(decoded)) return true;
  if (/^\d+(?:[-_.]\d+)*$/.test(decoded)) return true;
  if (INVALID_DESTINATION_ROUTE_TOKENS.has(decoded.toLowerCase())) return true;
  // 과거 목적지·여행자 토큰이 구분자 없이 이어 붙은 영문 경로를 차단한다.
  if (/^[a-z]+$/i.test(decoded) && decoded.length > 24) return true;
  return false;
}
