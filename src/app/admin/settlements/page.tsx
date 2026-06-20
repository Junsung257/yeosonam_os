'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle, Clock, Coins, Copy, ExternalLink, PauseCircle, Receipt, Wallet, X, XCircle } from 'lucide-react';
import { PageHeader, KpiCard } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';

type SettlementStatus = 'PENDING' | 'READY' | 'COMPLETED' | 'VOID' | 'HOLD';

interface Settlement {
  id: string;
  settlement_period: string;
  qualified_booking_count: number;
  total_amount: number;
  carryover_balance: number;
  final_total: number;
  tax_deduction: number;
  final_payout: number;
  status: SettlementStatus;
  settled_at?: string | null;
  payout_reference?: string | null;
  paid_by?: string | null;
  paid_at?: string | null;
  withholding_amount?: number | null;
  receipt_url?: string | null;
  hold_reason?: string | null;
  held_at?: string | null;
  released_at?: string | null;
  affiliates?: {
    id: string;
    name: string;
    referral_code: string;
    grade: number;
    payout_type: string;
  } | null;
}

interface Affiliate {
  id: string;
  name: string;
  referral_code: string;
}

interface PayoutEvidenceForm {
  payout_reference: string;
  paid_by: string;
  paid_at: string;
  withholding_amount: string;
  receipt_url: string;
}

type StatusConfirmTarget = {
  settlement: Settlement;
  status: Exclude<SettlementStatus, 'COMPLETED' | 'HOLD'>;
};

type Notice = {
  tone: 'success' | 'error';
  message: string;
};

const STATUS_BADGES: Record<string, string> = {
  PENDING: 'bg-status-neutralBg text-status-neutralFg',
  READY: 'bg-status-infoBg text-status-infoFg',
  COMPLETED: 'bg-status-successBg text-status-successFg',
  VOID: 'bg-status-dangerBg text-status-dangerFg',
  HOLD: 'bg-status-warningBg text-status-warningFg',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: '이월 대기',
  READY: '지급 대기',
  COMPLETED: '지급 완료',
  VOID: '취소',
  HOLD: '보류',
};

