const NON_PRODUCT_TITLE_RE = /(현금영수증|취소\s*규정|취소수수료|발급\s*안내|주의사항|포함사항|불포함사항)/;
const GARBLED_PLACEHOLDER_TITLE_RE = /^\?{2,}(?:\s+\?{2,})*$/;
const SOURCE_LABEL_MARKER_RE = /(?:^[[({]\d{3,4}[\])}]|_\d{4,8}$|[-_]\d{4}\s*(?:hwp|txt)?$|\d{1,2}\s*[~-]\s*\d{1,2}\s*\uC6D4|\uBC1C\uAD8C|\.hwp$|\.txt$)/i;
const KOREAN_DURATION_RE = /[1-9]\d*\s*\uBC15\s*[1-9]\d*\s*\uC77C/u;

function looksLikeUploadSourceLabel(value: string): boolean {
  return SOURCE_LABEL_MARKER_RE.test(value.trim());
}

function deterministicTitleLooksBetter(current: string, deterministic: string): boolean {
  const sourceLabel = looksLikeUploadSourceLabel(current);
  if (KOREAN_DURATION_RE.test(deterministic) && !KOREAN_DURATION_RE.test(current) && sourceLabel) return true;
  if (deterministic.length < Math.max(10, current.length + 4)) return false;
  return sourceLabel;
}

export function shouldReplaceUploadTitle(currentTitle?: string | null, deterministicTitle?: string | null): boolean {
  const current = currentTitle?.trim() ?? '';
  const deterministic = deterministicTitle?.trim() ?? '';
  if (!deterministic || deterministic.length < 5) return false;
  if (!current || current === '텍스트입력') return true;
  if (GARBLED_PLACEHOLDER_TITLE_RE.test(current)) return true;
  if (NON_PRODUCT_TITLE_RE.test(current)) return true;
  if (deterministicTitleLooksBetter(current, deterministic)) return true;
  return false;
}

export function normalizeUploadTitle(currentTitle?: string | null, deterministicTitle?: string | null): string | null {
  return shouldReplaceUploadTitle(currentTitle, deterministicTitle)
    ? deterministicTitle?.trim() ?? null
    : currentTitle ?? null;
}
