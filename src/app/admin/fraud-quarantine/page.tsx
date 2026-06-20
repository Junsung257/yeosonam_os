'use client';

/**
 * @file /admin/fraud-quarantine/page.tsx
 * @description AA-1 자동 격리된 booking 검토 + 1-click resolve / block 어드민 페이지.
 *
 * 박제 사유 (2026-05-13 Phase 9 Final):
 * fraud-detect 가 자동 격리한 booking 을 사장님이 한 화면에서 즉시 결정.
 */

import { useEffect, useState, useCallback, useRef } from 'react';

interface FraudItem {
  id: number;
  booking_id: string | null;
  detected_at: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  signal_codes: string[];
  signal_descs: string[];
  auto_action: 'memo_marked' | 'slack_only' | 'blocked';
  resolved_at: string | null;
  resolved_by: string | null;
  notes: string | null;
  bookings?: {
    id: string;
    booking_no: string | null;
    total_price: number | null;
    status: string | null;
    departure_date: string | null;
    internal_memo: string | null;
    customers?: { name?: string | null; phone?: string | null } | null;
  } | null;
}

const sevColor: Record<FraudItem['severity'], string> = {
  critical: 'bg-red-100 text-red-700 border-red-300',
  high:     'bg-orange-100 text-orange-700 border-orange-300',
  medium:   'bg-amber-100 text-amber-700 border-amber-300',
  low:      'bg-gray-100 text-gray-700 border-gray-200',
};

const actionLabel: Record<FraudItem['auto_action'], { text: string; cls: string }> = {
  memo_marked: { text: '자동 격리',    cls: 'bg-orange-100 text-orange-700' },
  slack_only:  { text: 'Slack 알림만', cls: 'bg-blue-100 text-blue-700' },
  blocked:     { text: '차단',          cls: 'bg-red-100 text-red-700' },
};

