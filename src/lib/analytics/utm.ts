const VALUE_RE = /^[\p{L}\p{N} _./:+-]{1,200}$/u;

export interface MarketingLinkInput {
  destination: string;
  source: string;
  medium: string;
  campaign: string;
  term?: string;
  content?: string;
}

export function buildMarketingUrl(
  input: MarketingLinkInput,
  siteUrl = 'https://www.yeosonam.com',
): { url: string; isFirstParty: boolean } {
  const base = new URL(siteUrl);
  const destination = new URL(input.destination, base);
  if (!['http:', 'https:'].includes(destination.protocol)) {
    throw new Error('Marketing destination must use HTTP(S)');
  }
  const values = {
    utm_source: input.source,
    utm_medium: input.medium,
    utm_campaign: input.campaign,
    utm_term: input.term,
    utm_content: input.content,
  };
  for (const [key, rawValue] of Object.entries(values)) {
    if (!rawValue) continue;
    const value = rawValue.trim();
    if (!VALUE_RE.test(value)) throw new Error(`Invalid ${key}`);
    destination.searchParams.set(key, value);
  }
  return {
    url: destination.toString(),
    isFirstParty: destination.origin === base.origin,
  };
}
