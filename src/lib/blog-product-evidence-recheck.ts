export type BlogProductEvidenceRecheckDecision =
  | {
      action: 'requeue';
      last_error: null;
      meta: Record<string, unknown>;
    }
  | {
      action: 'keep_blocked';
      last_error: string;
      meta: Record<string, unknown>;
    };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function productOpenContractFailure(blockers: string[]): string {
  const summary = blockers.slice(0, 5).join('|') || 'unknown_product_open_contract_blocker';
  return `product_customer_open_contract_failed:${summary}`;
}

function withoutProductOpenContractBlock(meta: Record<string, unknown>, checkedAt: string): Record<string, unknown> {
  const next = { ...meta };
  delete next.failure_code;
  delete next.quarantine_reason;
  delete next.self_heal_blocked;
  delete next.product_open_contract_blockers;
  return {
    ...next,
    product_open_contract_rechecked_at: checkedAt,
    product_open_contract_recheck_result: 'pass',
    requeued_by: 'blog-product-evidence-recheck',
    requeued_at: checkedAt,
  };
}

export function buildBlogProductEvidenceRecheckDecision(input: {
  meta?: unknown;
  contractOk: boolean;
  blockers?: string[];
  checkedAt?: string;
}): BlogProductEvidenceRecheckDecision {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const meta = asRecord(input.meta);
  if (input.contractOk) {
    return {
      action: 'requeue',
      last_error: null,
      meta: withoutProductOpenContractBlock(meta, checkedAt),
    };
  }

  const blockers = (input.blockers ?? []).map(value => String(value).trim()).filter(Boolean);
  return {
    action: 'keep_blocked',
    last_error: productOpenContractFailure(blockers),
    meta: {
      ...meta,
      failure_code: 'product_open_contract',
      quarantine_reason: 'product_open_contract',
      self_heal_blocked: true,
      product_open_contract_blockers: blockers,
      product_open_contract_rechecked_at: checkedAt,
      product_open_contract_recheck_result: 'blocked',
    },
  };
}
