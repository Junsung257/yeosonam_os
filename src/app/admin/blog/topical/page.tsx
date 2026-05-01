'use client';

/**
 * /admin/blog/topical — 토픽 권위 + Programmatic SEO 매트릭스 대시보드
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';

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

  if (!state) return <div className="text-slate-400 text-[13px]">로딩...</div>;

  const matrixTotal = (state.matrix.pending || 0) + (state.matrix.queued || 0) + (state.matrix.skipped || 0) + (state.matrix.failed || 0);

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-slate-800">토픽 권위 + Programmatic SEO</h1>
          <p className="text-[12px] text-slate-400 mt-0.5">
            Pillar↔Cluster 인터링크 자동화 + destination×angle×month 매트릭스
          </p>
        </div>
        <Link href="/admin/blog/queue" className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-[12px] rounded-lg hover:bg-slate-50">
          ← 큐
        </Link>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <p className="text-[11px] text-slate-400">Pillar 페이지</p>
          <p className="text-[22px] font-bold text-slate-800">{state.pillar_count}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <p className="text-[11px] text-slate-400">Cluster 매핑</p>
          <p className="text-[22px] font-bold text-slate-800">{state.cluster_total}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <p className="text-[11px] text-slate-400">매트릭스 대기</p>
          <p className="text-[22px] font-bold text-amber-600">{state.matrix.pending || 0}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <p className="text-[11px] text-slate-400">매트릭스 큐잉됨</p>
          <p className="text-[22px] font-bold text-emerald-600">{state.matrix.queued || 0}</p>
        </div>
      </div>

      {/* 컨트롤 */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => trigger('seed', '매트릭스 시드')}
          disabled={running !== null}
          className="px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-[12px] hover:bg-slate-50 disabled:opacity-50"
        >
          {running === 'seed' ? '시딩...' : '🌱 매트릭스 시드'}
          <p className="text-[10px] text-slate-400 mt-0.5">활성 destination × 12 angle</p>
        </button>
        <button
          onClick={() => trigger('promote', 'Pending → Queue')}
          disabled={running !== null}
          className="px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-[12px] hover:bg-slate-50 disabled:opacity-50"
        >
          {running === 'promote' ? '승격중...' : '⬆️ 7개 큐로 promote'}
          <p className="text-[10px] text-slate-400 mt-0.5">시즌 우선</p>
        </button>
        <button
          onClick={() => trigger('rebuild_clusters', 'Cluster 재구성')}
          disabled={running !== null}
          className="px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-[12px] hover:bg-slate-50 disabled:opacity-50"
        >
          {running === 'rebuild_clusters' ? '재구성...' : '🔗 Cluster 재구성'}
          <p className="text-[10px] text-slate-400 mt-0.5">Pillar↔Cluster 매핑</p>
        </button>
      </div>

      {msg && <div className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded">{msg}</div>}

      {/* 매트릭스 진행률 */}
      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <p className="text-[12px] font-semibold text-slate-700 mb-2">매트릭스 진행률 ({matrixTotal}건)</p>
        {matrixTotal === 0 ? (
          <p className="text-[11px] text-slate-400">아직 시드되지 않음. "🌱 매트릭스 시드" 버튼을 누르세요.</p>
        ) : (
          <div className="flex h-6 rounded overflow-hidden text-[10px] text-white font-semibold">
            <div className="bg-amber-500 flex items-center justify-center" style={{ width: `${((state.matrix.pending || 0) / matrixTotal) * 100}%` }}>
              {state.matrix.pending || 0}
            </div>
            <div className="bg-emerald-500 flex items-center justify-center" style={{ width: `${((state.matrix.queued || 0) / matrixTotal) * 100}%` }}>
              {state.matrix.queued || 0}
            </div>
            <div className="bg-slate-400 flex items-center justify-center" style={{ width: `${(((state.matrix.skipped || 0) + (state.matrix.failed || 0)) / matrixTotal) * 100}%` }}>
              {(state.matrix.skipped || 0) + (state.matrix.failed || 0)}
            </div>
          </div>
        )}
      </div>

      {/* Pillar 목록 */}
      {state.pillars.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
            <p className="text-[12px] font-semibold text-slate-700">Pillar 페이지 (destination 허브)</p>
          </div>
          <div className="grid grid-cols-3 gap-1 p-2">
            {state.pillars.map(p => {
              const clusters = state.cluster_by_destination.find(c => c.destination === p.pillar_for)?.count || 0;
              return (
                <Link key={p.slug} href={`/blog/${p.slug}`} className="px-3 py-2 bg-slate-50 hover:bg-slate-100 rounded text-[11px]">
                  <p className="font-semibold text-slate-700">🏛️ {p.pillar_for}</p>
                  <p className="text-slate-500">cluster {clusters}개 연결</p>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* 매트릭스 pending 샘플 */}
      {state.matrix_pending_sample.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
            <p className="text-[12px] font-semibold text-slate-700">대기 중 매트릭스 토픽 (priority 순)</p>
          </div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-3 py-2 text-slate-500">Destination</th>
                <th className="text-left px-3 py-2 text-slate-500">Angle</th>
                <th className="text-center px-2 py-2 text-slate-500">월</th>
                <th className="text-left px-3 py-2 text-slate-500">토픽</th>
                <th className="text-center px-2 py-2 text-slate-500">Priority</th>
              </tr>
            </thead>
            <tbody>
              {state.matrix_pending_sample.map((t: any) => (
                <tr key={t.id} className="border-b border-slate-100">
                  <td className="px-3 py-1.5 text-slate-700">{t.destination}</td>
                  <td className="px-3 py-1.5 text-slate-600 font-mono text-[10px]">{t.angle}</td>
                  <td className="px-2 py-1.5 text-center text-slate-500">{t.month || '-'}</td>
                  <td className="px-3 py-1.5 text-slate-700 truncate max-w-md">{t.topic_template}</td>
                  <td className="px-2 py-1.5 text-center text-slate-500 font-mono">{t.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
