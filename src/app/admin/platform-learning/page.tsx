'use client';

import { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { fmtDateTime } from '@/lib/admin-utils';
import { RefreshCw } from 'lucide-react';

type Row = {
  id: string;
  created_at: string;
  source: string;
  session_id: string | null;
  tenant_id: string | null;
  affiliate_id: string | null;
  message_sha256: string | null;
  message_redacted: string | null;
  payload: Record<string, unknown>;
  consent_flags: Record<string, unknown>;
};

export default function PlatformLearningPage() {
  const [events, setEvents] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 40;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (source) q.set('source', source);
      const res = await fetch(`/api/admin/platform-learning?${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '로드 실패');
      setEvents(json.events ?? []);
      setTotal(json.total ?? 0);
      setNotice(json.notice ?? null);
    } catch {
      setEvents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [offset, source]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="AI 플라이휠 이벤트"
        subtitle={
          <>QA 채팅·자비스 턴마다 적재되는 구조 신호. 원문은 해시만 저장하며 <code className="text-admin-2xs bg-admin-surface-2 px-1.5 py-0.5 rounded-admin-xs font-mono">PLATFORM_LEARNING_STORE_REDACTED_MESSAGE=true</code> 일 때 마스킹 전문이 함께 저장됩니다.</>
        }
      />
      {notice && (
        <p className="text-status-warningFg text-admin-sm mb-4 bg-status-warningBg border border-warning/20 rounded-admin-sm px-3 py-2">{notice}</p>
      )}

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <select
          value={source}
          onChange={(e) => {
            setOffset(0);
            setSource(e.target.value);
          }}
          className="h-9 border border-admin-border-mid rounded-admin-sm px-2.5 text-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
        >
          <option value="">전체 소스</option>
          <option value="qa_chat">qa_chat</option>
          <option value="qa_escalation_cta">qa_escalation_cta</option>
          <option value="jarvis_v1">jarvis_v1</option>
          <option value="jarvis_v2_stream">jarvis_v2_stream</option>
        </select>
        <span className="text-admin-sm text-admin-muted">총 <b className="admin-num text-admin-text">{total.toLocaleString()}</b>건</span>
        <Button variant="secondary" size="sm" onClick={() => load()}>
          <RefreshCw size={14} />
          새로고침
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-3 flex items-center gap-3">
              <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse flex-1" />
              <div className="h-4 bg-admin-surface-2 rounded-full animate-pulse w-20" />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <p className="text-admin-muted text-admin-sm py-8 text-center">데이터가 없거나 테이블이 아직 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {events.map((ev) => (
            <div key={ev.id} className="admin-card p-4 text-admin-sm">
              <div className="flex flex-wrap gap-2 text-admin-xs text-admin-muted mb-2">
                <span className="font-mono text-admin-text-2 font-semibold">{ev.source}</span>
                <span>{fmtDateTime(ev.created_at)}</span>
                {ev.tenant_id && <span className="font-mono">tenant: {ev.tenant_id.slice(0, 8)}…</span>}
                {ev.affiliate_id && <span className="font-mono">affiliate: {ev.affiliate_id.slice(0, 8)}…</span>}
                {ev.message_sha256 && (
                  <span className="truncate max-w-[200px] font-mono" title={ev.message_sha256}>
                    sha256: {ev.message_sha256.slice(0, 12)}…
                  </span>
                )}
              </div>
              {ev.message_redacted && (
                <p className="text-admin-text-2 text-admin-xs mb-2 whitespace-pre-wrap border-l-2 border-brand-light pl-2">
                  {ev.message_redacted}
                </p>
              )}
              <pre className="text-[11px] bg-admin-surface-2 rounded-admin-sm p-2 overflow-x-auto text-admin-text-2 font-mono">
                {JSON.stringify(ev.payload, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        {total > offset + limit && (
          <Button variant="ghost" size="sm" onClick={() => setOffset((o) => o + limit)}>
            더 보기 (다음 {limit}건)
          </Button>
        )}
        {offset > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setOffset((o) => Math.max(0, o - limit))}>
            이전 페이지
          </Button>
        )}
      </div>
    </div>
  );
}
