import type { NextRequest } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { submitReviewReceipt } from '@/lib/product-registration-v6/human-review-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ caseId: string }> | { caseId: string } };

export const POST = withAdminGuard((request: NextRequest, context?: Context) => submitReviewReceipt(request, context, undefined));
