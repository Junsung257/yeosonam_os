import { withAdminGuard } from '@/lib/admin-guard';
import { submitReviewReceipt } from '@/lib/product-registration-v6/human-review-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Adjudication uses the same Receipt contract. The database derives the
 * adjudicator slot from the case state and requires a third distinct account.
 */
export const POST = withAdminGuard((request, context) => submitReviewReceipt(request, context, 'adjudicator'));
