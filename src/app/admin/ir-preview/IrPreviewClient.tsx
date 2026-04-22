'use client';

import { useState } from 'react';

interface DraftRow {
  id: string;
  raw_text: string;
  ir: Record<string, unknown>;
  land_operator: string | null;
  region: string | null;
  normalizer_version: string;
  status: string;
  canary_mode: boolean;
  judge_verdict: string | null;
  judge_report: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-amber-100 text-amber-800',
  converted: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
  rejected: 'bg-gray-200 text-gray-600',
  confirmed: 'bg-blue-100 text-blue-800',
};

export default function IrPreviewClient({ drafts }: { drafts: DraftRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function approveDraft(row: DraftRow) {
    if (!confirm(`승인하여 travel_packages 에 등록하시겠습니까?\n\n${row.region} / ${row.land_operator}`)) return;
    setBusy(row.id);
    try {
      const res = await fetch('/api/register-via-ir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engine: 'direct',
          ir: row.ir,
          landOperator: row.land_operator,
          commissionRate: (row.ir as { meta?: { commissionRate?: number } })?.meta?.commissionRate ?? 10,
          rawText: row.raw_text,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setToast(`❌ 승인 실패: ${json.error || res.status}`);
        return;
      }
      setToast(`✅ 등록 완료: ${json.shortCode} (/packages/${json.packageId})`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setToast(`❌ 네트워크 오류: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setBusy(null);
    }
  }

  async function rejectDraft(row: DraftRow) {
    if (!confirm('거절하시겠습니까? (정보는 남아있고 재개 가능)')) return;
    setBusy(row.id);
    try {
      const res = await fetch(`/api/packages/${row.id}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      });
      if (!res.ok) {
        // fallback: 테이블 직접 업데이트는 API 없으면 어드민이 supabase 에서
        setToast(`⚠️  거절 API 미연결 — 수동: UPDATE normalized_intakes SET status='rejected' WHERE id='${row.id}'`);
      } else {
        setToast('✅ 거절 완료');
        setTimeout(() => window.location.reload(), 1200);
      }
    } catch (err) {
      setToast(`❌ ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {toast && (
        <div className="fixed bottom-6 right-6 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm max-w-md z-50">
          {toast}
          <button onClick={() => setToast(null)} className="ml-3 text-gray-400 hover:text-white">✕</button>
        </div>
      )}

      {drafts.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          IR draft 가 없습니다.
          <div className="text-xs mt-2 text-gray-400">
            <code>node db/register_via_ir.js &lt;raw&gt; --operator=&lt;랜드사&gt; --margin=&lt;N&gt; --dry-run</code> 으로 생성 가능.
          </div>
        </div>
      )}

      {drafts.map((row) => {
        const open = openId === row.id;
        const meta = (row.ir as { meta?: Record<string, unknown> })?.meta || {};
        const days = (row.ir as { days?: unknown[] })?.days || [];
        const inclusions = (row.ir as { inclusions?: string[] })?.inclusions || [];
        return (
          <div key={row.id} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            {/* 헤더 */}
            <div
              className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50"
              onClick={() => setOpenId(open ? null : row.id)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[row.status] || 'bg-gray-100'}`}>
                  {row.status}
                </span>
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">
                    {String(meta.region || row.region || '(지역미상)')} — {String(meta.productType || '?')} · {String(meta.tripStyle || '?')}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {row.land_operator} · days {days.length} · inclusions {inclusions.length} · {row.normalizer_version} · {new Date(row.created_at).toLocaleString('ko-KR')}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {row.status === 'draft' && (
                  <>
                    <button
                      disabled={busy === row.id}
                      onClick={(e) => { e.stopPropagation(); approveDraft(row); }}
                      className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {busy === row.id ? '처리중...' : '승인 → 등록'}
                    </button>
                    <button
                      disabled={busy === row.id}
                      onClick={(e) => { e.stopPropagation(); rejectDraft(row); }}
                      className="px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50"
                    >
                      거절
                    </button>
                  </>
                )}
                <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
              </div>
            </div>

            {/* 펼침 */}
            {open && (
              <div className="border-t border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-0 max-h-[600px] overflow-y-auto">
                {/* rawText */}
                <div className="p-3 border-r border-gray-200 bg-gray-50">
                  <div className="text-xs font-bold text-gray-500 mb-2 sticky top-0 bg-gray-50 py-1">원문 (raw_text)</div>
                  <pre className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed text-gray-700">{row.raw_text}</pre>
                </div>

                {/* IR JSON */}
                <div className="p-3 border-r border-gray-200">
                  <div className="text-xs font-bold text-blue-600 mb-2 sticky top-0 bg-white py-1">IR (NormalizedIntake)</div>
                  <pre className="text-[10px] font-mono leading-tight text-gray-800">
                    {JSON.stringify(row.ir, null, 2)}
                  </pre>
                </div>

                {/* 요약 사이드 */}
                <div className="p-3 bg-violet-50/40">
                  <div className="text-xs font-bold text-violet-700 mb-2 sticky top-0 bg-violet-50 py-1">요약</div>
                  <dl className="text-xs space-y-2">
                    <div>
                      <dt className="text-gray-500">지역·국가</dt>
                      <dd className="font-medium">{String(meta.region || '?')} / {String(meta.country || '?')}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">최소 인원</dt>
                      <dd className="font-medium">{String(meta.minParticipants ?? '?')}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">발권기한</dt>
                      <dd className="font-medium">{String(meta.ticketingDeadline || 'null')}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">inclusions ({inclusions.length})</dt>
                      <dd className="font-medium text-[10px] leading-tight">{inclusions.slice(0, 8).join(' / ')}{inclusions.length > 8 ? ' ...' : ''}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">일차</dt>
                      <dd className="font-medium">
                        {(days as Array<{ day?: number; regions?: string[]; segments?: unknown[] }>).map((d, i) => (
                          <div key={i} className="mt-1">
                            D{d.day || i + 1}: {(d.regions || []).join('→')} ({(d.segments || []).length} seg)
                          </div>
                        ))}
                      </dd>
                    </div>
                    {row.judge_verdict && (
                      <div>
                        <dt className="text-gray-500">Judge</dt>
                        <dd className="font-medium">{row.judge_verdict}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
