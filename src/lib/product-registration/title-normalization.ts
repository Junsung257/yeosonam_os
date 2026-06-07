const NON_PRODUCT_TITLE_RE = /(현금영수증|취소\s*규정|취소수수료|발급\s*안내|주의사항|포함사항|불포함사항)/;
const GARBLED_PLACEHOLDER_TITLE_RE = /^\?{2,}(?:\s+\?{2,})*$/;

export function shouldReplaceUploadTitle(currentTitle?: string | null, deterministicTitle?: string | null): boolean {
  const current = currentTitle?.trim() ?? '';
  const deterministic = deterministicTitle?.trim() ?? '';
  if (!deterministic || deterministic.length < 5) return false;
  if (!current || current === '텍스트입력') return true;
  if (GARBLED_PLACEHOLDER_TITLE_RE.test(current)) return true;
  if (NON_PRODUCT_TITLE_RE.test(current)) return true;
  return false;
}

export function normalizeUploadTitle(currentTitle?: string | null, deterministicTitle?: string | null): string | null {
  return shouldReplaceUploadTitle(currentTitle, deterministicTitle)
    ? deterministicTitle?.trim() ?? null
    : currentTitle ?? null;
}
