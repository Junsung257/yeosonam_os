'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { ArrowLeft, Settings, Plus, Calendar, Flame, PenLine, Archive } from 'lucide-react';

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
  primary_keyword: string | null;
  keyword_tier: 'head' | 'mid' | 'longtail' | null;
  monthly_search_volume: number | null;
  competition_level: 'low' | 'medium' | 'high' | null;
  trend_score: number | null;
  meta?: { search_intent?: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-admin-surface-2 text-admin-muted',
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
  trend: '🔥 트렌드',
  pillar: '🏛️ 필러',
  card_news: '🖼️ 카드뉴스',
  programmatic_seo: '🔎 pSEO',
  auto_heal: '🛠️ 자동복구',
};

const TIER_BADGES: Record<string, { label: string; cls: string }> = {
  head:     { label: 'HEAD',     cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  mid:      { label: 'MID',      cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  longtail: { label: 'LONGTAIL', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

const STATUS_TABS = [
  { key: 'all', label: '전체' },
  { key: 'queued', label: '대기' },
  { key: 'generating', label: '생성중' },
  { key: 'published', label: '발행' },
  { key: 'failed', label: '실패' },
];

interface BlogQueueClientProps {
  initialItems?: QueueItem[];
  initialCounts?: Record<string, number>;
}

export default function BlogQueuePage({ initialItems, initialCounts }: BlogQueueClientProps = {}) {
  const [items, setItems] = useState<QueueItem[]>(initialItems ?? []);
  const [counts, setCounts] = useState<Record<string, number>>(initialCounts ?? {});
  const [loading, setLoading] = useState(!initialItems);
  const [tab, setTab] = useState('all');
  const [running, setRunning] = useState<string | null>(null);
  const _skipInitialFetch = useRef(!!initialItems);

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

  useEffect(() => {
    if (_skipInitialFetch.current) {
      _skipInitialFetch.current = false;
      return;
    }
    fetchItems();
  }, [fetchItems]);

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
    <div className="space-y-5">
      <PageHeader
        title="자동 발행 큐"
        subtitle="시즌 · 커버리지 갭 · 상품 기반 자동 토픽 생성 및 예약 발행"
        actions={
          <>
            <Link href="/admin/blog/system">
              <Button variant="secondary" size="sm">
                <Settings size={14} />
                시스템·크론
              </Button>
            </Link>
            <Link href="/admin/blog">
              <Button variant="secondary" size="sm">
                <ArrowLeft size={14} />
                블로그 목록
              </Button>
            </Link>
            <Button variant="primary" size="sm" onClick={() => setSeedOpen(!seedOpen)}>
              <Plus size={14} />
              토픽 수동 추가
            </Button>
          </>
        }
      />

      {/* 수동 시드 */}
      {seedOpen && (
        <div className="admin-card border-brand/20 p-3 space-y-2">
          <input
            value={seedTopic}
            onChange={e => setSeedTopic(e.target.value)}
            placeholder="토픽 (예: 6월 다낭 비 오는 날 실내 코스)"
            className="w-full h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
          <div className="flex gap-2">
            <input
              value={seedDest}
              onChange={e => setSeedDest(e.target.value)}
              placeholder="목적지 (선택)"
              className="flex-1 h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
            />
            <Button variant="primary" onClick={addSeed}>
              추가 (priority 95)
            </Button>
          </div>
        </div>
      )}

      {/* 컨트롤 패널 */}
      <div className="grid grid-cols-4 gap-2">
        {([
          ['run_scheduler', '스케줄러', '큐 충전 + 슬롯', Calendar],
          ['run_trend_miner', '트렌드 마이너', '최신 검색 트렌드', Flame],
          ['run_publisher', '발행자', '지금 발행 처리', PenLine],
          ['run_lifecycle', '라이프사이클', '만료 글 아카이브', Archive],
        ] as const).map(([action, label, desc, Icon]) => (
          <button
            key={action}
            onClick={() => trigger(action)}
            disabled={running !== null}
            className="px-3 py-3 admin-card text-left text-admin-xs hover:border-admin-border-strong disabled:opacity-50 transition-colors"
          >
            <span className="inline-flex items-center gap-1.5 font-semibold text-admin-text">
              <Icon size={14} className="text-brand" />
              {running === action ? '실행중…' : label}
            </span>
            <p className="text-admin-2xs text-admin-muted mt-1">{desc}</p>
          </button>
        ))}
      </div>

      {/* 카운트 요약 */}
      <div className="flex items-center gap-3 admin-card p-3 text-admin-sm">
        <span><span className="text-admin-muted">대기</span> <b className="admin-num text-admin-text">{counts.queued ?? 0}</b></span>
        <span className="text-admin-border-mid">·</span>
        <span><span className="text-admin-muted">생성중</span> <b className="text-brand admin-num">{counts.generating ?? 0}</b></span>
        <span className="text-admin-border-mid">·</span>
        <span><span className="text-admin-muted">발행</span> <b className="text-success admin-num">{counts.published ?? 0}</b></span>
        <span className="text-admin-border-mid">·</span>
        <span><span className="text-admin-muted">실패</span> <b className="text-danger admin-num">{counts.failed ?? 0}</b></span>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-admin-surface-2 rounded-admin-sm p-1 w-fit">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 h-8 text-admin-sm font-medium rounded-admin-xs transition-colors ${
              tab === t.key ? 'bg-admin-surface text-admin-text shadow-admin-xs' : 'text-admin-muted hover:text-admin-text-2'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="text-center py-12 text-admin-muted text-admin-sm">로딩…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-admin-muted text-admin-sm admin-card">
          큐에 항목이 없습니다. 스케줄러를 실행해서 토픽을 채워보세요.
        </div>
      ) : (
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th style={{ width: 96 }}>소스</th>
                <th>토픽</th>
                <th style={{ width: 80 }}>목적지</th>
                <th className="text-center" style={{ width: 48 }}>우선</th>
                <th style={{ width: 128 }}>발행 예정</th>
                <th style={{ width: 80 }}>상태</th>
                <th style={{ width: 64 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <td className="text-admin-xs text-admin-muted">
                    {SOURCE_LABELS[it.source] || it.source}
                  </td>
                  <td>
                    <p className="text-admin-sm text-admin-text truncate max-w-md">{it.topic}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {it.keyword_tier && TIER_BADGES[it.keyword_tier] && (
                        <span className={`px-1.5 py-0.5 text-[9px] rounded-admin-xs border font-mono font-bold ${TIER_BADGES[it.keyword_tier].cls}`}>
                          {TIER_BADGES[it.keyword_tier].label}
                        </span>
                      )}
                      {it.primary_keyword && (
                        <span className="text-admin-2xs text-admin-muted">🔑 {it.primary_keyword}</span>
                      )}
                      {it.monthly_search_volume != null && it.monthly_search_volume > 0 && (
                        <span className="text-admin-2xs text-admin-muted-2 admin-num">
                          {it.monthly_search_volume.toLocaleString()}/mo
                        </span>
                      )}
                      {it.trend_score != null && it.trend_score > 0 && (
                        <span className="text-admin-2xs text-warning font-mono admin-num">
                          🔥 {it.trend_score}
                        </span>
                      )}
                      {it.meta?.search_intent && (
                        <span className="text-admin-2xs text-brand">
                          의도 {it.meta.search_intent}
                        </span>
                      )}
                    </div>
                    {it.last_error && (
                      <p className="text-admin-2xs text-danger truncate mt-0.5">⚠ {it.last_error}</p>
                    )}
                  </td>
                  <td className="text-admin-xs text-admin-muted">{it.destination || '—'}</td>
                  <td className="text-center text-admin-xs font-mono text-admin-muted admin-num">{it.priority}</td>
                  <td className="text-admin-xs text-admin-muted font-mono admin-num">
                    {it.target_publish_at
                      ? it.target_publish_at.slice(5, 16).replace('T', ' ')
                      : '—'}
                  </td>
                  <td>
                    <span className={`px-2 py-0.5 text-admin-2xs rounded-admin-xs font-semibold ${STATUS_COLORS[it.status] || 'bg-admin-surface-2 text-admin-muted'}`}>
                      {it.status}
                    </span>
                  </td>
                  <td className="text-right">
                    {it.content_creative_id ? (
                      <Link href={`/admin/blog/${it.content_creative_id}`} className="text-admin-xs text-brand hover:text-brand-dark hover:underline font-medium">
                        보기
                      </Link>
                    ) : (
                      <button
                        onClick={() => removeItem(it.id)}
                        className="text-admin-xs text-danger hover:underline font-medium"
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
