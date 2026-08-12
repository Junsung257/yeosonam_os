import type { FinanceCenterSummary } from '@/lib/finance-center-service';
import type { FinanceBookingReviewRow } from '@/lib/finance-settlement-v3-service';
import { parseTravelSettlementMemo } from '@/lib/settlement-import/bank-statement-parser';

export interface FinanceTravelActionScopeRow {
  id: string;
  receivedAt: string;
  memo: string | null;
  bookingDepartureDates: string[];
}

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
  blocker: string | null;
}

export interface FinanceWorkday {
  generatedAt: string;
  sync: FinanceCenterSummary['status'] & {
    healthy: boolean;
    nextScheduledSyncAt: string;
    missedScheduledWindows: number;
  };
  closeMonth: string;
  scope: {
    pendingBookingCount: number;
    futurePendingBookingCount: number;
    priorPendingBookingCount: number;
    undatedPendingBookingCount: number;
    travelReviewTransactionIds: string[];
    otherMonthTravelReviewCount: number;
  };
  metrics: Pick<FinanceCenterSummary['metrics'],
    | 'actualBankBalance'
    | 'protectedTravelCash'
    | 'protectedCustomerFunds'
    | 'unpaidSupplierCost'
    | 'estimatedTaxReserve'
    | 'companyOperatingResult'
    | 'confirmedTravelProfit'
    | 'provisionalUnconfirmedTravelMargin'
    | 'afterTaxConfirmedProfit'
    | 'safeToWithdraw'
    | 'calculationStatus'
    | 'blockers'
  >;
  tasks: FinanceWorkdayTask[];
  nextTask: FinanceWorkdayTask | null;
  completedSteps: number;
  totalSteps: number;
  openItems: number;
  stageItemTotal: number;
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

function task(params: Omit<FinanceWorkdayTask, 'status' | 'blocker'> & { blocked?: boolean; blocker?: string | null }): FinanceWorkdayTask {
  const { blocked = false, blocker, ...fields } = params;
  return {
    ...fields,
    status: params.count === 0 ? 'done' : blocked ? 'blocked' : 'ready',
    blocker: blocked ? blocker ?? '앞 단계 완료가 필요합니다.' : null,
  };
}

const KST_SYNC_HOURS = [0, 4, 8, 12, 16, 20];

export function nextClobeScheduledSyncAt(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60_000);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth();
  const date = kst.getUTCDate();
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    for (const hour of KST_SYNC_HOURS) {
      const candidate = new Date(Date.UTC(year, month, date + dayOffset, hour - 9, 12));
      if (candidate.getTime() > now.getTime()) return candidate.toISOString();
    }
  }
  return new Date(now.getTime() + 4 * 60 * 60_000).toISOString();
}

