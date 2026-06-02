import { type NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { getMarketingAssetGroups } from '@/lib/marketing/asset-groups';
import { attachLedgerToActions, syncMarketingRecommendations } from '@/lib/marketing/recommendation-ledger';

export const dynamic = 'force-dynamic';

async function getHandler(request: NextRequest) {
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 30), 1), 100);
  try {
    const data = await getMarketingAssetGroups(limit);
    const ledger = await syncMarketingRecommendations(data.groups, data.actions);
    const actions = attachLedgerToActions(data.actions, ledger);
    const groups = data.groups.map((group) => ({
      ...group,
      next_actions: attachLedgerToActions(group.next_actions, ledger),
    }));
    return NextResponse.json({
      ok: true,
      checked_at: new Date().toISOString(),
      access_state: 'ready',
      groups,
      actions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown asset group error';
    const accessState = /401|permission|unauthorized|auth/i.test(message) ? 'permission_denied' : 'data_unavailable';
    return NextResponse.json({
      ok: false,
      checked_at: new Date().toISOString(),
      access_state: accessState,
      error: accessState === 'permission_denied'
        ? '권한 없음: 관리자 세션 또는 서버 권한으로 자산 그룹을 조회할 수 없습니다.'
        : message,
      groups: [],
      actions: [],
      next_action: accessState === 'permission_denied'
        ? '다시 로그인하거나 관리자 API 권한/서비스 키 설정을 확인하세요.'
        : '상품, 블로그, 캠페인 데이터 연결 상태를 확인하세요.',
    }, { status: 200 });
  }
}

export const GET = withAdminGuard(getHandler);
