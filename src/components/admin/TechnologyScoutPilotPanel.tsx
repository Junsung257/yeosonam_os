'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, PauseCircle, PlayCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { TechnologyScoutPilotReadiness } from '@/lib/agent/pilot';

type RecentScoutCase = {
  taskId: string | null;
  caseId: string | null;
  status: string;
  shadowOnly: boolean;
  decision: string | null;
  projectName: string | null;
  outputHash: string | null;
  errorCode: string | null;
  updatedAt: string | null;
};

function GateIcon({ state }: { state: 'pass' | 'blocked' | 'not_checked' }) {
  if (state === 'pass') return <CheckCircle2 size={15} className="text-emerald-600" aria-hidden="true" />;
  if (state === 'blocked') return <PauseCircle size={15} className="text-amber-600" aria-hidden="true" />;
  return <Clock size={15} className="text-slate-400" aria-hidden="true" />;
}

function gateLabel(state: 'pass' | 'blocked' | 'not_checked') {
  return state === 'pass' ? '통과' : state === 'blocked' ? '차단' : '미확인';
}

export default function TechnologyScoutPilotPanel() {
  const [readiness, setReadiness] = useState<TechnologyScoutPilotReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [recentCases, setRecentCases] = useState<RecentScoutCase[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/agent/office/pilot-readiness', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Pilot 상태를 불러오지 못했습니다.');
      setReadiness(data as TechnologyScoutPilotReadiness);
      const recentResponse = await fetch('/api/admin/agent/office/pilot/shadow', { cache: 'no-store' });
      if (recentResponse.ok) {
        const recentData = await recentResponse.json();
        setRecentCases(Array.isArray(recentData?.recentCases) ? recentData.recentCases as RecentScoutCase[] : []);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Pilot 상태를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  const runPreviewPilot = useCallback(async () => {
    setRunning(true);
    setRunMessage(null);
    try {
      const response = await fetch('/api/admin/agent/office/pilot/shadow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: 'TS-001' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Preview Pilot을 실행하지 못했습니다.');
      setRunMessage(data.status === 'succeeded'
        ? `TS-001 실행 완료 · run ${data.runId ?? '—'}`
        : data.status === 'duplicate' ? 'TS-001은 이미 실행된 Business Task입니다.' : `실행 결과: ${data.status}`);
      await load();
    } catch (runError) {
      setRunMessage(runError instanceof Error ? runError.message : 'Preview Pilot을 실행하지 못했습니다.');
    } finally {
      setRunning(false);
    }
  }, [load]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="mt-4 rounded-admin-md border border-slate-700 bg-slate-950 p-4 text-white shadow-admin-xs" aria-labelledby="technology-scout-pilot-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={15} className="text-emerald-300" aria-hidden="true" />
            <h2 id="technology-scout-pilot-heading" className="text-admin-sm font-semibold">Technology Scout Pilot</h2>
            <span className="rounded-admin-sm border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">SHADOW · 실행 잠금</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
            공식 자료를 검토용 Radar 후보로만 만드는 첫 역할입니다. 자동 위임·게시·DB 변경은 아직 허용되지 않습니다.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading} className="border-slate-600 bg-slate-900 text-slate-200 hover:bg-slate-800">
          <RefreshCw size={13} aria-hidden="true" />
          상태 새로고침
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-admin-sm border border-slate-700 bg-slate-900/70 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-slate-200">수동 Preview 실행</p>
          <p className="mt-0.5 text-[10px] text-slate-400">TS-001 고정 · 공개 근거만 사용 · 외부 쓰기 0 · Production 영구 차단</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void runPreviewPilot()}
          loading={running}
          disabled={!readiness?.execution?.enabled || loading}
          className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlayCircle size={13} aria-hidden="true" />
          {readiness?.execution?.enabled ? 'Preview에서 실행' : 'Preview 잠금'}
        </Button>
      </div>
      {runMessage && <p className="mt-2 rounded-admin-sm border border-slate-700 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-300">{runMessage}</p>}

      {recentCases.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-admin-sm border border-slate-700">
          <table className="min-w-[620px] w-full text-left text-[10px]">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Case</th>
                <th className="px-3 py-2 font-medium">Project</th>
                <th className="px-3 py-2 font-medium">결과</th>
                <th className="px-3 py-2 font-medium">Hash</th>
                <th className="px-3 py-2 font-medium">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700 bg-slate-950 text-slate-300">
              {recentCases.map((item) => (
                <tr key={item.taskId ?? `${item.caseId}-${item.updatedAt}`}>
                  <td className="px-3 py-2 font-mono">{item.caseId ?? '—'}</td>
                  <td className="px-3 py-2">{item.projectName ?? '—'}</td>
                  <td className="px-3 py-2 font-semibold">{item.decision ?? item.errorCode ?? '—'}</td>
                  <td className="max-w-[180px] truncate px-3 py-2 font-mono text-slate-500">{item.outputHash ?? '—'}</td>
                  <td className="px-3 py-2">{item.shadowOnly ? `SHADOW · ${item.status}` : item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="mt-3 rounded-admin-sm border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-[11px] text-rose-200">{error}</p>}
      {loading && !readiness ? (
        <div className="mt-4 h-24 animate-pulse rounded-admin-sm bg-slate-800" aria-label="Pilot 상태 로딩 중" />
      ) : readiness ? (
        <>
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
            <div className="rounded-admin-sm border border-slate-700 bg-slate-900/80 p-3">
              <div className="flex items-center gap-2"><GateIcon state={readiness.gates.contractFixtures.state} /><span className="text-[11px] text-slate-300">계약 Fixture</span><span className="ml-auto text-[10px] font-semibold text-emerald-300">{gateLabel(readiness.gates.contractFixtures.state)}</span></div>
              <p className="mt-2 font-mono text-admin-sm text-white">{readiness.gates.contractFixtures.passed}/{readiness.gates.contractFixtures.total}</p>
              <p className="mt-1 text-[10px] text-slate-400">결정론적 입력·근거·Review 계약</p>
            </div>
            <div className="rounded-admin-sm border border-slate-700 bg-slate-900/80 p-3">
              <div className="flex items-center gap-2"><GateIcon state={readiness.gates.protocolAttestation.state} /><span className="text-[11px] text-slate-300">Codex read-only 호환성</span><span className="ml-auto text-[10px] font-semibold text-amber-200">{gateLabel(readiness.gates.protocolAttestation.state)}</span></div>
              <p className="mt-2 text-admin-sm text-white">{readiness.gates.protocolAttestation.codexVersion ?? '로컬 확인 필요'}</p>
              <p className="mt-1 text-[10px] text-slate-400">모델 턴 없이 로컬 attestation</p>
            </div>
            <div className="rounded-admin-sm border border-amber-300/20 bg-amber-300/5 p-3">
              <div className="flex items-center gap-2"><GateIcon state={readiness.gates.productionRunsMigration.state} /><span className="text-[11px] text-slate-300">Production Run 원장</span><span className="ml-auto text-[10px] font-semibold text-amber-200">승인 대기</span></div>
              <p className="mt-2 text-admin-sm text-white">DB 적용 0건</p>
              <p className="mt-1 text-[10px] text-slate-400">agent_tasks가 계속 업무 상태 SSOT</p>
            </div>
          </div>
          <div className="mt-3 rounded-admin-sm border border-slate-700 bg-slate-900/60 px-3 py-2">
            <p className="text-[11px] font-semibold text-slate-200">다음 통과 조건</p>
            <ul className="mt-1 space-y-1 text-[10px] leading-relaxed text-slate-400">
              {readiness.nextActions.map((action) => <li key={action} className="before:mr-1 before:text-slate-600 before:content-['•']">{action}</li>)}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}
