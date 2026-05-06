'use client';
import { useState, useEffect, useCallback } from 'react';

interface FieldStat {
  field_path: string;
  total_count: number;
  critical_count: number;
  high_count: number;
  applied_total: number;
  most_common_category: string | null;
  last_correction_at: string;
}
interface CategoryStat {
  category: string;
  total_count: number;
  applied_total: number;
  critical_count: number;
  destinations: string[] | null;
}
interface DestinationStat {
  destination: string;
  total_count: number;
  critical_count: number;
  high_count: number;
  unique_fields: number;
  most_common_field: string | null;
  last_correction_at: string;
}

function SystemWeaknessPanel() {
  const [tab, setTab] = useState<'field' | 'category' | 'destination'>('field');
  const [fieldStats, setFieldStats] = useState<FieldStat[]>([]);
  const [categoryStats, setCategoryStats] = useState<CategoryStat[]>([]);
  const [destinationStats, setDestinationStats] = useState<DestinationStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    setStatsLoading(true);
    fetch(`/api/extractions/corrections?stats=${tab}`)
      .then(r => r.json())
      .then(json => {
        if (tab === 'field') setFieldStats(json.rows || []);
        if (tab === 'category') setCategoryStats(json.rows || []);
        if (tab === 'destination') setDestinationStats(json.rows || []);
      })
      .finally(() => setStatsLoading(false));
  }, [tab]);

  return (
    <div className="bg-gradient-to-br from-slate-50 to-blue-50 border border-slate-200 rounded-xl p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-bold text-slate-800">🔍 시스템 약점 자동 발견</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            정정 빈도 ↑ = 추출 정확도 ↓. 이 통계로 어디를 우선 개선할지 자동 도출됩니다.
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          {(['field', 'category', 'destination'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-2.5 py-1 rounded ${tab === t ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>
              {t === 'field' ? '필드별' : t === 'category' ? '카테고리별' : '목적지별'}
            </button>
          ))}
        </div>
      </div>

      {statsLoading ? (
        <p className="text-xs text-slate-400 py-3 text-center">분석 중…</p>
      ) : tab === 'field' ? (
        fieldStats.length === 0 ? <p className="text-xs text-slate-400 py-3 text-center">정정 데이터 누적 시 통계 표시</p>
        : (
          <table className="w-full text-xs">
            <thead><tr className="text-slate-500 border-b border-slate-200">
              <th className="text-left py-1.5">필드</th>
              <th className="text-right">총</th>
              <th className="text-right">CRIT</th>
              <th className="text-right">HIGH</th>
              <th className="text-right">prompt 주입</th>
              <th className="text-left pl-3">주 카테고리</th>
              <th className="text-right">최근</th>
            </tr></thead>
            <tbody>
              {fieldStats.slice(0, 10).map(s => (
                <tr key={s.field_path} className="border-b border-slate-100">
                  <td className="py-1.5 font-mono text-slate-700">{s.field_path}</td>
                  <td className="text-right font-bold text-slate-800">{s.total_count}</td>
                  <td className="text-right text-red-600">{s.critical_count || ''}</td>
                  <td className="text-right text-amber-600">{s.high_count || ''}</td>
                  <td className="text-right text-emerald-600">{s.applied_total}</td>
                  <td className="pl-3 text-slate-500">{s.most_common_category || '-'}</td>
                  <td className="text-right text-slate-400 text-[10px]">{new Date(s.last_correction_at).toLocaleDateString('ko-KR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : tab === 'category' ? (
        categoryStats.length === 0 ? <p className="text-xs text-slate-400 py-3 text-center">정정 데이터 누적 시 통계 표시</p>
        : (
          <table className="w-full text-xs">
            <thead><tr className="text-slate-500 border-b border-slate-200">
              <th className="text-left py-1.5">카테고리</th>
              <th className="text-right">총</th>
              <th className="text-right">CRIT</th>
              <th className="text-right">prompt 주입</th>
              <th className="text-left pl-3">관련 목적지</th>
            </tr></thead>
            <tbody>
              {categoryStats.map(s => (
                <tr key={s.category} className="border-b border-slate-100">
                  <td className="py-1.5 text-slate-700">{s.category}</td>
                  <td className="text-right font-bold text-slate-800">{s.total_count}</td>
                  <td className="text-right text-red-600">{s.critical_count || ''}</td>
                  <td className="text-right text-emerald-600">{s.applied_total}</td>
                  <td className="pl-3 text-slate-500">{(s.destinations || []).slice(0, 5).join(', ') || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        destinationStats.length === 0 ? <p className="text-xs text-slate-400 py-3 text-center">정정 데이터 누적 시 통계 표시</p>
        : (
          <table className="w-full text-xs">
            <thead><tr className="text-slate-500 border-b border-slate-200">
              <th className="text-left py-1.5">목적지</th>
              <th className="text-right">총</th>
              <th className="text-right">CRIT</th>
              <th className="text-right">HIGH</th>
              <th className="text-right">고유 필드 수</th>
              <th className="text-left pl-3">최빈 필드</th>
            </tr></thead>
            <tbody>
              {destinationStats.map(s => (
                <tr key={s.destination} className="border-b border-slate-100">
                  <td className="py-1.5 text-slate-700">📍 {s.destination}</td>
                  <td className="text-right font-bold text-slate-800">{s.total_count}</td>
                  <td className="text-right text-red-600">{s.critical_count || ''}</td>
                  <td className="text-right text-amber-600">{s.high_count || ''}</td>
                  <td className="text-right text-slate-600">{s.unique_fields}</td>
                  <td className="pl-3 font-mono text-slate-500 text-[10px]">{s.most_common_field || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}

interface Correction {
  id: string;
  field_path: string;
  reflection: string | null;
  before_value: unknown;
  after_value: unknown;
  raw_text_excerpt: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string | null;
  created_at: string;
  applied_count: number;
  land_operator_id: string | null;
  destination: string | null;
}

const SEVERITY_BG: Record<string, string> = {
  critical: 'bg-red-100 border-red-300 text-red-700',
  high: 'bg-amber-100 border-amber-300 text-amber-700',
  medium: 'bg-blue-100 border-blue-300 text-blue-700',
  low: 'bg-slate-100 border-slate-300 text-slate-600',
};

export default function CorrectionsPage() {
  const [items, setItems] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDestination, setFilterDestination] = useState('');
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'critical' | 'high' | 'medium'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editSeverity, setEditSeverity] = useState<string>('medium');
  const [editCategory, setEditCategory] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterDestination) params.set('destination', filterDestination);
      if (filterSeverity !== 'all') params.set('min_severity', filterSeverity);
      params.set('limit', '50');
      const res = await fetch(`/api/extractions/corrections?${params}`);
      const json = await res.json();
      setItems(Array.isArray(json.corrections) ? json.corrections : []);
    } finally {
      setLoading(false);
    }
  }, [filterDestination, filterSeverity]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (c: Correction) => {
    setEditingId(c.id);
    setEditText(c.reflection || '');
    setEditSeverity(c.severity);
    setEditCategory(c.category || '');
  };

  const saveEdit = async (id: string) => {
    await fetch('/api/extractions/corrections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        reflection: editText,
        severity: editSeverity,
        category: editCategory || null,
      }),
    });
    setEditingId(null);
    load();
  };

  const deactivate = async (id: string) => {
    if (!confirm('이 정정을 비활성화 하시겠습니까? (잘못 기록된 경우)')) return;
    await fetch('/api/extractions/corrections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: false }),
    });
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const stats = {
    total: items.length,
    critical: items.filter(i => i.severity === 'critical').length,
    high: items.filter(i => i.severity === 'high').length,
    applied: items.reduce((s, i) => s + (i.applied_count || 0), 0),
  };

  const renderValue = (v: unknown): string => {
    if (v === null || v === undefined) return '(없음)';
    if (typeof v === 'string') return v;
    return JSON.stringify(v).slice(0, 200);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">🧠 Reflexion 정정 메모리</h1>
          <p className="text-sm text-slate-500 mt-1">
            사장님이 정정한 케이스가 다음 등록의 prompt 에 자동 주입되어 같은 실수를 차단합니다 (Shinn et al. NeurIPS 2023).
          </p>
        </div>
        <a href="/admin/packages" className="px-3 py-1.5 bg-slate-100 text-slate-700 text-sm rounded-lg hover:bg-slate-200">← 패키지 목록</a>
      </div>

      {/* 시스템 약점 자동 발견 패널 */}
      <SystemWeaknessPanel />


      {/* 통계 */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <div className="text-xs text-slate-500">활성 정정 (현재 필터)</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{stats.total}</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="text-xs text-red-600">CRITICAL</div>
          <div className="text-2xl font-bold text-red-700 mt-1">{stats.critical}</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="text-xs text-amber-600">HIGH</div>
          <div className="text-2xl font-bold text-amber-700 mt-1">{stats.high}</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="text-xs text-emerald-600">총 prompt 주입 횟수</div>
          <div className="text-2xl font-bold text-emerald-700 mt-1">{stats.applied}</div>
          <div className="text-[10px] text-emerald-500 mt-0.5">학습 효과 측정 지표</div>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex gap-3 mb-4 items-center bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-3">
        <input
          type="text"
          value={filterDestination}
          onChange={e => setFilterDestination(e.target.value)}
          placeholder="목적지 필터 (예: 보홀)"
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 flex-1"
        />
        <div className="flex gap-1">
          {(['all', 'critical', 'high', 'medium'] as const).map(s => (
            <button key={s} onClick={() => setFilterSeverity(s)}
              className={`px-3 py-1.5 text-xs rounded-lg ${filterSeverity === s ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {s === 'all' ? '전체' : s.toUpperCase() + '↑'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4 space-y-2">
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-2/3" />
              <div className="h-3 bg-slate-100 rounded animate-pulse w-full" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14">
          <svg className="w-10 h-10 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" /></svg>
          <p className="text-admin-sm font-medium text-slate-500">활성 정정 메모리가 없습니다.</p>
          <p className="text-admin-xs text-slate-400">패키지를 인라인 편집하면 자동 적립됩니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(c => (
            <div key={c.id} className={`bg-white border rounded-xl p-4 border-slate-200`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 text-[10px] font-mono rounded border ${SEVERITY_BG[c.severity]}`}>
                      {c.severity.toUpperCase()}
                    </span>
                    {c.category && <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-100 text-slate-600">{c.category}</span>}
                    {c.destination && <span className="text-xs text-slate-500">📍 {c.destination}</span>}
                    {c.applied_count > 0 && <span className="text-xs text-emerald-600 font-bold">prompt 주입 {c.applied_count}회</span>}
                    <span className="text-[10px] text-slate-400 ml-auto">{new Date(c.created_at).toLocaleDateString('ko-KR')}</span>
                  </div>
                  <div className="mt-2 font-mono text-xs text-slate-700">field: <span className="text-blue-700">{c.field_path}</span></div>

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="bg-red-50 border border-red-100 rounded p-2">
                      <div className="text-[10px] text-red-600 font-bold mb-1">❌ 이전 (AI 생성)</div>
                      <div className="text-xs text-slate-700 font-mono whitespace-pre-wrap break-words">{renderValue(c.before_value)}</div>
                    </div>
                    <div className="bg-emerald-50 border border-emerald-100 rounded p-2">
                      <div className="text-[10px] text-emerald-600 font-bold mb-1">✅ 정답 (사장님 정정)</div>
                      <div className="text-xs text-slate-700 font-mono whitespace-pre-wrap break-words">{renderValue(c.after_value)}</div>
                    </div>
                  </div>

                  {editingId === c.id ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        placeholder="이 정정의 교훈을 한 문장으로 (예: '원문 일정 verbatim 우선 — 포함사항 표기 차용 금지')"
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 min-h-[60px]"
                      />
                      <div className="flex gap-2 items-center">
                        <select value={editSeverity} onChange={e => setEditSeverity(e.target.value)}
                          className="text-xs border rounded px-2 py-1.5">
                          <option value="critical">CRITICAL</option>
                          <option value="high">HIGH</option>
                          <option value="medium">MEDIUM</option>
                          <option value="low">LOW</option>
                        </select>
                        <select value={editCategory} onChange={e => setEditCategory(e.target.value)}
                          className="text-xs border rounded px-2 py-1.5">
                          <option value="">카테고리 선택</option>
                          <option value="hallucination">hallucination (환각)</option>
                          <option value="overcorrect">overcorrect (자동 정상화 위반)</option>
                          <option value="verbatim-violation">verbatim-violation (원문 변형)</option>
                          <option value="schema-mismatch">schema-mismatch</option>
                          <option value="missing">missing</option>
                          <option value="manual-correction">manual-correction</option>
                        </select>
                        <button onClick={() => saveEdit(c.id)}
                          className="px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700">저장</button>
                        <button onClick={() => setEditingId(null)}
                          className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs rounded-lg hover:bg-slate-200">취소</button>
                      </div>
                    </div>
                  ) : c.reflection ? (
                    <div className="mt-2 bg-blue-50 border border-blue-100 rounded p-2">
                      <span className="text-[10px] text-blue-600 font-bold">💡 교훈</span>
                      <p className="text-xs text-slate-700 mt-1">{c.reflection}</p>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-slate-400">교훈 미입력 — "교훈 입력" 으로 추가하면 prompt 효과 ↑</div>
                  )}
                </div>

                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button onClick={() => startEdit(c)}
                    className="px-2.5 py-1 bg-blue-600 text-white text-[10px] rounded hover:bg-blue-700">
                    {c.reflection ? '교훈 수정' : '교훈 입력'}
                  </button>
                  <button onClick={() => deactivate(c.id)}
                    className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[10px] rounded hover:bg-slate-200">
                    비활성화
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
