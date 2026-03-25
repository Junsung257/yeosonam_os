'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';

interface TenantProduct {
  id: string;
  title: string;
  destination?: string;
  category?: string;
}

interface InventoryBlock {
  id:              string;
  product_id:      string;
  date:            string;
  total_seats:     number;
  booked_seats:    number;
  available_seats: number;
  price_override?: number;
  status:          'OPEN' | 'CLOSED' | 'SOLDOUT';
  travel_packages?: { title: string; destination?: string };
}

interface DayModal {
  date:        string;
  product_id:  string;
  existing?:   InventoryBlock;
}

const STATUS_COLOR: Record<string, string> = {
  OPEN:    'bg-green-100 text-green-700 border-green-200',
  CLOSED:  'bg-gray-100 text-gray-500 border-gray-200',
  SOLDOUT: 'bg-red-100 text-red-600 border-red-200',
};

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

export default function TenantInventoryPage() {
  const params   = useParams();
  const tenantId = params.tenantId as string;

  const now = new Date();
  const [viewYear,  setViewYear]  = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-indexed

  const [products,  setProducts]  = useState<TenantProduct[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string>('');
  const [blocks,    setBlocks]    = useState<InventoryBlock[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [dayModal,  setDayModal]  = useState<DayModal | null>(null);
  const [modalForm, setModalForm] = useState({ total_seats: 0, status: 'OPEN', price_override: '' });
  const [saving,    setSaving]    = useState(false);

  // 상품 목록 로드
  useEffect(() => {
    fetch(`/api/tenant/products?tenant_id=${tenantId}`)
      .then(r => r.json())
      .then(d => {
        const prods = d.products ?? [];
        setProducts(prods);
        if (prods.length > 0 && !selectedProduct) setSelectedProduct(prods[0].id);
      });
  }, [tenantId, selectedProduct]);

  const loadBlocks = useCallback(async () => {
    if (!selectedProduct) return;
    setLoading(true);
    const from = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
    const to   = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${getDaysInMonth(viewYear, viewMonth)}`;
    const res  = await fetch(`/api/tenant/inventory?product_id=${selectedProduct}&from=${from}&to=${to}`);
    const data = await res.json();
    setBlocks(data.blocks ?? []);
    setLoading(false);
  }, [selectedProduct, viewYear, viewMonth]);

  useEffect(() => { loadBlocks(); }, [loadBlocks]);

  function openDayModal(day: number) {
    if (!selectedProduct) return;
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const existing = blocks.find(b => b.date === dateStr);
    setDayModal({ date: dateStr, product_id: selectedProduct, existing });
    setModalForm({
      total_seats:    existing?.total_seats ?? 0,
      status:         existing?.status ?? 'OPEN',
      price_override: existing?.price_override != null ? String(existing.price_override) : '',
    });
  }

  async function saveDayBlock(e: React.FormEvent) {
    e.preventDefault();
    if (!dayModal) return;
    setSaving(true);
    await fetch('/api/tenant/inventory', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id:     tenantId,
        product_id:    dayModal.product_id,
        date:          dayModal.date,
        total_seats:   modalForm.total_seats,
        booked_seats:  dayModal.existing?.booked_seats ?? 0,
        status:        modalForm.status,
        price_override: modalForm.price_override !== '' ? Number(modalForm.price_override) : null,
      }),
    });
    setSaving(false);
    setDayModal(null);
    await loadBlocks();
  }

  // 전월 일괄 복사
  async function copyPrevMonth() {
    const prevMonth = viewMonth === 0 ? 11 : viewMonth - 1;
    const prevYear  = viewMonth === 0 ? viewYear - 1 : viewYear;
    const from = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;
    const to   = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${getDaysInMonth(prevYear, prevMonth)}`;
    const res  = await fetch(`/api/tenant/inventory?product_id=${selectedProduct}&from=${from}&to=${to}`);
    const { blocks: prevBlocks }: { blocks: InventoryBlock[] } = await res.json();
    if (!prevBlocks.length) { alert('전월 재고 데이터가 없습니다.'); return; }

    const newBlocks = prevBlocks.map(b => {
      const day = b.date.slice(8);
      const maxDay = getDaysInMonth(viewYear, viewMonth);
      const dayNum = parseInt(day);
      if (dayNum > maxDay) return null;
      return {
        tenant_id:     tenantId,
        product_id:    selectedProduct,
        date:          `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${day}`,
        total_seats:   b.total_seats,
        booked_seats:  0,
        status:        b.status,
        price_override: b.price_override,
      };
    }).filter(Boolean);

    await fetch('/api/tenant/inventory', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks: newBlocks }),
    });
    await loadBlocks();
  }

  // 달력 생성
  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDow    = new Date(viewYear, viewMonth, 1).getDay(); // 0=일
  const blockMap    = new Map(blocks.map(b => [b.date, b]));

  const monthLabel = `${viewYear}년 ${viewMonth + 1}월`;

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">재고 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">날짜를 클릭해 좌석/상태를 설정하세요.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={selectedProduct}
            onChange={e => setSelectedProduct(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="">상품 선택</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); }}
              className="px-2 py-1.5 border rounded text-sm hover:bg-gray-50"
            >←</button>
            <span className="text-sm font-semibold text-gray-700 px-2">{monthLabel}</span>
            <button
              onClick={() => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); }}
              className="px-2 py-1.5 border rounded text-sm hover:bg-gray-50"
            >→</button>
          </div>
          <button
            onClick={copyPrevMonth}
            disabled={!selectedProduct}
            className="text-xs border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            📋 전월 일괄 복사
          </button>
        </div>
      </div>

      {/* 달력 */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 border-b bg-gray-50">
          {['일','월','화','수','목','금','토'].map((d, i) => (
            <div key={d} className={`px-2 py-2.5 text-center text-xs font-semibold ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-600'}`}>
              {d}
            </div>
          ))}
        </div>

        {/* 날짜 셀 */}
        <div className="grid grid-cols-7">
          {/* 빈 셀 (첫 주 패딩) */}
          {Array.from({ length: firstDow }).map((_, i) => (
            <div key={`empty-${i}`} className="border-b border-r min-h-[80px] bg-gray-50" />
          ))}

          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day     = i + 1;
            const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const block   = blockMap.get(dateStr);
            const dow     = (firstDow + i) % 7;
            const isToday = dateStr === new Date().toISOString().slice(0, 10);

            return (
              <div
                key={day}
                onClick={() => openDayModal(day)}
                className={`border-b border-r min-h-[80px] p-2 cursor-pointer hover:bg-indigo-50 transition ${
                  !selectedProduct ? 'opacity-40 cursor-not-allowed' : ''
                } ${isToday ? 'bg-indigo-50' : ''}`}
              >
                <div className={`text-sm font-semibold mb-1 ${
                  dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-700'
                } ${isToday ? 'text-indigo-700' : ''}`}>
                  {day}
                  {isToday && <span className="ml-1 text-xs text-indigo-500">오늘</span>}
                </div>
                {block ? (
                  <div className={`text-xs rounded px-1.5 py-0.5 border font-medium ${STATUS_COLOR[block.status]}`}>
                    {block.status === 'SOLDOUT' ? '매진' :
                     block.status === 'CLOSED'  ? '마감' :
                     `${block.available_seats}석`}
                    {block.price_override != null && (
                      <div className="text-xs opacity-70">₩{fmt(block.price_override)}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-gray-300">-</div>
                )}
              </div>
            );
          })}
        </div>

        {loading && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
            <span className="text-sm text-gray-400 animate-pulse">로딩 중...</span>
          </div>
        )}
      </div>

      {/* 범례 */}
      <div className="flex gap-4 text-xs text-gray-500">
        {Object.entries(STATUS_COLOR).map(([s, c]) => (
          <span key={s} className={`px-2 py-0.5 rounded border ${c}`}>
            {s === 'OPEN' ? '● 판매 중' : s === 'CLOSED' ? '● 마감' : '● 매진'}
          </span>
        ))}
        <span className="text-gray-400">※ 날짜 클릭으로 재고 설정</span>
      </div>

      {/* 날짜 재고 모달 */}
      {dayModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-1">{dayModal.date} 재고 설정</h3>
            <p className="text-xs text-gray-400 mb-4">
              {products.find(p => p.id === dayModal.product_id)?.title}
            </p>
            <form onSubmit={saveDayBlock} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">총 좌석 수</label>
                <input
                  type="number" min="0" value={modalForm.total_seats}
                  onChange={e => setModalForm(f => ({ ...f, total_seats: Number(e.target.value) }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                {dayModal.existing && (
                  <p className="text-xs text-gray-400 mt-1">
                    예약 {dayModal.existing.booked_seats}석 / 잔여 {dayModal.existing.available_seats}석
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">상태</label>
                <select
                  value={modalForm.status}
                  onChange={e => setModalForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <option value="OPEN">OPEN — 판매 중</option>
                  <option value="CLOSED">CLOSED — 마감</option>
                  <option value="SOLDOUT">SOLDOUT — 매진</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">가격 오버라이드 (비워두면 기본가)</label>
                <input
                  type="number" min="0" value={modalForm.price_override}
                  onChange={e => setModalForm(f => ({ ...f, price_override: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="예: 1200000"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setDayModal(null)}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-xl text-sm hover:bg-gray-50">
                  취소
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 bg-indigo-600 text-white py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
