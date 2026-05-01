'use client';

/**
 * 입출금 채팅식 매칭 — 어드민 ⌘K 명령 바 (Phase 2)
 *
 * 사장님이 한 줄(`260505_남영선_베스트아시아`)을 치면 분기 A/B/C/D 후보 노출 →
 * Enter / 확정 버튼으로 1-click 매칭.
 *
 * 정책 (project_payment_command_matching.md):
 *   - 출금 자동매칭 금지 (auto-suggest 칩 + 일괄 자동매칭에서 제외).
 *   - 단, 사장님 ⌘K 1-click 매칭은 허용 — 일반 출금은 RPC 가 거부하므로
 *     PATCH /api/bank-transactions (applyToBooking → total_paid_out 증가) 로 우회.
 *   - 입금/환불은 RPC(confirm_payment_match) 사용 (paid_amount 누적).
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { Command } from 'cmdk';
import type {
  ResolveResult,
  BookingHit,
  MatchBranch,
} from '@/lib/payment-command-resolver';
import type { ParsedCommand } from '@/lib/payment-command-parser';

interface Props {
  /** 매칭 성공 시 부모 데이터 reload 콜백 */
  onMatched?: () => void;
  /** 미매칭 거래에 대한 매칭 시도 컨텍스트 (옵션, prop) */
  contextTransactionId?: string;
}

export interface PaymentCommandBarHandle {
  /**
   * 외부에서 모달 열고 거래 컨텍스트를 임시로 prefill (다음 confirm 시 atomic 매칭).
   * 출금/환불 컨텍스트는 confirm 시 PATCH 경로로 우회 (RPC 가 일반 출금 거부).
   */
  openWithTransaction: (
    transactionId: string,
    opts?: { prefillInput?: string; txType?: '입금' | '출금'; isRefund?: boolean },
  ) => void;
}

const DEBOUNCE_MS = 280;

