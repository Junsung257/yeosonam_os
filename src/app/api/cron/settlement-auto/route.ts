import { apiResponse } from '@/lib/api-response';
import { withCronGuard } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

const getHandler = async () => apiResponse({
  paused: true,
  code: 'DIRECT_SETTLEMENT_DISABLED',
  message: '자동 정산 완료는 비활성화되었습니다. 원장 V2의 작성·승인·지급 절차를 사용하세요.',
}, { status: 423 });

export const GET = withCronGuard(getHandler);
