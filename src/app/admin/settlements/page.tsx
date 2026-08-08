"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Receipt,
  Wallet,
} from "lucide-react";
import { PageHeader, KpiCard } from "@/components/admin/patterns";
import Button from "@/components/ui/Button";

type Affiliate = { id: string; name: string; referral_code: string };
type Payout = {
  id: string;
  status: "REQUESTED" | "APPROVED" | "COMPLETED" | "FAILED";
  amount_krw: number;
  payout_reference: string | null;
  receipt_url: string | null;
  requested_by: string;
  approved_by: string | null;
  completed_at: string | null;
};
type Run = {
  id: string;
  settlement_period: string;
  status: "HOLD" | "READY" | "PAYOUT_PENDING" | "COMPLETED";
  hold_reason_code: string | null;
  qualified_booking_count: number;
  gross_commission_krw: number;
  adjustment_krw: number;
  withholding_krw: number;
  net_payout_krw: number;
  calculation_trace_id: string;
  affiliates: Affiliate | Affiliate[] | null;
  payouts: Payout | Payout[] | null;
};

function periods() {
  const result: string[] = [];
  const now = new Date();
  for (let offset = 1; offset <= 12; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    result.push(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
    );
  }
  return result;
}
function key(action: string) {
  return `${action}:${crypto.randomUUID()}`;
}
function krw(value: number | null | undefined) {
  return `₩${Number(value || 0).toLocaleString("ko-KR")}`;
}
function unwrap<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] || null : value;
}
function apiMessage(value: unknown, fallback: string) {
  const root = value as { error?: string | { message?: string } };
  return typeof root.error === "string"
    ? root.error
    : root.error?.message || fallback;
}

