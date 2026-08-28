import type { GroupRfq } from '@/lib/db/rfq';
import { redactKoreanPII } from '@/lib/pii-redactor';

const PRIVATE_FIELDS = [
  'share_token',
  'customer_name',
  'customer_phone',
  'customer_id',
  'ai_interview_log',
  'custom_requirements',
] as const;

const LOCKED_FIELDS = [
  'budget_per_person',
  'total_budget',
  'special_requests',
] as const;

export const TENANT_PORTAL_VISIBLE_RFQ_STATUSES = new Set([
  'published',
  'bidding',
  'analyzing',
  'awaiting_selection',
  'contracted',
  'completed',
]);

type TenantPortalRfq = Omit<GroupRfq, (typeof PRIVATE_FIELDS)[number]> & {
  customer_name: string;
};

export function sanitizeTenantPortalRfq(
  rfq: GroupRfq,
  isUnlocked = true,
): TenantPortalRfq {
  const safe = { ...rfq } as Record<string, unknown>;
  for (const field of PRIVATE_FIELDS) delete safe[field];
  if (!isUnlocked) {
    for (const field of LOCKED_FIELDS) delete safe[field];
  } else if (typeof safe.special_requests === 'string') {
    const redacted = redactKoreanPII(safe.special_requests).redacted.trim();
    safe.special_requests = redacted || undefined;
  }
  safe.customer_name = '고객 (익명)';
  return safe as TenantPortalRfq;
}
