export type BlogProviderFailureCode =
  | 'provider_insufficient_balance'
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'provider_invalid_request'
  | 'provider_unknown_failure';

export function isRetryableBlogProviderFailure(code: BlogProviderFailureCode): boolean {
  return code === 'provider_rate_limited' || code === 'provider_unavailable';
}

/**
 * Convert provider-facing error text into a stable operational code.
 *
 * Provider messages are not a durable contract: DeepSeek has returned both
 * HTTP-like prefixes ("402 Insufficient Balance") and prose-only variants.
 * Keep the raw message in evidence, but use this code for dashboards,
 * retry/quarantine decisions, and runbook routing.
 */
export function classifyBlogProviderFailure(reason: unknown): BlogProviderFailureCode {
  const message = String(reason ?? '').trim().toLowerCase();

  if (/\b402\b|insufficient\s+(?:balance|funds|credit)|out\s+of\s+(?:balance|credits?)/i.test(message)) {
    return 'provider_insufficient_balance';
  }
  if (/\b429\b|rate[ -]?limit|too many requests|quota exceeded/i.test(message)) {
    return 'provider_rate_limited';
  }
  if (/\b5\d\d\b|timeout|temporar|unavailable|connection|network|econn|fetch failed/i.test(message)) {
    return 'provider_unavailable';
  }
  if (/\b4\d\d\b|invalid request|bad request|unauthorized|forbidden|invalid api key/i.test(message)) {
    return 'provider_invalid_request';
  }
  return 'provider_unknown_failure';
}
