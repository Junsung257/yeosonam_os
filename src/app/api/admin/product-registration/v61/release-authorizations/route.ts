import type { NextRequest } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const postHandler = async (_request: NextRequest) => apiResponse(
  {
    success: false,
    code: 'PUBLICATION_REQUEST_WORKFLOW_REQUIRED',
    error: '직접 release authorization·pointer 공개는 종료되었습니다. exact revision 공개 심사 요청을 사용하세요.',
    next: '/admin/product-registration',
  },
  { status: 410, headers: { 'Cache-Control': 'private, no-store' } },
);

export const POST = withAdminGuard(postHandler);
