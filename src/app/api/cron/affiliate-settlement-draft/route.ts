import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withCronGuard } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

const getHandler = async (_request: NextRequest) => apiResponse({
  paused: true,
  code: 'LEGACY_SETTLEMENT_DRAFT_PAUSED',
  message: '원장 V2 정책 승인과 백필 검증 전에는 자동 정산 기안을 생성하지 않습니다.',
  canonical_contract: 'commission_ledger_entries -> settlement_runs -> settlement_lines',
}, { status: 423 });

export const GET = withCronGuard(getHandler);
