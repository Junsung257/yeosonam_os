export interface AutoAttractionInsertPolicyInput {
  nodeEnv?: string;
  allowAutoAttractionInsertEnv?: string;
}

export type AttractionCreateChannel = 'upload' | 'cron' | 'admin_manual';

/**
 * SSOT: docs/product-registration-v3-standard-language.md
 * - supplier 텍스트 기반 자동 신규 attraction INSERT 금지
 * - 테스트 환경 opt-in도 허용하지 않는다. 등록 파이프라인은 unmatched 큐까지만 처리한다.
 */
export function shouldAllowAutoAttractionInsert(input: AutoAttractionInsertPolicyInput): boolean {
  void input;
  return false;
}

/**
 * attraction 신규 생성 허용 정책 SSOT
 * - admin_manual: 허용 (관리자 명시 액션)
 * - upload: 항상 금지
 * - cron: 금지
 */
export function canCreateAttractionRecord(
  channel: AttractionCreateChannel,
  input: AutoAttractionInsertPolicyInput = {},
): boolean {
  void input;
  if (channel === 'admin_manual') return true;
  return false;
}
