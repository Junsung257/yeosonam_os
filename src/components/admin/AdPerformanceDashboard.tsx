'use client';

import { useState, useCallback, useEffect } from 'react';
import Papa from 'papaparse';
import dynamic from 'next/dynamic';

const BarChart = dynamic(() => import('recharts').then(m => ({ default: m.BarChart })), { ssr: false });
const Bar = dynamic(() => import('recharts').then(m => ({ default: m.Bar })), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(m => ({ default: m.XAxis })), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(m => ({ default: m.YAxis })), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(m => ({ default: m.Tooltip })), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(m => ({ default: m.ResponsiveContainer })), { ssr: false });
const Cell = dynamic(() => import('recharts').then(m => ({ default: m.Cell })), { ssr: false });
import {
  parseCsvRow,
  savePerformanceData,
  getPerformanceData,
  clearPerformanceData,
  type AdPerformanceRow,
} from '@/lib/ad-brain';

interface AdPerformanceDashboardProps {
  onClose: () => void;
}

export default function AdPerformanceDashboard({ onClose }: AdPerformanceDashboardProps) {
  const [rows, setRows] = useState<AdPerformanceRow[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const [sortBy, setSortBy] = useState<'ctr' | 'conversions' | 'spend'>('ctr');

  // 초기 로드 (localStorage)
  useEffect(() => {
    setRows(getPerformanceData());
  }, []);

  // ── CSV 파싱 ───────────────────────────────────────────
  const handleFiles = useCallback((files: FileList | File[]) => {
    const file = Array.from(files).find(f => f.name.endsWith('.csv'));
    if (!file) {
      setImportResult('CSV 파일만 지원합니다.');
      return;
    }

    setImporting(true);
    setImportResult('');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed: AdPerformanceRow[] = [];
        let skipped = 0;

        for (const row of results.data as Record<string, string>[]) {
          const mapped = parseCsvRow(row);
          if (mapped) {
            parsed.push(mapped);
          } else {
            skipped++;
          }
        }

        if (parsed.length > 0) {
          savePerformanceData(parsed);
          setRows(getPerformanceData());
          setImportResult(`${parsed.length}개 소재 임포트 완료${skipped > 0 ? ` (${skipped}행 스킵 — Tracking ID 없음)` : ''}`);
        } else {
          setImportResult(`파싱 가능한 데이터가 없습니다. 캠페인 이름에 YSN-XXX-XXXX 형식의 Tracking ID가 필요합니다.`);
        }

        setImporting(false);
      },
      error: () => {
        setImportResult('CSV 파싱 실패. 파일 형식을 확인해주세요.');
        setImporting(false);
      },
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleClear = () => {
    if (!confirm('모든 성과 데이터를 삭제하시겠습니까?')) return;
    clearPerformanceData();
    setRows([]);
    setImportResult('데이터 초기화 완료');
  };

  // ── 정렬 ───────────────────────────────────────────────
  const sorted = [...rows].sort((a, b) => {
    if (sortBy === 'ctr') return b.ctr - a.ctr;
    if (sortBy === 'conversions') return b.conversions - a.conversions;
    return b.spend - a.spend;
  });

  const winners = rows.filter(r => r.isWinner);
  const avgCtr = rows.length > 0 ? (rows.reduce((s, r) => s + r.ctr, 0) / rows.length) : 0;
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalConversions = rows.reduce((s, r) => s + r.conversions, 0);

  // 차트 데이터 (상위 10개)
  const chartData = sorted.slice(0, 10).map(r => ({
    name: r.creative_id.replace('YSN-', ''),
    ctr: r.ctr,
    conversions: r.conversions,
    isWinner: r.isWinner,
  }));

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-3xl bg-white shadow-xl border-l border-slate-200 h-full flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-admin-lg font-semibold text-slate-800">Ad-Brain 성과 대시보드</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Meta CSV 드롭 → 자동 분석 → 다음 기획안에 RAG 반영</p>
          </div>
          <div className="flex items-center gap-2">
            {rows.length > 0 && (
              <button onClick={handleClear} className="px-3 py-1.5 text-admin-xs text-red-500 border border-red-200 rounded hover:bg-red-50 transition">
                초기화
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 transition">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* ── CSV 드롭존 ────────────────────────────── */}
          <div
            onDragEnter={e => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={e => { e.preventDefault(); setDragActive(false); }}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.csv';
              input.onchange = e => {
                const files = (e.target as HTMLInputElement).files;
                if (files) handleFiles(files);
              };
              input.click();
            }}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition ${
              dragActive ? 'border-[#005d90] bg-blue-50' : 'border-slate-300 bg-slate-50 hover:border-slate-400'
            }`}
          >
            <p className="text-admin-base font-medium text-slate-700 mb-1">
              {importing ? '파싱 중...' : 'Meta Ads CSV 파일을 드래그하거나 클릭'}
            </p>
            <p className="text-[11px] text-slate-400">캠페인 이름에 YSN-XXX-XXXX 형식의 Tracking ID가 포함되어야 합니다</p>
          </div>

          {importResult && (
            <div className={`px-3 py-2 rounded text-admin-xs ${
              importResult.includes('완료') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
              'bg-amber-50 text-amber-700 border border-amber-200'
            }`}>
              {importResult}
            </div>
          )}

          {/* ── KPI 카드 ──────────────────────────────── */}
          {rows.length > 0 && (
            <>
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-white border border-slate-200 rounded-lg p-3">
                  <p className="text-[11px] text-slate-500">총 소재</p>
                  <p className="text-xl font-bold text-slate-800">{rows.length}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-3">
                  <p className="text-[11px] text-slate-500">평균 CTR</p>
                  <p className={`text-xl font-bold ${avgCtr >= 3 ? 'text-emerald-600' : 'text-slate-800'}`}>{avgCtr.toFixed(1)}%</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-3">
                  <p className="text-[11px] text-slate-500">총 전환</p>
                  <p className="text-xl font-bold text-[#005d90]">{totalConversions}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-3">
                  <p className="text-[11px] text-slate-500">총 지출</p>
                  <p className="text-xl font-bold text-slate-800">₩{(totalSpend / 10000).toFixed(0)}만</p>
                </div>
              </div>

              {/* Winner 요약 */}
              {winners.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <p className="text-admin-xs font-semibold text-emerald-700 mb-1">Winner 소재 {winners.length}개</p>
                  <div className="flex flex-wrap gap-1.5">
                    {winners.slice(0, 5).map(w => (
                      <span key={w.creative_id} className="px-2 py-0.5 bg-white border border-emerald-300 rounded text-[11px] text-emerald-700">
                        {w.creative_id} — CTR {w.ctr}%
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* ── 차트 ──────────────────────────────── */}
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <h3 className="text-admin-sm font-semibold text-slate-800 mb-3">CTR 비교 (상위 10개)</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                    <Tooltip formatter={(v: unknown) => [`${v}%`, 'CTR'] as [string, string]} />
                    <Bar dataKey="ctr" radius={[3, 3, 0, 0]}>
                      {chartData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.isWinner ? '#059669' : '#94a3b8'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* ── 테이블 ────────────────────────────── */}
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-admin-sm font-semibold text-slate-800">소재별 성과</h3>
                  <div className="flex gap-1">
                    {(['ctr', 'conversions', 'spend'] as const).map(s => (
                      <button key={s} onClick={() => setSortBy(s)}
                        className={`px-2 py-0.5 text-[10px] rounded transition ${sortBy === s ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                        {s === 'ctr' ? 'CTR순' : s === 'conversions' ? '전환순' : '지출순'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-[11px] font-semibold text-slate-500 py-1.5 px-3 text-left">ID</th>
                        <th className="text-[11px] font-semibold text-slate-500 py-1.5 px-3 text-left">목적지</th>
                        <th className="text-[11px] font-semibold text-slate-500 py-1.5 px-3 text-left">소구</th>
                        <th className="text-[11px] font-semibold text-slate-500 py-1.5 px-3 text-center">CTR</th>
                        <th className="text-[11px] font-semibold text-slate-500 py-1.5 px-3 text-center">전환</th>
                        <th className="text-[11px] font-semibold text-slate-500 py-1.5 px-3 text-right">지출</th>
                        <th className="text-[11px] font-semibold text-slate-500 py-1.5 px-3 text-center">상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(row => (
                        <tr key={row.creative_id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="text-admin-xs text-slate-800 py-1.5 px-3 font-mono">{row.creative_id}</td>
                          <td className="text-admin-xs text-slate-600 py-1.5 px-3">{row.destination}</td>
                          <td className="text-admin-xs text-slate-600 py-1.5 px-3">{row.concept}</td>
                          <td className={`text-admin-xs py-1.5 px-3 text-center font-medium ${row.ctr >= 3 ? 'text-emerald-600' : 'text-slate-700'}`}>{row.ctr}%</td>
                          <td className="text-admin-xs text-slate-700 py-1.5 px-3 text-center">{row.conversions}</td>
                          <td className="text-admin-xs text-slate-700 py-1.5 px-3 text-right">₩{row.spend.toLocaleString()}</td>
                          <td className="text-admin-xs py-1.5 px-3 text-center">
                            {row.isWinner ? (
                              <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] rounded font-medium">Winner</span>
                            ) : (
                              <span className="text-slate-400 text-[10px]">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {rows.length === 0 && !importResult && (
            <div className="text-center py-12 text-slate-400">
              <p className="text-admin-base mb-1">성과 데이터가 없습니다</p>
              <p className="text-[11px]">Meta Ads Manager에서 CSV를 다운로드하여 위에 드롭하세요</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
