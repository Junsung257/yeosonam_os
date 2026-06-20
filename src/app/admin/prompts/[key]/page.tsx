'use client';

import { useState, useEffect, useCallback, use, useRef } from 'react';
import Link from 'next/link';
import { fmtDateTime } from '@/lib/admin-utils';

interface PromptVersion {
  id: string;
  key: string;
  version: number;
  is_active: boolean;
  body: string;
  task_type: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
  change_note: string | null;
}

export default function PromptEditPage(props: { params: Promise<Promise<{ key: string }> | { key: string }> }) {
  const params = use(props.params);
  // Next.js: in 14 params is a plain object, in 15+ a Promise. Defensively support both.
  const resolved = (params && typeof (params as { then?: unknown }).then === 'function')
    ? use(params as Promise<{ key: string }>)
    : (params as { key: string });
  const decodedKey = decodeURIComponent(resolved.key);

  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [invalidating, setInvalidating] = useState(false);
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<PromptVersion | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const rollbackCancelRef = useRef<HTMLButtonElement | null>(null);

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/prompts/${encodeURIComponent(decodedKey)}`);
    const json = await res.json();
    const rows: PromptVersion[] = json.data ?? [];
    setVersions(rows);
    const active = rows.find(r => r.is_active);
    if (active) setBody(active.body);
    setLoading(false);
  }, [decodedKey]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!rollbackTarget) return;
    requestAnimationFrame(() => rollbackCancelRef.current?.focus());
  }, [rollbackTarget]);

  const active = versions.find(v => v.is_active);

  async function handleSave() {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: decodedKey,
          body,
          task_type: active?.task_type ?? null,
          metadata: active?.metadata ?? {},
          change_note: changeNote || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      showToast(`v${json.data.version} 저장 완료`);
      setChangeNote('');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '저장 실패', 'err');
    } finally {
      setSaving(false);
    }
  }

  async function handleInvalidate() {
    setInvalidating(true);
    try {
      await fetch(`/api/prompts/${encodeURIComponent(decodedKey)}/invalidate`, { method: 'POST' });
      showToast('캐시 무효화 완료 — 다음 LLM 호출 시 이 버전이 즉시 적용됩니다');
    } catch {
      showToast('캐시 무효화 실패', 'err');
    } finally {
      setInvalidating(false);
    }
  }

  async function handleRollback(version: number) {
    setRollingBack(version);
    try {
      const res = await fetch(`/api/prompts/${encodeURIComponent(decodedKey)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      showToast(`v${json.data.new_version} 로 롤백 완료`);
      setRollbackTarget(null);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '롤백 실패', 'err');
    } finally {
      setRollingBack(null);
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-3xl">
        <div className="h-6 bg-admin-surface-2 rounded animate-pulse w-56" />
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-3.5 bg-admin-surface-2 rounded animate-pulse" style={{ width: `${80 - i * 10}%` }} />
          ))}
        </div>
        <div className="h-40 bg-admin-bg rounded-admin-md animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* 토스트 */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-admin-md text-sm font-medium text-white transition-all ${toast.type === 'ok' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/prompts" className="text-admin-muted-2 hover:text-admin-text-2 text-sm">
          ← 목록
        </Link>
        <span className="text-admin-muted-2">/</span>
        <h1 className="text-xl font-extrabold text-admin-text font-mono">{decodedKey}</h1>
        {active && (
          <span className="bg-admin-surface-2 text-admin-muted text-xs px-2 py-0.5 rounded font-mono">
            v{active.version} 활성
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button
            onClick={handleInvalidate}
            disabled={invalidating}
            className="px-3 py-1.5 text-sm border border-admin-border-strong rounded-lg hover:bg-admin-bg disabled:opacity-50"
          >
            {invalidating ? '처리 중...' : '즉시 적용'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !body.trim()}
            className="px-4 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 font-medium"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>

      {/* 메타 정보 */}
      {active && (
        <div className="flex gap-4 text-xs text-admin-muted mb-4">
          {active.task_type && <span>task: <strong>{active.task_type}</strong></span>}
          <span>마지막 수정: {fmtDateTime(active.created_at)}</span>
          {active.created_by && <span>by {active.created_by}</span>}
        </div>
      )}

      {/* 변경 메모 */}
      <div className="mb-3">
        <input
          type="text"
          value={changeNote}
          onChange={e => setChangeNote(e.target.value)}
          placeholder="변경 메모 (예: R11 규칙 추가, 톤 조정)"
          className="w-full border border-admin-border-mid rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>

      {/* 프롬프트 편집 textarea */}
      <div className="relative mb-6">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={30}
          className="w-full font-mono text-sm border border-admin-border-mid rounded-lg px-4 py-3 resize-y focus:outline-none focus:ring-2 focus:ring-slate-400 bg-admin-bg leading-relaxed"
          spellCheck={false}
        />
        <div className="absolute bottom-3 right-3 text-xs text-admin-muted-2">
          {body.length.toLocaleString()}자
        </div>
      </div>

      {/* 버전 히스토리 */}
      <div>
        <h2 className="text-sm font-bold text-admin-text-2 mb-3">버전 히스토리</h2>
        {versions.length === 0 ? (
          <p className="text-admin-muted-2 text-sm">버전 없음</p>
        ) : (
          <div className="overflow-x-auto rounded-admin-md border border-admin-border-mid">
            <table className="min-w-full text-sm">
              <thead className="bg-admin-bg border-b border-admin-border-mid">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold text-admin-text-2">버전</th>
                  <th className="text-left px-4 py-2 font-semibold text-admin-text-2">수정일</th>
                  <th className="text-left px-4 py-2 font-semibold text-admin-text-2">작성자</th>
                  <th className="text-left px-4 py-2 font-semibold text-admin-text-2">메모</th>
                  <th className="px-4 py-2 font-semibold text-admin-text-2">상태</th>
                  <th className="px-4 py-2">
                    <span className="sr-only">작업</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {versions.map(v => (
                  <tr key={v.id} className={v.is_active ? 'bg-green-50' : 'hover:bg-admin-bg'}>
                    <td className="px-4 py-2 font-mono text-admin-text-2 font-medium">v{v.version}</td>
                    <td className="px-4 py-2 text-admin-muted text-xs whitespace-nowrap">
                      {fmtDateTime(v.created_at)}
                    </td>
                    <td className="px-4 py-2 text-admin-muted text-xs">{v.created_by ?? '—'}</td>
                    <td className="px-4 py-2 text-admin-muted max-w-xs truncate text-xs">
                      {v.change_note ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {v.is_active ? (
                        <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded font-medium">
                          현재
                        </span>
                      ) : (
                        <span className="bg-admin-surface-2 text-admin-muted text-xs px-2 py-0.5 rounded">
                          비활성
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {!v.is_active && (
                        <button
                          type="button"
                          onClick={() => setRollbackTarget(v)}
                          disabled={rollingBack === v.version}
                          aria-haspopup="dialog"
                          aria-expanded={rollbackTarget?.version === v.version}
                          aria-controls="prompt-rollback-confirm-dialog"
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium disabled:opacity-50"
                        >
                          {rollingBack === v.version ? '처리 중...' : '롤백'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rollbackTarget && (
        <div className="fixed inset-0 z-[60] flex h-dvh items-center justify-center overflow-y-auto px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            aria-label="프롬프트 롤백 확인 닫기"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => setRollbackTarget(null)}
          />
          <div
            id="prompt-rollback-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prompt-rollback-confirm-title"
            aria-describedby="prompt-rollback-confirm-description prompt-rollback-confirm-summary"
            className="relative w-full max-w-md rounded-admin-md border border-blue-100 bg-white p-5 shadow-admin-lg"
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Prompt rollback</p>
              <h2 id="prompt-rollback-confirm-title" className="text-lg font-bold text-admin-text">
                v{rollbackTarget.version}으로 롤백할까요?
              </h2>
              <p id="prompt-rollback-confirm-description" className="text-sm leading-6 text-admin-muted">
                현재 활성 버전은 비활성화되고, 선택한 버전이 새 활성 버전으로 복원됩니다.
              </p>
            </div>

            <dl
              id="prompt-rollback-confirm-summary"
              className="mt-4 grid grid-cols-1 gap-2 rounded-admin-sm bg-blue-50 p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">key</dt>
                <dd className="max-w-[13rem] truncate font-mono text-xs font-semibold text-admin-text">{decodedKey}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">현재</dt>
                <dd className="font-semibold text-admin-text">v{active?.version ?? '-'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">대상</dt>
                <dd className="font-semibold text-admin-text">v{rollbackTarget.version}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">작성일</dt>
                <dd className="font-semibold text-admin-text">{fmtDateTime(rollbackTarget.created_at)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">메모</dt>
                <dd className="max-w-[13rem] truncate font-semibold text-admin-text">{rollbackTarget.change_note ?? '-'}</dd>
              </div>
            </dl>

            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={rollbackCancelRef}
                type="button"
                onClick={() => setRollbackTarget(null)}
                className="rounded-admin-sm border border-admin-border bg-white px-4 py-2 text-sm font-medium text-admin-text hover:bg-admin-surface-2"
              >
                다시 확인
              </button>
              <button
                type="button"
                onClick={() => handleRollback(rollbackTarget.version)}
                disabled={rollingBack === rollbackTarget.version}
                className="rounded-admin-sm bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {rollingBack === rollbackTarget.version ? '처리 중...' : '롤백'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
