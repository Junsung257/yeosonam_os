'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';

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

export default function PromptEditPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const decodedKey = decodeURIComponent(key);

  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [invalidating, setInvalidating] = useState(false);
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

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
    if (!confirm(`v${version}으로 롤백하시겠습니까? 현재 버전은 비활성화됩니다.`)) return;
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
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '롤백 실패', 'err');
    } finally {
      setRollingBack(null);
    }
  }

  if (loading) {
    return <div className="p-6 text-slate-400 text-sm">불러오는 중...</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* 토스트 */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white transition-all ${toast.type === 'ok' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/prompts" className="text-slate-400 hover:text-slate-700 text-sm">
          ← 목록
        </Link>
        <span className="text-slate-300">/</span>
        <h1 className="text-xl font-extrabold text-slate-900 font-mono">{decodedKey}</h1>
        {active && (
          <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded font-mono">
            v{active.version} 활성
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button
            onClick={handleInvalidate}
            disabled={invalidating}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
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
        <div className="flex gap-4 text-xs text-slate-500 mb-4">
          {active.task_type && <span>task: <strong>{active.task_type}</strong></span>}
          <span>마지막 수정: {new Date(active.created_at).toLocaleString('ko-KR')}</span>
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
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>

      {/* 프롬프트 편집 textarea */}
      <div className="relative mb-6">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={30}
          className="w-full font-mono text-sm border border-slate-200 rounded-lg px-4 py-3 resize-y focus:outline-none focus:ring-2 focus:ring-slate-400 bg-slate-50 leading-relaxed"
          spellCheck={false}
        />
        <div className="absolute bottom-3 right-3 text-xs text-slate-400">
          {body.length.toLocaleString()}자
        </div>
      </div>

      {/* 버전 히스토리 */}
      <div>
        <h2 className="text-sm font-bold text-slate-700 mb-3">버전 히스토리</h2>
        {versions.length === 0 ? (
          <p className="text-slate-400 text-sm">버전 없음</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold text-slate-700">버전</th>
                  <th className="text-left px-4 py-2 font-semibold text-slate-700">수정일</th>
                  <th className="text-left px-4 py-2 font-semibold text-slate-700">작성자</th>
                  <th className="text-left px-4 py-2 font-semibold text-slate-700">메모</th>
                  <th className="px-4 py-2 font-semibold text-slate-700">상태</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {versions.map(v => (
                  <tr key={v.id} className={v.is_active ? 'bg-green-50' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-2 font-mono text-slate-700 font-medium">v{v.version}</td>
                    <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">
                      {new Date(v.created_at).toLocaleString('ko-KR')}
                    </td>
                    <td className="px-4 py-2 text-slate-500 text-xs">{v.created_by ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-500 max-w-xs truncate text-xs">
                      {v.change_note ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {v.is_active ? (
                        <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded font-medium">
                          현재
                        </span>
                      ) : (
                        <span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded">
                          비활성
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {!v.is_active && (
                        <button
                          onClick={() => handleRollback(v.version)}
                          disabled={rollingBack === v.version}
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
    </div>
  );
}
