'use client';

import { useEffect, useState, useCallback } from 'react';

interface BlogDraft {
  id: string;
  seo_title: string | null;
  readability_score: number | null;
  created_at: string;
  slug: string | null;
  blog_html: string | null;
  angle_type: string | null;
  status: string;
  manually_published?: boolean; // local state
}

const NAVER_BLOG_URL = 'https://blog.naver.com/PostWriteForm.naver';

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi, '## $1\n\n')
    .replace(/<h[4-6][^>]*>(.*?)<\/h[4-6]>/gi, '### $1\n\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function BlogExportPage() {
  const [drafts, setDrafts] = useState<BlogDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const [marking, setMarking] = useState<Record<string, boolean>>({});

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        '/api/admin/content-hub?type=blog&status=DRAFT&limit=50',
      );
      const json = await res.json();
      setDrafts(
        (json.data ?? []).filter((d: BlogDraft) => d.blog_html),
      );
    } catch {
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDrafts();
  }, [fetchDrafts]);

  async function copyToClipboard(draft: BlogDraft) {
    const text = draft.blog_html ? htmlToMarkdown(draft.blog_html) : '';
    try {
      await navigator.clipboard.writeText(text);
      setCopied((prev) => ({ ...prev, [draft.id]: true }));
      setTimeout(() => setCopied((prev) => ({ ...prev, [draft.id]: false })), 2500);
    } catch {
      alert('클립보드 복사 실패. 브라우저 권한을 확인해주세요.');
    }
  }

  async function markManuallyPublished(draft: BlogDraft) {
    setMarking((prev) => ({ ...prev, [draft.id]: true }));
    try {
      const res = await fetch('/api/content-hub/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creative_id: draft.id, action: 'manually_published' }),
      });
      if (!res.ok) throw new Error('API 오류');
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
    } catch {
      alert('상태 업데이트 실패');
    } finally {
      setMarking((prev) => ({ ...prev, [draft.id]: false }));
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">네이버 블로그 발행</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            발행 준비된 블로그 목록 — 복사 후 네이버 블로그에 직접 붙여넣기
          </p>
        </div>
        <button
          onClick={fetchDrafts}
          className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
        >
          새로고침
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : drafts.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-sm text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
          발행 대기 중인 블로그 글이 없습니다
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((draft) => (
            <div
              key={draft.id}
              className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 truncate">
                    {draft.seo_title ?? '(제목 없음)'}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    {draft.readability_score != null && (
                      <span className="text-xs text-slate-500">
                        가독성 {draft.readability_score}점
                      </span>
                    )}
                    {draft.angle_type && (
                      <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">
                        {draft.angle_type}
                      </span>
                    )}
                    <span className="text-xs text-slate-400">
                      {new Date(draft.created_at).toLocaleDateString('ko-KR')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => copyToClipboard(draft)}
                    className={[
                      'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      copied[draft.id]
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                    ].join(' ')}
                  >
                    {copied[draft.id] ? '복사 완료!' : '클립보드 복사'}
                  </button>

                  <a
                    href={NAVER_BLOG_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-700 transition-colors"
                  >
                    네이버 블로그 열기
                  </a>
                </div>
              </div>

              <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
                <input
                  type="checkbox"
                  id={`done-${draft.id}`}
                  checked={marking[draft.id] ?? false}
                  onChange={() => markManuallyPublished(draft)}
                  disabled={marking[draft.id]}
                  className="w-4 h-4 rounded accent-indigo-600 cursor-pointer"
                />
                <label
                  htmlFor={`done-${draft.id}`}
                  className="text-xs text-slate-500 cursor-pointer select-none"
                >
                  네이버 블로그에 직접 발행 완료 — 체크 시 목록에서 제거됩니다
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
