function normalizeKeywordSeparators(value: string): string {
  return value
    .replace(/[\/|,+·・]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortDestinationKeyword(destination?: string | null): string | null {
  const normalized = normalizeKeywordSeparators(destination ?? '');
  return normalized.length >= 2 ? normalized : null;
}

function usableKeyword(value?: string | null): string | null {
  const normalized = normalizeKeywordSeparators(value ?? '');
  if (normalized.length < 2) return null;
  if (normalized.length > 42) return null;
  return normalized;
}

export function choosePublisherPrimaryKeyword(input: {
  source?: string | null;
  productId?: string | null;
  destination?: string | null;
  itemPrimaryKeyword?: string | null;
  generatedPrimaryKeyword?: string | null;
  topic?: string | null;
}): string | null {
  if (input.source === 'pillar') return null;

  const destination = shortDestinationKeyword(input.destination);

  if (input.productId) {
    return usableKeyword(input.generatedPrimaryKeyword)
      ?? (destination ? `${destination} 패키지` : null)
      ?? usableKeyword(input.itemPrimaryKeyword)
      ?? usableKeyword(input.topic);
  }

  return usableKeyword(input.generatedPrimaryKeyword)
    ?? usableKeyword(input.itemPrimaryKeyword)
    ?? destination
    ?? usableKeyword(input.topic);
}
