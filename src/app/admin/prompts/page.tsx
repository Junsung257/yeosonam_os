'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface PromptRow {
  id: string;
  key: string;
  version: number;
  is_active: boolean;
  task_type: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
  change_note: string | null;
}

const TASK_TYPE_LABELS: Record<string, string> = {
  'normalize-simple': '정규화',
  'normalize-complex': '정규화(복잡)',
  'jarvis-simple': '자비스',
  'jarvis-complex': '자비스(복잡)',
  'card-news': '카드뉴스',
  'blog-generate': '블로그',
  'qa-chat': 'QA 챗',
  'free-travel-extract': '자유여행',
  'concierge-search': '콘시어지',
};

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTask, setFilterTask] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/prompts');
    const json = await res.json();
    setPrompts(json.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = filterTask
    ? prompts.filter(p => p.task_type === filterTask)
    : prompts;

  const taskTypes = Array.from(new Set(prompts.map(p => p.task_type).filter(Boolean))) as string[];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">프롬프트 레지스트리</h1>
          <p className="text-sm text-slate-500 mt-1">
            AI 시스템 프롬프트를 코드 배포 없이 편집·버전 관리·즉시 롤백합니다.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4 p-3 bg-slate-50 rounded-lg">
        <select
          value={filterTask}
          onChange={e => setFilterTask(e.target.value)}
          className="border border-slate-200 rounded px-2 py-1 text-sm"
        >
          <option value="">전체 task_type</option>
          {taskTypes.map(t => (
            <option key={t} value={t}>{TASK_TYPE_LABELS[t] ?? t}</option>
          ))}
        </select>
        <button
          onClick={load}
          className="ml-auto text-sm text-slate-500 hover:text-slate-800 underline"
        >
          새로고침
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden divide-y divide-slate-50">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-40" />
              <div className="h-3.5 bg-slate-100 rounded animate-pulse flex-1" />
              <div className="h-4 bg-slate-100 rounded-full animate-pulse w-14" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-slate-400 text-sm py-10 text-center">
          프롬프트 없음. Supabase migration 적용 후 시드 데이터를 확인하세요.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">KEY</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">TASK</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">VER</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">최종 메모</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">수정일</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-slate-900 font-medium">{p.key}</td>
                  <td className="px-4 py-3">
                    {p.task_type ? (
                      <span className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded font-medium">
                        {TASK_TYPE_LABELS[p.task_type] ?? p.task_type}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <span className="bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded font-mono">
                      v{p.version}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 max-w-xs truncate">
                    {p.change_note ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                    {new Date(p.created_at).toLocaleDateString('ko-KR', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/prompts/${encodeURIComponent(p.key)}`}
                      className="text-blue-600 hover:text-blue-800 font-medium text-xs"
                    >
                      편집
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
