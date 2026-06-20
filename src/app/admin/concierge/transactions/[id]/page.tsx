'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { fmtDateTime } from '@/lib/admin-utils';
import { maskEmail, maskPhone } from '@/lib/pii-mask';

interface SagaEvent {
  event:     string;
  timestamp: string;
  detail?:   string;
}

interface VoucherItem {
  code:         string;
  product_name: string;
  product_type: string;
}

interface ApiOrder {
  id:           string;
  api_name:     string;
  product_type: string;
  product_name: string;
  cost:         number;
  price:        number;
  quantity:     number;
  status:       string;
  external_ref?: string;
  attrs?:       Record<string, unknown>;
  created_at:   string;
}

interface Transaction {
  id:              string;
  idempotency_key: string;
  session_id:      string;
  status:          string;
  total_cost:      number;
  total_price:     number;
  net_margin:      number;
  customer_name?:  string;
  customer_phone?: string;
  customer_email?: string;
  saga_log:        SagaEvent[];
  vouchers?:       VoucherItem[];
  api_orders:      ApiOrder[];
  created_at:      string;
  updated_at:      string;
}

const STATUS_BADGE: Record<string, string> = {
  PENDING:        'bg-admin-surface-2 text-admin-text-2',
  CUSTOMER_PAID:  'bg-blue-100 text-blue-700',
  API_PROCESSING: 'bg-yellow-100 text-yellow-700',
  COMPLETED:      'bg-green-100 text-green-700',
  PARTIAL_FAIL:   'bg-red-100 text-red-700',
  REFUNDED:       'bg-purple-100 text-purple-700',
};

const ORDER_STATUS_BADGE: Record<string, string> = {
  PENDING:   'bg-admin-surface-2 text-admin-muted',
  CONFIRMED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
  REFUNDED:  'bg-purple-100 text-purple-700',
};

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  HOTEL:    '🏨 호텔',
  ACTIVITY: '🎭 액티비티',
  CRUISE:   '🚢 크루즈',
};

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

