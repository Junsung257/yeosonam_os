'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpCircle, Clock, GitBranch, Layers, Network, Send, Sprout } from 'lucide-react';
import { KpiCard, PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';

interface State {
  pillars: Array<{ slug: string; pillar_for: string }>;
  pillar_count: number;
  cluster_total: number;
  cluster_by_destination: Array<{ destination: string; count: number }>;
  authority_score?: number;
  weak_destinations?: Array<{ destination: string; count: number }>;
  next_actions?: string[];
  matrix: Record<string, number>;
  matrix_pending_sample: Array<any>;
}

export default function TopicalPage() {
  const [state, setState] = useState<State | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function fetchState() {
    const res = await fetch('/api/admin/topical-state', { cache: 'no-store' });
    setState(await res.json());
  }

  useEffect(() => {
    fetchState();
  }, []);

  async function trigger(action: string, label: string) {
    setRunning(action);
    setMessage('');
    try {
      const res = await fetch('/api/admin/topical-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      setMessage(`${label}: ${JSON.stringify(data.result || data).slice(0, 240)}`);
      fetchState();
    } catch (error) {
      setMessage(`${label} 실패: ${(error as Error).message}`);
    } finally {
      setRunning(null);
    }
  }

  const matrixTotal = useMemo(() => {
    if (!state) return 0;
    return (state.matrix.pending || 0) + (state.matrix.queued || 0) + (state.matrix.skipped || 0) + (state.matrix.failed || 0);
  }, [state]);

  if (!state) return <div className="text-admin-sm text-admin-muted-2">로딩 중</div>;

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader
        title="토픽권위 지도"
        subtitle="여행지별 허브, 비교 글, 상품 글, 광고 랜딩 공백을 찾아 블로그와 광고 OS가 같은 방향으로 움직이게 합니다."
        actions={
          <Link href="/admin/blog/queue">
            <Button variant="secondary" size="sm">
              <ArrowLeft size={14} />
              발행 큐
            </Button>
          </Link>
        }
      />

      <section className="admin-card p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">이 페이지의 목적</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              같은 다낭 상품이 계속 등록되어도 글을 무한 생성하지 않도록, 목적지 허브와 고객 의도별 클러스터를 관리합니다.
            </p>
          </div>
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">Pillar / Cluster</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              Pillar는 “다낭 여행” 같은 허브 글이고, Cluster는 부모님 여행, 부산 출발, 비교, 환전, 날씨 같은 세부 의도 글입니다.
            </p>
          </div>
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">광고 활용</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              초세부 키워드 광고는 가장 가까운 허브/클러스터/상품 CTA로 연결되고, 성과가 쌓이면 다음 글 각도와 광고 확장 후보가 됩니다.
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Authority Score" value={`${state.authority_score ?? 0}`} unit="/100" icon={GitBranch} tone={(state.authority_score ?? 0) >= 70 ? 'positive' : 'neutral'} />
        <KpiCard label="허브 글" value={state.pillar_count.toLocaleString('ko-KR')} icon={Layers} />
        <KpiCard label="클러스터 연결" value={state.cluster_total.toLocaleString('ko-KR')} icon={Network} />
        <KpiCard label="대기 토픽" value={(state.matrix.pending || 0).toLocaleString('ko-KR')} icon={Clock} tone={state.matrix.pending > 0 ? 'negative' : 'neutral'} />
        <KpiCard label="큐 등록" value={(state.matrix.queued || 0).toLocaleString('ko-KR')} icon={Send} tone="positive" />
      </div>

      {(state.next_actions?.length || 0) > 0 && (
        <section className="admin-card p-3">
          <p className="text-admin-xs font-semibold text-admin-text-2">다음 보강 액션</p>
          <div className="mt-2 space-y-1">
            {state.next_actions?.slice(0, 5).map((action) => (
              <p key={action} className="text-admin-xs leading-5 text-admin-muted">- {action}</p>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-2 md:grid-cols-3">
        <button
          onClick={() => trigger('seed', '매트릭스 시드')}
          disabled={running !== null}
          className="admin-card px-3 py-3 text-left text-admin-xs transition-colors hover:border-admin-border-strong disabled:opacity-50"
        >
          <span className="inline-flex items-center gap-1.5 font-semibold text-admin-text">
            <Sprout size={14} className="text-success" />
            {running === 'seed' ? '시드 중' : '매트릭스 시드'}
          </span>
          <p className="mt-1 text-admin-2xs text-admin-muted">활성 destination x 고객 의도 생성</p>
        </button>
        <button
          onClick={() => trigger('promote', 'Pending to Queue')}
          disabled={running !== null}
          className="admin-card px-3 py-3 text-left text-admin-xs transition-colors hover:border-admin-border-strong disabled:opacity-50"
        >
          <span className="inline-flex items-center gap-1.5 font-semibold text-admin-text">
            <ArrowUpCircle size={14} className="text-brand" />
            {running === 'promote' ? '승격 중' : '상위 7개 큐 등록'}
          </span>
          <p className="mt-1 text-admin-2xs text-admin-muted">광고/SEO 공백 우선순위 반영</p>
        </button>
        <button
          onClick={() => trigger('rebuild_clusters', 'Cluster 재구성')}
          disabled={running !== null}
          className="admin-card px-3 py-3 text-left text-admin-xs transition-colors hover:border-admin-border-strong disabled:opacity-50"
        >
          <span className="inline-flex items-center gap-1.5 font-semibold text-admin-text">
            <GitBranch size={14} className="text-brand" />
            {running === 'rebuild_clusters' ? '재구성 중' : 'Cluster 재구성'}
          </span>
          <p className="mt-1 text-admin-2xs text-admin-muted">허브와 세부 글 연결 재계산</p>
        </button>
      </div>

      {message && <div className="rounded-admin-sm bg-admin-surface-2 p-2.5 text-admin-xs text-admin-muted">{message}</div>}

      <div className="admin-card p-3">
        <p className="mb-2 text-admin-xs font-semibold text-admin-text-2">매트릭스 진행률 <span className="admin-num">{matrixTotal}</span>건</p>
        {matrixTotal === 0 ? (
          <p className="text-admin-xs text-admin-muted-2">아직 시드되지 않았습니다. 매트릭스 시드를 먼저 실행하세요.</p>
        ) : (
          <div className="flex h-6 overflow-hidden rounded-admin-sm text-admin-2xs font-semibold text-white admin-num">
            <div className="flex items-center justify-center bg-warning" style={{ width: `${((state.matrix.pending || 0) / matrixTotal) * 100}%` }}>{state.matrix.pending || 0}</div>
            <div className="flex items-center justify-center bg-success" style={{ width: `${((state.matrix.queued || 0) / matrixTotal) * 100}%` }}>{state.matrix.queued || 0}</div>
            <div className="flex items-center justify-center bg-admin-muted-2" style={{ width: `${(((state.matrix.skipped || 0) + (state.matrix.failed || 0)) / matrixTotal) * 100}%` }}>{(state.matrix.skipped || 0) + (state.matrix.failed || 0)}</div>
          </div>
        )}
      </div>

      {state.pillars.length > 0 && (
        <div className="admin-card overflow-hidden">
          <div className="border-b border-admin-border bg-admin-surface-2 px-3 py-2.5">
            <p className="text-admin-xs font-semibold text-admin-text-2">허브 글</p>
          </div>
          <div className="grid gap-1.5 p-2 md:grid-cols-3">
            {state.pillars.map((pillar) => {
              const clusters = state.cluster_by_destination.find((cluster) => cluster.destination === pillar.pillar_for)?.count || 0;
              return (
                <Link key={pillar.slug} href={`/blog/${pillar.slug}`} className="rounded-admin-sm bg-admin-surface-2 px-3 py-2 text-admin-xs transition-colors hover:bg-brand-light">
                  <p className="font-semibold text-admin-text">{pillar.pillar_for}</p>
                  <p className="text-admin-muted admin-num">cluster {clusters}개 연결</p>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {state.matrix_pending_sample.length > 0 && (
        <div className="overflow-hidden rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs">
          <div className="border-b border-admin-border px-3 py-2.5">
            <p className="text-admin-xs font-semibold text-admin-text-2">대기 중인 토픽 후보</p>
          </div>
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>Destination</th>
                <th>Angle</th>
                <th className="text-center">월</th>
                <th>토픽</th>
                <th className="text-center">Priority</th>
              </tr>
            </thead>
            <tbody>
              {state.matrix_pending_sample.map((topic: any) => (
                <tr key={topic.id}>
                  <td className="text-admin-text">{topic.destination}</td>
                  <td className="font-mono text-admin-2xs text-admin-muted">{topic.angle}</td>
                  <td className="text-center text-admin-muted admin-num">{topic.month || '-'}</td>
                  <td className="max-w-md truncate text-admin-text">{topic.topic_template}</td>
                  <td className="text-center font-mono text-admin-muted admin-num">{topic.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
