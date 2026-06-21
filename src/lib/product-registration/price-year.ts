const YEAR_RE = /\b(20\d{2})\b/g;

const POSITIVE_PRICE_YEAR_CONTEXT =
  /(PKG|상품|상품가|판매가|정규요금|요금표|출\s*발|출발일|일정|여행|배포|적용|기간|\d{1,2}\s*[월./-])/;

const NEGATIVE_NOTICE_YEAR_CONTEXT =
  /(취소|환불|수수료|규정|약관|전자담배|현금영수증|입국|여권|비자|공지|주의사항|notice|cancel|cancellation|refund|policy|e-?cigarette|passport|visa)/i;

export function inferSourceBackedPriceYear(rawText: string | null | undefined): number | null {
  if (!rawText) return null;
  const candidates: Array<{ year: number; score: number; index: number }> = [];
  for (const match of rawText.matchAll(YEAR_RE)) {
    const year = Number(match[1]);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) continue;
    const index = match.index ?? 0;
    const context = rawText.slice(Math.max(0, index - 80), Math.min(rawText.length, index + 80));
    let score = 0;
    if (POSITIVE_PRICE_YEAR_CONTEXT.test(context)) score += 3;
    if (NEGATIVE_NOTICE_YEAR_CONTEXT.test(context)) score -= 4;
    candidates.push({ year, score, index });
  }

  const positive = candidates
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.year - left.year || left.index - right.index);
  if (positive[0]) return positive[0].year;

  return null;
}

export function resolvePriceRecoveryYear(input: {
  explicitYear?: number | null;
  rawText?: string | null;
  documentRawText?: string | null;
}): number | undefined {
  if (typeof input.explicitYear === 'number' && Number.isInteger(input.explicitYear) && input.explicitYear >= 2000) {
    return input.explicitYear;
  }
  return (
    inferSourceBackedPriceYear(input.rawText)
    ?? inferSourceBackedPriceYear(input.documentRawText)
    ?? undefined
  );
}