export default function TransactionDetailPage() {
  const params  = useParams();
  const router  = useRouter();
  const id      = getRouteParam(params?.id);
  const encodedId = encodeURIComponent(id);

  const [txn, setTxn]           = useState<Transaction | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refunding, setRefunding] = useState(false);
  const [refundConfirmOpen, setRefundConfirmOpen] = useState(false);
  const [error, setError]       = useState('');
  const refundCancelRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setTxn(null);
      setError('트랜잭션 ID가 올바르지 않습니다');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res  = await fetch(`/api/concierge/transactions/${encodedId}`);
      const data = await res.json();
      setTxn(data.transaction ?? null);
    } catch {
      setError('트랜잭션 로드 실패');
    } finally {
      setLoading(false);
    }
  }, [encodedId, id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!refundConfirmOpen) return;
    requestAnimationFrame(() => refundCancelRef.current?.focus());
  }, [refundConfirmOpen]);

  async function handleRefund() {
    if (!id) return;
    setRefunding(true);
    setError('');
    try {
      const res  = await fetch(`/api/concierge/transactions/${encodedId}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'refund' }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRefundConfirmOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '환불 처리 실패');
    } finally {
      setRefunding(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-3xl">
        <div className="h-6 bg-admin-surface-2 rounded animate-pulse w-40" />
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-24 shrink-0" />
              <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse flex-1" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!txn) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-500">{error || '트랜잭션을 찾을 수 없습니다.'}</p>
        <button onClick={() => router.back()} className="mt-4 text-indigo-600 hover:underline text-sm">← 돌아가기</button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/concierge" className="text-admin-muted-2 hover:text-admin-muted text-sm">← 목록</Link>
          <h1 className="text-xl font-bold text-admin-text">트랜잭션 상세</h1>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[txn.status] ?? 'bg-admin-surface-2 text-admin-muted'}`}>
            {txn.status}
          </span>
        </div>
        {(txn.status === 'PARTIAL_FAIL' || txn.status === 'COMPLETED' || txn.status === 'CUSTOMER_PAID') && (
          <button
            type="button"
            onClick={() => setRefundConfirmOpen(true)}
            disabled={refunding}
            aria-haspopup="dialog"
            aria-expanded={refundConfirmOpen}
            aria-controls="concierge-refund-confirm-dialog"
            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {refunding ? '처리 중...' : '수동 환불 처리'}
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {refundConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex h-dvh items-center justify-center overflow-y-auto px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            aria-label="환불 확인 닫기"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => setRefundConfirmOpen(false)}
          />
          <div
            id="concierge-refund-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="concierge-refund-confirm-title"
            aria-describedby="concierge-refund-confirm-description concierge-refund-confirm-summary"
            className="relative w-full max-w-md rounded-admin-md border border-red-100 bg-white p-5 shadow-admin-lg"
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Manual refund</p>
              <h2 id="concierge-refund-confirm-title" className="text-lg font-bold text-admin-text">
                트랜잭션 환불 처리
              </h2>
              <p id="concierge-refund-confirm-description" className="text-sm leading-6 text-admin-muted">
                결제 상태와 외부 API 주문 상태를 확인한 뒤 수동 환불로 기록합니다.
              </p>
            </div>

            <dl
              id="concierge-refund-confirm-summary"
              className="mt-4 grid grid-cols-1 gap-2 rounded-admin-sm bg-red-50 p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">현재 상태</dt>
                <dd className="font-semibold text-admin-text">{txn.status}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">판매가</dt>
                <dd className="font-semibold text-admin-text">{txn.total_price.toLocaleString()}원</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">API 주문</dt>
                <dd className="font-semibold text-admin-text">{txn.api_orders.length}건</dd>
              </div>
            </dl>

            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={refundCancelRef}
                type="button"
                onClick={() => setRefundConfirmOpen(false)}
                className="rounded-admin-sm border border-admin-border bg-white px-4 py-2 text-sm font-medium text-admin-text hover:bg-admin-surface-2"
              >
                다시 확인
              </button>
              <button
                type="button"
                onClick={handleRefund}
                disabled={refunding}
                className="rounded-admin-sm bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {refunding ? '처리 중...' : '환불 처리'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 고객 · 결제 요약 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-admin-md border p-4 space-y-2">
          <h3 className="text-sm font-semibold text-admin-text-2 border-b pb-2">고객 정보</h3>
          <p className="text-sm"><span className="text-admin-muted">이름:</span> <span className="font-medium">{txn.customer_name ?? '-'}</span></p>
          <p className="text-sm"><span className="text-admin-muted">연락처:</span> {maskPhone(txn.customer_phone ?? null, 'cs_agent') ?? '-'}</p>
          <p className="text-sm"><span className="text-admin-muted">이메일:</span> {maskEmail(txn.customer_email ?? null, 'cs_agent') ?? '-'}</p>
          <p className="text-sm text-admin-muted-2 font-mono text-xs">{txn.id}</p>
        </div>
        <div className="bg-white rounded-admin-md border p-4 space-y-2">
          <h3 className="text-sm font-semibold text-admin-text-2 border-b pb-2">결제 요약</h3>
          <p className="text-sm"><span className="text-admin-muted">판매가:</span> <span className="font-bold text-indigo-700">₩{txn.total_price.toLocaleString()}</span></p>
          <p className="text-sm"><span className="text-admin-muted">원가:</span> ₩{txn.total_cost.toLocaleString()}</p>
          <p className="text-sm"><span className="text-admin-muted">순마진:</span> <span className="font-semibold text-green-600">₩{txn.net_margin.toLocaleString()}</span></p>
          <p className="text-sm text-admin-muted-2 text-xs">{fmtDateTime(txn.created_at)}</p>
        </div>
      </div>

      {/* 바우처 */}
      {txn.status === 'COMPLETED' && txn.vouchers && txn.vouchers.length > 0 && (
        <div className="bg-white rounded-admin-md border p-4">
          <h3 className="text-sm font-semibold text-admin-text-2 mb-3">발행된 바우처</h3>
          <div className="grid grid-cols-2 gap-3">
            {txn.vouchers.map((v, i) => (
              <div key={i} className={`rounded-lg p-3 border-2 ${
                v.product_type === 'CRUISE' ? 'border-blue-200 bg-blue-50'
                : v.product_type === 'HOTEL' ? 'border-amber-200 bg-amber-50'
                : 'border-green-200 bg-green-50'
              }`}>
                <div className="text-xs text-admin-muted">{PRODUCT_TYPE_LABELS[v.product_type] ?? v.product_type}</div>
                <div className="font-medium text-sm text-admin-text-2 mt-0.5">{v.product_name}</div>
                <div className="font-mono font-bold text-indigo-700 tracking-widest mt-1">{v.code}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* API 주문 목록 */}
      <div className="bg-white rounded-admin-md border overflow-hidden">
        <div className="px-4 py-3 bg-admin-bg border-b">
          <h3 className="text-sm font-semibold text-admin-text-2">API 주문 상세 ({txn.api_orders.length}건)</h3>
        </div>
        <div className="divide-y">
          {txn.api_orders.map(order => (
            <div key={order.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-admin-muted">{PRODUCT_TYPE_LABELS[order.product_type] ?? order.product_type}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ORDER_STATUS_BADGE[order.status] ?? 'bg-admin-surface-2'}`}>
                      {order.status}
                    </span>
                  </div>
                  <p className="font-medium text-admin-text">{order.product_name}</p>
                  {order.external_ref && (
                    <p className="text-xs text-admin-muted-2 mt-0.5 font-mono">Ref: {order.external_ref}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-bold text-indigo-700">₩{order.price.toLocaleString()}</p>
                  <p className="text-xs text-admin-muted-2">원가 ₩{order.cost.toLocaleString()}</p>
                </div>
              </div>
              {/* 크루즈 상세 */}
              {order.product_type === 'CRUISE' && order.attrs && (
                <div className="mt-2 p-2 bg-blue-50 rounded-lg text-xs text-blue-700 grid grid-cols-2 gap-1">
                  {order.attrs.ship_name      ? <span>🛳 {String(order.attrs.ship_name)}</span>      : null}
                  {order.attrs.cabin_class    ? <span>🛏 {String(order.attrs.cabin_class)}</span>    : null}
                  {order.attrs.dining         ? <span>🍽 {String(order.attrs.dining)}</span>         : null}
                  {order.attrs.departure_port ? <span>⚓ {String(order.attrs.departure_port)} 출항</span> : null}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Saga 로그 타임라인 */}
      <div className="bg-white rounded-admin-md border p-4">
        <h3 className="text-sm font-semibold text-admin-text-2 mb-4">Saga 이벤트 로그</h3>
        <div className="space-y-3">
          {(txn.saga_log ?? []).map((event, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${
                  event.event === 'COMPLETED'     ? 'bg-green-500'
                  : event.event === 'ROLLBACK' || event.event === 'PARTIAL_FAIL' ? 'bg-red-500'
                  : event.event === 'MANUAL_REFUND' ? 'bg-purple-500'
                  : 'bg-indigo-400'
                }`} />
                {i < (txn.saga_log?.length ?? 0) - 1 && (
                  <div className="w-0.5 h-full bg-slate-200 mt-1" />
                )}
              </div>
              <div className="pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-admin-text">{event.event}</span>
                  <span className="text-xs text-admin-muted-2">
                    {fmtDateTime(event.timestamp)}
                  </span>
                </div>
                {event.detail && (
                  <p className="text-xs text-admin-muted mt-0.5">{event.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
