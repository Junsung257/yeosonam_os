"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatSettlementTimestamp } from "@/lib/settlement-date-format";

type Line = {
  id: string;
  booking_no: string | null;
  product_name: string;
  departure_date: string | null;
  customer_masked: string | null;
  traveler_count: number;
  commission_base_krw: number | null;
  commission_rate: number | null;
  policy_set_version: string | null;
  line_type: string;
  line_amount_krw: number;
};
type Payout = {
  id: string;
  status: string;
  amount_krw: number;
  payout_reference: string | null;
  receipt_url: string | null;
  completed_at: string | null;
};
type Settlement = {
  id: string;
  settlement_period: string;
  status: string;
  hold_reason_code: string | null;
  qualified_booking_count: number;
  gross_commission_krw: number;
  adjustment_krw: number;
  withholding_krw: number;
  net_payout_krw: number;
  calculation_trace_id: string;
  payouts: Payout[] | Payout | null;
  lines: Line[];
};
type Dispute = {
  id: string;
  settlement_run_id: string | null;
  status: string;
  reason: string;
  opened_at: string;
};
function krw(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}
function commandKey() {
  return `settlement-dispute:${crypto.randomUUID()}`;
}

export default function EarningsPage() {
  const router = useRouter();
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const response = await fetch("/api/partner/earnings", {
      cache: "no-store",
    });
    if (response.status === 401) return router.replace("/partner/login");
    if (!response.ok) return setUnavailable(true);
    const result = await response.json();
    setSettlements(result.settlements || []);
    setDisputes(result.disputes || []);
  }
  useEffect(() => {
    load().catch(() => setUnavailable(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submitDispute() {
    if (!disputeId || reason.trim().length < 10) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/partner/disputes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": commandKey(),
        },
        body: JSON.stringify({
          dispute_type: "SETTLEMENT",
          settlement_run_id: disputeId,
          reason: reason.trim(),
          evidence_urls: [],
        }),
      });
      if (!response.ok) throw new Error("failed");
      setReason("");
      setDisputeId(null);
      await load();
    } catch {
      alert("이의제기를 접수하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-bold text-blue-700">수익·정산</p>
        <h1 className="mt-1 text-3xl font-black">정산 금액과 지급 증빙</h1>
        <p className="mt-2 text-sm text-slate-600">
          정산 확정 시점에 고정된 원장 라인만 표시합니다. 완료된 정산은 이후
          예약 상태가 바뀌어도 달라지지 않습니다.
        </p>
      </header>
      {unavailable ? (
        <p
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-5 font-bold text-red-800"
        >
          정산 데이터를 불러오지 못했습니다.
        </p>
      ) : !settlements ? (
        <div className="h-64 animate-pulse rounded-2xl bg-slate-200" />
      ) : settlements.length === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <h2 className="text-xl font-black">아직 생성된 정산서가 없습니다</h2>
          <p className="mt-2 text-sm text-slate-600">
            정산 정책이 승인되고 지급 조건을 충족하면 월 정산서가 생성됩니다.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          {settlements.map((run) => {
            const payout = Array.isArray(run.payouts)
              ? run.payouts[0]
              : run.payouts;
            const activeDispute = disputes.find(
              (dispute) =>
                dispute.settlement_run_id === run.id &&
                !["RESOLVED", "REJECTED", "WITHDRAWN"].includes(dispute.status),
            );
            return (
              <article
                key={run.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
              >
                <div className="flex flex-col justify-between gap-4 md:flex-row">
                  <div>
                    <p className="text-sm font-bold text-blue-700">
                      {run.settlement_period} 정산
                    </p>
                    <h2 className="mt-1 text-2xl font-black">
                      실지급액 {krw(run.net_payout_krw)}
                    </h2>
                    <p className="mt-2 text-sm text-slate-600">
                      상태 {run.status}
                      {run.hold_reason_code
                        ? ` · 보류 사유 ${run.hold_reason_code}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/api/settlements/${run.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-bold"
                    >
                      정산서 PDF
                    </a>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenId(openId === run.id ? null : run.id)
                      }
                      className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold"
                    >
                      포함 내역 {run.lines.length}건
                    </button>
                  </div>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-slate-500">발생 커미션</dt>
                    <dd className="mt-1 font-black">
                      {krw(run.gross_commission_krw)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">조정·역분개</dt>
                    <dd className="mt-1 font-black">
                      {krw(run.adjustment_krw)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">원천징수</dt>
                    <dd className="mt-1 font-black">
                      -{krw(run.withholding_krw)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">포함 예약</dt>
                    <dd className="mt-1 font-black">
                      {run.qualified_booking_count}건
                    </dd>
                  </div>
                </dl>
                {payout ? (
                  <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
                    <p className="font-black text-emerald-900">
                      지급 {payout.status} · {krw(payout.amount_krw)}
                    </p>
                    <p className="mt-1 text-emerald-800">
                      참조번호 {payout.payout_reference || "지급 처리 중"} ·
                      완료{" "}
                      {payout.completed_at
                        ? formatSettlementTimestamp(payout.completed_at, { includeYear: true })
                        : "아직 미완료"}
                    </p>
                    {payout.receipt_url ? (
                      <a
                        href={payout.receipt_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex font-bold text-emerald-900 underline"
                      >
                        지급 증빙 열기
                      </a>
                    ) : null}
                  </div>
                ) : null}
                {openId === run.id ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-3">예약</th>
                          <th>상품</th>
                          <th>출발</th>
                          <th>유형</th>
                          <th>기준금액</th>
                          <th>적용률</th>
                          <th>라인 금액</th>
                        </tr>
                      </thead>
                      <tbody>
                        {run.lines.map((line) => (
                          <tr
                            key={line.id}
                            className="border-b border-slate-100"
                          >
                            <td className="py-3 font-mono text-xs">
                              {line.booking_no || "-"}
                            </td>
                            <td>{line.product_name}</td>
                            <td>{line.departure_date || "-"}</td>
                            <td>{line.line_type}</td>
                            <td>
                              {line.commission_base_krw == null
                                ? "-"
                                : krw(line.commission_base_krw)}
                            </td>
                            <td>
                              {line.commission_rate == null
                                ? "-"
                                : `${(Number(line.commission_rate) * 100).toFixed(2)}%`}
                            </td>
                            <td className="font-black">
                              {krw(line.line_amount_krw)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                <div className="mt-4 border-t border-slate-100 pt-4">
                  {activeDispute ? (
                    <p className="text-sm font-bold text-amber-800">
                      이의제기 {activeDispute.status} · {activeDispute.reason}
                    </p>
                  ) : disputeId === run.id ? (
                    <div className="space-y-3">
                      <label className="block">
                        <span className="mb-1 block text-sm font-bold">
                          이의제기 사유
                        </span>
                        <textarea
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          minLength={10}
                          maxLength={2000}
                          rows={4}
                          className="w-full rounded-xl border border-slate-300 p-3"
                          placeholder="확인이 필요한 예약 또는 금액을 10자 이상 적어 주세요."
                        />
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setDisputeId(null);
                            setReason("");
                          }}
                          className="min-h-11 rounded-xl border border-slate-300 px-4 font-bold"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={() => void submitDispute()}
                          disabled={submitting || reason.trim().length < 10}
                          className="min-h-11 rounded-xl bg-slate-950 px-4 font-bold text-white disabled:bg-slate-300"
                        >
                          접수
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDisputeId(run.id)}
                      className="min-h-11 rounded-xl border border-red-300 px-4 text-sm font-bold text-red-700"
                    >
                      이 금액에 이의제기
                    </button>
                  )}
                </div>
                <p className="mt-3 break-all text-xs text-slate-500">
                  계산 trace {run.calculation_trace_id}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
