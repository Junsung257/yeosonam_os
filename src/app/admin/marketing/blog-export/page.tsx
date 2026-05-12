'use client';

import { useEffect, useState, useCallback } from 'react';
import { fmtDateISO } from '@/lib/admin-utils';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { RefreshCw, ExternalLink, Copy, Check, Inbox } from 'lucide-react';

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
    <div className="max-w-4xl mx-auto space-y-5">
      <PageHeader
        title="네이버 블로그 발행"
        subtitle="발행 준비된 블로그 목록 — 복사 후 네이버 블로그에 직접 붙여넣기"
        actions={
          <Button variant="secondary" size="sm" onClick={fetchDrafts}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            새로고침
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-admin-surface-2 rounded-admin-md animate-pulse" />
          ))}
        </div>
      ) : drafts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 admin-card">
          <div className="w-12 h-12 rounded-full bg-admin-surface-2 flex items-center justify-center text-admin-muted">
            <Inbox size={20} strokeWidth={1.75} />
          </div>
          <p className="text-admin-sm font-medium text-admin-muted">발행 대기 중인 블로그 글이 없습니다</p>
        </div>
      ) : (
        <div className="space-y-2">
          {drafts.map((draft) => (
            <div
              key={draft.id}
              className="admin-card p-4 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-admin-text truncate">
                    {draft.seo_title ?? '(제목 없음)'}
                  </p>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {draft.readability_score != null && (
                      <span className="text-admin-xs text-admin-muted">
                        가독성 <span className="admin-num font-semibold">{draft.readability_score}</span>점
                      </span>
                    )}
                    {draft.angle_type && (
                      <span className="text-admin-2xs bg-brand-light text-brand px-2 py-0.5 rounded-admin-xs font-semibold uppercase">
                        {draft.angle_type}
                      </span>
                    )}
                    <span className="text-admin-xs text-admin-muted-2 admin-num">
                      {fmtDateISO(draft.created_at)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => copyToClipboard(draft)}
                    className={copied[draft.id] ? '!bg-status-successBg !text-status-successFg !border-success/30' : ''}
                  >
                    {copied[draft.id] ? <><Check size={14} />복사 완료</> : <><Copy size={14} />클립보드 복사</>}
                  </Button>

                  <a
                    href={NAVER_BLOG_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-admin-sm text-admin-sm font-medium bg-success text-white hover:opacity-90 transition-opacity"
                  >
                    <ExternalLink size={14} />
                    네이버 블로그 열기
                  </a>
                </div>
              </div>

              <div className="flex items-center gap-2 border-t border-admin-border pt-3">
                <input
                  type="checkbox"
                  id={`done-${draft.id}`}
                  checked={marking[draft.id] ?? false}
                  onChange={() => markManuallyPublished(draft)}
                  disabled={marking[draft.id]}
                  className="w-4 h-4 rounded accent-brand cursor-pointer"
                />
                <label
                  htmlFor={`done-${draft.id}`}
                  className="text-admin-xs text-admin-muted cursor-pointer select-none"
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
