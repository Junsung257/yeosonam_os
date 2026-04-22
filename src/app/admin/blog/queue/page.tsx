'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface QueueItem {
  id: string;
  topic: string;
  source: string;
  priority: number;
  destination: string | null;
  angle_type: string | null;
  category: string | null;
  target_publish_at: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  content_creative_id: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-slate-100 text-slate-600',
  generating: 'bg-blue-100 text-blue-700',
  published: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
  skipped: 'bg-amber-50 text-amber-600',
};

const SOURCE_LABELS: Record<string, string> = {
  seasonal: '🗓️ 시즌',
  coverage_gap: '🧩 갭 분석',
  user_seed: '👤 수동',
  product: '🧳 상품',
};

const STATUS_TABS = [
  { key: 'all', label: '전체' },
  { key: 'queued', label: '대기' },
  { key: 'generating', label: '생성중' },
  { key: 'published', label: '발행' },
  { key: 'failed', label: '실패' },
];

export default function BlogQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [running, setRunning] = useState<string | null>(null);

  // 수동 시드
  const [seedOpen, setSeedOpen] = useState(false);
  const [seedTopic, setSeedTopic] = useState('');
  const [seedDest, setSeedDest] = useState('');

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '200' });
    if (tab !== 'all') params.set('status', tab);
    const res = await fetch(`/api/blog/queue?${params}`);
    const data = await res.json();
    setItems(data.items || []);
    setCounts(data.counts || {});
    setLoading(false);
  }, [tab]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const trigger = async (action: string) => {
    setRunning(action);
    try {
      const res = await fetch('/api/blog/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      alert(`${action} 완료\n\n` + JSON.stringify(data.result, null, 2).slice(0, 800));
      fetchItems();
    } catch (e) {
      alert('실행 실패: ' + (e as Error).message);
    } finally {
      setRunning(null);
    }
  };

  const addSeed = async () => {
    if (!seedTopic.trim()) return;
    await fetch('/api/blog/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add_topic',
        topic: seedTopic.trim(),
        destination: seedDest.trim() || null,
        priority: 95,
      }),
    });
    setSeedTopic('');
    setSeedDest('');
    setSeedOpen(false);
    fetchItems();
  };

  const removeItem = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    await fetch(`/api/blog/queue?id=${id}`, { method: 'DELETE' });
    fetchItems();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-slate-800">자동 발행 큐</h1>
          <p className="text-[12px] text-slate-400 mt-0.5">
            시즌 · 커버리지 갭 · 상품 기반 자동 토픽 생성 및 예약 발행
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/blog" className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-[12px] rounded-lg hover:bg-slate-50">
            ← 블로그 목록
          </Link>
          <button
            onClick={() => setSeedOpen(!seedOpen)}
            className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-[12px] rounded-lg hover:bg-slate-50"
          >
            + 토픽 수동 추가
          </button>
        </div>
      </div>

      {/* 수동 시드 */}
      {seedOpen && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-2">
          <input
            value={seedTopic}
            onChange={e => setSeedTopic(e.target.value)}
            placeholder="토픽 (예: 6월 다낭 비 오는 날 실내 코스)"
            className="w-full px-3 py-2 text-[13px] border border-slate-300 rounded bg-white"
          />
          <div className="flex gap-2">
            <input
              value={seedDest}
              onChange={e => setSeedDest(e.target.value)}
              placeholder="목적지 (선택)"
              className="flex-1 px-3 py-2 text-[13px] border border-slate-300 rounded bg-white"
            />
            <button onClick={addSeed} className="px-4 py-2 bg-indigo-600 text-white text-[13px] rounded font-semibold">
              추가 (priority 95)
            </button>
          </div>
        </div>
      )}

      {/* 컨트롤 패널 */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => trigger('run_scheduler')}
          disabled={running !== null}
          className="px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-[12px] hover:bg-slate-50 disabled:opacity-50"
        >
          {running === 'run_scheduler' ? '실행중...' : '🗓️ 스케줄러 즉시 실행'}
          <p className="text-[10px] text-slate-400 mt-0.5">큐 충전 + 슬롯 배정</p>
        </button>
        <button
          onClick={() => trigger('run_publisher')}
          disabled={running !== null}
          className="px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-[12px] hover:bg-slate-50 disabled:opacity-50"
        >
          {running === 'run_publisher' ? '실행중...' : '✍️ 발행자 즉시 실행'}
          <p className="text-[10px] text-slate-400 mt-0.5">지금 발행 대상 처리</p>
        </button>
        <button
          onClick={() => trigger('run_lifecycle')}
          disabled={running !== null}
          className="px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-[12px] hover:bg-slate-50 disabled:opacity-50"
        >
          {running === 'run_lifecycle' ? '실행중...' : '🗄️ 라이프사이클'}
          <p className="text-[10px] text-slate-400 mt-0.5">만료 상품 글 아카이브</p>
        </button>
      </div>

      {/* 카운트 요약 */}
      <div className="flex gap-2 bg-white border border-slate-200 rounded-lg p-3 text-[12px]">
        <span><span className="text-slate-400">대기</span> <b>{counts.queued ?? 0}</b></span>
        <span className="text-slate-200">·</span>
        <span><span className="text-slate-400">생성중</span> <b className="text-blue-600">{counts.generating ?? 0}</b></span>
        <span className="text-slate-200">·</span>
        <span><span className="text-slate-400">발행</span> <b className="text-emerald-600">{counts.published ?? 0}</b></span>
        <span className="text-slate-200">·</span>
        <span><span className="text-slate-400">실패</span> <b className="text-rose-600">{counts.failed ?? 0}</b></span>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition ${
              tab === t.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-[13px]">로딩...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-[13px]">
          큐에 항목이 없습니다. 스케줄러를 실행해서 토픽을 채워보세요.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-3 py-2 text-[11px] text-slate-500 font-medium w-24">소스</th>
                <th className="text-left px-3 py-2 text-[11px] text-slate-500 font-medium">토픽</th>
                <th className="text-left px-3 py-2 text-[11px] text-slate-500 font-medium w-20">목적지</th>
                <th className="text-center px-2 py-2 text-[11px] text-slate-500 font-medium w-12">우선</th>
                <th className="text-left px-3 py-2 text-[11px] text-slate-500 font-medium w-32">발행 예정</th>
                <th className="text-left px-3 py-2 text-[11px] text-slate-500 font-medium w-20">상태</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5 text-[11px] text-slate-600">
                    {SOURCE_LABELS[it.source] || it.source}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="text-[12px] text-slate-800 truncate max-w-md">{it.topic}</p>
                    {it.last_error && (
                      <p className="text-[10px] text-rose-600 truncate mt-0.5">⚠ {it.last_error}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-slate-500">{it.destination || '-'}</td>
                  <td className="px-2 py-2.5 text-center text-[11px] font-mono text-slate-600">{it.priority}</td>
                  <td className="px-3 py-2.5 text-[11px] text-slate-500 font-mono">
                    {it.target_publish_at
                      ? new Date(it.target_publish_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : '-'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${STATUS_COLORS[it.status] || 'bg-slate-100 text-slate-500'}`}>
                      {it.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {it.content_creative_id ? (
                      <Link href={`/admin/blog/${it.content_creative_id}`} className="text-[11px] text-blue-600 hover:underline">
                        보기
                      </Link>
                    ) : (
                      <button
                        onClick={() => removeItem(it.id)}
                        className="text-[11px] text-rose-500 hover:underline"
                      >
                        제거
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
  );
}
