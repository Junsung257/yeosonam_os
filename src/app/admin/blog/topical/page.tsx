'use client';

/**
 * /admin/blog/topical — 토픽 권위 + Programmatic SEO 매트릭스 대시보드
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader, KpiCard } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { ArrowLeft, Sprout, ArrowUpCircle, GitBranch, Layers, Network, Clock, Send } from 'lucide-react';

interface State {
  pillars: Array<{ slug: string; pillar_for: string }>;
  pillar_count: number;
  cluster_total: number;
  cluster_by_destination: Array<{ destination: string; count: number }>;
  matrix: Record<string, number>;
  matrix_pending_sample: Array<any>;
}

export default function TopicalPage() {
  const [state, setState] = useState<State | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const fetchState = async () => {
    const res = await fetch('/api/admin/topical-state');
    setState(await res.json());
  };

  useEffect(() => { fetchState(); }, []);

  const trigger = async (action: string, label: string) => {
    setRunning(action);
    setMsg('');
    try {
      const res = await fetch('/api/admin/topical-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      setMsg(`✅ ${label}: ` + JSON.stringify(data.result).slice(0, 200));
      fetchState();
    } catch (e) {
      setMsg(`❌ ${label} 실패: ` + (e as Error).message);
    } finally {
      setRunning(null);
    }
  };

  if (!state) return <div className="text-admin-muted-2 text-admin-sm">로딩...</div>;

  const matrixTotal = (state.matrix.pending || 0) + (state.matrix.queued || 0) + (state.matrix.skipped || 0) + (state.matrix.failed || 0);

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader
        title="토픽 권위 + Programmatic SEO"
        subtitle="Pillar ↔ Cluster 인터링크 자동화 + destination × angle × month 매트릭스"
        actions={
          <Link href="/admin/blog/queue">
            <Button variant="secondary" size="sm">
              <ArrowLeft size={14} />
              발행 큐
            </Button>
          </Link>
        }
      />

      {/* 통계 */}
      <div className="grid grid-cols-4 gap-3">
        <KpiCard label="Pillar 페이지" value={state.pillar_count.toLocaleString()} icon={Layers} />
        <KpiCard label="Cluster 매핑" value={state.cluster_total.toLocaleString()} icon={Network} />
        <KpiCard label="매트릭스 대기" value={(state.matrix.pending || 0).toLocaleString()} icon={Clock} tone={state.matrix.pending > 0 ? 'negative' : 'neutral'} />
        <KpiCard label="매트릭스 큐잉됨" value={(state.matrix.queued || 0).toLocaleString()} icon={Send} tone="positive" />
      </div>

      {/* 컨트롤 */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => trigger('seed', '매트릭스 시드')}
          disabled={running !== null}
          className="px-3 py-3 admin-card text-left text-admin-xs hover:border-admin-border-strong disabled:opacity-50 transition-colors"
        >
          <span className="inline-flex items-center gap-1.5 font-semibold text-admin-text">
            <Sprout size={14} className="text-success" />
            {running === 'seed' ? '시딩…' : '매트릭스 시드'}
          </span>
          <p className="text-admin-2xs text-admin-muted mt-1">활성 destination × 12 angle</p>
        </button>
        <button
          onClick={() => trigger('promote', 'Pending → Queue')}
          disabled={running !== null}
          className="px-3 py-3 admin-card text-left text-admin-xs hover:border-admin-border-strong disabled:opacity-50 transition-colors"
        >
          <span className="inline-flex items-center gap-1.5 font-semibold text-admin-text">
            <ArrowUpCircle size={14} className="text-brand" />
            {running === 'promote' ? '승격중…' : '7개 큐로 promote'}
          </span>
          <p className="text-admin-2xs text-admin-muted mt-1">시즌 우선</p>
        </button>
        <button
          onClick={() => trigger('rebuild_clusters', 'Cluster 재구성')}
          disabled={running !== null}
          className="px-3 py-3 admin-card text-left text-admin-xs hover:border-admin-border-strong disabled:opacity-50 transition-colors"
        >
          <span className="inline-flex items-center gap-1.5 font-semibold text-admin-text">
            <GitBranch size={14} className="text-brand" />
            {running === 'rebuild_clusters' ? '재구성…' : 'Cluster 재구성'}
          </span>
          <p className="text-admin-2xs text-admin-muted mt-1">Pillar ↔ Cluster 매핑</p>
        </button>
      </div>

      {msg && <div className="text-admin-xs text-admin-muted bg-admin-surface-2 p-2.5 rounded-admin-sm">{msg}</div>}

      {/* 매트릭스 진행률 */}
      <div className="admin-card p-3">
        <p className="text-admin-xs font-semibold text-admin-text-2 mb-2">매트릭스 진행률 (<span className="admin-num">{matrixTotal}</span>건)</p>
        {matrixTotal === 0 ? (
          <p className="text-admin-xs text-admin-muted-2">아직 시드되지 않음. "매트릭스 시드" 버튼을 누르세요.</p>
        ) : (
          <div className="flex h-6 rounded-admin-sm overflow-hidden text-admin-2xs text-white font-semibold admin-num">
            <div className="bg-warning flex items-center justify-center" style={{ width: `${((state.matrix.pending || 0) / matrixTotal) * 100}%` }}>
              {state.matrix.pending || 0}
            </div>
            <div className="bg-success flex items-center justify-center" style={{ width: `${((state.matrix.queued || 0) / matrixTotal) * 100}%` }}>
              {state.matrix.queued || 0}
            </div>
            <div className="bg-admin-muted-2 flex items-center justify-center" style={{ width: `${(((state.matrix.skipped || 0) + (state.matrix.failed || 0)) / matrixTotal) * 100}%` }}>
              {(state.matrix.skipped || 0) + (state.matrix.failed || 0)}
            </div>
          </div>
        )}
      </div>

      {/* Pillar 목록 */}
      {state.pillars.length > 0 && (
        <div className="admin-card overflow-hidden">
          <div className="px-3 py-2.5 bg-admin-surface-2 border-b border-admin-border">
            <p className="text-admin-xs font-semibold text-admin-text-2">Pillar 페이지 (destination 허브)</p>
          </div>
          <div className="grid grid-cols-3 gap-1.5 p-2">
            {state.pillars.map(p => {
              const clusters = state.cluster_by_destination.find(c => c.destination === p.pillar_for)?.count || 0;
              return (
                <Link key={p.slug} href={`/blog/${p.slug}`} className="px-3 py-2 bg-admin-surface-2 hover:bg-brand-light rounded-admin-sm text-admin-xs transition-colors">
                  <p className="font-semibold text-admin-text">🏛️ {p.pillar_for}</p>
                  <p className="text-admin-muted admin-num">cluster {clusters}개 연결</p>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* 매트릭스 pending 샘플 */}
      {state.matrix_pending_sample.length > 0 && (
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
          <div className="px-3 py-2.5 border-b border-admin-border">
            <p className="text-admin-xs font-semibold text-admin-text-2">대기 중 매트릭스 토픽 (priority 순)</p>
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
              {state.matrix_pending_sample.map((t: any) => (
                <tr key={t.id}>
                  <td className="text-admin-text">{t.destination}</td>
                  <td className="text-admin-muted font-mono text-admin-2xs">{t.angle}</td>
                  <td className="text-center text-admin-muted admin-num">{t.month || '—'}</td>
                  <td className="text-admin-text truncate max-w-md">{t.topic_template}</td>
                  <td className="text-center text-admin-muted font-mono admin-num">{t.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
