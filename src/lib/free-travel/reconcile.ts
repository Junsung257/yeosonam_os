/**
 * lib/free-travel/reconcile.ts
 *
 * OTA 월간 커미션 리포트 → free_travel_commissions 자동 매칭.
 *
 * 매칭 전략 (우선순위):
 *   1. OTA 리포트의 sub_id / session_id 필드 → session_id 직접 매칭
 *   2. 날짜 범위(±3일) + 금액 범위(±20%) fuzzy 매칭
 *   3. 매칭 불가 → status='unmatched'
 */

import { supabaseAdmin } from '@/lib/supabase';

export interface OtaReportItem {
  ref_id?:     string;  // OTA 고유 참조 ID
  sub_id?:     string;  // 우리가 심은 session_id (있을 때만)
  amount_krw:  number;  // 커미션 금액
  booking_date?: string; // OTA 예약일 (YYYY-MM-DD)
}

export interface ReconcileResult {
  reportId:     string;
  matched:      number;
  unmatched:    number;
  totalKrw:     number;
  reportStatus: 'uploaded' | 'partially_reconciled' | 'fully_reconciled';
  items:        {
    commissionId: string | null;
    refId: string;
    matched: boolean;
    amount: number;
    matchReason: 'direct' | 'fuzzy' | 'none';
    confidence: number;
  }[];
}

export async function reconcileOtaReport(
  reportId: string,
  items: OtaReportItem[],
): Promise<ReconcileResult> {
  if (!supabaseAdmin) throw new Error('DB 미설정');

  // 해당 리포트의 OTA 정보 조회
  const { data: reportRow } = await supabaseAdmin
    .from('ota_commission_reports')
    .select('ota, report_month')
    .eq('id', reportId)
    .limit(1);

  const report = reportRow?.[0];
  if (!report) throw new Error('리포트를 찾을 수 없습니다.');

  // 해당 월의 pending 커미션 레코드 조회
  const [rYear, rMonth] = report.report_month.split('-').map(Number);
  const monthStart = `${report.report_month}-01`;
  const lastDay    = new Date(rYear, rMonth, 0).getDate(); // 해당 월의 마지막 날 (2월·소월 정확)
  const monthEnd   = `${report.report_month}-${String(lastDay).padStart(2, '0')}`;

  const { data: pending } = await supabaseAdmin
    .from('free_travel_commissions')
    .select('id, session_id, estimated_krw, created_at, status')
    .eq('ota', report.ota)
    .in('status', ['pending', 'reported'])
    .gte('created_at', monthStart)
    .lte('created_at', monthEnd);

  type PendingRow = { id: string; session_id: string | null; estimated_krw: number | null; created_at: string; status: string };
  const pendingList: PendingRow[] = (pending ?? []) as PendingRow[];
  const resultItems: ReconcileResult['items'] = [];
  let matched = 0;
  const usedIds = new Set<string>(); // 이미 매칭된 commission ID 추적 (중복 매칭 방지)

  for (const item of items) {
    let commissionId: string | null = null;
    let matchReason: 'direct' | 'fuzzy' | 'none' = 'none';
    let confidence = 0;

    // 전략 1: sub_id로 직접 매칭
    if (item.sub_id) {
      const direct = pendingList.find(p =>
        !usedIds.has(p.id) &&
        (p.session_id === item.sub_id || p.id === item.sub_id),
      );
      if (direct) { commissionId = direct.id; usedIds.add(direct.id); }
      if (direct) {
        matchReason = 'direct';
        confidence = 1;
      }
    }

    // 전략 2: 금액 범위 fuzzy 매칭 (sub_id 없을 때)
    if (!commissionId && item.amount_krw > 0) {
      const fuzzy = pendingList.find(p => {
        const est = p.estimated_krw ?? 0;
        return (
          !usedIds.has(p.id) &&
          p.status !== 'reconciled' &&
          Math.abs(item.amount_krw - est) / Math.max(est, 1) <= 0.2
        );
      });
      if (fuzzy) { commissionId = fuzzy.id; usedIds.add(fuzzy.id); }
      if (fuzzy) {
        matchReason = 'fuzzy';
        confidence = 0.7;
      }
    }

    if (commissionId) {
      const { error: updateErr } = await supabaseAdmin
        .from('free_travel_commissions')
        .update({
          status:        'reconciled',
          confirmed_krw: item.amount_krw,
          ota_report_ref: item.ref_id ?? null,
          reported_at:   new Date().toISOString(),
        })
        .eq('id', commissionId);
      if (updateErr) {
        console.error('[reconcile] commission update 실패:', updateErr.message);
        usedIds.delete(commissionId); // 실패한 ID는 재사용 가능하게 해제
        commissionId = null;
      } else {
        matched++;
      }
    } else {
      // 매칭 불가 → 새 unmatched 레코드 생성
      const { data: newRow, error: insertErr } = await supabaseAdmin
        .from('free_travel_commissions')
        .insert({
          ota:             report.ota,
          status:          'unmatched',
          confirmed_krw:   item.amount_krw,
          ota_report_ref:  item.ref_id ?? null,
          commission_rate: 0,
          ...(item.booking_date ? { created_at: item.booking_date } : {}),
        })
        .select('id')
        .single();
      commissionId = insertErr ? null : (newRow?.id ?? null);
    }

    resultItems.push({
      commissionId,
      refId:   item.ref_id ?? '',
      matched: !!commissionId && commissionId !== null,
      amount:  item.amount_krw,
      matchReason,
      confidence,
    });
  }

  const totalKrw = items.reduce((s, i) => s + i.amount_krw, 0);

  const reportStatus: ReconcileResult['reportStatus'] =
    matched === 0 ? 'uploaded'
    : matched === items.length ? 'fully_reconciled'
    : 'partially_reconciled';

  // 리포트 reconciled 상태로 업데이트
  await supabaseAdmin
    .from('ota_commission_reports')
    .update({
      reconciled:    matched === items.length,
      reconciled_at: new Date().toISOString(),
      item_count:    items.length,
      total_krw:     totalKrw,
      raw_json:      {
        items,
        matched,
        unmatched: items.length - matched,
        reportStatus,
      },
    })
    .eq('id', reportId);

  return {
    reportId,
    matched,
    unmatched: items.length - matched,
    totalKrw,
    reportStatus,
    items: resultItems,
  };
}
