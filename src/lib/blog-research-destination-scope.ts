function normalizeDestinationScope(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s._·ㆍ•/\\-]+/g, '');
}

export function matchesBlogResearchDestinationScope(input: {
  destination: string;
  scopes?: unknown;
}): boolean {
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) return true;
  const destination = normalizeDestinationScope(input.destination);
  if (!destination) return false;
  return input.scopes.some((scope) =>
    typeof scope === 'string'
    && normalizeDestinationScope(scope) === destination);
}
