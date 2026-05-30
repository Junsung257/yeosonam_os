'use client';

import { useState } from 'react';
import { fmtDateTime } from '@/lib/admin-utils';
import Button from '@/components/ui/Button';
import { Inbox } from 'lucide-react';
import SensitiveRawText from '@/components/admin/SensitiveRawText';

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
  rejected: 'bg-slate-200 text-admin-muted',
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
      const rawRes = await fetch('/api/admin/ir-preview/raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      });
      const rawJson = await rawRes.json();
      if (!rawRes.ok || !rawJson.rawText) {
        setToast(`rawText load failed: ${rawJson.error || rawRes.status}`);
        return;
      }
      const rawText = String(rawJson.rawText);
      const ir = { ...row.ir, rawText };
      const res = await fetch('/api/register-via-ir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engine: 'direct',
          ir,
          landOperator: row.land_operator,
          commissionRate: (ir as { meta?: { commissionRate?: number } })?.meta?.commissionRate ?? 10,
          rawText,
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
    <div className="space-y-2">
      {toast && (
        <div className="fixed bottom-6 right-6 bg-admin-text text-white px-4 py-2 rounded-admin-sm shadow-admin-md text-admin-sm max-w-md z-50 flex items-center gap-3">
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="text-admin-muted-2 hover:text-white">✕</button>
        </div>
      )}

      {drafts.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 admin-card">
          <div className="w-12 h-12 rounded-full bg-admin-surface-2 flex items-center justify-center text-admin-muted">
            <Inbox size={20} strokeWidth={1.75} />
          </div>
          <div className="text-center">
            <p className="text-admin-base font-medium text-admin-text">IR draft 가 없습니다</p>
            <code className="text-admin-2xs mt-2 text-admin-muted-2 font-mono block">node db/register_via_ir.js &lt;raw&gt; --operator=&lt;랜드사&gt; --margin=&lt;N&gt; --dry-run</code>
            <p className="text-admin-xs mt-1 text-admin-muted-2">으로 생성 가능</p>
          </div>
        </div>
      )}

      {drafts.map((row) => {
        const open = openId === row.id;
        const meta = (row.ir as { meta?: Record<string, unknown> })?.meta || {};
        const days = (row.ir as { days?: unknown[] })?.days || [];
        const inclusions = (row.ir as { inclusions?: string[] })?.inclusions || [];
        return (
          <div key={row.id} className="admin-card overflow-hidden">
            {/* 헤더 */}
            <div
              className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-admin-surface-2 transition-colors"
              onClick={() => setOpenId(open ? null : row.id)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={`text-admin-xs px-2 py-0.5 rounded-admin-xs font-semibold ${STATUS_COLOR[row.status] || 'bg-admin-surface-2 text-admin-muted'}`}>
                  {row.status}
                </span>
                <div className="min-w-0">
                  <div className="font-medium text-admin-text truncate">
                    {String(meta.region || row.region || '(지역미상)')} — {String(meta.productType || '?')} · {String(meta.tripStyle || '?')}
                  </div>
                  <div className="text-admin-xs text-admin-muted truncate">
                    {row.land_operator} · days <span className="admin-num">{days.length}</span> · inclusions <span className="admin-num">{inclusions.length}</span> · {row.normalizer_version} · {fmtDateTime(row.created_at)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {row.status === 'draft' && (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy === row.id}
                      onClick={(e) => { e.stopPropagation(); approveDraft(row); }}
                    >
                      {busy === row.id ? '처리중…' : '승인 → 등록'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy === row.id}
                      onClick={(e) => { e.stopPropagation(); rejectDraft(row); }}
                    >
                      거절
                    </Button>
                  </>
                )}
                <span className="text-admin-muted-2 text-admin-sm">{open ? '▴' : '▾'}</span>
              </div>
            </div>

            {/* 펼침 */}
            {open && (
              <div className="border-t border-admin-border grid grid-cols-1 md:grid-cols-3 gap-0 max-h-[600px] overflow-y-auto">
                {/* rawText */}
                <div className="p-3 border-r border-admin-border bg-admin-surface-2">
                  <SensitiveRawText value={row.raw_text} title="원문" />
                </div>

                {/* IR JSON */}
                <div className="p-3 border-r border-admin-border">
                  <div className="text-admin-2xs font-semibold uppercase tracking-wider text-brand mb-2 sticky top-0 bg-admin-surface py-1">IR (NormalizedIntake)</div>
                  <pre className="text-[10px] font-mono leading-tight text-admin-text-2">
                    {JSON.stringify(row.ir, null, 2)}
                  </pre>
                </div>

                {/* 요약 사이드 */}
                <div className="p-3 bg-brand-light/40">
                  <div className="text-admin-2xs font-semibold uppercase tracking-wider text-brand mb-2 sticky top-0 bg-brand-light/40 py-1">요약</div>
                  <dl className="text-admin-xs space-y-2">
                    <div>
                      <dt className="text-admin-muted">지역·국가</dt>
                      <dd className="font-medium">{String(meta.region || '?')} / {String(meta.country || '?')}</dd>
                    </div>
                    <div>
                      <dt className="text-admin-muted">최소 인원</dt>
                      <dd className="font-medium">{String(meta.minParticipants ?? '?')}</dd>
                    </div>
                    <div>
                      <dt className="text-admin-muted">발권기한</dt>
                      <dd className="font-medium">{String(meta.ticketingDeadline || 'null')}</dd>
                    </div>
                    <div>
                      <dt className="text-admin-muted">inclusions ({inclusions.length})</dt>
                      <dd className="font-medium text-[10px] leading-tight">{inclusions.slice(0, 8).join(' / ')}{inclusions.length > 8 ? ' ...' : ''}</dd>
                    </div>
                    <div>
                      <dt className="text-admin-muted">일차</dt>
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
                        <dt className="text-admin-muted">Judge</dt>
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
