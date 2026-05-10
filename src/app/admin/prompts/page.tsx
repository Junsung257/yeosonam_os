'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { PageHeader, FilterBar } from '@/components/admin/patterns';
import { fmtMonthDayTime } from '@/lib/admin-utils';
import Button from '@/components/ui/Button';
import { RefreshCw } from 'lucide-react';

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
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="프롬프트 레지스트리"
        subtitle="AI 시스템 프롬프트를 코드 배포 없이 편집·버전 관리·즉시 롤백합니다."
      />

      <FilterBar
        right={
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw size={14} />
            새로고침
          </Button>
        }
      >
        <select
          value={filterTask}
          onChange={e => setFilterTask(e.target.value)}
          className="h-8 border border-admin-border-mid rounded-admin-sm px-2.5 text-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
        >
          <option value="">전체 task_type</option>
          {taskTypes.map(t => (
            <option key={t} value={t}>{TASK_TYPE_LABELS[t] ?? t}</option>
          ))}
        </select>
        <span className="text-admin-sm text-admin-muted">
          총 <b className="admin-num text-admin-text">{filtered.length}</b>건
        </span>
      </FilterBar>

      {loading ? (
        <div className="admin-card overflow-hidden divide-y divide-admin-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-40" />
              <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse flex-1" />
              <div className="h-4 bg-admin-surface-2 rounded-full animate-pulse w-14" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-admin-muted text-admin-sm py-12 text-center bg-admin-surface rounded-admin-md border border-admin-border-mid">
          프롬프트 없음. Supabase migration 적용 후 시드 데이터를 확인하세요.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>KEY</th>
                <th>TASK</th>
                <th>VER</th>
                <th>최종 메모</th>
                <th>수정일</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id}>
                  <td className="font-mono text-admin-text font-medium">{p.key}</td>
                  <td>
                    {p.task_type ? (
                      <span className="bg-brand-light text-brand text-admin-2xs px-2 py-0.5 rounded-admin-xs font-semibold uppercase tracking-wider">
                        {TASK_TYPE_LABELS[p.task_type] ?? p.task_type}
                      </span>
                    ) : (
                      <span className="text-admin-muted-2">—</span>
                    )}
                  </td>
                  <td>
                    <span className="bg-admin-surface-2 text-admin-text-2 text-admin-xs px-2 py-0.5 rounded-admin-xs font-mono admin-num">
                      v{p.version}
                    </span>
                  </td>
                  <td className="text-admin-muted max-w-xs truncate">
                    {p.change_note ?? '—'}
                  </td>
                  <td className="text-admin-muted-2 text-admin-xs whitespace-nowrap admin-num">
                    {fmtMonthDayTime(p.created_at)}
                  </td>
                  <td>
                    <Link
                      href={`/admin/prompts/${encodeURIComponent(p.key)}`}
                      className="text-brand hover:text-brand-dark font-medium text-admin-xs"
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
