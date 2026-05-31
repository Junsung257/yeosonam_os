import { NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  fetchNaverAdgroupById,
  fetchNaverAdgroups,
  fetchNaverBusinessChannels,
  fetchNaverCampaigns,
  fetchNaverKeywordTool,
  getGoogleAdsConfigStatus,
  getNaverAdsConfigStatus,
} from '@/lib/search-ads-api';
import { resolveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';

export const dynamic = 'force-dynamic';

type AuditItem = {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  evidence: string;
  next_action: string;
};

function item(id: string, label: string, status: AuditItem['status'], evidence: string, nextAction: string): AuditItem {
  return { id, label, status, evidence, next_action: nextAction };
}

export const POST = withAdminGuard(async () => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const [
    budgetRes,
    keywordRes,
    campaignRes,
    naverKeywordSample,
    naverCampaigns,
    naverAdgroups,
    naverChannels,
  ] = await Promise.all([
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('platform,status,monthly_budget_krw,daily_budget_cap_krw,max_cpc_krw,external_ad_group_id')
      .in('platform', ['naver', 'google']),
    supabaseAdmin
      .from('search_ad_keyword_plans')
      .select('id,platform,plan_status,autopilot_status,tier,external_keyword_id,suggested_bid_krw')
      .in('platform', ['naver', 'google'])
      .limit(500),
    supabaseAdmin
      .from('ad_campaigns')
      .select('id,channel,status')
      .in('channel', ['naver', 'google'])
      .limit(100),
    fetchNaverKeywordTool(['여행']),
    fetchNaverCampaigns({ recordSize: 100 }),
    fetchNaverAdgroups({ recordSize: 100 }),
    fetchNaverBusinessChannels({ recordSize: 100 }),
  ]);

  const firstDbError = budgetRes.error || keywordRes.error || campaignRes.error;
  if (firstDbError) {
    return NextResponse.json({ ok: false, error: firstDbError.message }, { status: 500 });
  }

  const budgets = (budgetRes.data || []) as Array<{
    platform: string;
    status: string | null;
    monthly_budget_krw: number | null;
    daily_budget_cap_krw: number | null;
    max_cpc_krw: number | null;
    external_ad_group_id: string | null;
  }>;
  const keywords = (keywordRes.data || []) as Array<{
    platform: string;
    plan_status: string | null;
    autopilot_status: string | null;
    tier: string | null;
    external_keyword_id: string | null;
    suggested_bid_krw: number | null;
  }>;
  const campaigns = (campaignRes.data || []) as Array<{ channel: string | null; status: string | null }>;
  const naverBudget = budgets.find((row) => row.platform === 'naver');
  const googleBudget = budgets.find((row) => row.platform === 'google');
  const storedNaverAdgroupId = String(naverBudget?.external_ad_group_id || '').trim();
  const storedNaverAdgroup = storedNaverAdgroupId
    ? naverAdgroups.adgroups.find((row) => row.nccAdgroupId === storedNaverAdgroupId) || (await fetchNaverAdgroupById(storedNaverAdgroupId)).adgroup
    : null;
  const hasVerifiedNaverAdgroup = storedNaverAdgroupId
    ? Boolean(storedNaverAdgroup)
    : naverAdgroups.adgroups.length > 0;
  const naverBudgetReady = Boolean(naverBudget?.status === 'active' && Number(naverBudget.monthly_budget_krw || 0) > 0 && Number(naverBudget.daily_budget_cap_krw || 0) > 0);
  const googleBudgetReady = Boolean(googleBudget?.status === 'active' && Number(googleBudget.monthly_budget_krw || 0) > 0 && Number(googleBudget.daily_budget_cap_krw || 0) > 0);
  const naverApproved = keywords.filter((row) => row.platform === 'naver' && row.plan_status === 'approved' && ['approved', 'testing'].includes(row.autopilot_status || '') && row.tier !== 'negative');
  const googleApproved = keywords.filter((row) => row.platform === 'google' && row.plan_status === 'approved' && ['approved', 'testing'].includes(row.autopilot_status || '') && row.tier !== 'negative');
  const naverConfig = getNaverAdsConfigStatus();
  const googleConfig = getGoogleAdsConfigStatus();
  const googleToken = googleConfig.configured ? await resolveOAuthToken('', 'google_ads') : null;

  const items: AuditItem[] = [
    item(
      'naver-api',
      '네이버 검색광고 API',
      naverConfig.configured && naverKeywordSample.length > 0 ? 'pass' : naverConfig.configured ? 'warn' : 'fail',
      naverConfig.configured
        ? `KeywordTool ${naverKeywordSample.length.toLocaleString('ko-KR')}개 응답`
        : '네이버 검색광고 키 미설정',
      naverConfig.configured ? 'API 키는 있으므로 계정 자산과 예산을 확인합니다.' : 'NAVER_ADS_API_KEY/SECRET/CUSTOMER_ID를 설정합니다.',
    ),
    item(
      'naver-assets',
      '네이버 캠페인/비즈채널/광고그룹',
      hasVerifiedNaverAdgroup ? 'pass' : naverCampaigns.campaigns.length > 0 || naverChannels.channels.length > 0 || storedNaverAdgroupId ? 'warn' : 'fail',
      `캠페인 ${naverCampaigns.campaigns.length}개, 비즈채널 ${naverChannels.channels.length}개, 광고그룹 ${naverAdgroups.adgroups.length}개, 저장 그룹 ${storedNaverAdgroupId || '없음'}, 검증 ${storedNaverAdgroup ? '성공' : storedNaverAdgroupId ? '실패' : '대기'}`,
      storedNaverAdgroup
        ? '저장된 외부 그룹 ID가 네이버 API에서 검증됐습니다. 네이버 정지 키워드 점검을 실행합니다.'
        : storedNaverAdgroupId
          ? '저장된 외부 그룹 ID가 네이버 API에서 확인되지 않습니다. nccAdgroupId를 다시 확인하거나 광고그룹 조회를 실행합니다.'
        : naverAdgroups.adgroups.length > 0
          ? '네이버 광고그룹 조회 결과에서 사용할 그룹 ID를 예산 테이블의 외부 그룹 ID에 저장합니다.'
          : '네이버 광고센터에서 검색광고 캠페인/비즈채널/광고그룹을 먼저 만들거나, 이미 쓰는 nccAdgroupId를 외부 그룹 ID에 저장합니다.',
    ),
    item(
      'naver-budget',
      '네이버 예산 캡',
      naverBudgetReady ? 'pass' : 'fail',
      `상태 ${naverBudget?.status || '없음'}, 월 ${Number(naverBudget?.monthly_budget_krw || 0).toLocaleString('ko-KR')}원, 일 ${Number(naverBudget?.daily_budget_cap_krw || 0).toLocaleString('ko-KR')}원`,
      naverBudgetReady ? '예산 캡은 준비됐습니다. 외부 광고그룹 ID가 검증되면 정지 키워드 업로드를 점검합니다.' : '네이버 예산을 active로 바꾸기 전에는 외부 업로드/집행을 보류합니다.',
    ),
    item(
      'naver-approved-keywords',
      '네이버 승인 키워드',
      naverApproved.length > 0 ? 'pass' : 'fail',
      `승인 후보 ${naverApproved.length.toLocaleString('ko-KR')}개`,
      '네이버 후보를 승인하면 정지 키워드 업로드 대상이 됩니다.',
    ),
    item(
      'google-api',
      'Google Ads 권한',
      googleConfig.configured && googleToken?.accessToken ? 'warn' : googleConfig.configured ? 'warn' : 'fail',
      googleConfig.configured ? `키 있음, OAuth ${googleToken?.accessToken ? '있음' : '없음'}` : 'Google Ads 키 미설정',
      googleToken?.accessToken
        ? '현재 별도 probe에서 PERMISSION_DENIED가 확인됐으므로 customer 권한/scope를 점검합니다.'
        : 'Google Ads OAuth 연결을 먼저 완료합니다.',
    ),
    item(
      'google-budget',
      'Google 예산 캡',
      googleBudgetReady ? 'pass' : 'fail',
      `상태 ${googleBudget?.status || '없음'}, 월 ${Number(googleBudget?.monthly_budget_krw || 0).toLocaleString('ko-KR')}원, 일 ${Number(googleBudget?.daily_budget_cap_krw || 0).toLocaleString('ko-KR')}원`,
      googleBudgetReady ? '예산 캡은 준비됐지만 Google Ads 권한 경고가 남아 실제 외부 집행은 보류합니다.' : 'Google 권한 문제가 풀리기 전에는 예산을 켜도 실제 집행은 보류합니다.',
    ),
    item(
      'google-approved-keywords',
      'Google 승인 키워드',
      googleApproved.length > 0 ? 'pass' : 'warn',
      `승인 후보 ${googleApproved.length.toLocaleString('ko-KR')}개`,
      'Google 권한이 풀리면 캠페인 드래프트 생성 대상이 됩니다.',
    ),
    item(
      'internal-drafts',
      '내부 캠페인 드래프트',
      campaigns.some((row) => row.status === 'DRAFT') ? 'pass' : 'warn',
      `드래프트 ${campaigns.filter((row) => row.status === 'DRAFT').length.toLocaleString('ko-KR')}개, 활성 ${campaigns.filter((row) => row.status === 'ACTIVE').length.toLocaleString('ko-KR')}개`,
      '승인 후보와 예산이 준비되면 캠페인 드래프트를 생성합니다.',
    ),
  ];

  const pass = items.filter((row) => row.status === 'pass').length;
  const fail = items.filter((row) => row.status === 'fail').length;
  const warn = items.filter((row) => row.status === 'warn').length;
  const nextAction = items.find((row) => row.status === 'fail')?.next_action || items.find((row) => row.status === 'warn')?.next_action || 'L2 시범 집행 준비가 완료됐습니다.';

  return NextResponse.json({
    ok: true,
    readiness: {
      pass,
      warn,
      fail,
      total: items.length,
      today_launch_ready: fail === 0,
      next_action: nextAction,
    },
    items,
  });
});
