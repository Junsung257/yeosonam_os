'use client';

import { useEffect, useState, useCallback } from 'react';

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface CommissionRow {
  id: string;
  session_id: string | null;
  ota: string;
  status: string;
  estimated_krw: number | null;
  confirmed_krw: number | null;
  commission_rate: number;
  click_count: number;
  clicked_at: string | null;
  created_at: string;
  free_travel_sessions?: { destination: string; date_from: string; customer_phone: string | null } | null;
}

interface ReportRow {
  id: string;
  ota: string;
  report_month: string;
  total_krw: number;
  item_count: number;
  reconciled: boolean;
  reconciled_at: string | null;
  created_at: string;
}

interface UnmatchedCandidate {
  id: string;
  session_id: string | null;
  estimated_krw: number | null;
  created_at: string;
  status: string;
}

interface UnmatchedRow {
  id: string;
  ota: string;
  confirmed_krw: number | null;
  ota_report_ref: string | null;
  created_at: string;
  candidates: UnmatchedCandidate[];
}

const STATUS_LABEL: Record<string, string> = {
  pending:    '대기',
  reported:   '리포트 수신',
  reconciled: '매칭 완료',
  paid:       '입금 확인',
  unmatched:  '수동 확인',
};

const STATUS_COLOR: Record<string, string> = {
  pending:    'bg-yellow-50 text-yellow-700',
  reported:   'bg-blue-50 text-blue-700',
  reconciled: 'bg-green-50 text-green-700',
  paid:       'bg-emerald-50 text-emerald-700',
  unmatched:  'bg-red-50 text-red-700',
};

// ─── 컴포넌트 ────────────────────────────────────────────────────────────────

