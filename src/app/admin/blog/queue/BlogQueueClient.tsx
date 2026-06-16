'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Archive,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  Flame,
  ListChecks,
  PenLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { DetailDrawer, EmptyState, PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { fmtDateTime } from '@/lib/admin-utils';

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
  meta?: Record<string, unknown> | null;
  ops?: {
    attention: boolean;
    history: boolean;
    urgency: 'blocked' | 'stale' | 'overdue' | 'history' | 'normal';
    issue: string;
  };
}

interface QueueSummary {
  scope: string;
  total_rows: number;
  returned: number;
  active_count: number;
  attention_count: number;
  history_hidden: number;
  overdue_queued: number;
  stale_generating: number;
  issue_counts: Record<string, number>;
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-admin-surface-2 text-admin-muted',
  generating: 'bg-blue-100 text-blue-700',
  published: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
  skipped: 'bg-amber-50 text-amber-700',
};

const SOURCE_LABELS: Record<string, string> = {
  seasonal: '시즌',
  coverage_gap: '갭 분석',
  user_seed: '수동',
  product: '상품',
  trend: '트렌드',
  pillar: '필러',
  card_news: '카드뉴스',
  programmatic_seo: 'pSEO',
  auto_heal: '자동복구',
  gsc_longtail: 'GSC 롱테일',
};

const ISSUE_LABELS: Record<string, string> = {
  topic_fit: '주제 적합성',
  editorial_quality: '편집 품질',
  seo_score: 'SEO 점수',
  schema_constraint: 'DB 제약',
  self_heal_blocked: '자동복구 차단',
  image_quality: '이미지 품질',
  timeout: '시간초과',
  unknown_failure: '원인 미상',
  other: '기타',
  none: '정상',
};

const VIEW_TABS = [
  { key: 'active', label: '운영 필요', scope: 'active', status: 'all' },
  { key: 'attention', label: '문제', scope: 'attention', status: 'all' },
  { key: 'queued', label: '대기', scope: 'all', status: 'queued' },
  { key: 'failed', label: '실패', scope: 'all', status: 'failed' },
  { key: 'history', label: '과거/숨김', scope: 'history', status: 'all' },
  { key: 'all', label: '전체', scope: 'all', status: 'all' },
] as const;

function urgencyClass(item: QueueItem): string {
  const urgency = item.ops?.urgency;
  if (urgency === 'blocked') return 'bg-danger-light text-danger border-danger/30';
  if (urgency === 'stale' || urgency === 'overdue') return 'bg-status-warningBg text-status-warningFg border-warning/30';
  if (urgency === 'history') return 'bg-admin-surface-2 text-admin-muted border-admin-border';
  return 'bg-status-successBg text-status-successFg border-success/20';
}

function urgencyLabel(item: QueueItem): string {
  const urgency = item.ops?.urgency;
  if (urgency === 'blocked') return '차단';
  if (urgency === 'stale') return '생성 정체';
  if (urgency === 'overdue') return '발행 지연';
  if (urgency === 'history') return '과거';
  return '정상';
}

function compactError(error: string | null): string {
  if (!error) return '-';
  return error.replace(/\s+/g, ' ').slice(0, 140);
}

