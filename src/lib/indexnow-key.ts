/**
 * Naver Search Advisor accepts an IndexNow key made from hexadecimal
 * characters and hyphens, with a total length of 8-128 characters.
 * Keep the shared key compatible with Naver because the same payload is also
 * sent to the global IndexNow endpoint.
 */
export const NAVER_INDEXNOW_KEY_PATTERN = /^[0-9a-fA-F-]{8,128}$/;

export function isValidNaverIndexNowKey(value: string | null | undefined): boolean {
  return NAVER_INDEXNOW_KEY_PATTERN.test(value?.trim() ?? '');
}
