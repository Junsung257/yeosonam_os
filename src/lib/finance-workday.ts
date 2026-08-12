import type { FinanceCenterSummary } from '@/lib/finance-center-service';
import type { FinanceBookingReviewRow } from '@/lib/finance-settlement-v3-service';

export type FinanceWorkdayTaskKind =
  | 'sync'
  | 'travel_review'
  | 'booking_risk'
  | 'booking_review'
  | 'company_classification'
  | 'month_close'
  | 'evidence';

export interface FinanceWorkdayTask {
  kind: FinanceWorkdayTaskKind;
  label: string;
  description: string;
  count: number;
  status: 'done' | 'ready' | 'blocked';
  href: string;
  actionLabel: string;
}

export interface FinanceWorkday {
  generatedAt: string;
  sync: FinanceCenterSummary['status'] & { healthy: boolean };
  metrics: Pick<FinanceCenterSummary['metrics'], 'actualBankBalance' | 'protectedTravelCash' | 'safeToWithdraw' | 'calculationStatus' | 'blockers'>;
  tasks: FinanceWorkdayTask[];
  nextTask: FinanceWorkdayTask | null;
  completedSteps: number;
  totalSteps: number;
  openItems: number;
}

function isSyncHealthy(summary: FinanceCenterSummary, now: Date): boolean {
  const lastSyncAt = summary.status.lastSyncAt ? new Date(summary.status.lastSyncAt).getTime() : Number.NaN;
  const ageHours = Number.isFinite(lastSyncAt) ? (now.getTime() - lastSyncAt) / 3_600_000 : Number.POSITIVE_INFINITY;
  return summary.status.connected
    && summary.status.lastSyncStatus === 'success'
    && summary.status.sourceCount === summary.status.recognizedCount
    && summary.status.difference === 0
    && ageHours <= 8;
}

function task(params: Omit<FinanceWorkdayTask, 'status'> & { blocked?: boolean }): FinanceWorkdayTask {
  return {
    ...params,
    status: params.count === 0 ? 'done' : params.blocked ? 'blocked' : 'ready',
  };
}

export function buildFinanceWorkday(params: {
  summary: FinanceCenterSummary;
  pendingBookings: FinanceBookingReviewRow[];
  missingReceiptCount: number;
  closeMonth: string;
  now?: Date;
}): FinanceWorkday {
  const now = params.now ?? new Date();
  const syncHealthy = isSyncHealthy(params.summary, now);
  const pending = params.pendingBookings.filter(row => row.reviewStatus === 'pending');
  const riskBookings = pending.filter(row => row.cashMargin < 0 || row.hasReviewDrift);
  const normalBookings = pending.filter(row => !riskBookings.some(risk => risk.id === row.id));
  const firstRisk = riskBookings[0];
  const firstNormal = normalBookings[0];
  const travelReviewCount = params.summary.actions.travelMemoOrAllocation + params.summary.actions.unmatchedTravel;
  const closeCount = params.summary.actions.monthCloseWaiting + params.summary.actions.postCloseChanges;

  const tasks: FinanceWorkdayTask[] = [
    task({
      kind: 'sync',
      label: '통장 동기화와 잔액 확인',
      description: params.summary.status.difference === 0
        ? 'Clobe 최신 거래와 OS 원장이 같은지 확인합니다.'
        : `통장과 OS 계산 잔액이 ${Math.abs(params.summary.status.difference).toLocaleString('ko-KR')}원 다릅니다.`,
      count: syncHealthy ? 0 : 1,
      href: '/admin/finance?tab=review&return=today',
      actionLabel: '동기화 확인',
    }),
    task({
      kind: 'travel_review',
      label: '여행 메모·배분 오류',
      description: 'Clobe 메모가 없거나 예약과 아직 연결되지 않은 거래를 먼저 처리합니다.',
      count: travelReviewCount,
      href: '/admin/finance?tab=review&return=today',
      actionLabel: '거래 검토 열기',
      blocked: !syncHealthy,
    }),
    task({
      kind: 'booking_risk',
      label: '출금 초과·변경 예약',
      description: '음수 마진, 취소·환불 또는 확인 뒤 거래가 바뀐 예약입니다.',
      count: riskBookings.length,
      href: firstRisk
        ? `/admin/finance?tab=bookings&status=pending&focus=${encodeURIComponent(firstRisk.id)}&return=today`
        : '/admin/finance?tab=bookings&status=pending&return=today',
      actionLabel: '위험 예약 확인',
      blocked: !syncHealthy || travelReviewCount > 0,
    }),
    task({
      kind: 'booking_review',
      label: '예약별 정산 확인',
      description: '입금·출금·Clobe 메모를 직접 보고 확인한 예약만 확정수익에 포함합니다.',
      count: normalBookings.length,
      href: firstNormal
        ? `/admin/finance?tab=bookings&status=pending&focus=${encodeURIComponent(firstNormal.id)}&return=today`
        : '/admin/finance?tab=bookings&status=pending&return=today',
      actionLabel: '다음 예약 확인',
      blocked: !syncHealthy || travelReviewCount > 0 || riskBookings.length > 0,
    }),
    task({
      kind: 'company_classification',
      label: '회사 거래 분류',
      description: '여행이 아닌 경비·세금·대표자 인출을 분류해 실제 운영손익을 정리합니다.',
      count: params.summary.actions.unclassifiedCompany,
      href: '/admin/finance?tab=expenses&return=today',
      actionLabel: '회사 거래 분류',
      blocked: !syncHealthy,
    }),
    task({
      kind: 'month_close',
      label: '출발 월 마감',
      description: `${params.closeMonth} 출발 예약의 검토가 끝나면 확정 스냅샷을 잠급니다.`,
      count: closeCount,
      href: `/admin/finance?tab=periods&month=${params.closeMonth}&return=today`,
      actionLabel: '월 마감 확인',
      blocked: pending.length > 0 || travelReviewCount > 0 || !syncHealthy,
    }),
    task({
      kind: 'evidence',
      label: '세금·증빙 보완',
      description: '정산 결과를 바꾸지 않고 누락된 증빙만 이어서 준비합니다.',
      count: params.missingReceiptCount,
      href: `/admin/finance?tab=tax&month=${params.closeMonth}&return=today`,
      actionLabel: '증빙 확인',
    }),
  ];
  const actionable = tasks.filter(item => item.status !== 'done');

  return {
    generatedAt: params.summary.generatedAt,
    sync: { ...params.summary.status, healthy: syncHealthy },
    metrics: {
      actualBankBalance: params.summary.metrics.actualBankBalance,
      protectedTravelCash: params.summary.metrics.protectedTravelCash,
      safeToWithdraw: params.summary.metrics.safeToWithdraw,
      calculationStatus: params.summary.metrics.calculationStatus,
      blockers: params.summary.metrics.blockers,
    },
    tasks,
    nextTask: actionable.find(item => item.status === 'ready') ?? actionable[0] ?? null,
    completedSteps: tasks.filter(item => item.status === 'done').length,
    totalSteps: tasks.length,
    openItems: tasks.reduce((sum, item) => sum + item.count, 0),
  };
}