const PaymentCommandBar = forwardRef<PaymentCommandBarHandle, Props>(function PaymentCommandBar(
  { onMatched, contextTransactionId },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [imperativeTxId, setImperativeTxId] = useState<string | undefined>(undefined);
  const [imperativeTxType, setImperativeTxType] = useState<'입금' | '출금' | undefined>(undefined);
  const [imperativeIsRefund, setImperativeIsRefund] = useState<boolean>(false);

  useImperativeHandle(
    ref,
    () => ({
      openWithTransaction: (transactionId, opts) => {
        setImperativeTxId(transactionId);
        setImperativeTxType(opts?.txType);
        setImperativeIsRefund(opts?.isRefund ?? false);
        if (opts?.prefillInput !== undefined) setInput(opts.prefillInput);
        setOpen(true);
      },
    }),
    [],
  );

  // imperative > prop 우선
  const effectiveTxId = imperativeTxId ?? contextTransactionId;
  // 출금(환불 아님)은 RPC 가 거부하므로 PATCH 경로로 우회
  const useOutflowPath = imperativeTxType === '출금' && !imperativeIsRefund;
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ⌘K / Ctrl+K 토글
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // 모달 닫힘 → 상태 리셋 (마지막 입력은 유지하지 않음 — 새 매칭 시작)
  useEffect(() => {
    if (!open) {
      setInput('');
      setResult(null);
      setError(null);
      setConfirming(null);
      setImperativeTxId(undefined);
      setImperativeTxType(undefined);
      setImperativeIsRefund(false);
      if (abortRef.current) abortRef.current.abort();
    }
  }, [open]);

  // 디바운스 + 후보 조회
  useEffect(() => {
    if (!open) return;
    const trimmed = input.trim();
    if (!trimmed) {
      setResult(null);
      setError(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/payments/match-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: trimmed }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
        setResult(data as ResolveResult);
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        setError(err.message || '조회 실패');
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // 인플라이트 fetch 도 함께 취소 — stale 응답이 setState 하지 못하게
      if (abortRef.current) abortRef.current.abort();
    };
  }, [input, open]);

  const handleConfirmBooking = useCallback(
    async (booking: BookingHit) => {
      if (!result) return;
      // 모달 단위 lock — 다른 confirm 이 in-flight 면 즉시 무시 (중복 클릭/엔터 가드)
      if (confirming !== null) return;
      setConfirming(booking.id);
      setError(null);
      try {
        // 출금(환불 아님): RPC 가 정책으로 거부하므로 PATCH 경로 (applyToBooking) 사용.
        // total_paid_out 증가 + message_logs '🏢 랜드사 송금 매칭' 자동 기록.
        // 입금/환불: 기존 RPC 경로 (paid_amount 누적 + 학습 룰).
        const isOutflow = useOutflowPath && !!effectiveTxId;
        const url = isOutflow ? '/api/bank-transactions' : '/api/payments/match-confirm';
        const method = isOutflow ? 'PATCH' : 'POST';
        const body = isOutflow
          ? { action: 'match', transactionId: effectiveTxId, bookingId: booking.id }
          : {
              input: result.parsed.rawInput,
              bookingId: booking.id,
              transactionId: effectiveTxId,
            };
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `확정 실패 (${res.status})`);
        setToast({
          kind: 'ok',
          msg: `✅ ${booking.customer_name ?? booking.booking_no} ${isOutflow ? '출금 매칭' : '매칭'} 완료`,
        });
        setOpen(false);
        onMatched?.();
        setTimeout(() => setToast(null), 3000);
      } catch (err: any) {
        setToast({ kind: 'err', msg: `매칭 실패: ${err.message}` });
        setTimeout(() => setToast(null), 4000);
        // 실패도 외부 데이터 stale 가능성(409 conflict 시 다른 어드민 매칭 완료 등) → reload
        onMatched?.();
      } finally {
        setConfirming(null);
      }
    },
    [result, onMatched, effectiveTxId, confirming, useOutflowPath],
  );

  /**
   * 분기 C 1-click 신규 예약 생성 + (tx 컨텍스트 있으면) 매칭.
   * parsed.customerName / parsed.date / parsed.operatorAlias 만으로 booking 생성 —
   * 상세 가격·인원 등은 사장님이 어드민 그리드에서 후속 수정.
   */
  const [creatingNew, setCreatingNew] = useState(false);
  const handleCreateAndMatch = useCallback(async () => {
    if (!result || creatingNew) return;
    const customerName = result.parsed.customerName?.trim();
    if (!customerName) {
      setToast({ kind: 'err', msg: '고객명을 파싱할 수 없습니다 — 입력을 확인하세요' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setCreatingNew(true);
    try {
      // 1) 고객 생성/재사용 — 서버 dedup
      const custRes = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: customerName,
          quick_created: true,
          quick_created_tx_id: effectiveTxId,
        }),
      });
      const custData = await custRes.json();
      const customerId = custData.customer?.id;
      if (!customerId) throw new Error(custData.error || '고객 생성 실패');

      // 2) 예약 생성 — landOperator 텍스트는 resolver 매칭 우선, 없으면 입력 alias
      const resolvedOperator = result.operators?.[0];
      const landOperatorText = resolvedOperator?.name ?? result.parsed.operatorAlias ?? undefined;
      const bookRes = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadCustomerId: customerId,
          packageTitle: '미지정 상품',
          adultCount: 1,
          childCount: 0,
          adultCost: 0,
          adultPrice: 0,
          childCost: 0,
          childPrice: 0,
          fuelSurcharge: 0,
          departureDate: result.parsed.date || undefined,
          landOperator: landOperatorText,
          quickCreated: true,
          quickCreatedTxId: effectiveTxId,
        }),
      });
      const bookData = await bookRes.json();
      const bookingId = bookData.booking?.id;
      if (!bookingId) throw new Error(bookData.error || '예약 생성 실패');

      // 2-b) 랜드사 FK 보강 — 후속 settlement-bundle 에서 미정산 booking 으로 잡히도록
      // PATCH 인라인 셀 시그니처: { id, <컬럼명>: 값 }
      if (resolvedOperator?.id) {
        await fetch('/api/bookings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: bookingId,
            land_operator_id: resolvedOperator.id,
          }),
        }).catch(() => { /* best-effort, 사장님이 그리드에서 보강 가능 */ });
      }

      // 3) tx 컨텍스트 있으면 매칭까지 — 출금/입금/환불 모두 PATCH 경로 (applyToBooking)
      if (effectiveTxId) {
        const matchRes = await fetch('/api/bank-transactions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'match',
            transactionId: effectiveTxId,
            bookingId,
          }),
        });
        if (!matchRes.ok) {
          const errData = await matchRes.json().catch(() => ({}));
          throw new Error(errData.error || '매칭 실패');
        }
      }

      const opLabel = landOperatorText ? ` · ${landOperatorText}` : '';
      const dateLabel = result.parsed.date ? ` · ${result.parsed.date.slice(2).replace(/-/g, '')}` : '';
      setToast({
        kind: 'ok',
        msg: `✅ ${customerName}${dateLabel}${opLabel} 예약 생성${effectiveTxId ? ' + 매칭' : ''} 완료`,
      });
      setOpen(false);
      onMatched?.();
      setTimeout(() => setToast(null), 3500);
    } catch (err: any) {
      setToast({ kind: 'err', msg: err.message || '신규 예약 생성 실패' });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setCreatingNew(false);
    }
  }, [result, effectiveTxId, onMatched, creatingNew]);

  return (
    <>
      {/* 떠있는 버튼 (모달 닫힌 상태) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 bg-blue-600 text-white px-4 py-2.5 rounded-full shadow-lg hover:bg-blue-700 text-sm flex items-center gap-2 transition"
          title="입금/출금 매칭 명령 (⌘K)"
        >
          <kbd className="bg-white/20 px-1.5 py-0.5 rounded text-xs font-mono">⌘K</kbd>
          <span>매칭 명령</span>
        </button>
      )}

      {/* 토스트 */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-2 rounded shadow-lg text-sm ${
            toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          }`}
          role="status"
        >
          {toast.msg}
        </div>
      )}

      {/* 모달 */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-[8vh] px-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="입금/출금 매칭 명령"
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-2xl"
            onClick={e => e.stopPropagation()}
          >
            <Command shouldFilter={false} loop>
              <div className="px-4 pt-4 pb-2">
                <div className="text-[11px] text-slate-500 mb-1.5">
                  예시: <code className="bg-slate-100 px-1 rounded">260505_남영선_베스트아시아</code>{' '}
                  · <code className="bg-slate-100 px-1 rounded">BK-0042</code>
                  {' '}· <code className="bg-slate-100 px-1 rounded">남영선</code>
                </div>
                <Command.Input
                  value={input}
                  onValueChange={setInput}
                  placeholder="출발일_고객명_랜드사… 한 줄 입력"
                  autoFocus
                  className="w-full text-base outline-none border-0 placeholder:text-slate-400 bg-transparent"
                />
              </div>

              <div className="border-t border-slate-100" />

              <Command.List className="max-h-[60vh] overflow-y-auto p-3">
                {loading && (
                  <Command.Loading>
                    <div className="px-3 py-4 text-sm text-slate-500 flex items-center gap-2">
                      <Spinner /> 조회 중…
                    </div>
                  </Command.Loading>
                )}

                {error && (
                  <div className="px-3 py-3 text-sm text-red-600 bg-red-50 rounded">
                    {error}
                  </div>
                )}

                {!loading && !error && result && (
                  <ResultPanel
                    result={result}
                    onConfirm={handleConfirmBooking}
                    onCreateAndMatch={handleCreateAndMatch}
                    confirming={confirming}
                    creatingNew={creatingNew}
                    hasTransactionContext={!!effectiveTxId}
                    setInput={setInput}
                  />
                )}

                {!loading && !error && !result && input.trim() === '' && (
                  <div className="px-3 py-12 text-center text-sm text-slate-400">
                    <p className="mb-1">메모 형식으로 입력하세요</p>
                    <p className="text-xs">출발일(YYMMDD) _ 고객명 _ 랜드사약칭</p>
                  </div>
                )}
              </Command.List>

              <div className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400 flex justify-between">
                <span>
                  <kbd className="bg-slate-100 px-1 rounded">↑↓</kbd> 선택{' '}
                  <kbd className="bg-slate-100 px-1 rounded">Enter</kbd> 확정{' '}
                  <kbd className="bg-slate-100 px-1 rounded">Esc</kbd> 닫기
                </span>
                <span>⌘K로 토글</span>
              </div>
            </Command>
          </div>
        </div>
      )}
    </>
  );
});

const BRANCH_INFO: Record<MatchBranch, { label: string; color: string; desc: string }> = {
  A: {
    label: '✅ 자동 매칭 후보',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    desc: 'Enter 또는 확정 버튼으로 1-click 매칭',
  },
  B: {
    label: '🔍 부분/다건 후보',
    color: 'bg-blue-50 text-blue-700 border-blue-200',
    desc: '직접 선택해서 확정해주세요',
  },
  C: {
    label: '➕ 신규 예약 의심',
    color: 'bg-amber-50 text-amber-800 border-amber-200',
    desc: '예약 0건 — 새 예약 등록',
  },
  D: {
    label: '❓ 매칭 불충분',
    color: 'bg-slate-50 text-slate-700 border-slate-200',
    desc: '입력을 수정하거나 후보 검토',
  },
};

function ResultPanel({
  result,
  onConfirm,
  onCreateAndMatch,
  confirming,
  creatingNew,
  hasTransactionContext,
  setInput,
}: {
  result: ResolveResult;
  onConfirm: (b: BookingHit) => void;
  onCreateAndMatch: () => void;
  confirming: string | null;
  creatingNew: boolean;
  hasTransactionContext: boolean;
  setInput: (s: string) => void;
}) {
  const info = BRANCH_INFO[result.branch];

  return (
    <div className="space-y-3">
      <BranchHeader branch={result.branch} parsed={result.parsed} info={info} />

      {result.bookings.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1 px-2">
            예약 후보 ({result.bookings.length})
          </div>
          <Command.Group>
            {result.bookings.map((b, idx) => (
              <Command.Item
                key={b.id}
                value={`${b.booking_no}_${b.customer_name ?? ''}_${b.id}`}
                // Enter 1-click 자동 확정은 분기 A 의 top-1 후보에만 허용.
                // 분기 B/D 에서는 click 만 받음 — 디바운스 직후 들어오는 의도치 않은 Enter 차단.
                onSelect={() => {
                  if (result.branch === 'A' && idx === 0) onConfirm(b);
                }}
                disabled={confirming !== null && confirming !== b.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded cursor-pointer hover:bg-slate-50 data-[selected=true]:bg-blue-50 data-[disabled=true]:opacity-40"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    <span>{b.customer_name ?? '이름 없음'}</span>
                    <span className="text-slate-400">/</span>
                    <span className="text-slate-600 font-mono text-xs">{b.booking_no}</span>
                    {b.departure_date && (
                      <span className="text-xs text-slate-500">
                        {b.departure_date.slice(2, 10).replace(/-/g, '')}
                      </span>
                    )}
                    {b.land_operator_name && (
                      <span className="text-xs text-slate-500">· {b.land_operator_name}</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 truncate">
                    {b.reasons.slice(0, 3).join(' · ')}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                    판매가 {fmtKRW(b.total_price)} · 수금 {fmtKRW(b.paid_amount)} · 잔금{' '}
                    {fmtKRW(Math.max(0, b.total_price - b.paid_amount))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <ScoreBar score={b.score} />
                  <button
                    disabled={confirming === b.id}
                    onClick={e => {
                      e.stopPropagation();
                      onConfirm(b);
                    }}
                    className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {confirming === b.id ? '...' : '확정'}
                  </button>
                </div>
              </Command.Item>
            ))}
          </Command.Group>
        </div>
      )}

      {result.branch === 'C' && (
        <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 text-sm">
          <div className="font-semibold text-amber-800 mb-1">예약을 찾을 수 없습니다</div>
          <p className="text-xs text-amber-700 mb-2">
            "{result.parsed.customerName ?? '입력한 이름'}" 고객의 예약이 없습니다.
            {' '}아래 정보로 즉시 예약을 만들고{hasTransactionContext ? ' 이 거래에 매칭' : ''}합니다.
            {' '}<span className="text-[11px] text-amber-600">(상세 가격·인원은 어드민에서 후속 수정)</span>
          </p>
          <div className="text-[11px] text-amber-700 font-mono mb-2 flex flex-wrap gap-x-3">
            {result.parsed.date && <span>출발일={result.parsed.date}</span>}
            <span>대표자={result.parsed.customerName ?? '—'}</span>
            <span>
              랜드사={result.operators?.[0]?.name ?? result.parsed.operatorAlias ?? '—'}
              {result.operators?.[0] ? '' : (result.parsed.operatorAlias ? ' (텍스트만)' : '')}
            </span>
          </div>
          <button
            onClick={onCreateAndMatch}
            disabled={creatingNew || !result.parsed.customerName}
            className="inline-block text-xs px-3 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {creatingNew
              ? '생성 중…'
              : hasTransactionContext
                ? '예약 생성 + 거래 매칭'
                : '예약 생성'}
          </button>
        </div>
      )}

      {result.similarCustomers.length > 0 && result.branch !== 'A' && (
        <div className="border border-slate-200 rounded-lg p-3 text-sm">
          <div className="font-semibold text-slate-700 mb-1.5 text-xs">비슷한 고객 후보</div>
          <div className="flex flex-wrap gap-1.5">
            {result.similarCustomers.map(name => (
              <button
                key={name}
                onClick={() =>
                  setInput(
                    result.parsed.rawInput.replace(
                      result.parsed.customerName ?? '__none__',
                      name,
                    ),
                  )
                }
                className="text-xs px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded transition"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="text-[11px] text-amber-600 px-2">
          ⚠ {result.warnings.join(' · ')}
        </div>
      )}
    </div>
  );
}

function BranchHeader({
  branch,
  parsed,
  info,
}: {
  branch: MatchBranch;
  parsed: ParsedCommand;
  info: { label: string; color: string; desc: string };
}) {
  return (
    <div className={`border rounded-lg p-2.5 text-sm ${info.color}`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">{info.label}</span>
        <span className="text-[11px] opacity-70 font-mono">분기 {branch}</span>
      </div>
      <div className="text-xs mt-1 opacity-80">{info.desc}</div>
      <div className="text-[11px] mt-1.5 font-mono opacity-70 flex flex-wrap gap-x-3">
        {parsed.bookingId && <span>BK={parsed.bookingId}</span>}
        {parsed.date && (
          <span>
            날짜={parsed.date}
            {parsed.dateAmbiguous ? ' (?)' : ''}
          </span>
        )}
        {parsed.customerName && <span>고객={parsed.customerName}</span>}
        {parsed.operatorAlias && <span>랜드사={parsed.operatorAlias}</span>}
      </div>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    score >= 0.85 ? 'bg-emerald-500' : score >= 0.6 ? 'bg-blue-500' : 'bg-slate-300';
  return (
    <div className="flex items-center gap-1 text-[10px] text-slate-500 w-14">
      <div className="flex-1 h-1.5 bg-slate-100 rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums">{pct}</span>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin"
      aria-hidden
    />
  );
}

function fmtKRW(n: number): string {
  if (!n) return '0';
  if (n >= 10000) return `${(n / 10000).toFixed(0)}만`;
  return n.toLocaleString();
}

export default PaymentCommandBar;