export default function AdminSettlementsV2Page() {
  const monthOptions = useMemo(periods, []);
  const [period, setPeriod] = useState(monthOptions[0]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [affiliateId, setAffiliateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [evidenceRun, setEvidenceRun] = useState<Run | null>(null);
  const [evidence, setEvidence] = useState({
    payout_reference: "",
    receipt_url: "",
    bank_transaction_reference: "",
    completed_at: new Date().toISOString().slice(0, 16),
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [runResponse, affiliateResponse] = await Promise.all([
        fetch(`/api/settlements?period=${encodeURIComponent(period)}`, {
          cache: "no-store",
        }),
        fetch("/api/affiliates", { cache: "no-store" }),
      ]);
      const runResult = await runResponse.json();
      const affiliateResult = await affiliateResponse.json();
      if (!runResponse.ok)
        throw new Error(
          apiMessage(runResult, "정산 목록을 불러오지 못했습니다."),
        );
      if (!affiliateResponse.ok)
        throw new Error(
          apiMessage(affiliateResult, "파트너 목록을 불러오지 못했습니다."),
        );
      setRuns(runResult.data?.settlements || runResult.settlements || []);
      setAffiliates(
        affiliateResult.data?.affiliates || affiliateResult.affiliates || [],
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "정산 데이터를 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [period]);
  useEffect(() => {
    void load();
  }, [load]);

  async function createRun() {
    if (!affiliateId) return;
    setBusy("create");
    setError("");
    try {
      const response = await fetch("/api/settlements", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key("create-settlement"),
        },
        body: JSON.stringify({
          affiliate_id: affiliateId,
          settlement_period: period,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(apiMessage(result, "정산 생성 실패"));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "정산 생성 실패");
    } finally {
      setBusy(null);
    }
  }

  async function command(
    run: Run,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    setBusy(run.id);
    setError("");
    try {
      const payout = unwrap(run.payouts);
      const response = await fetch("/api/settlements", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key(action.toLowerCase()),
        },
        body: JSON.stringify({
          id: run.id,
          action,
          payout_id: payout?.id,
          ...extra,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(apiMessage(result, "정산 명령 실패"));
      setEvidenceRun(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "정산 명령 실패");
    } finally {
      setBusy(null);
    }
  }

  const counts = runs.reduce<Record<string, number>>(
    (acc, run) => ({ ...acc, [run.status]: (acc[run.status] || 0) + 1 }),
    {},
  );
  const payoutTotal = runs.reduce(
    (sum, run) => sum + Number(run.net_payout_krw || 0),
    0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Affiliate Ledger V2"
        title="파트너 정산"
        description="원장 라인 고정, 작성자·승인자 분리, 지급 증빙 불변 계약으로 처리합니다."
        actions={
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            className="h-9 rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 text-admin-base"
          >
            {monthOptions.map((month) => (
              <option key={month}>{month}</option>
            ))}
          </select>
        }
      />
      {error ? (
        <p
          role="alert"
          className="rounded-admin-md bg-status-dangerBg p-4 text-admin-sm font-semibold text-status-dangerFg"
        >
          {error}
        </p>
      ) : null}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label="실지급 합계"
          value={krw(payoutTotal)}
          icon={Wallet}
          tone="positive"
        />
        <KpiCard
          label="보류"
          value={String(counts.HOLD || 0)}
          unit="건"
          icon={AlertTriangle}
          tone={counts.HOLD ? "negative" : "neutral"}
        />
        <KpiCard
          label="지급 준비"
          value={String(counts.READY || 0)}
          unit="건"
          icon={Clock}
        />
        <KpiCard
          label="승인·지급 중"
          value={String(counts.PAYOUT_PENDING || 0)}
          unit="건"
          icon={Receipt}
        />
        <KpiCard
          label="완료"
          value={String(counts.COMPLETED || 0)}
          unit="건"
          icon={CheckCircle}
          tone="positive"
        />
      </section>
      <section className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-4">
        <h2 className="text-admin-h3 text-admin-text">개별 정산 실행</h2>
        <p className="mt-1 text-admin-xs text-admin-muted">
          활성 정산 정책이 없거나 원장 근거가 부족하면 생성 대신 HOLD 또는
          오류로 중단됩니다.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            value={affiliateId}
            onChange={(event) => setAffiliateId(event.target.value)}
            className="h-10 flex-1 rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3"
          >
            <option value="">파트너 선택</option>
            {affiliates.map((affiliate) => (
              <option key={affiliate.id} value={affiliate.id}>
                {affiliate.name} · {affiliate.referral_code}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            size="sm"
            onClick={createRun}
            disabled={!affiliateId || busy === "create"}
            loading={busy === "create"}
          >
            정산 실행
          </Button>
        </div>
      </section>
      <section className="overflow-x-auto rounded-admin-md border border-admin-border-mid bg-admin-surface">
        <table className="admin-data-table min-w-[1080px]">
          <thead>
            <tr>
              {[
                "파트너",
                "기간",
                "원장 금액",
                "조정",
                "원천징수",
                "실지급",
                "상태",
                "지급 증빙",
                "작업",
              ].map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="py-12 text-center">
                  불러오는 중
                </td>
              </tr>
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-admin-muted">
                  이 기간에 생성된 정산이 없습니다.
                </td>
              </tr>
            ) : (
              runs.map((run) => {
                const affiliate = unwrap(run.affiliates);
                const payout = unwrap(run.payouts);
                return (
                  <tr key={run.id}>
                    <td>
                      <p className="font-semibold">
                        {affiliate?.name || "파트너 확인 필요"}
                      </p>
                      <p className="font-mono text-admin-xs text-admin-muted">
                        {affiliate?.referral_code}
                      </p>
                    </td>
                    <td className="admin-num">{run.settlement_period}</td>
                    <td className="admin-num">
                      {krw(run.gross_commission_krw)}
                    </td>
                    <td className="admin-num">{krw(run.adjustment_krw)}</td>
                    <td className="admin-num">-{krw(run.withholding_krw)}</td>
                    <td className="font-bold admin-num">
                      {krw(run.net_payout_krw)}
                    </td>
                    <td>
                      <span className="rounded-admin-xs bg-admin-surface-2 px-2 py-1 text-admin-xs font-bold">
                        {run.status}
                      </span>
                      {run.hold_reason_code ? (
                        <p className="mt-1 max-w-48 text-admin-xs text-status-warningFg">
                          {run.hold_reason_code}
                        </p>
                      ) : null}
                    </td>
                    <td>
                      {payout ? (
                        <div className="text-admin-xs">
                          <p className="font-bold">{payout.status}</p>
                          <p className="mt-1">
                            {payout.payout_reference || "참조번호 대기"}
                          </p>
                          {payout.receipt_url ? (
                            <a
                              href={payout.receipt_url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-bold text-brand"
                            >
                              증빙 열기
                            </a>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-admin-xs text-admin-muted">
                          미요청
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {run.status === "HOLD" ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => command(run, "READY")}
                            disabled={busy === run.id}
                          >
                            보류 해제
                          </Button>
                        ) : null}
                        {run.status === "READY" && !payout ? (
                          <>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => command(run, "REQUEST_PAYOUT")}
                              disabled={busy === run.id}
                            >
                              지급 요청
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                const reason =
                                  prompt("보류 사유 코드를 입력하세요.");
                                if (reason)
                                  void command(run, "HOLD", {
                                    hold_reason_code: reason,
                                  });
                              }}
                              disabled={busy === run.id}
                            >
                              보류
                            </Button>
                          </>
                        ) : null}
                        {payout?.status === "REQUESTED" ? (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => command(run, "APPROVE_PAYOUT")}
                            disabled={busy === run.id}
                          >
                            다른 관리자 승인
                          </Button>
                        ) : null}
                        {payout?.status === "APPROVED" ? (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => setEvidenceRun(run)}
                            disabled={busy === run.id}
                          >
                            지급 증빙 등록
                          </Button>
                        ) : null}
                        <a
                          href={`/api/settlements/${run.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center rounded-admin-sm border border-admin-border-mid px-3 text-admin-xs font-semibold"
                        >
                          PDF
                        </a>
                        {affiliate ? (
                          <Link
                            href={`/admin/affiliates/${affiliate.id}`}
                            className="inline-flex h-8 items-center px-2 text-admin-xs font-semibold text-brand"
                          >
                            상세
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
      {evidenceRun ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void command(evidenceRun, "COMPLETE_PAYOUT", {
                ...evidence,
                completed_at: new Date(evidence.completed_at).toISOString(),
              });
            }}
            className="w-full max-w-lg rounded-admin-md bg-admin-surface p-5 shadow-admin-lg"
          >
            <h2 className="text-admin-h2">지급 증빙 등록</h2>
            <p className="mt-1 text-admin-xs text-admin-muted">
              한 번 완료하면 금액과 증빙을 수정하거나 삭제할 수 없습니다.
            </p>
            <div className="mt-4 space-y-3">
              <Field
                label="지급 참조번호"
                value={evidence.payout_reference}
                onChange={(value) =>
                  setEvidence({ ...evidence, payout_reference: value })
                }
              />
              <Field
                label="HTTPS 증빙 URL"
                type="url"
                value={evidence.receipt_url}
                onChange={(value) =>
                  setEvidence({ ...evidence, receipt_url: value })
                }
              />
              <Field
                label="은행 거래 참조"
                value={evidence.bank_transaction_reference}
                onChange={(value) =>
                  setEvidence({
                    ...evidence,
                    bank_transaction_reference: value,
                  })
                }
              />
              <Field
                label="지급 시각"
                type="datetime-local"
                value={evidence.completed_at}
                onChange={(value) =>
                  setEvidence({ ...evidence, completed_at: value })
                }
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEvidenceRun(null)}
              >
                취소
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="submit"
                disabled={
                  !evidence.payout_reference ||
                  !evidence.receipt_url ||
                  !evidence.completed_at
                }
                loading={busy === evidenceRun.id}
              >
                완료·불변 저장
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-admin-xs font-medium text-admin-muted">
        {label}
      </span>
      <input
        type={type}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3"
      />
    </label>
  );
}