function jsonPreview(value: unknown): string {
  if (!value) return '-';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function BlogQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<(typeof VIEW_TABS)[number]['key']>('active');
  const [source, setSource] = useState('all');
  const [age, setAge] = useState('all');
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [actionLog, setActionLog] = useState('');
  const [selected, setSelected] = useState<QueueItem | null>(null);

  const [seedOpen, setSeedOpen] = useState(false);
  const [seedTopic, setSeedTopic] = useState('');
  const [seedDest, setSeedDest] = useState('');

  const currentView = VIEW_TABS.find((tab) => tab.key === view) || VIEW_TABS[0];

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      scope: currentView.scope,
      limit: '160',
      age,
    });
    if (currentView.status !== 'all') params.set('status', currentView.status);
    if (source !== 'all') params.set('source', source);
    if (query.trim()) params.set('q', query.trim());
    try {
      const res = await fetch(`/api/blog/queue?${params}`, { cache: 'no-store' });
      const data = await res.json();
      setItems(data.items || []);
      setCounts(data.counts || {});
      setSummary(data.summary || null);
    } finally {
      setLoading(false);
    }
  }, [age, currentView.scope, currentView.status, query, source]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const issueChips = useMemo(() => {
    const entries = Object.entries(summary?.issue_counts || {}).filter(([, value]) => value > 0);
    return entries.sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [summary]);

  const summaryCards: Array<{ label: string; value: number; hint: string; icon: LucideIcon }> = [
    { label: '운영 필요', value: summary?.active_count ?? 0, hint: '오늘 볼 큐', icon: ListChecks },
    { label: '문제', value: summary?.attention_count ?? 0, hint: '실패/지연/정체', icon: AlertTriangle },
    { label: '대기', value: counts.queued ?? 0, hint: '전체 queued', icon: Clock },
    { label: '실패', value: counts.failed ?? 0, hint: '재시도 필요', icon: AlertTriangle },
    { label: '숨김 이력', value: summary?.history_hidden ?? 0, hint: '기본 화면 제외', icon: Archive },
  ];

  async function trigger(action: string) {
    setRunning(action);
    setActionLog('');
    try {
      const res = await fetch('/api/blog/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      setActionLog(`${action} 결과\n${JSON.stringify(data.result || data, null, 2).slice(0, 3000)}`);
      await fetchItems();
    } catch (error) {
      setActionLog(`실행 실패: ${(error as Error).message}`);
    } finally {
      setRunning(null);
    }
  }

  async function addSeed() {
    if (!seedTopic.trim()) return;
    setRunning('add_topic');
    try {
      const res = await fetch('/api/blog/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_topic',
          topic: seedTopic.trim(),
          destination: seedDest.trim() || null,
          priority: 95,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSeedTopic('');
      setSeedDest('');
      setSeedOpen(false);
      setActionLog(`토픽 추가 완료\n${JSON.stringify(data.item || data, null, 2).slice(0, 1600)}`);
      await fetchItems();
    } catch (error) {
      setActionLog(`토픽 추가 실패: ${(error as Error).message}`);
    } finally {
      setRunning(null);
    }
  }

  async function patchItem(id: string, action: 'requeue' | 'hide') {
    setRunning(`${action}:${id}`);
    try {
      const res = await fetch('/api/blog/queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setActionLog(`${action === 'requeue' ? '재시도 등록' : '숨김 처리'} 완료`);
      setSelected(null);
      await fetchItems();
    } catch (error) {
      setActionLog(`처리 실패: ${(error as Error).message}`);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="블로그 발행 큐"
        subtitle="기본 화면은 오늘 운영이 필요한 항목만 보여줍니다. 발행/스킵 이력은 과거 탭에서 확인합니다."
        actions={
          <>
            <Link href="/admin/blog/system">
              <Button variant="secondary" size="sm">
                <Settings size={14} />
                시스템
              </Button>
            </Link>
            <Link href="/admin/blog">
              <Button variant="secondary" size="sm">
                <ListChecks size={14} />
                블로그 OS
              </Button>
            </Link>
            <Button variant="primary" size="sm" onClick={() => setSeedOpen((open) => !open)}>
              <Plus size={14} />
              토픽 추가
            </Button>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {summaryCards.map(({ label, value, hint, icon: Icon }) => (
          <div key={label} className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-4 shadow-admin-xs">
            <div className="flex items-start justify-between gap-3">
              <p className="text-admin-xs font-semibold uppercase tracking-wider text-admin-muted">{label}</p>
              <Icon size={15} className="text-admin-muted-2" />
            </div>
            <p className="mt-2 text-admin-display font-bold text-admin-text admin-num">{value.toLocaleString('ko-KR')}</p>
            <p className="mt-1 text-admin-xs text-admin-muted">{hint}</p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {([
          ['run_scheduler', '스케줄러', '큐 충전 + 슬롯', Calendar],
          ['run_trend_miner', '트렌드', '검색/소셜 후보', Flame],
          ['run_publisher', '발행자', '품질게이트 후 발행', PenLine],
          ['run_lifecycle', '라이프사이클', '만료/보관 처리', Archive],
        ] as const).map(([action, label, desc, Icon]) => (
          <button
            key={action}
            onClick={() => trigger(action)}
            disabled={running !== null}
            className="rounded-admin-md border border-admin-border-mid bg-admin-surface px-3 py-3 text-left text-admin-xs shadow-admin-xs transition-colors hover:border-admin-border-strong disabled:opacity-50"
          >
            <span className="inline-flex items-center gap-1.5 font-semibold text-admin-text">
              <Icon size={14} className="text-brand" />
              {running === action ? '실행 중' : label}
            </span>
            <span className="mt-1 block text-admin-2xs text-admin-muted">{desc}</span>
          </button>
        ))}
      </div>

      {actionLog && (
        <pre className="max-h-64 overflow-auto rounded-admin-md border border-admin-border-mid bg-admin-text p-3 text-admin-2xs text-admin-on-brand whitespace-pre-wrap">
          {actionLog}
        </pre>
      )}

      {seedOpen && (
        <section className="rounded-admin-md border border-brand/25 bg-admin-surface p-4 shadow-admin-xs">
          <p className="mb-3 text-admin-xs font-semibold text-admin-text-2">수동 토픽 추가</p>
          <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
            <input
              value={seedTopic}
              onChange={(event) => setSeedTopic(event.target.value)}
              placeholder="예: 다낭 7월 여행 준비물 옷차림 날씨 우기"
              className="h-9 rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 text-admin-sm text-admin-text focus:border-brand focus:outline-none focus:shadow-admin-focus"
            />
            <input
              value={seedDest}
              onChange={(event) => setSeedDest(event.target.value)}
              placeholder="목적지"
              className="h-9 rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 text-admin-sm text-admin-text focus:border-brand focus:outline-none focus:shadow-admin-focus"
            />
            <Button variant="primary" onClick={addSeed} disabled={running !== null || !seedTopic.trim()}>
              추가
            </Button>
          </div>
        </section>
      )}

      <div className="flex flex-col gap-3 rounded-admin-md border border-admin-border-mid bg-admin-surface p-3 shadow-admin-xs">
        <div className="flex flex-wrap gap-1 rounded-admin-sm bg-admin-surface-2 p-1 w-fit">
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              className={`h-8 rounded-admin-xs px-3 text-admin-sm font-medium transition-colors ${
                view === tab.key ? 'bg-admin-surface text-admin-text shadow-admin-xs' : 'text-admin-muted hover:text-admin-text-2'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-admin-muted-2" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="토픽, 목적지, 키워드, 오류 검색"
              className="h-9 w-full rounded-admin-sm border border-admin-border-mid bg-admin-surface pl-9 pr-3 text-admin-sm text-admin-text focus:border-brand focus:outline-none focus:shadow-admin-focus"
            />
          </div>
          <select value={source} onChange={(event) => setSource(event.target.value)} className="h-9 rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 text-admin-sm text-admin-text">
            <option value="all">모든 소스</option>
            {Object.entries(SOURCE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select value={age} onChange={(event) => setAge(event.target.value)} className="h-9 rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 text-admin-sm text-admin-text">
            <option value="all">전체 기간</option>
            <option value="today">오늘 생성</option>
            <option value="7d">최근 7일</option>
            <option value="30d">최근 30일</option>
            <option value="stale">오래됨/정체</option>
          </select>
          <Button variant="secondary" size="sm" onClick={fetchItems} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            새로고침
          </Button>
        </div>
        {issueChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {issueChips.map(([issue, value]) => (
              <span key={issue} className="rounded-admin-xs bg-danger-light px-2 py-1 text-admin-2xs font-semibold text-danger">
                {ISSUE_LABELS[issue] || issue} {value}
              </span>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-8 text-center text-admin-sm text-admin-muted">큐를 불러오는 중</div>
      ) : items.length === 0 ? (
        <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface">
          <EmptyState
            icon={CheckCircle2}
            title="현재 조건에 맞는 큐가 없습니다"
            description="기본 운영 화면이 비어 있다면 오늘 처리할 큐가 없는 상태입니다."
          />
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs">
          <table className="admin-data-table w-full min-w-[1040px] table-fixed">
            <thead>
              <tr>
                <th style={{ width: 120 }}>긴급도</th>
                <th style={{ width: 130 }}>발행 예정</th>
                <th>토픽/키워드</th>
                <th style={{ width: 120 }}>소스</th>
                <th style={{ width: 96 }}>시도</th>
                <th style={{ width: 150 }}>액션</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={item.ops?.attention ? 'bg-danger-light/25' : ''}>
                  <td>
                    <span className={`inline-flex rounded-admin-xs border px-2 py-1 text-admin-2xs font-semibold ${urgencyClass(item)}`}>
                      {urgencyLabel(item)}
                    </span>
                    <span className={`mt-1 block w-fit rounded-admin-xs px-2 py-0.5 text-admin-2xs font-semibold ${STATUS_COLORS[item.status] || 'bg-admin-surface-2 text-admin-muted'}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="text-admin-xs text-admin-muted admin-num">
                    {item.target_publish_at ? fmtDateTime(item.target_publish_at) : '-'}
                  </td>
                  <td className="min-w-0">
                    <button onClick={() => setSelected(item)} className="block max-w-full truncate text-left text-admin-sm font-semibold text-admin-text hover:text-brand">
                      {item.topic}
                    </button>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {item.destination && <span className="rounded-admin-xs bg-admin-surface-2 px-1.5 py-0.5 text-admin-2xs text-admin-muted">{item.destination}</span>}
                      {item.primary_keyword && <span className="rounded-admin-xs bg-brand-light px-1.5 py-0.5 text-admin-2xs font-semibold text-brand">{item.primary_keyword}</span>}
                      {item.keyword_tier && <span className="rounded-admin-xs bg-admin-surface-2 px-1.5 py-0.5 text-admin-2xs font-mono text-admin-muted">{item.keyword_tier}</span>}
                      {item.monthly_search_volume ? <span className="text-admin-2xs text-admin-muted admin-num">{item.monthly_search_volume.toLocaleString('ko-KR')}/mo</span> : null}
                    </div>
                    {item.last_error && <p className="mt-1 truncate text-admin-2xs text-danger">{compactError(item.last_error)}</p>}
                  </td>
                  <td className="text-admin-xs text-admin-muted">{SOURCE_LABELS[item.source] || item.source || '-'}</td>
                  <td className="text-admin-xs text-admin-muted admin-num">
                    {item.attempts || 0}회
                    <span className="block text-admin-2xs">P{item.priority || 0}</span>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {item.content_creative_id && (
                        <Link href={`/admin/blog/${item.content_creative_id}`} className="inline-flex h-7 items-center gap-1 rounded-admin-xs border border-admin-border px-2 text-admin-2xs font-semibold text-brand hover:bg-brand-light">
                          <Eye size={12} />
                          글
                        </Link>
                      )}
                      {item.status === 'failed' && (
                        <button onClick={() => patchItem(item.id, 'requeue')} className="inline-flex h-7 items-center gap-1 rounded-admin-xs border border-admin-border px-2 text-admin-2xs font-semibold text-admin-text-2 hover:bg-admin-surface-2">
                          <RotateCcw size={12} />
                          재시도
                        </button>
                      )}
                      {!['published', 'skipped'].includes(item.status) && (
                        <button onClick={() => patchItem(item.id, 'hide')} className="inline-flex h-7 items-center gap-1 rounded-admin-xs border border-admin-border px-2 text-admin-2xs font-semibold text-admin-muted hover:bg-admin-surface-2">
                          <Archive size={12} />
                          숨김
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.topic || '큐 상세'}
        subtitle={selected ? `${SOURCE_LABELS[selected.source] || selected.source || '-'} · ${selected.status}` : undefined}
        width="w-full sm:w-[560px] lg:w-[680px]"
        actions={
          selected && (
            <>
              {selected.status === 'failed' && (
                <Button variant="secondary" size="sm" onClick={() => patchItem(selected.id, 'requeue')}>
                  <RotateCcw size={14} />
                  재시도
                </Button>
              )}
              {!['published', 'skipped'].includes(selected.status) && (
                <Button variant="secondary" size="sm" onClick={() => patchItem(selected.id, 'hide')}>
                  <Archive size={14} />
                  숨김
                </Button>
              )}
              {selected.content_creative_id && (
                <Link href={`/admin/blog/${selected.content_creative_id}`}>
                  <Button variant="primary" size="sm">
                    <Eye size={14} />
                    글 열기
                  </Button>
                </Link>
              )}
            </>
          )
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-admin-xs">
              {[
                ['상태', selected.status],
                ['긴급도', urgencyLabel(selected)],
                ['목적지', selected.destination || '-'],
                ['우선순위', selected.priority],
                ['발행 예정', selected.target_publish_at ? fmtDateTime(selected.target_publish_at) : '-'],
                ['생성일', selected.created_at ? fmtDateTime(selected.created_at) : '-'],
                ['키워드', selected.primary_keyword || '-'],
                ['검색의도', String(selected.meta?.search_intent || '-')],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-admin-sm border border-admin-border p-3">
                  <p className="text-admin-2xs font-semibold text-admin-muted">{String(label)}</p>
                  <p className="mt-1 break-words text-admin-sm text-admin-text admin-num">{String(value)}</p>
                </div>
              ))}
            </div>
            <section>
              <p className="mb-1.5 text-admin-xs font-semibold text-admin-text-2">오류 원인</p>
              <pre className="max-h-36 overflow-auto rounded-admin-sm bg-danger-light p-3 text-admin-2xs text-danger whitespace-pre-wrap">
                {selected.last_error || '기록된 오류 없음'}
              </pre>
            </section>
            <section>
              <p className="mb-1.5 text-admin-xs font-semibold text-admin-text-2">메타 / 품질 근거</p>
              <pre className="max-h-80 overflow-auto rounded-admin-sm bg-admin-surface-2 p-3 text-admin-2xs text-admin-muted whitespace-pre-wrap">
                {jsonPreview(selected.meta)}
              </pre>
            </section>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
