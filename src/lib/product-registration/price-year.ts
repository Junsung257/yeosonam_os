const YEAR_RE = /\b(20\d{2})\b/g;

const POSITIVE_PRICE_YEAR_CONTEXT =
  /(PKG|상품|상품가|판매가|정규요금|요금표|출\s*발|출발일|일정|여행|배포|적용|기간|\d{1,2}\s*[월./-])/;

const NEGATIVE_NOTICE_YEAR_CONTEXT =
  /(취소|환불|수수료|규정|약관|전자담배|현금영수증|입국|여권|비자|공지|주의사항|notice|cancel|cancellation|refund|policy|e-?cigarette|passport|visa)/i;

const KOREAN_POSITIVE_PRICE_YEAR_CONTEXT =
  /(?:\uC0C1\uD488|\uD328\uD0A4\uC9C0|\uC815\uADDC\s*\uC694\uAE08|\uC815\uADDC\uC694\uAE08|\uC694\uAE08\uD45C|\uC694\uAE08|\uD310\uB9E4\uAC00|\uCD9C\uBC1C|\uCD9C\uBC1C\uC77C|\uAE30\uAC04|\uD2B9\uAC00|PKG|\d{1,2}\s*[./-]\s*\d{1,2})/iu;

const KOREAN_NEGATIVE_NOTICE_YEAR_CONTEXT =
  /(?:\uCDE8\uC18C|\uD658\uBD88|\uC218\uC218\uB8CC|\uC5EC\uAD8C|\uBE44\uC790|\uACF5\uC9C0|\uC8FC\uC758|\uC8FC\uC758\uC0AC\uD56D|\uC804\uC790\uB2F4\uBC30|\uC785\uAD6D|\uC368\uCC28\uC9C0|\uAC08\uB77C\uB514\uB108|notice|cancel|refund|policy|passport|visa)/iu;

function normalizeShortYear(value: string): number | null {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 0 || year > 99) return null;
  return 2000 + year;
}

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
    if (KOREAN_POSITIVE_PRICE_YEAR_CONTEXT.test(context)) score += 3;
    if (NEGATIVE_NOTICE_YEAR_CONTEXT.test(context)) score -= 4;
    if (KOREAN_NEGATIVE_NOTICE_YEAR_CONTEXT.test(context)) score -= 4;
    candidates.push({ year, score, index });
  }

  const shortYearRe = /(?:^|[^\d])(\d{2})\s*\uB144\s*\d{1,2}\s*\uC6D4|(?:^|[^\d])(\d{2})[./](\d{1,2})[./](\d{1,2})/g;
  for (const match of rawText.matchAll(shortYearRe)) {
    const year = normalizeShortYear(match[1] ?? match[2] ?? '');
    if (!year) continue;
    const index = match.index ?? 0;
    const context = rawText.slice(Math.max(0, index - 100), Math.min(rawText.length, index + 100));
    let score = 0;
    if (POSITIVE_PRICE_YEAR_CONTEXT.test(context)) score += 2;
    if (KOREAN_POSITIVE_PRICE_YEAR_CONTEXT.test(context)) score += 4;
    if (NEGATIVE_NOTICE_YEAR_CONTEXT.test(context)) score -= 4;
    if (KOREAN_NEGATIVE_NOTICE_YEAR_CONTEXT.test(context)) score -= 4;
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