function getMonthOptions(): string[] {
  const options: string[] = [];
  const now = new Date();
  for (let i = 1; i <= 12; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return options;
}

function defaultSettlementPeriod(): string {
  return getMonthOptions()[0] || new Date().toISOString().substring(0, 7);
}

function todayLocalInputValue(): string {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function unwrapSettlements(json: unknown): Settlement[] {
  const root = json as { settlements?: Settlement[]; data?: { settlements?: Settlement[] } };
  return root.settlements || root.data?.settlements || [];
}

function unwrapAffiliates(json: unknown): Affiliate[] {
  const root = json as { affiliates?: Affiliate[]; data?: { affiliates?: Affiliate[] } };
  return root.affiliates || root.data?.affiliates || [];
}

function apiError(json: unknown, fallback: string): string {
  const root = json as { error?: string | { message?: string } };
  if (typeof root.error === 'string') return root.error;
  if (root.error?.message) return root.error.message;
  return fallback;
}

function krw(value: number | null | undefined) {
  return `₩${Number(value || 0).toLocaleString()}`;
}

function settlementAmountDelta(settlement: Settlement): number {
  const finalTotal = Number(settlement.final_total || 0);
  const finalPayout = Number(settlement.final_payout || 0);
  const withholding = Number(
    settlement.status === 'COMPLETED'
      ? settlement.withholding_amount ?? settlement.tax_deduction ?? 0
      : settlement.tax_deduction ?? 0,
  );
  return finalTotal - finalPayout - withholding;
}

function settlementReviewReasons(settlement: Settlement): string[] {
  const reasons: string[] = [];
  const delta = settlementAmountDelta(settlement);

  if (settlement.status === 'PENDING') {
    reasons.push('최소 지급 조건 미달 또는 이월 대기');
  }
  if (settlement.status === 'HOLD' && settlement.hold_reason) {
    reasons.push(`보류: ${settlement.hold_reason}`);
  }
  if (settlement.status === 'READY' && Number(settlement.final_payout || 0) <= 0) {
    reasons.push('지급 대기 상태지만 실지급액이 0원입니다.');
  }
  if (settlement.status === 'COMPLETED') {
    if (!settlement.payout_reference || !settlement.paid_by || !settlement.paid_at || !settlement.receipt_url) {
      reasons.push('지급 완료 증빙 누락');
    }
    if (Math.abs(delta) > 1) {
      reasons.push(`지급+원천징수 합계 차이 ${krw(delta)}`);
    }
  }
  if (settlement.status === 'VOID') {
    reasons.push('취소/롤백 상태입니다. 재정산은 새 정산 생성으로 처리하세요.');
  }
  if (Number(settlement.final_total || 0) < 0 || Number(settlement.final_payout || 0) < 0) {
    reasons.push('정산 금액이 음수입니다. 조정액을 확인하세요.');
  }

  return reasons;
}

export default function SettlementsPage() {
  const [period, setPeriod] = useState(defaultSettlementPeriod);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState<string | null>(null);
  const [bulkClosing, setBulkClosing] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const [completionTarget, setCompletionTarget] = useState<Settlement | null>(null);
  const [holdTarget, setHoldTarget] = useState<Settlement | null>(null);
  const [statusConfirmTarget, setStatusConfirmTarget] = useState<StatusConfirmTarget | null>(null);
  const [holdReason, setHoldReason] = useState('');
  const [search, setSearch] = useState('');
  const [copiedEvidence, setCopiedEvidence] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const statusConfirmCancelRef = useRef<HTMLButtonElement | null>(null);
  const [evidence, setEvidence] = useState<PayoutEvidenceForm>({
    payout_reference: '',
    paid_by: '',
    paid_at: todayLocalInputValue(),
    withholding_amount: '0',
    receipt_url: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, aRes] = await Promise.all([
        fetch(`/api/settlements?period=${encodeURIComponent(period)}`),
        fetch('/api/affiliates'),
      ]);
      const sJson = await sRes.json();
      const aJson = await aRes.json();
      if (!sRes.ok) throw new Error(apiError(sJson, '정산 목록을 불러오지 못했습니다.'));
      if (!aRes.ok) throw new Error(apiError(aJson, '파트너 목록을 불러오지 못했습니다.'));
      setSettlements(unwrapSettlements(sJson));
      setAffiliates(unwrapAffiliates(aJson));
    } catch (err) {
      setNotice({
        tone: 'error',
        message: err instanceof Error ? err.message : '정산 데이터를 불러오지 못했습니다.',
      });
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!statusConfirmTarget) return;
    requestAnimationFrame(() => statusConfirmCancelRef.current?.focus());
  }, [statusConfirmTarget]);

  const closeSettlement = async (affiliateId: string) => {
    setClosing(affiliateId);
    try {
      const res = await fetch('/api/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ affiliateId, period }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNotice({ tone: 'error', message: apiError(json, '정산 마감에 실패했습니다.') });
        return;
      }
      setNotice({ tone: 'success', message: '정산 마감을 실행했습니다.' });
      await load();
    } finally {
      setClosing(null);
    }
  };

  const updateStatus = async (id: string, status: SettlementStatus, payload: Record<string, unknown> = {}) => {
    setStatusUpdating(id);
    try {
      const res = await fetch('/api/settlements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, ...payload }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNotice({ tone: 'error', message: apiError(json, '상태 변경에 실패했습니다.') });
        return;
      }
      setCompletionTarget(null);
      setHoldTarget(null);
      setStatusConfirmTarget(null);
      setHoldReason('');
      setNotice({ tone: 'success', message: `정산 상태를 ${STATUS_LABELS[status] || status}(으)로 변경했습니다.` });
      await load();
    } finally {
      setStatusUpdating(null);
    }
  };

  const openCompletionModal = (settlement: Settlement) => {
    setCompletionTarget(settlement);
    setEvidence({
      payout_reference: '',
      paid_by: '',
      paid_at: todayLocalInputValue(),
      withholding_amount: String(Number(settlement.tax_deduction || 0)),
      receipt_url: '',
    });
  };

  const submitCompletion = () => {
    if (!completionTarget) return;
    updateStatus(completionTarget.id, 'COMPLETED', {
      payout_reference: evidence.payout_reference.trim(),
      paid_by: evidence.paid_by.trim(),
      paid_at: new Date(evidence.paid_at).toISOString(),
      withholding_amount: Number(evidence.withholding_amount),
      receipt_url: evidence.receipt_url.trim(),
    });
  };

  const openHoldModal = (settlement: Settlement) => {
    setHoldTarget(settlement);
    setHoldReason(settlement.hold_reason || '');
  };

  const openStatusConfirm = (
    settlement: Settlement,
    status: Exclude<SettlementStatus, 'COMPLETED' | 'HOLD'>,
  ) => {
    setStatusConfirmTarget({ settlement, status });
  };

  const submitStatusConfirm = () => {
    if (!statusConfirmTarget) return;
    updateStatus(statusConfirmTarget.settlement.id, statusConfirmTarget.status);
  };

  const submitHold = () => {
    if (!holdTarget) return;
    updateStatus(holdTarget.id, 'HOLD', { hold_reason: holdReason.trim() });
  };

  const settledIds = useMemo(() => new Set(settlements.map((s) => s.affiliates?.id).filter(Boolean)), [settlements]);
  const unsettledAffiliates = affiliates.filter((a) => !settledIds.has(a.id));
  const closeAllSettlements = async () => {
    if (unsettledAffiliates.length === 0) return;
    setBulkClosing(true);
    const failed: string[] = [];
    try {
      for (const affiliate of unsettledAffiliates) {
        setClosing(affiliate.id);
        const res = await fetch('/api/settlements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ affiliateId: affiliate.id, period }),
        });
        const json = await res.json();
        if (!res.ok) {
          failed.push(`${affiliate.name}: ${apiError(json, '정산 생성 실패')}`);
        }
      }
      if (failed.length > 0) {
        setNotice({ tone: 'error', message: `일부 정산 생성에 실패했습니다.\n\n${failed.join('\n')}` });
      } else {
        setNotice({ tone: 'success', message: `${unsettledAffiliates.length}명 정산을 생성했습니다.` });
      }
      await load();
    } finally {
      setClosing(null);
      setBulkClosing(false);
    }
  };
  const visibleSettlements = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return settlements;
    return settlements.filter((s) => [
      s.affiliates?.name,
      s.affiliates?.referral_code,
      s.payout_reference,
    ].some((value) => (value || '').toLowerCase().includes(q)));
  }, [search, settlements]);

  const totalPayout = settlements.reduce((s, x) => s + Number(x.final_payout || 0), 0);
  const totalTax = settlements.reduce((s, x) => s + Number(x.tax_deduction || 0), 0);
  const statusCounts = {
    READY: settlements.filter((s) => s.status === 'READY').length,
    HOLD: settlements.filter((s) => s.status === 'HOLD').length,
    COMPLETED: settlements.filter((s) => s.status === 'COMPLETED').length,
    VOID: settlements.filter((s) => s.status === 'VOID').length,
  };

  const copyEvidence = async (settlement: Settlement) => {
    const value = settlement.receipt_url || settlement.payout_reference || '';
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedEvidence(settlement.id);
    window.setTimeout(() => setCopiedEvidence(''), 1400);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="정산 관리"
        subtitle="월간 파트너 수수료 정산과 지급 증빙 관리"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="파트너, 코드, 증빙 검색"
              className="h-9 w-56 rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 text-admin-base text-admin-text transition-colors focus:border-brand focus:outline-none focus:shadow-admin-focus"
            />
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="h-9 rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 text-admin-base text-admin-text admin-num transition-colors focus:border-brand focus:outline-none focus:shadow-admin-focus"
            >
              {getMonthOptions().map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        }
      />

      {notice && (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
          className={`rounded-admin-md border px-4 py-3 text-admin-sm font-medium whitespace-pre-line ${
            notice.tone === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {notice.message}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <KpiCard label="총 지급 예정액" value={krw(totalPayout)} icon={Wallet} tone="positive" />
        <KpiCard label="총 원천징수" value={`-${krw(totalTax)}`} icon={Receipt} tone="negative" />
        <KpiCard label="지급 대기" value={statusCounts.READY.toLocaleString()} unit="건" icon={Clock} />
        <KpiCard label="보류" value={statusCounts.HOLD.toLocaleString()} unit="건" icon={PauseCircle} tone={statusCounts.HOLD > 0 ? 'negative' : 'neutral'} />
        <KpiCard label="지급 완료" value={statusCounts.COMPLETED.toLocaleString()} unit="건" icon={CheckCircle} tone="positive" />
        <KpiCard label="취소" value={statusCounts.VOID.toLocaleString()} unit="건" icon={XCircle} tone={statusCounts.VOID > 0 ? 'negative' : 'neutral'} />
      </div>

      <div className="overflow-hidden rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs">
        <div className="flex items-center justify-between border-b border-admin-border px-4 py-3">
          <h2 className="text-admin-h3 text-admin-text admin-num">{period} 정산 현황</h2>
          <span className="text-admin-xs text-admin-muted admin-num">{visibleSettlements.length} / {settlements.length}건</span>
        </div>
        <table className="admin-data-table">
          <thead>
            <tr>
              {['파트너', '건수', '발생 수수료', '이월 포함', '원천징수', '실지급액', '상태', '지급 증빙', '액션'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {[100, 40, 80, 80, 60, 80, 56, 120, 160].map((w, j) => (
                    <td key={j}>
                      <div className="h-3 animate-pulse rounded bg-admin-surface-2" style={{ width: w }} />
                      <span className="sr-only">정산 정보 로딩 중</span>
                    </td>
                  ))}
                </tr>
              ))
            ) : visibleSettlements.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-14 text-center" style={{ height: 'auto' }}>
                  <span className="sr-only">정산 빈 상태</span>
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-admin-surface-2 text-admin-muted">
                      <Coins size={20} strokeWidth={1.75} />
                    </div>
                    <p className="text-admin-sm font-medium text-admin-muted">조건에 맞는 정산 데이터가 없습니다.</p>
                  </div>
                </td>
              </tr>
            ) : visibleSettlements.map((s) => {
              const amountDelta = settlementAmountDelta(s);
              const reviewReasons = settlementReviewReasons(s);
              return (
              <tr key={s.id}>
                <td>
                  <div className="font-medium text-admin-text">{s.affiliates?.name}</div>
                  <div className="font-mono text-admin-xs text-admin-muted">{s.affiliates?.referral_code}</div>
                </td>
                <td className="admin-num">{Number(s.qualified_booking_count || 0).toLocaleString()}건</td>
                <td className="admin-num">{krw(s.total_amount)}</td>
                <td className="font-medium admin-num">{krw(s.final_total)}</td>
                <td className="text-danger admin-num">{s.tax_deduction > 0 ? `-${krw(s.tax_deduction)}` : '₩0'}</td>
                <td>
                  <div className="font-bold text-success admin-num">{krw(s.final_payout)}</div>
                  {Math.abs(amountDelta) > 1 ? (
                    <div className="mt-0.5 text-admin-xs font-medium text-danger admin-num">
                      차이 {krw(amountDelta)}
                    </div>
                  ) : null}
                </td>
                <td>
                  <span className={`rounded-admin-xs px-2 py-0.5 text-admin-xs font-semibold ${STATUS_BADGES[s.status] || STATUS_BADGES.PENDING}`}>
                    {STATUS_LABELS[s.status] || s.status}
                  </span>
                  {reviewReasons.length > 0 ? (
                    <div className="mt-1 space-y-0.5">
                      {reviewReasons.slice(0, 2).map((reason) => (
                        <div
                          key={reason}
                          className="flex max-w-[220px] items-center gap-1 truncate text-admin-xs text-admin-muted"
                          title={reason}
                        >
                          <AlertCircle size={11} className="shrink-0 text-status-warningFg" />
                          <span className="truncate">{reason}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </td>
                <td>
                  <EvidenceCell settlement={s} copied={copiedEvidence === s.id} onCopy={() => copyEvidence(s)} />
                </td>
                <td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {s.status === 'PENDING' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openStatusConfirm(s, 'READY')}
                        disabled={statusUpdating === s.id || Number(s.final_payout || 0) <= 0}
                      >
                        지급 대기
                      </Button>
                    )}
                    {s.status === 'READY' && (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => openCompletionModal(s)}
                          disabled={statusUpdating === s.id}
                        >
                          지급 완료
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openHoldModal(s)}
                          disabled={statusUpdating === s.id}
                        >
                          보류
                        </Button>
                      </>
                    )}
                    {s.status === 'HOLD' && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => openStatusConfirm(s, 'READY')}
                        disabled={statusUpdating === s.id}
                      >
                        보류 해제
                      </Button>
                    )}
                    {['READY', 'COMPLETED'].includes(s.status) && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openStatusConfirm(s, 'VOID')}
                        disabled={statusUpdating === s.id}
                      >
                        취소
                      </Button>
                    )}
                    <Link
                      href={`/admin/affiliates/${s.affiliates?.id}`}
                      className="text-admin-xs font-medium text-brand hover:text-brand-dark"
                    >
                      상세
                    </Link>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {unsettledAffiliates.length > 0 && (
        <div className="admin-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-admin-border px-4 py-3">
            <div>
              <h2 className="text-admin-h3 text-admin-text">
                정산 마감 대기 <span className="admin-num text-admin-muted">({unsettledAffiliates.length}명)</span>
              </h2>
              <p className="mt-0.5 text-admin-xs text-admin-muted admin-num">
                아래 파트너는 {period} 정산 마감이 아직 실행되지 않았습니다.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={closeAllSettlements}
              disabled={bulkClosing || loading}
              loading={bulkClosing}
            >
              전체 정산 생성
            </Button>
          </div>
          <div>
            {unsettledAffiliates.map((a) => (
              <div key={a.id} className="flex items-center justify-between border-b border-admin-border px-4 py-2 last:border-b-0">
                <div>
                  <span className="text-admin-sm font-medium text-admin-text">{a.name}</span>
                  <span className="ml-2 font-mono text-admin-xs text-admin-muted">{a.referral_code}</span>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => closeSettlement(a.id)}
                  disabled={bulkClosing || closing === a.id}
                >
                  {closing === a.id ? '마감 중' : '정산 마감 실행'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {completionTarget && (
        <PayoutEvidenceModal
          settlement={completionTarget}
          evidence={evidence}
          submitting={statusUpdating === completionTarget.id}
          onChange={setEvidence}
          onClose={() => setCompletionTarget(null)}
          onSubmit={submitCompletion}
        />
      )}
      {holdTarget && (
        <HoldReasonModal
          settlement={holdTarget}
          reason={holdReason}
          submitting={statusUpdating === holdTarget.id}
          onChange={setHoldReason}
          onClose={() => {
            setHoldTarget(null);
            setHoldReason('');
          }}
          onSubmit={submitHold}
        />
      )}
      {statusConfirmTarget && (
        <SettlementStatusConfirmModal
          target={statusConfirmTarget}
          submitting={statusUpdating === statusConfirmTarget.settlement.id}
          cancelRef={statusConfirmCancelRef}
          onClose={() => setStatusConfirmTarget(null)}
          onSubmit={submitStatusConfirm}
        />
      )}
    </div>
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

function EvidenceCell({ settlement, copied, onCopy }: { settlement: Settlement; copied: boolean; onCopy: () => void }) {
  if (settlement.status === 'COMPLETED') {
    return (
      <div className="space-y-1 text-admin-xs">
        <div className="font-medium text-admin-text">{settlement.payout_reference || '참조번호 없음'}</div>
        <div className="text-admin-muted admin-num">{formatDateTime(settlement.paid_at)}</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1 font-medium text-brand hover:text-brand-dark"
          >
            <Copy size={12} /> {copied ? '복사됨' : '복사'}
          </button>
          {settlement.receipt_url ? (
            <a
              href={settlement.receipt_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand hover:text-brand-dark"
            >
              <ExternalLink size={12} /> 열기
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  if (settlement.status === 'HOLD') {
    return <span className="text-admin-xs text-admin-muted">보류 사유 확인 필요</span>;
  }

  return <span className="text-admin-xs text-admin-muted">-</span>;
}

function PayoutEvidenceModal({
  settlement,
  evidence,
  submitting,
  onChange,
  onClose,
  onSubmit,
}: {
  settlement: Settlement;
  evidence: PayoutEvidenceForm;
  submitting: boolean;
  onChange: (next: PayoutEvidenceForm) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const withholdingAmount = Number(evidence.withholding_amount);
  const amountMismatch =
    Number.isFinite(withholdingAmount)
    && Math.abs(Number(settlement.final_payout || 0) + withholdingAmount - Number(settlement.final_total || 0)) > 1;
  const disabled =
    !evidence.payout_reference.trim() ||
    !evidence.paid_by.trim() ||
    !evidence.paid_at.trim() ||
    !evidence.receipt_url.trim() ||
    !Number.isFinite(withholdingAmount) ||
    withholdingAmount < 0 ||
    withholdingAmount > Number(settlement.final_total || 0) ||
    amountMismatch;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-lg rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-lg">
        <div className="flex items-start justify-between border-b border-admin-border px-5 py-4">
          <div>
            <h2 className="text-admin-h2 text-admin-text">지급 증빙 입력</h2>
            <p className="mt-1 text-admin-xs text-admin-muted">
              {settlement.affiliates?.name} · {settlement.settlement_period} · {krw(settlement.final_payout)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-admin-sm text-admin-muted hover:bg-admin-surface-2 hover:text-admin-text"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <Field
            name="payout_reference"
            label="지급 참조번호"
            value={evidence.payout_reference}
            onChange={(value) => onChange({ ...evidence, payout_reference: value })}
            placeholder="은행 거래번호, 내부 지급 ID 등"
            required
          />
          <Field
            name="paid_by"
            label="지급 처리자"
            value={evidence.paid_by}
            onChange={(value) => onChange({ ...evidence, paid_by: value })}
            placeholder="담당자 또는 서비스 계정"
            required
          />
          <Field
            name="paid_at"
            label="지급 일시"
            type="datetime-local"
            value={evidence.paid_at}
            onChange={(value) => onChange({ ...evidence, paid_at: value })}
            required
          />
          <Field
            name="withholding_amount"
            label="원천징수액"
            type="number"
            value={evidence.withholding_amount}
            onChange={(value) => onChange({ ...evidence, withholding_amount: value })}
            placeholder="0"
            min={0}
            required
          />
          <Field
            name="receipt_url"
            label="증빙 URL"
            value={evidence.receipt_url}
            onChange={(value) => onChange({ ...evidence, receipt_url: value })}
            placeholder="영수증, 이체확인증, 파일 URL"
            required
          />
          {amountMismatch ? (
            <p className="rounded-admin-sm bg-status-warningBg px-3 py-2 text-admin-xs font-medium text-status-warningFg">
              실지급액과 원천징수액의 합이 이월 포함 정산액과 일치해야 합니다.
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-admin-border px-5 py-4">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            취소
          </Button>
          <Button variant="primary" size="sm" onClick={onSubmit} disabled={disabled} loading={submitting}>
            증빙 저장 후 완료
          </Button>
        </div>
      </div>
    </div>
  );
}

function HoldReasonModal({
  settlement,
  reason,
  submitting,
  onChange,
  onClose,
  onSubmit,
}: {
  settlement: Settlement;
  reason: string;
  submitting: boolean;
  onChange: (next: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const disabled = !reason.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-md rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-lg">
        <div className="flex items-start justify-between border-b border-admin-border px-5 py-4">
          <div>
            <h2 className="text-admin-h2 text-admin-text">정산 보류</h2>
            <p className="mt-1 text-admin-xs text-admin-muted">
              {settlement.affiliates?.name} · {settlement.settlement_period} · {krw(settlement.final_payout)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-admin-sm text-admin-muted hover:bg-admin-surface-2 hover:text-admin-text"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-admin-xs font-medium text-admin-muted">보류 사유</span>
            <textarea
              name="hold_reason"
              value={reason}
              onChange={(e) => onChange(e.target.value)}
              required
              rows={4}
              className="w-full resize-none rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 py-2 text-admin-base text-admin-text outline-none transition-colors focus:border-brand focus:shadow-admin-focus"
              placeholder="계좌 확인, 금액 재검토, 증빙 대기 등"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-admin-border px-5 py-4">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            취소
          </Button>
          <Button variant="primary" size="sm" onClick={onSubmit} disabled={disabled} loading={submitting}>
            보류 저장
          </Button>
        </div>
      </div>
    </div>
  );
}

function SettlementStatusConfirmModal({
  target,
  submitting,
  cancelRef,
  onClose,
  onSubmit,
}: {
  target: StatusConfirmTarget;
  submitting: boolean;
  cancelRef: { current: HTMLButtonElement | null };
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { settlement, status } = target;
  const isVoid = status === 'VOID';

  return (
    <div className="fixed inset-0 z-50 flex h-dvh items-center justify-center overflow-y-auto bg-black/35 px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settlement-status-confirm-title"
        aria-describedby="settlement-status-confirm-description settlement-status-confirm-summary"
        className="w-full max-w-md rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-lg"
      >
        <div className="flex items-start justify-between border-b border-admin-border px-5 py-4">
          <div>
            <h2 id="settlement-status-confirm-title" className="text-admin-h2 text-admin-text">
              정산 상태 변경
            </h2>
            <p id="settlement-status-confirm-description" className="mt-1 text-admin-xs leading-5 text-admin-muted">
              {settlement.affiliates?.name} 정산을 {STATUS_LABELS[status]} 상태로 변경합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-admin-sm text-admin-muted hover:bg-admin-surface-2 hover:text-admin-text"
            aria-label="정산 상태 변경 확인 닫기"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">
          <div
            id="settlement-status-confirm-summary"
            className={`rounded-admin-sm border px-3 py-3 text-admin-sm ${
              isVoid
                ? 'border-status-dangerFg/20 bg-status-dangerBg text-status-dangerFg'
                : 'border-status-infoFg/20 bg-status-infoBg text-status-infoFg'
            }`}
          >
            <div className="flex justify-between gap-3">
              <span>현재 상태</span>
              <span className="font-bold">{STATUS_LABELS[settlement.status] || settlement.status}</span>
            </div>
            <div className="mt-1 flex justify-between gap-3">
              <span>변경 상태</span>
              <span className="font-bold">{STATUS_LABELS[status]}</span>
            </div>
            <div className="mt-1 flex justify-between gap-3">
              <span>실지급액</span>
              <span className="admin-num font-bold">{krw(settlement.final_payout)}</span>
            </div>
          </div>
          {isVoid ? (
            <p className="mt-3 rounded-admin-sm bg-status-warningBg px-3 py-2 text-admin-xs font-medium text-status-warningFg">
              취소 상태로 바꾸면 지급 흐름에서 제외됩니다. 증빙과 파트너 안내 상태를 확인해 주세요.
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-admin-border px-5 py-4">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-8 rounded-admin-sm border border-admin-border-mid px-3 text-admin-sm font-medium text-admin-text-2 hover:bg-admin-surface-2 disabled:opacity-50"
          >
            다시 확인
          </button>
          <Button variant={isVoid ? 'danger' : 'primary'} size="sm" onClick={onSubmit} disabled={submitting} loading={submitting}>
            {STATUS_LABELS[status]}로 변경
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  name,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  min,
  required = false,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  min?: number;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-admin-xs font-medium text-admin-muted">{label}</span>
      <input
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        required={required}
        className="h-9 w-full rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 text-admin-base text-admin-text outline-none transition-colors focus:border-brand focus:shadow-admin-focus"
      />
    </label>
  );
}