export default function FreeTravelSettlementsPage() {
  const [commissions, setCommissions] = useState<CommissionRow[]>([]);
  const [reports,     setReports]     = useState<ReportRow[]>([]);
  const [unmatchedRows, setUnmatchedRows] = useState<UnmatchedRow[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [loadError,   setLoadError]   = useState<string | null>(null);
  const [uploading,   setUploading]   = useState(false);
  const [reconcileResult, setReconcileResult] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [cRes, rRes] = await Promise.all([
        fetch('/api/admin/free-travel/commissions'),
        fetch('/api/admin/free-travel/reconcile'),
      ]);
      const uRes = await fetch('/api/admin/free-travel/unmatched');
      if (!cRes.ok || !rRes.ok) throw new Error('데이터 로드 실패');
      const [cData, rData, uData] = await Promise.all([cRes.json(), rRes.json(), uRes.ok ? uRes.json() : Promise.resolve({ unmatched: [] })]);
      setCommissions(cData.commissions ?? []);
      setReports(rData.reports ?? []);
      setUnmatchedRows(uData.unmatched ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '데이터 로드 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // KPI 집계
  const thisMonth = new Date().toISOString().slice(0, 7);
  const thisMonthRows = commissions.filter(c => c.created_at.startsWith(thisMonth));
  const estimatedThisMonth = thisMonthRows.reduce((s, c) => s + (c.estimated_krw ?? 0), 0);
  const prevReport = reports.find(r => r.reconciled);
  const pendingCount = commissions.filter(c => c.status === 'pending').length;
  const unmatchedCount = commissions.filter(c => c.status === 'unmatched').length;

  // OTA 리포트 JSON 업로드
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setReconcileResult(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);

      const res = await fetch('/api/admin/free-travel/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });
      const data = await res.json();

      if (res.ok) {
        const statusLabel =
          data.reportStatus === 'fully_reconciled' ? '전체 매칭 완료'
          : data.reportStatus === 'partially_reconciled' ? '부분 매칭'
          : '업로드 완료';
        setReconcileResult(`${statusLabel} · 자동매칭 ${data.matched}건 / 수동확인 ${data.unmatched}건 / 합계 ${data.totalKrw?.toLocaleString()}원`);
        loadData();
      } else {
        setReconcileResult(`오류: ${data.error}`);
      }
    } catch (err) {
      setReconcileResult(`파일 파싱 오류: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleResolveUnmatched = async (unmatchedId: string, targetCommissionId: string) => {
    const res = await fetch('/api/admin/free-travel/unmatched', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unmatchedId, targetCommissionId, reason: 'admin manual resolve' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setReconcileResult(`오류: ${data.error ?? '수동 매칭 실패'}`);
      return;
    }
    setReconcileResult('수동 매칭이 완료되었습니다.');
    loadData();
  };

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <div>
        <h1 className="text-[22px] font-bold text-[#191F28]">자유여행 정산</h1>
        <p className="text-[13px] text-[#8B95A1] mt-1">패키지 정산과 완전히 분리된 OTA 어필리에이트 커미션 추적</p>
      </div>

      {/* 로드 에러 */}
      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700 font-medium flex items-center gap-2">
          <span>⚠</span> {loadError}
          <button onClick={loadData} className="ml-auto text-red-600 underline text-[12px]">다시 시도</button>
        </div>
      )}

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: '이번달 예상 커미션', value: `${estimatedThisMonth.toLocaleString()}원`, sub: thisMonth },
          { label: '전월 확정 커미션', value: prevReport ? `${prevReport.total_krw.toLocaleString()}원` : '−', sub: prevReport?.report_month ?? '' },
          { label: '미매칭 세션', value: `${pendingCount}건`, sub: '매칭 대기' },
          { label: '수동 확인 필요', value: `${unmatchedCount}건`, sub: 'OTA 리포트 불일치' },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-white rounded-2xl border border-[#E5E7EB] p-4">
            <p className="text-[12px] text-[#8B95A1] font-medium">{label}</p>
            <p className="text-[22px] font-extrabold text-[#191F28] mt-1 tabular-nums">{value}</p>
            <p className="text-[11px] text-[#C9D0D6] mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* OTA 리포트 업로드 */}
      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5">
        <h2 className="text-[15px] font-bold text-[#191F28] mb-1">OTA 리포트 업로드</h2>
        <p className="text-[12px] text-[#8B95A1] mb-4">
          MRT 파트너센터에서 다운로드한 JSON 리포트를 업로드하면 자동 매칭합니다.<br />
          포맷: {"{ ota, reportMonth, items: [{ ref_id, sub_id?, amount_krw }] }"}
        </p>

        <label className="flex flex-col items-center justify-center border-2 border-dashed border-[#E5E7EB] rounded-xl py-8 cursor-pointer hover:border-[#3182F6] transition-colors">
          <span className="text-3xl mb-2">📁</span>
          <span className="text-[14px] font-semibold text-[#4E5968]">
            {uploading ? '업로드 중...' : 'JSON 파일 선택 또는 드래그'}
          </span>
          <input type="file" accept=".json" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>

        {reconcileResult && (
          <div className={`mt-3 px-4 py-3 rounded-xl text-[13px] font-medium ${
            reconcileResult.startsWith('오류') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
          }`}>
            {reconcileResult}
          </div>
        )}
      </div>

      {/* OTA 리포트 이력 */}
      {reports.length === 0 && !loading && !loadError && (
        <div className="bg-white rounded-2xl border border-[#E5E7EB] px-5 py-8 text-center text-[13px] text-[#8B95A1]">
          아직 업로드된 OTA 리포트가 없습니다. 위에서 JSON 파일을 업로드하세요.
        </div>
      )}
      {reports.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#F2F4F6]">
            <h2 className="text-[15px] font-bold text-[#191F28]">OTA 리포트 이력</h2>
          </div>
          <table className="w-full text-[13px]">
            <thead className="bg-[#F7F8FA]">
              <tr>
                {['OTA', '기간', '총액', '건수', '상태', '처리일'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[#8B95A1] font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F2F4F6]">
              {reports.map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-semibold">{r.ota.toUpperCase()}</td>
                  <td className="px-4 py-3 tabular-nums">{r.report_month}</td>
                  <td className="px-4 py-3 tabular-nums font-bold">{r.total_krw.toLocaleString()}원</td>
                  <td className="px-4 py-3 tabular-nums">{r.item_count}건</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${r.reconciled ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
                      {r.reconciled ? '매칭 완료' : '처리 전'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#8B95A1]">{r.reconciled_at?.slice(0, 10) ?? '−'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 커미션 현황 */}
      <div className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#F2F4F6] flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-[#191F28]">커미션 현황</h2>
          <span className="text-[12px] text-[#8B95A1]">{commissions.length}건</span>
        </div>
        {loading ? (
          <p className="px-5 py-8 text-center text-[#8B95A1]">불러오는 중...</p>
        ) : commissions.length === 0 ? (
          <p className="px-5 py-8 text-center text-[#8B95A1]">자유여행 검색 후 커미션이 생성됩니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-[#F7F8FA]">
                <tr>
                  {['여행지', 'OTA', '클릭', '예상 커미션', '확정', '상태', '생성일'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[#8B95A1] font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F4F6]">
                {commissions.map(c => (
                  <tr key={c.id} className="hover:bg-[#F7F8FA]">
                    <td className="px-4 py-3">{(c.free_travel_sessions as any)?.destination ?? '−'}</td>
                    <td className="px-4 py-3 font-semibold">{c.ota.toUpperCase()}</td>
                    <td className="px-4 py-3 tabular-nums">{c.click_count}회</td>
                    <td className="px-4 py-3 tabular-nums">{c.estimated_krw?.toLocaleString() ?? '−'}원</td>
                    <td className="px-4 py-3 tabular-nums font-semibold">{c.confirmed_krw?.toLocaleString() ?? '−'}원</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_COLOR[c.status] ?? 'bg-gray-50 text-gray-600'}`}>
                        {STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#8B95A1] tabular-nums">{c.created_at.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* unmatched 복구 큐 */}
      <div className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#F2F4F6] flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-[#191F28]">Unmatched 복구 큐</h2>
          <span className="text-[12px] text-[#8B95A1]">{unmatchedRows.length}건</span>
        </div>
        {unmatchedRows.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-[#8B95A1] text-center">수동 복구가 필요한 항목이 없습니다.</p>
        ) : (
          <div className="divide-y divide-[#F2F4F6]">
            {unmatchedRows.map(u => (
              <div key={u.id} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[13px] font-semibold text-[#191F28]">
                    {u.ota.toUpperCase()} · 리포트금액 {Number(u.confirmed_krw ?? 0).toLocaleString()}원
                  </p>
                  <span className="text-[11px] text-[#8B95A1]">{u.created_at.slice(0, 10)}</span>
                </div>
                {u.candidates.length === 0 ? (
                  <p className="text-[12px] text-[#8B95A1]">추천 후보가 없습니다. 보류 처리 후 재검토하세요.</p>
                ) : (
                  <div className="space-y-1.5">
                    {u.candidates.map(c => (
                      <div key={c.id} className="flex items-center justify-between border border-[#E5E7EB] rounded-lg px-3 py-2">
                        <p className="text-[12px] text-[#4E5968]">
                          후보 {c.id.slice(0, 8)} · 예상 {Number(c.estimated_krw ?? 0).toLocaleString()}원
                        </p>
                        <button
                          onClick={() => handleResolveUnmatched(u.id, c.id)}
                          className="text-[11px] font-semibold bg-[#3182F6] text-white px-2.5 py-1 rounded-md hover:bg-[#1b6cf2]"
                        >
                          수동 연결
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
