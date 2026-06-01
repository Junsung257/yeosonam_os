import type { StandardNoticeDraft } from './standard-notices';

export type StandardNoticeReviewSaveRow = StandardNoticeDraft & {
  values_valid?: boolean;
};

export type StandardNoticeCustomerSavePayload = {
  packageId: string;
  notices_parsed: Array<{
    type: 'CRITICAL' | 'POLICY' | 'INFO';
    title: string;
    text: string;
    category: StandardNoticeDraft['category'];
    values: StandardNoticeDraft['values'];
    template_key: string;
    review_status: StandardNoticeDraft['review_status'];
    source_line: number | null;
  }>;
  customer_notes: string;
  saved_count: number;
  skipped_count: number;
};

export function buildStandardNoticeCustomerSavePayload(
  packageId: string,
  rows: StandardNoticeReviewSaveRow[],
): { ok: true; payload: StandardNoticeCustomerSavePayload } | { ok: false; error: string } {
  const invalid = rows.find(row => row.values_valid === false);
  if (invalid) {
    return { ok: false, error: `추출값 JSON을 확인하세요: ${invalid.category}` };
  }

  const publishableRows = rows.filter(row =>
    row.visibility === 'customer_visible' &&
    (row.review_status === 'auto_clean' || row.review_status === 'manual_approved')
  );

  const notices_parsed = publishableRows.map(row => ({
    type: row.risk_level === 'high' ? 'CRITICAL' as const : row.risk_level === 'medium' ? 'POLICY' as const : 'INFO' as const,
    title: '유의사항',
    text: `• ${row.standard_text}`,
    category: row.category,
    values: row.values,
    template_key: row.template_key,
    review_status: row.review_status,
    source_line: row.evidence[0]?.line_start ?? null,
  }));

  return {
    ok: true,
    payload: {
      packageId,
      notices_parsed,
      customer_notes: publishableRows.map(row => row.standard_text).join('\n'),
      saved_count: publishableRows.length,
      skipped_count: rows.length - publishableRows.length,
    },
  };
}
