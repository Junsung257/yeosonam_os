export interface AutoAttractionInsertPolicyInput {
  nodeEnv?: string;
  allowAutoAttractionInsertEnv?: string;
}

export type AttractionCreateChannel = 'upload' | 'cron' | 'admin_manual';

/**
 * SSOT: docs/product-registration-v3-standard-language.md
 * - supplier 텍스트 기반 자동 신규 attraction INSERT 금지
 * - 예외는 테스트 환경에서만 명시 opt-in 허용
 */
export function shouldAllowAutoAttractionInsert(input: AutoAttractionInsertPolicyInput): boolean {
  return input.nodeEnv === 'test' && input.allowAutoAttractionInsertEnv === '1';
}

/**
 * attraction 신규 생성 허용 정책 SSOT
 * - admin_manual: 허용 (관리자 명시 액션)
 * - upload: 테스트 환경에서만 명시 opt-in 허용
 * - cron: 금지
 */
export function canCreateAttractionRecord(
  channel: AttractionCreateChannel,
  input: AutoAttractionInsertPolicyInput = {},
): boolean {
  if (channel === 'admin_manual') return true;
  if (channel === 'upload') return shouldAllowAutoAttractionInsert(input);
  return false;
}
