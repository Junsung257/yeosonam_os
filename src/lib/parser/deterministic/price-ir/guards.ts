const OPTIONAL_PRICE_CONTEXT_RE = /선택\s*관광|추천\s*관광|입장권|티켓|옵션/i;

export function isOptionalTourPriceContext(rawText: string): boolean {
  return OPTIONAL_PRICE_CONTEXT_RE.test(rawText);
}
