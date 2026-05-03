'use client';

import { useState, useEffect, useCallback } from 'react';

interface CompetitorPrice {
  id: string;
  destination: string;
  duration: string;
  competitor: string;
  price: number;
  departure_date: string | null;
  source_url: string | null;
  recorded_by: string | null;
  recorded_at: string;
}

interface YeosonamPrice {
  destination: string;
  duration_days: number;
  min_price: number;
  title: string;
}

const COMPETITORS = ['하나투어', '모두투어', '노랑풍선', '참좋은여행', '자유투어', '기타'];

const fmt만 = (n: number) =>
  n >= 10000
    ? `${Math.floor(n / 10000).toLocaleString()}만${n % 10000 > 0 ? ` ${(n % 10000).toLocaleString()}` : ''}원`
    : `${n.toLocaleString()}원`;

export default function CompetitorPricesPage() {
  const [competitorData, setCompetitorData] = useState<CompetitorPrice[]>([]);
  const [yeosonamPrices, setYeosonamPrices] = useState<YeosonamPrice[]>([]);
  const [filterDest, setFilterDest] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 폼 상태
  const [form, setForm] = useState({
    destination: '',
    duration: '',
    competitor: '',
    price: '',
    departureDate: '',
    sourceUrl: '',
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterDest ? `?destination=${encodeURIComponent(filterDest)}` : '';
      const res = await fetch(`/api/admin/competitor-prices${params}`);
      const json = await res.json();
      setCompetitorData(json.data ?? []);
      setYeosonamPrices(json.yeosonamPrices ?? []);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '데이터 로드 실패');
    } finally {
      setLoading(false);
    }
  }, [filterDest]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const price = parseInt(form.price.replace(/,/g, ''), 10);
    if (!form.destination || !form.duration || !form.competitor || isNaN(price)) {
      setErrorMsg('목적지, 기간, 경쟁사, 가격은 필수입니다.');
      return;
    }

    setSubmitLoading(true);
    try {
      const res = await fetch('/api/admin/competitor-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: form.destination,
          duration: form.duration,
          competitor: form.competitor,
          price,
          departureDate: form.departureDate || undefined,
          sourceUrl: form.sourceUrl || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error ?? '등록 실패');
        return;
      }
      setSuccessMsg('경쟁사 가격이 등록되었습니다.');
      setForm({ destination: '', duration: '', competitor: '', price: '', departureDate: '', sourceUrl: '' });
      void fetchData();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '네트워크 오류');
    } finally {
      setSubmitLoading(false);
    }
  };

  // 비교 테이블: destination + duration 기준으로 그루핑
  const grouped = competitorData.reduce<Record<string, CompetitorPrice[]>>((acc, row) => {
    const key = `${row.destination} / ${row.duration}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  // 여소남 최저가 맵 (destination + duration_days → min_price)
  const yeosonamMap = yeosonamPrices.reduce<Record<string, number>>((acc, y) => {
    acc[y.destination] = y.min_price;
    return acc;
  }, {});

  const destinations = Array.from(new Set(competitorData.map((d) => d.destination)));

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">경쟁사 가격 비교</h1>
        <p className="text-sm text-gray-500 mt-1">
          경쟁사 가격을 수동 입력하고 여소남 최저가와 비교합니다.
        </p>
      </div>

      {/* 가격 입력 폼 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-semibold text-gray-800 mb-4">새 가격 입력</h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">목적지 *</label>
            <input
              value={form.destination}
              onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))}
              placeholder="싱가포르"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">기간 *</label>
            <input
              value={form.duration}
              onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
              placeholder="4박5일"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">경쟁사 *</label>
            <select
              value={form.competitor}
              onChange={(e) => setForm((f) => ({ ...f, competitor: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">선택</option>
              {COMPETITORS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">가격 (원) *</label>
            <input
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              placeholder="1290000"
              type="number"
              min={0}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">출발일 (선택)</label>
            <input
              value={form.departureDate}
              onChange={(e) => setForm((f) => ({ ...f, departureDate: e.target.value }))}
              type="date"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">참고 URL (선택)</label>
            <input
              value={form.sourceUrl}
              onChange={(e) => setForm((f) => ({ ...f, sourceUrl: e.target.value }))}
              placeholder="https://..."
              type="url"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="col-span-2 sm:col-span-3 flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={submitLoading}
              className="bg-blue-600 text-white font-semibold px-5 py-2 rounded-lg hover:bg-blue-700 active:scale-95 transition disabled:opacity-50 text-sm"
            >
              {submitLoading ? '등록 중...' : '가격 등록'}
            </button>
            {successMsg && <p className="text-green-600 text-sm">{successMsg}</p>}
            {errorMsg && <p className="text-red-600 text-sm">{errorMsg}</p>}
          </div>
        </form>
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">목적지 필터:</label>
        <select
          value={filterDest}
          onChange={(e) => setFilterDest(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">전체</option>
          {destinations.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <button
          onClick={() => void fetchData()}
          className="text-sm text-blue-600 hover:underline"
        >
          새로고침
        </button>
      </div>

      {/* 비교 테이블 */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          등록된 경쟁사 가격이 없습니다. 위 폼에서 입력해주세요.
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([groupKey, rows]) => {
            const destName = groupKey.split(' / ')[0];
            const yeosonamMin = yeosonamMap[destName];

            return (
              <div key={groupKey} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800">{groupKey}</h3>
                  {yeosonamMin != null && (
                    <span className="text-xs bg-blue-100 text-blue-700 font-medium px-2.5 py-1 rounded-full">
                      여소남 최저가: {fmt만(yeosonamMin)}
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">경쟁사</th>
                        <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">가격</th>
                        {yeosonamMin != null && (
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">
                            여소남 대비
                          </th>
                        )}
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">출발일</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">입력일</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">출처</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const diff = yeosonamMin != null ? row.price - yeosonamMin : null;
                        const diffPct =
                          yeosonamMin != null && yeosonamMin > 0
                            ? ((diff! / yeosonamMin) * 100).toFixed(1)
                            : null;

                        return (
                          <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium text-gray-800">{row.competitor}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900">
                              {fmt만(row.price)}
                            </td>
                            {yeosonamMin != null && (
                              <td className="px-4 py-3 text-right">
                                {diff != null && (
                                  <span
                                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                      diff > 0
                                        ? 'bg-red-100 text-red-600'
                                        : diff < 0
                                        ? 'bg-green-100 text-green-600'
                                        : 'bg-gray-100 text-gray-500'
                                    }`}
                                  >
                                    {diff > 0 ? '+' : ''}{fmt만(diff)} ({diffPct}%)
                                  </span>
                                )}
                              </td>
                            )}
                            <td className="px-4 py-3 text-gray-500 text-xs">
                              {row.departure_date ?? '—'}
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-xs">
                              {new Date(row.recorded_at).toLocaleDateString('ko-KR')}
                            </td>
                            <td className="px-4 py-3">
                              {row.source_url ? (
                                <a
                                  href={row.source_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-500 hover:underline text-xs"
                                >
                                  링크
                                </a>
                              ) : (
                                <span className="text-gray-300 text-xs">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
