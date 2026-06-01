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
  authority_score?: number;
  weak_destinations?: Array<{ destination: string; count: number }>;
  next_actions?: string[];
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
      <section className="admin-card p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">이 화면의 목적</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              같은 여행지 상품이 계속 들어와도 중복 글을 무한 생성하지 않고, 여행지 허브와 세부 관점 글을 구조화합니다.
            </p>
          </div>
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">Pillar / Cluster</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              Pillar는 다낭 같은 여행지 허브, Cluster는 부모님 여행, 부산 출발, 비교, 일정 같은 세부 의도 글입니다.
            </p>
          </div>
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">광고 활용</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              초세부 키워드별 랜딩 후보를 만들고, 색인/순위/예약 성과를 보고 광고 OS가 다음 키워드와 글 각도를 추천합니다.
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label="Authority Score" value={`${state.authority_score ?? 0}`} unit="/100" icon={GitBranch} tone={(state.authority_score ?? 0) >= 70 ? 'positive' : 'neutral'} />
        <KpiCard label="Pillar 페이지" value={state.pillar_count.toLocaleString()} icon={Layers} />
        <KpiCard label="Cluster 매핑" value={state.cluster_total.toLocaleString()} icon={Network} />
        <KpiCard label="매트릭스 대기" value={(state.matrix.pending || 0).toLocaleString()} icon={Clock} tone={state.matrix.pending > 0 ? 'negative' : 'neutral'} />
        <KpiCard label="매트릭스 큐잉됨" value={(state.matrix.queued || 0).toLocaleString()} icon={Send} tone="positive" />
      </div>

      {(state.next_actions?.length || 0) > 0 && (
        <section className="admin-card p-3">
          <p className="text-admin-xs font-semibold text-admin-text-2">다음 보강 액션</p>
          <div className="mt-2 space-y-1">
            {state.next_actions?.slice(0, 4).map((action) => (
              <p key={action} className="text-admin-xs leading-5 text-admin-muted">- {action}</p>
            ))}
          </div>
        </section>
      )}

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