export default function FraudQuarantinePage() {
  const [items, setItems] = useState<FraudItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'unresolved' | 'resolved' | 'all'>('unresolved');
  const [busy, setBusy] = useState<number | null>(null);
  const [blockTarget, setBlockTarget] = useState<FraudItem | null>(null);
  const blockCancelRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/fraud-quarantine?status=${filter}`);
      const d = await res.json();
      setItems(d.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!blockTarget) return;
    requestAnimationFrame(() => blockCancelRef.current?.focus());
  }, [blockTarget]);

  const doAction = async (id: number, action: 'resolve' | 'unresolve' | 'block', notes?: string) => {
    setBusy(id);
    try {
      await fetch('/api/admin/fraud-quarantine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, resolved_by: 'admin', notes }),
      });
      await load();
      if (action === 'block') setBlockTarget(null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">자동 격리 검토</h1>
          <p className="text-sm text-admin-muted mt-1">fraud-detect 가 자동 마킹한 booking — 1-click 해결/차단</p>
        </div>
        <div className="flex gap-2">
          {(['unresolved', 'resolved', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-admin-sm px-3 py-1 rounded ${filter === f ? 'bg-blue-600 text-white' : 'bg-admin-surface-2'}`}
            >
              {f === 'unresolved' ? '미해결' : f === 'resolved' ? '해결됨' : '전체'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-admin-muted">로드 중...</p>
      ) : items.length === 0 ? (
        <p className="text-admin-muted">📭 항목 없음</p>
      ) : (
        <div className="space-y-3">
          {items.map(item => {
            const b = item.bookings;
            return (
              <div key={item.id} className={`p-4 rounded-lg border ${item.resolved_at ? 'bg-gray-50 border-gray-200 opacity-70' : 'bg-white border-admin-border'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded border font-bold ${sevColor[item.severity]}`}>
                      {item.severity.toUpperCase()}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${actionLabel[item.auto_action].cls}`}>
                      {actionLabel[item.auto_action].text}
                    </span>
                    {b && (
                      <span className="text-xs text-admin-muted">
                        예약 {b.booking_no ?? b.id.slice(0, 8)} · {b.customers?.name ?? '—'} · {b.total_price ? `${b.total_price.toLocaleString()}원` : '—'}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-admin-muted">{item.detected_at.slice(5, 16).replace('T', ' ')}</span>
                </div>

                <div className="space-y-1 mb-3">
                  {item.signal_descs.map((d, i) => (
                    <div key={i} className="text-admin-sm text-admin-text-2">
                      <span className="text-[10px] text-admin-muted font-mono mr-1">{item.signal_codes[i] ?? '?'}</span>
                      {d}
                    </div>
                  ))}
                </div>

                {item.notes && (
                  <div className="text-xs text-admin-muted bg-admin-surface-2 px-2 py-1 rounded mb-2">📝 {item.notes}</div>
                )}

                {!item.resolved_at ? (
                  <div className="flex gap-2">
                    <button
                      disabled={busy === item.id}
                      onClick={() => void doAction(item.id, 'resolve', 'false positive — 정상 예약')}
                      className="text-sm px-3 py-1.5 bg-emerald-600 text-white rounded disabled:opacity-50"
                    >
                      ✅ 해결 (정상)
                    </button>
                    <button
                      disabled={busy === item.id}
                      type="button"
                      onClick={() => setBlockTarget(item)}
                      aria-haspopup="dialog"
                      aria-expanded={blockTarget?.id === item.id}
                      aria-controls="fraud-block-confirm-dialog"
                      className="text-sm px-3 py-1.5 bg-red-600 text-white rounded disabled:opacity-50"
                    >
                      🚫 차단 (사기 확정)
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-admin-muted">
                      ✓ {item.resolved_by} · {item.resolved_at.slice(5, 16).replace('T', ' ')}
                    </span>
                    <button
                      onClick={() => void doAction(item.id, 'unresolve')}
                      className="text-admin-muted hover:text-admin-text underline"
                    >
                      되돌리기
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {blockTarget && (
        <div className="fixed inset-0 z-[60] flex h-dvh items-center justify-center overflow-y-auto px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            aria-label="예약 차단 확인 닫기"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => setBlockTarget(null)}
          />
          <div
            id="fraud-block-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fraud-block-confirm-title"
            aria-describedby="fraud-block-confirm-description fraud-block-confirm-summary"
            className="relative w-full max-w-md rounded-admin-md border border-red-100 bg-white p-5 shadow-admin-lg"
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Fraud quarantine</p>
              <h2 id="fraud-block-confirm-title" className="text-lg font-bold text-admin-text">
                예약을 차단 처리할까요?
              </h2>
              <p id="fraud-block-confirm-description" className="text-sm leading-6 text-admin-muted">
                이 작업은 예약 상태를 cancelled로 처리합니다. 고객과 결제 정보를 확인한 뒤 진행하세요.
              </p>
            </div>

            <dl
              id="fraud-block-confirm-summary"
              className="mt-4 grid grid-cols-1 gap-2 rounded-admin-sm bg-red-50 p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">위험도</dt>
                <dd className="font-semibold text-admin-text">{blockTarget.severity.toUpperCase()}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">예약</dt>
                <dd className="font-semibold text-admin-text">
                  {blockTarget.bookings?.booking_no ?? blockTarget.bookings?.id.slice(0, 8) ?? '-'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">고객</dt>
                <dd className="font-semibold text-admin-text">{blockTarget.bookings?.customers?.name ?? '-'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">금액</dt>
                <dd className="font-semibold text-admin-text">
                  {blockTarget.bookings?.total_price ? `${blockTarget.bookings.total_price.toLocaleString()}원` : '-'}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={blockCancelRef}
                type="button"
                onClick={() => setBlockTarget(null)}
                className="rounded-admin-sm border border-admin-border bg-white px-4 py-2 text-sm font-medium text-admin-text hover:bg-admin-surface-2"
              >
                다시 확인
              </button>
              <button
                type="button"
                onClick={() => void doAction(blockTarget.id, 'block', '사장님 차단 결정')}
                disabled={busy === blockTarget.id}
                className="rounded-admin-sm bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy === blockTarget.id ? '처리 중...' : '차단 처리'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