function syntheticKeys(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}:${index}`);
}

/**
 * Manual booking allocations are authoritative, followed by a valid Clobe
 * travel memo. An unresolved row falls back to its bank transaction month so
 * it remains visible without blocking unrelated departure months.
 */
export function scopeTravelActionTransactionIds(
  rows: FinanceTravelActionScopeRow[],
  closeMonth: string,
): string[] {
  return rows.flatMap(row => {
    const bookingMonths = [...new Set(row.bookingDepartureDates
      .filter(Boolean)
      .map(value => value.slice(0, 7)))];
    if (bookingMonths.length > 0) return bookingMonths.includes(closeMonth) ? [row.id] : [];

    const memoMonth = parseTravelSettlementMemo(row.memo)?.departureDate.slice(0, 7);
    if (memoMonth) return memoMonth === closeMonth ? [row.id] : [];

    return row.receivedAt.slice(0, 7) === closeMonth ? [row.id] : [];
  });
}

export function buildFinanceWorkday(params: {
  summary: FinanceCenterSummary;
  pendingBookings: FinanceBookingReviewRow[];
  missingReceiptCount: number;
  closeMonth: string;
  closeMonthClosed?: boolean;
  closeMonthPostCloseExceptionIds?: string[];
  closeMonthTravelTransactionIds?: string[];
  otherMonthTravelReviewCount?: number;
  now?: Date;
}): FinanceWorkday {
  const now = params.now ?? new Date();
  const syncHealthy = isSyncHealthy(params.summary, now);
  const pending = params.pendingBookings.filter(row => row.reviewStatus === 'pending');
  const monthPending = pending.filter(row => row.departureDate?.slice(0, 7) === params.closeMonth);
  const futurePending = pending.filter(row => row.departureDate && row.departureDate.slice(0, 7) > params.closeMonth);
  const priorPending = pending.filter(row => row.departureDate && row.departureDate.slice(0, 7) < params.closeMonth);
  const undatedPending = pending.filter(row => !row.departureDate);
  const riskBookings = monthPending.filter(row => row.cashMargin < 0 || row.hasReviewDrift);
  const riskBookingIds = new Set(riskBookings.map(row => row.id));
  const normalBookings = monthPending.filter(row => !riskBookingIds.has(row.id));
  const firstRisk = riskBookings[0];
  const firstNormal = normalBookings[0];
  const travelTransactionIds = params.closeMonthTravelTransactionIds
    ?? params.summary.actionRefs?.travelTransactionIds
    ?? syntheticKeys('travel', params.summary.actions.travelMemoOrAllocation);
  const travelReviewCount = travelTransactionIds.length;
  const closeMonthPostCloseExceptionIds = params.closeMonthPostCloseExceptionIds ?? [];
  const closeCount = params.closeMonthClosed && closeMonthPostCloseExceptionIds.length === 0
    ? 0
    : Math.max(1, closeMonthPostCloseExceptionIds.length);
  const lastSyncAt = params.summary.status.lastSyncAt ? new Date(params.summary.status.lastSyncAt).getTime() : Number.NaN;
  const syncAgeHours = Number.isFinite(lastSyncAt) ? Math.max(0, (now.getTime() - lastSyncAt) / 3_600_000) : Number.POSITIVE_INFINITY;
  const uniqueItemKeys = new Set<string>();
  const register = (keys: string[]) => {
    keys.forEach(key => uniqueItemKeys.add(key));
    return keys.length;
  };

  const tasks: FinanceWorkdayTask[] = [
    task({
      kind: 'sync',
      label: '통장 동기화와 잔액 확인',
      description: params.summary.status.difference === 0
        ? 'Clobe 최신 거래와 OS 원장이 같은지 확인합니다.'
        : `통장과 OS 계산 잔액이 ${Math.abs(params.summary.status.difference).toLocaleString('ko-KR')}원 다릅니다.`,
      count: register(syncHealthy ? [] : ['sync:clobe']),
      href: `/admin/finance?tab=review&mode=workday&queue=review&month=${params.closeMonth}&return=today`,
      actionLabel: '동기화 확인',
    }),
    task({
      kind: 'travel_review',
      label: '여행 메모·배분 오류',
      description: 'Clobe 메모가 없거나 예약과 아직 연결되지 않은 거래를 먼저 처리합니다.',
      count: register(travelTransactionIds.map(id => `transaction:${id}`)),
      href: `/admin/finance?tab=review&mode=workday&queue=review&month=${params.closeMonth}&return=today`,
      actionLabel: '거래 검토 열기',
      blocked: !syncHealthy,
      blocker: 'Clobe 동기화와 통장 잔액 확인을 먼저 완료해주세요.',
    }),
    task({
      kind: 'booking_risk',
      label: '출금 초과·변경 예약',
      description: '음수 마진, 취소·환불 또는 확인 뒤 거래가 바뀐 예약입니다.',
      count: register(riskBookings.map(row => `booking:${row.id}`)),
      href: firstRisk
        ? `/admin/finance?tab=bookings&month=${params.closeMonth}&status=pending&sort=departure_asc&mode=workday&focus=${encodeURIComponent(firstRisk.id)}&return=today`
        : `/admin/finance?tab=bookings&month=${params.closeMonth}&status=pending&sort=departure_asc&mode=workday&return=today`,
      actionLabel: '위험 예약 확인',
      blocked: !syncHealthy || travelReviewCount > 0,
      blocker: !syncHealthy ? 'Clobe 동기화를 먼저 완료해주세요.' : '여행 메모·배분 오류를 먼저 처리해주세요.',
    }),
    task({
      kind: 'booking_review',
      label: '예약별 정산 확인',
      description: '입금·출금·Clobe 메모를 직접 보고 확인한 예약만 확정수익에 포함합니다.',
      count: register(normalBookings.map(row => `booking:${row.id}`)),
      href: firstNormal
        ? `/admin/finance?tab=bookings&month=${params.closeMonth}&status=pending&sort=departure_asc&mode=workday&focus=${encodeURIComponent(firstNormal.id)}&return=today`
        : `/admin/finance?tab=bookings&month=${params.closeMonth}&status=pending&sort=departure_asc&mode=workday&return=today`,
      actionLabel: '다음 예약 확인',
      blocked: !syncHealthy || travelReviewCount > 0 || riskBookings.length > 0,
      blocker: riskBookings.length > 0 ? '출금 초과·변경 예약을 먼저 확인해주세요.' : '앞 단계의 거래 오류를 먼저 처리해주세요.',
    }),
    task({
      kind: 'company_classification',
      label: '회사 거래 분류',
      description: '여행이 아닌 경비·세금·대표자 인출을 분류해 실제 운영손익을 정리합니다.',
      count: register((params.summary.actionRefs?.unclassifiedCompanyTransactionIds
        ?? syntheticKeys('company', params.summary.actions.unclassifiedCompany))
        .map(id => `company:${id}`)),
      href: '/admin/finance?tab=expenses&mode=workday&return=today',
      actionLabel: '회사 거래 분류',
      blocked: !syncHealthy,
      blocker: 'Clobe 동기화를 먼저 완료해주세요.',
    }),
    task({
      kind: 'month_close',
      label: '출발 월 마감',
      description: `${params.closeMonth} 출발 예약의 검토가 끝나면 확정 스냅샷을 잠급니다.`,
      count: register(closeCount > 0
        ? [`month:${params.closeMonth}`, ...closeMonthPostCloseExceptionIds.map(id => `exception:${id}`)]
        : []),
      href: `/admin/finance?tab=periods&month=${params.closeMonth}&return=today`,
      actionLabel: '월 마감 확인',
      blocked: monthPending.length > 0 || travelReviewCount > 0 || !syncHealthy,
      blocker: monthPending.length > 0
        ? `${params.closeMonth} 출발 예약 ${monthPending.length}건의 검토를 완료해주세요.`
        : travelReviewCount > 0
          ? '월 소속을 확인할 수 없는 여행 거래를 먼저 처리해주세요.'
          : 'Clobe 동기화를 먼저 완료해주세요.',
    }),
    task({
      kind: 'evidence',
      label: '세금·증빙 보완',
      description: '정산 결과를 바꾸지 않고 누락된 증빙만 이어서 준비합니다.',
      count: register(syntheticKeys('evidence', params.missingReceiptCount)),
      href: `/admin/finance?tab=tax&month=${params.closeMonth}&return=today`,
      actionLabel: '증빙 확인',
    }),
  ];
  const actionable = tasks.filter(item => item.status !== 'done');

  return {
    generatedAt: params.summary.generatedAt,
    sync: {
      ...params.summary.status,
      healthy: syncHealthy,
      nextScheduledSyncAt: nextClobeScheduledSyncAt(now),
      missedScheduledWindows: Number.isFinite(syncAgeHours) ? Math.max(0, Math.floor(syncAgeHours / 4)) : 99,
    },
    closeMonth: params.closeMonth,
    scope: {
      pendingBookingCount: monthPending.length,
      futurePendingBookingCount: futurePending.length,
      priorPendingBookingCount: priorPending.length,
      undatedPendingBookingCount: undatedPending.length,
      travelReviewTransactionIds: travelTransactionIds,
      otherMonthTravelReviewCount: params.otherMonthTravelReviewCount ?? 0,
    },
    metrics: {
      actualBankBalance: params.summary.metrics.actualBankBalance,
      protectedTravelCash: params.summary.metrics.protectedTravelCash,
      protectedCustomerFunds: params.summary.metrics.protectedCustomerFunds,
      unpaidSupplierCost: params.summary.metrics.unpaidSupplierCost,
      estimatedTaxReserve: params.summary.metrics.estimatedTaxReserve,
      companyOperatingResult: params.summary.metrics.companyOperatingResult,
      confirmedTravelProfit: params.summary.metrics.confirmedTravelProfit,
      provisionalUnconfirmedTravelMargin: params.summary.metrics.provisionalUnconfirmedTravelMargin,
      afterTaxConfirmedProfit: params.summary.metrics.afterTaxConfirmedProfit,
      safeToWithdraw: params.summary.metrics.safeToWithdraw,
      calculationStatus: params.summary.metrics.calculationStatus,
      blockers: params.summary.metrics.blockers,
    },
    tasks,
    nextTask: actionable.find(item => item.status === 'ready') ?? actionable[0] ?? null,
    completedSteps: tasks.filter(item => item.status === 'done').length,
    totalSteps: tasks.length,
    openItems: uniqueItemKeys.size,
    stageItemTotal: tasks.reduce((sum, item) => sum + item.count, 0),
  };
}
