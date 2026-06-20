'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
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
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  // papaparse 동적 임포트 (초기 번들 경량화)
  const papaRef = useRef<any>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dropzoneRef = useRef<HTMLDivElement | null>(null);
  const clearConfirmOpenRef = useRef(false);
  const clearConfirmDialogRef = useRef<HTMLDivElement | null>(null);
  const clearCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const clearTriggerRef = useRef<HTMLButtonElement | null>(null);
  const performanceTitleId = 'ad-performance-dashboard-title';
  const performanceDescriptionId = 'ad-performance-dashboard-description';
  const performanceStatusId = 'ad-performance-dashboard-status';
  const performanceDropzoneHelpId = 'ad-performance-dashboard-dropzone-help';
  const clearConfirmTitleId = 'ad-performance-clear-confirm-title';
  const clearConfirmDescriptionId = 'ad-performance-clear-confirm-description';
  const clearConfirmStatusId = 'ad-performance-clear-confirm-status';

  const closeClearConfirm = useCallback(() => {
    setClearConfirmOpen(false);
    window.setTimeout(() => {
      clearTriggerRef.current?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    clearConfirmOpenRef.current = clearConfirmOpen;
  }, [clearConfirmOpen]);

  useEffect(() => {
    import('papaparse').then(m => { papaRef.current = m.default ?? m; });
  }, []);

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const getFocusableElements = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );

    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      dropzoneRef.current?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (clearConfirmOpenRef.current) return;

      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (focusableElements.length === 1) {
        event.preventDefault();
        firstElement.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      window.setTimeout(() => {
        if (previousActiveElement && document.contains(previousActiveElement)) previousActiveElement.focus();
      }, 0);
    };
  }, [onClose]);

  useEffect(() => {
    if (!clearConfirmOpen) return undefined;

    const getFocusableElements = () => Array.from(
      clearConfirmDialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );

    const focusTimer = window.setTimeout(() => {
      clearCancelButtonRef.current?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeClearConfirm();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [clearConfirmOpen, closeClearConfirm]);

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

    const Papa = papaRef.current;
    if (!Papa) {
      setImportResult('CSV 파서 로딩 중...');
      setImporting(false);
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: { data: Record<string, string>[] }) => {
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

  const openClearConfirm = (trigger: HTMLButtonElement) => {
    clearTriggerRef.current = trigger;
    setClearConfirmOpen(true);
  };

  const handleClear = () => {
    clearPerformanceData();
    setRows([]);
    setImportResult('데이터 초기화 완료');
    setClearConfirmOpen(false);
    window.setTimeout(() => {
      dropzoneRef.current?.focus();
    }, 0);
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

  const openFilePicker = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = e => {
      const files = (e.target as HTMLInputElement).files;
      if (files) handleFiles(files);
    };
    input.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
        aria-label="성과 대시보드 닫기"
      />
      <div
        ref={dialogRef}
        className="relative flex h-dvh max-h-dvh w-full max-w-3xl flex-col bg-white shadow-admin-lg border-l border-admin-border-mid"
        role="dialog"
        aria-modal="true"
        aria-labelledby={performanceTitleId}
        aria-describedby={`${performanceDescriptionId} ${performanceStatusId}`}
      >
        {/* 헤더 */}
        <div className="bg-white border-b border-admin-border-mid px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 id={performanceTitleId} className="text-admin-lg font-semibold text-admin-text-2">Ad-Brain 성과 대시보드</h2>
            <p id={performanceDescriptionId} className="text-[11px] text-admin-muted mt-0.5">Meta CSV 드롭 → 자동 분석 → 다음 기획안에 RAG 반영</p>
          </div>
          <div className="flex items-center gap-2">
            {rows.length > 0 && (
              <button
                type="button"
                onClick={event => openClearConfirm(event.currentTarget)}
                aria-haspopup="dialog"
                aria-controls={clearConfirmOpen ? 'ad-performance-clear-confirm-dialog' : undefined}
                className="px-3 py-1.5 text-admin-xs text-red-500 border border-red-200 rounded hover:bg-red-50 transition"
              >
                초기화
              </button>
            )}
            <button type="button" aria-label="성과 대시보드 닫기" onClick={onClose} className="p-1.5 text-admin-muted-2 hover:text-admin-muted transition">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-5">
          <p id={performanceStatusId} role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {importing ? 'Meta Ads CSV 파일을 파싱 중입니다.' : importResult || `성과 데이터 ${rows.length}개, Winner 소재 ${winners.length}개입니다.`}
          </p>
          {/* ── CSV 드롭존 ────────────────────────────── */}
          <div
            ref={dropzoneRef}
            role="button"
            tabIndex={0}
            aria-label="Meta Ads CSV 파일 선택"
            aria-describedby={`${performanceDropzoneHelpId} ${performanceStatusId}`}
            onDragEnter={e => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={e => { e.preventDefault(); setDragActive(false); }}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            onClick={openFilePicker}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openFilePicker();
              }
            }}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition ${
              dragActive ? 'border-[#005d90] bg-blue-50' : 'border-admin-border-strong bg-admin-bg hover:border-slate-400'
            }`}
          >
            <p className="text-admin-base font-medium text-admin-text-2 mb-1">
              {importing ? '파싱 중...' : 'Meta Ads CSV 파일을 드래그하거나 클릭'}
            </p>
            <p id={performanceDropzoneHelpId} className="text-[11px] text-admin-muted-2">캠페인 이름에 YSN-XXX-XXXX 형식의 Tracking ID가 포함되어야 합니다</p>
          </div>

          {importResult && (
            <div role="status" aria-live="polite" className={`px-3 py-2 rounded text-admin-xs ${
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
                <div className="bg-white border border-admin-border-mid rounded-lg p-3">
                  <p className="text-[11px] text-admin-muted">총 소재</p>
                  <p className="text-xl font-bold text-admin-text-2">{rows.length}</p>
                </div>
                <div className="bg-white border border-admin-border-mid rounded-lg p-3">
                  <p className="text-[11px] text-admin-muted">평균 CTR</p>
                  <p className={`text-xl font-bold ${avgCtr >= 3 ? 'text-emerald-600' : 'text-admin-text-2'}`}>{avgCtr.toFixed(1)}%</p>
                </div>
                <div className="bg-white border border-admin-border-mid rounded-lg p-3">
                  <p className="text-[11px] text-admin-muted">총 전환</p>
                  <p className="text-xl font-bold text-[#005d90]">{totalConversions}</p>
                </div>
                <div className="bg-white border border-admin-border-mid rounded-lg p-3">
                  <p className="text-[11px] text-admin-muted">총 지출</p>
                  <p className="text-xl font-bold text-admin-text-2">₩{(totalSpend / 10000).toFixed(0)}만</p>
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
              <div className="bg-white border border-admin-border-mid rounded-lg p-4">
                <h3 className="text-admin-sm font-semibold text-admin-text-2 mb-3">CTR 비교 (상위 10개)</h3>
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
              <div className="bg-white border border-admin-border-mid rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-admin-border-mid flex items-center justify-between">
                  <h3 className="text-admin-sm font-semibold text-admin-text-2">소재별 성과</h3>
                  <div className="flex gap-1" role="group" aria-label="성과 정렬 기준">
                    {(['ctr', 'conversions', 'spend'] as const).map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSortBy(s)}
                        aria-pressed={sortBy === s}
                        className={`px-2 py-0.5 text-[10px] rounded transition ${sortBy === s ? 'bg-blue-600 text-white' : 'bg-admin-surface-2 text-admin-muted hover:bg-slate-200'}`}>
                        {s === 'ctr' ? 'CTR순' : s === 'conversions' ? '전환순' : '지출순'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-admin-bg border-b border-admin-border-mid">
                        <th className="text-[11px] font-semibold text-admin-muted py-1.5 px-3 text-left">ID</th>
                        <th className="text-[11px] font-semibold text-admin-muted py-1.5 px-3 text-left">목적지</th>
                        <th className="text-[11px] font-semibold text-admin-muted py-1.5 px-3 text-left">소구</th>
                        <th className="text-[11px] font-semibold text-admin-muted py-1.5 px-3 text-center">CTR</th>
                        <th className="text-[11px] font-semibold text-admin-muted py-1.5 px-3 text-center">전환</th>
                        <th className="text-[11px] font-semibold text-admin-muted py-1.5 px-3 text-right">지출</th>
                        <th className="text-[11px] font-semibold text-admin-muted py-1.5 px-3 text-center">상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(row => (
                        <tr key={row.creative_id} className="border-b border-admin-border hover:bg-admin-bg">
                          <td className="text-admin-xs text-admin-text-2 py-1.5 px-3 font-mono">{row.creative_id}</td>
                          <td className="text-admin-xs text-admin-muted py-1.5 px-3">{row.destination}</td>
                          <td className="text-admin-xs text-admin-muted py-1.5 px-3">{row.concept}</td>
                          <td className={`text-admin-xs py-1.5 px-3 text-center font-medium ${row.ctr >= 3 ? 'text-emerald-600' : 'text-admin-text-2'}`}>{row.ctr}%</td>
                          <td className="text-admin-xs text-admin-text-2 py-1.5 px-3 text-center">{row.conversions}</td>
                          <td className="text-admin-xs text-admin-text-2 py-1.5 px-3 text-right">₩{row.spend.toLocaleString()}</td>
                          <td className="text-admin-xs py-1.5 px-3 text-center">
                            {row.isWinner ? (
                              <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] rounded font-medium">Winner</span>
                            ) : (
                              <span className="text-admin-muted-2 text-[10px]">-</span>
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
            <div className="text-center py-12 text-admin-muted-2">
              <p className="text-admin-base mb-1">성과 데이터가 없습니다</p>
              <p className="text-[11px]">Meta Ads Manager에서 CSV를 다운로드하여 위에 드롭하세요</p>
            </div>
          )}
        </div>
      </div>
      {clearConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex h-dvh items-center justify-center overflow-y-auto bg-slate-900/40 px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div
            id="ad-performance-clear-confirm-dialog"
            ref={clearConfirmDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={clearConfirmTitleId}
            aria-describedby={`${clearConfirmDescriptionId} ${clearConfirmStatusId}`}
            tabIndex={-1}
            className="admin-scope w-full max-w-sm rounded-admin-md border border-admin-border-mid bg-admin-surface p-5 shadow-admin-xl"
          >
            <h3 id={clearConfirmTitleId} className="text-admin-h3 text-admin-text">
              성과 데이터 초기화
            </h3>
            <p id={clearConfirmDescriptionId} className="mt-2 text-admin-sm leading-6 text-admin-muted">
              현재 불러온 Meta Ads 성과 데이터 {rows.length}개를 이 브라우저에서 삭제합니다. 삭제 후 CSV를 다시 임포트해야 대시보드와 Winner 기준이 복구됩니다.
            </p>
            <p id={clearConfirmStatusId} role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              성과 데이터 초기화 확인창이 열렸습니다. 취소 또는 초기화 확정을 선택하세요.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                ref={clearCancelButtonRef}
                onClick={closeClearConfirm}
                className="rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 py-2 text-admin-sm font-medium text-admin-text-2 hover:bg-admin-surface-2 focus:outline-none focus:shadow-admin-focus"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="rounded-admin-sm border border-red-200 bg-red-50 px-3 py-2 text-admin-sm font-semibold text-red-700 hover:bg-red-100 focus:outline-none focus:shadow-admin-focus"
              >
                초기화 확정
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
