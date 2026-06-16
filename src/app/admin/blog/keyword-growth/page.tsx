'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Layers, MousePointerClick, Play, Search, TrendingUp } from 'lucide-react';
import { KpiCard, PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';

type GrowthData = {
  ok: boolean;
  warnings?: string[];
  summary?: {
    days: number;
    tracked_queries: number;
    gsc_longtail_queue: number;
    active_families: number;
    cannibalization_watch: number;
    total_clicks: number;
    total_impressions: number;
    conversion_weighted_queries: number;
  };
  top_queries?: Array<{
    query: string | null;
    slug: string | null;
    impressions: number;
    clicks: number;
    ctr: number;
    avg_position: number | null;
    opportunity_score: number;
    revenue_score: number;
  }>;
  families?: Array<{
    id: string;
    family_key: string;
    canonical_keyword: string | null;
    destination: string | null;
    intent: string | null;
    status: string | null;
    member_count: number;
    queue_count: number;
    max_score: number;
    cannibalization_risk: 'low' | 'medium' | 'high';
  }>;
  cannibalization_watch?: Array<{
    id: string;
    family_key: string;
    canonical_keyword: string | null;
    destination: string | null;
    member_count: number;
    queue_count: number;
    max_score: number;
    cannibalization_risk: 'medium' | 'high';
  }>;
  queue?: Array<{
    id: string;
    topic: string | null;
    primary_keyword: string | null;
    keyword_tier: string | null;
    monthly_search_volume: number | null;
    competition_level: string | null;
    priority: number | null;
    status: string | null;
    destination: string | null;
    source: string | null;
    created_at: string | null;
  }>;
};

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function riskClass(risk: string): string {
  if (risk === 'high') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (risk === 'medium') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

export default function BlogKeywordGrowthPage() {
  const [days, setDays] = useState(28);
  const [data, setData] = useState<GrowthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/blog/keyword-growth?days=${days}`, { cache: 'no-store' });
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function runLongtailExpander(dryRun: boolean) {
    setRunning(true);
    setRunResult('');
    try {
      const path = `/api/cron/blog-longtail-expander?${dryRun ? 'dry_run=1&' : ''}limit=10&seed_limit=30`;
      const res = await fetch('/api/admin/cron-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);
      setRunResult(`${dryRun ? 'Dry-run' : '큐 삽입'} 완료: 후보 ${result.candidates?.length || 0}개, 삽입 ${result.inserted?.length || 0}개`);
      await fetchData();
    } catch (error) {
      setRunResult(`실패: ${(error as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  const summary = data?.summary;

  return (
    <div className="space-y-5">
      <PageHeader
        title="키워드 성장 엔진"
        subtitle="구글 서치콘솔 롱테일, 키워드 묶음, 중복 잠식 위험, 수익 신호를 묶어서 다음 발행 우선순위를 봅니다."
        actions={
          <>
            <Link href="/admin/blog/queue">
              <Button variant="secondary" size="sm">
                <ArrowLeft size={14} />
                발행 큐
              </Button>
            </Link>
            <Button variant="secondary" size="sm" onClick={() => runLongtailExpander(true)} disabled={running}>
              <Search size={14} />
              후보 미리보기
            </Button>
            <Button variant="primary" size="sm" onClick={() => runLongtailExpander(false)} disabled={running}>
              <Play size={14} />
              롱테일 확장 실행
            </Button>
          </>
        }
      />

      {runResult && (
        <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-3 text-admin-xs text-admin-text-2">
          {runResult}
        </div>
      )}

      {(data?.warnings || []).length > 0 && (
        <div className="rounded-admin-md border border-amber-200 bg-amber-50 p-3 text-admin-xs text-amber-800">
          일부 데이터 소스가 아직 준비되지 않았습니다: {(data?.warnings || []).join(' / ')}
        </div>
      )}

      <div className="flex gap-1 rounded-admin-sm bg-admin-surface-2 p-1 w-fit">
        {[14, 28, 60].map((value) => (
          <button
            key={value}
            onClick={() => setDays(value)}
            className={`h-8 rounded-admin-xs px-3 text-admin-sm font-medium transition-colors admin-num ${days === value ? 'bg-admin-surface text-admin-text shadow-admin-xs' : 'text-admin-muted hover:text-admin-text-2'}`}
          >
            {value}일
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <KpiCard label="추적 쿼리" value={(summary?.tracked_queries || 0).toLocaleString('ko-KR')} icon={Search} />
        <KpiCard label="구글 롱테일 큐" value={(summary?.gsc_longtail_queue || 0).toLocaleString('ko-KR')} icon={TrendingUp} tone="positive" />
        <KpiCard label="키워드 패밀리" value={(summary?.active_families || 0).toLocaleString('ko-KR')} icon={Layers} />
        <KpiCard label="잠식 감시" value={(summary?.cannibalization_watch || 0).toLocaleString('ko-KR')} icon={AlertTriangle} tone={summary?.cannibalization_watch ? 'negative' : 'neutral'} />
        <KpiCard label="총 클릭" value={(summary?.total_clicks || 0).toLocaleString('ko-KR')} icon={MousePointerClick} />
        <KpiCard label="수익 신호 쿼리" value={(summary?.conversion_weighted_queries || 0).toLocaleString('ko-KR')} icon={TrendingUp} tone="positive" />
      </div>

      <section className="admin-card overflow-hidden">
        <div className="border-b border-admin-border px-3 py-2.5">
          <p className="text-admin-xs font-semibold text-admin-text-2">성장 후보 쿼리</p>
          <p className="mt-0.5 text-admin-2xs text-admin-muted">클릭, 노출, 평균순위, 전환/수익 신호를 합쳐 우선순위를 잡습니다.</p>
        </div>
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>쿼리</th>
              <th>연결 글</th>
              <th className="text-right">점수</th>
              <th className="text-right">클릭</th>
              <th className="text-right">노출</th>
              <th className="text-right">CTR</th>
              <th className="text-right">평균순위</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="py-8 text-center text-admin-muted">불러오는 중</td></tr>
            ) : (data?.top_queries || []).slice(0, 30).map((row) => (
              <tr key={`${row.query}-${row.slug}`}>
                <td className="font-semibold text-admin-text-2">{row.query || '-'}</td>
                <td>
                  {row.slug ? <Link href={`/blog/${row.slug}`} className="font-mono text-admin-2xs text-brand hover:underline">{row.slug.slice(0, 38)}</Link> : '-'}
                </td>
                <td className="text-right font-semibold admin-num">{row.opportunity_score.toFixed(1)}</td>
                <td className="text-right admin-num">{row.clicks.toLocaleString('ko-KR')}</td>
                <td className="text-right text-admin-muted admin-num">{row.impressions.toLocaleString('ko-KR')}</td>
                <td className="text-right admin-num">{pct(row.ctr)}</td>
                <td className="text-right admin-num">{row.avg_position ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="admin-card overflow-hidden">
          <div className="border-b border-admin-border px-3 py-2.5">
            <p className="text-admin-xs font-semibold text-admin-text-2">잠식 감시</p>
            <p className="mt-0.5 text-admin-2xs text-admin-muted">비슷한 롱테일이 한 가족 안에서 여러 개 발행/대기 중이면 대표글과 보조글을 나눠야 합니다.</p>
          </div>
          <div className="divide-y divide-admin-border">
            {(data?.cannibalization_watch || []).slice(0, 12).map((family) => (
              <div key={family.id} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-admin-sm font-semibold text-admin-text-2">{family.canonical_keyword || family.family_key}</p>
                    <p className="mt-0.5 text-admin-2xs text-admin-muted">{family.destination || '전체'} · 멤버 {family.member_count}개 · 큐 {family.queue_count}개</p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-admin-2xs font-semibold ${riskClass(family.cannibalization_risk)}`}>
                    {family.cannibalization_risk}
                  </span>
                </div>
              </div>
            ))}
            {(data?.cannibalization_watch || []).length === 0 && (
              <div className="p-8 text-center text-admin-xs text-admin-muted">현재 감시 대상 없음</div>
            )}
          </div>
        </section>

        <section className="admin-card overflow-hidden">
          <div className="border-b border-admin-border px-3 py-2.5">
            <p className="text-admin-xs font-semibold text-admin-text-2">키워드 패밀리</p>
            <p className="mt-0.5 text-admin-2xs text-admin-muted">대표 키워드 기준으로 롱테일을 묶고, 발행 우선순위와 역할을 관리합니다.</p>
          </div>
          <div className="divide-y divide-admin-border">
            {(data?.families || []).slice(0, 12).map((family) => (
              <div key={family.id} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-admin-sm font-semibold text-admin-text-2">{family.canonical_keyword || family.family_key}</p>
                    <p className="mt-0.5 text-admin-2xs text-admin-muted">{family.destination || '전체'} · {family.intent || '의도 미분류'} · 점수 {family.max_score}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-admin-2xs font-semibold ${riskClass(family.cannibalization_risk)}`}>
                    {family.cannibalization_risk}
                  </span>
                </div>
              </div>
            ))}
            {(data?.families || []).length === 0 && (
              <div className="p-8 text-center text-admin-xs text-admin-muted">마이그레이션/첫 확장 실행 후 표시됩니다.</div>
            )}
          </div>
        </section>
      </div>

      <section className="admin-card overflow-hidden">
        <div className="border-b border-admin-border px-3 py-2.5">
          <p className="text-admin-xs font-semibold text-admin-text-2">최근 자동 키워드 큐</p>
        </div>
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>키워드</th>
              <th>주제</th>
              <th>소스</th>
              <th>Tier</th>
              <th className="text-right">검색량</th>
              <th className="text-right">우선순위</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {(data?.queue || []).slice(0, 40).map((row) => (
              <tr key={row.id}>
                <td className="font-semibold text-admin-text-2">{row.primary_keyword || '-'}</td>
                <td className="max-w-md truncate text-admin-muted">{row.topic || '-'}</td>
                <td>{row.source}</td>
                <td>{row.keyword_tier || '-'}</td>
                <td className="text-right admin-num">{row.monthly_search_volume?.toLocaleString('ko-KR') || '-'}</td>
                <td className="text-right admin-num">{row.priority || '-'}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
