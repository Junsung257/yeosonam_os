'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Package {
  id: string;
  title: string;
  destination?: string;
  price?: number;
}

interface Customer {
  id: string;
  name: string;
  phone?: string;
  passport_expiry?: string;
  passport_no?: string;
}

interface Booking {
  id: string;
  booking_no?: string;
  package_id?: string;
  package_title?: string;
  lead_customer_id: string;
  adult_count: number;
  child_count: number;
  adult_cost: number;
  adult_price: number;
  child_cost: number;
  child_price: number;
  fuel_surcharge: number;
  total_cost?: number;
  total_price?: number;
  status: string;
  departure_date?: string;
  notes?: string;
  created_at: string;
  customers?: Customer;
  booking_passengers?: { customers: Customer }[];
}

const STATUS_OPTIONS = [
  { value: 'pending',          label: '예약접수' },
  { value: 'waiting_deposit',  label: '계약금 대기' },
  { value: 'deposit_paid',     label: '계약금 완납' },
  { value: 'waiting_balance',  label: '잔금 대기' },
  { value: 'fully_paid',       label: '완납' },
  { value: 'cancelled',        label: '취소' },
  { value: 'confirmed',        label: '예약확정 (레거시)' },
  { value: 'completed',        label: '결제완료 (레거시)' },
];

function isPassportExpiringSoon(expiry?: string) {
  if (!expiry) return false;
  const d = new Date(expiry);
  const sixMonths = new Date();
  sixMonths.setMonth(sixMonths.getMonth() + 6);
  return d <= sixMonths;
}

interface EditBookingClientProps {
  params: { id: string };
  initialBooking?: Booking;
  initialPackages?: Package[];
  initialCustomers?: Customer[];
}

export default function EditBookingClient({ params, initialBooking, initialPackages, initialCustomers }: EditBookingClientProps) {
  const { id } = params;
  const router = useRouter();

  const [booking, setBooking] = useState<Booking | null>(initialBooking ?? null);
  const [packages, setPackages] = useState<Package[]>(initialPackages ?? []);
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers ?? []);
  const [loading, setLoading] = useState(!initialBooking);

  const initPassengers = initialBooking
    ? (initialBooking.booking_passengers || []).map(bp => bp.customers).filter(c => c && c.id !== initialBooking.lead_customer_id)
    : [];

  const [form, setForm] = useState({
    packageId: initialBooking?.package_id || '',
    packageTitle: initialBooking?.package_title || '',
    leadCustomerId: initialBooking?.lead_customer_id || '',
    adultCount: initialBooking?.adult_count ?? 1,
    childCount: initialBooking?.child_count ?? 0,
    adultCost: initialBooking?.adult_cost ?? 0,
    adultPrice: initialBooking?.adult_price ?? 0,
    childCost: initialBooking?.child_cost ?? 0,
    childPrice: initialBooking?.child_price ?? 0,
    fuelSurcharge: initialBooking?.fuel_surcharge ?? 0,
    departureDate: initialBooking?.departure_date || '',
    notes: initialBooking?.notes || '',
    status: initialBooking?.status || 'pending',
  });

  const [selectedPassengers, setSelectedPassengers] = useState<Customer[]>(initPassengers);
  const [customerSearch, setCustomerSearch] = useState(initialBooking?.customers?.name || '');
  const [passengerSearch, setPassengerSearch] = useState('');
  const [customerMode, setCustomerMode] = useState<'view' | 'edit-info' | 'switch'>('view');
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCustomerPhone, setEditCustomerPhone] = useState('');
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [priceChangedReason, setPriceChangedReason] = useState('');
  const [originalPrices, setOriginalPrices] = useState<{
    adultCost: number; adultPrice: number; childCost: number; childPrice: number; fuelSurcharge: number;
  } | null>(initialBooking ? {
    adultCost: initialBooking.adult_cost,
    adultPrice: initialBooking.adult_price,
    childCost: initialBooking.child_cost,
    childPrice: initialBooking.child_price,
    fuelSurcharge: initialBooking.fuel_surcharge,
  } : null);

  useEffect(() => {
    if (initialBooking && initialPackages && initialCustomers) return;
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [bRes, pRes, cRes] = await Promise.all([
          fetch(`/api/bookings?id=${id}`),
          fetch('/api/packages?limit=200'),
          fetch('/api/customers'),
        ]);
        const bData = await bRes.json();
        const pData = await pRes.json();
        const cData = await cRes.json();

        const b: Booking = bData.booking;
        setBooking(b);
        setPackages(pData.packages || []);
        setCustomers(cData.customers || []);

        if (b) {
          setForm({
            packageId: b.package_id || '',
            packageTitle: b.package_title || '',
            leadCustomerId: b.lead_customer_id,
            adultCount: b.adult_count,
            childCount: b.child_count,
            adultCost: b.adult_cost,
            adultPrice: b.adult_price,
            childCost: b.child_cost,
            childPrice: b.child_price,
            fuelSurcharge: b.fuel_surcharge,
            departureDate: b.departure_date || '',
            notes: b.notes || '',
            status: b.status,
          });
          setOriginalPrices({
            adultCost: b.adult_cost,
            adultPrice: b.adult_price,
            childCost: b.child_cost,
            childPrice: b.child_price,
            fuelSurcharge: b.fuel_surcharge,
          });
          setCustomerSearch(b.customers?.name || '');
          const passengers = (b.booking_passengers || [])
            .map(bp => bp.customers)
            .filter(c => c && c.id !== b.lead_customer_id);
          setSelectedPassengers(passengers);
        }
      } catch (e) {
        console.error(e);
        setError('예약 정보를 불러오는데 실패했습니다.');
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const filteredCustomers = customerSearch.length >= 1
    ? customers.filter(c => c.name.includes(customerSearch) || (c.phone || '').includes(customerSearch))
    : [];

  // 현재 선택된 대표 고객 (form.leadCustomerId 기준)
  const currentLeadCustomer = customers.find(c => c.id === form.leadCustomerId)
    ?? (booking?.customers && booking.customers.id === form.leadCustomerId ? booking.customers : null);

  // 고객 정보 정정 (오기입 등): customers 테이블 자체를 PATCH
  const handleCustomerInfoSave = async () => {
    if (!form.leadCustomerId) return;
    if (!editCustomerName.trim()) { setError('이름은 비울 수 없습니다.'); return; }
    setSavingCustomer(true);
    setError('');
    try {
      const res = await fetch('/api/customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: form.leadCustomerId,
          name: editCustomerName.trim(),
          phone: editCustomerPhone.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '고객 정보 수정 실패');
      // 로컬 customers 목록 갱신 + booking 화면 표시 갱신
      setCustomers(prev => prev.map(c => c.id === form.leadCustomerId
        ? { ...c, name: editCustomerName.trim(), phone: editCustomerPhone.trim() || undefined }
        : c));
      setBooking(b => b && b.customers && b.customers.id === form.leadCustomerId
        ? { ...b, customers: { ...b.customers, name: editCustomerName.trim(), phone: editCustomerPhone.trim() || undefined } }
        : b);
      setCustomerSearch(editCustomerName.trim());
      setCustomerMode('view');
    } catch (e) {
      setError(e instanceof Error ? e.message : '고객 정보 수정 실패');
    } finally {
      setSavingCustomer(false);
    }
  };

  // 검색어로 새 고객 즉시 생성 + 즉시 대표 지정
  const handleCreateCustomer = async () => {
    const name = customerSearch.trim();
    if (!name) return;
    setSavingCustomer(true);
    setError('');
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, skipDedup: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.customer) throw new Error(data.error || '고객 추가 실패');
      const c: Customer = data.customer;
      setCustomers(prev => [...prev, c]);
      setForm(f => ({ ...f, leadCustomerId: c.id }));
      setCustomerSearch(c.name);
      setCustomerMode('view');
    } catch (e) {
      setError(e instanceof Error ? e.message : '고객 추가 실패');
    } finally {
      setSavingCustomer(false);
    }
  };

  const filteredPassengers = passengerSearch.length >= 1
    ? customers.filter(c =>
        (c.name.includes(passengerSearch) || (c.phone || '').includes(passengerSearch)) &&
        c.id !== form.leadCustomerId &&
        !selectedPassengers.find(p => p.id === c.id)
      )
    : [];

  const totalCost = form.adultCount * form.adultCost + form.childCount * form.childCost + form.fuelSurcharge;
  const totalPrice = form.adultCount * form.adultPrice + form.childCount * form.childPrice + form.fuelSurcharge;
  const margin = totalPrice - totalCost;
  const marginRate = totalPrice > 0 ? ((margin / totalPrice) * 100).toFixed(1) : '0';

  const hasPriceChanged = originalPrices && (
    form.adultCost !== originalPrices.adultCost ||
    form.adultPrice !== originalPrices.adultPrice ||
    form.childCost !== originalPrices.childCost ||
    form.childPrice !== originalPrices.childPrice ||
    form.fuelSurcharge !== originalPrices.fuelSurcharge
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.leadCustomerId) { setError('대표 예약자를 선택해주세요.'); return; }
    if (hasPriceChanged && !priceChangedReason.trim()) {
      setError('금액을 수정할 경우 수정 사유를 입력해야 합니다.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      const passengerIds = [form.leadCustomerId, ...selectedPassengers.map(p => p.id)];
      const res = await fetch('/api/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...form, passengerIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (hasPriceChanged && originalPrices) {
        await fetch('/api/audit-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'BOOKING_PRICE_EDIT',
            targetType: 'booking',
            targetId: id,
            description: `[${booking?.booking_no}] 금액 수정 — 사유: ${priceChangedReason}`,
            beforeValue: {
              adult_cost: originalPrices.adultCost,
              adult_price: originalPrices.adultPrice,
              child_cost: originalPrices.childCost,
              child_price: originalPrices.childPrice,
              fuel_surcharge: originalPrices.fuelSurcharge,
            },
            afterValue: {
              adult_cost: form.adultCost,
              adult_price: form.adultPrice,
              child_cost: form.childCost,
              child_price: form.childPrice,
              fuel_surcharge: form.fuelSurcharge,
            },
          }),
        });
        setOriginalPrices({
          adultCost: form.adultCost, adultPrice: form.adultPrice,
          childCost: form.childCost, childPrice: form.childPrice,
          fuelSurcharge: form.fuelSurcharge,
        });
        setPriceChangedReason('');
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '수정 실패');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-3xl mx-auto px-4 space-y-4">
          <div className="h-6 bg-slate-100 rounded animate-pulse w-40" />
          <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-6 space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 bg-slate-100 rounded animate-pulse w-24" />
                <div className="h-9 bg-slate-50 rounded-lg animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-3xl mx-auto px-4 text-center py-20">
          <p className="text-slate-500">예약을 찾을 수 없습니다.</p>
          <Link href="/admin/bookings" className="mt-4 inline-block text-blue-600 hover:underline text-sm">← 목록으로</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-3xl mx-auto px-4">
        <div className="mb-4 flex items-center justify-between">
          <Link href={`/admin/bookings/${id}`} className="text-sm text-blue-600 hover:underline">← 상세 보기</Link>
          <span className="font-mono text-xs text-slate-400">{booking.booking_no || id.slice(0, 8)}</span>
        </div>

        <h1 className="text-2xl font-bold text-slate-900 mb-6">예약 수정</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 상태 */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-slate-900 mb-4">예약 상태</h2>
            <div className="flex gap-2 flex-wrap">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, status: opt.value }))}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                    form.status === opt.value
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 상품 선택 */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-slate-900 mb-4">상품</h2>
            <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
              {packages.map(pkg => (
                <button key={pkg.id} type="button"
                  onClick={() => setForm(f => ({ ...f, packageId: pkg.id, packageTitle: pkg.title, adultCost: pkg.price || f.adultCost, adultPrice: pkg.price ? Math.round(pkg.price * 1.09) : f.adultPrice }))}
                  className={`text-left p-3 rounded-lg border transition ${
                    form.packageId === pkg.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                  }`}>
                  <p className="font-medium text-slate-900 text-sm">{pkg.title}</p>
                  <p className="text-xs text-slate-500">{pkg.destination} {pkg.price && `· ${pkg.price.toLocaleString()}원`}</p>
                </button>
              ))}
            </div>
            {form.packageId ? (
              <div className="mt-3 p-2 bg-blue-50 rounded text-sm text-blue-700 flex items-center justify-between">
                <span>{form.packageTitle}</span>
                <button type="button" onClick={() => setForm(f => ({ ...f, packageId: '', packageTitle: '' }))}
                  className="text-blue-400 hover:text-blue-600">×</button>
              </div>
            ) : (
              <div className="mt-2">
                <input
                  type="text"
                  value={form.packageTitle}
                  onChange={e => setForm(f => ({ ...f, packageTitle: e.target.value }))}
                  placeholder="상품명 직접 입력 (상품 미선택 시)"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>

          {/* 대표 예약자 */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-slate-900 mb-4">대표 예약자</h2>

            {/* 현재 선택 칩 */}
            {currentLeadCustomer && customerMode === 'view' && (
              <div className="flex items-center justify-between gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 text-sm truncate">{currentLeadCustomer.name}</p>
                  <p className="text-xs text-slate-500 truncate">{currentLeadCustomer.phone || '연락처 없음'}</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button type="button"
                    onClick={() => {
                      setEditCustomerName(currentLeadCustomer.name || '');
                      setEditCustomerPhone(currentLeadCustomer.phone || '');
                      setCustomerMode('edit-info');
                    }}
                    className="text-admin-xs text-blue-700 border border-blue-200 bg-white px-2.5 py-1 rounded-md hover:bg-blue-100 transition">
                    이름·연락처 정정
                  </button>
                  <button type="button"
                    onClick={() => { setCustomerSearch(''); setCustomerMode('switch'); }}
                    className="text-admin-xs text-slate-700 border border-slate-200 bg-white px-2.5 py-1 rounded-md hover:bg-slate-50 transition">
                    다른 고객으로 변경
                  </button>
                </div>
              </div>
            )}

            {/* 정보 정정 모드 (오기입 정정 — 같은 사람의 이름/전화 수정) */}
            {customerMode === 'edit-info' && (
              <div className="p-3 border border-amber-200 bg-amber-50 rounded-lg space-y-2">
                <p className="text-[11px] text-amber-800 font-medium">
                  ⚠️ 이 작업은 <b>customers 테이블의 고객 레코드 자체</b>를 수정합니다 — 이 고객이 등록된 모든 예약·블로그·자료에 동일하게 반영됩니다.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={editCustomerName}
                    onChange={e => setEditCustomerName(e.target.value)}
                    placeholder="이름"
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  <input type="text" value={editCustomerPhone}
                    onChange={e => setEditCustomerPhone(e.target.value)}
                    placeholder="010-0000-0000"
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div className="flex gap-1.5 justify-end">
                  <button type="button" onClick={() => setCustomerMode('view')}
                    className="text-admin-xs text-slate-600 px-3 py-1.5 rounded-md hover:bg-slate-100">취소</button>
                  <button type="button" onClick={handleCustomerInfoSave} disabled={savingCustomer}
                    className="text-admin-xs bg-amber-600 text-white px-3 py-1.5 rounded-md hover:bg-amber-700 disabled:opacity-50">
                    {savingCustomer ? '저장 중...' : '고객 정보 저장'}
                  </button>
                </div>
              </div>
            )}

            {/* 변경 모드 (다른 고객으로 교체) */}
            {(customerMode === 'switch' || !currentLeadCustomer) && (
              <div className="space-y-2">
                <input
                  type="text"
                  autoFocus={customerMode === 'switch'}
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  placeholder="이름 또는 전화번호로 기존 고객 검색"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {filteredCustomers.length > 0 && (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    {filteredCustomers.slice(0, 5).map(c => (
                      <button key={c.id} type="button"
                        onClick={() => { setForm(f => ({ ...f, leadCustomerId: c.id })); setCustomerSearch(c.name); setCustomerMode('view'); }}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition ${form.leadCustomerId === c.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'}`}>
                        {c.name} {c.phone && <span className="text-slate-400 ml-2">{c.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {customerSearch.trim().length >= 1 && filteredCustomers.length === 0 && (
                  <button type="button" onClick={handleCreateCustomer} disabled={savingCustomer}
                    className="w-full text-left px-4 py-2.5 text-sm bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition disabled:opacity-50">
                    {savingCustomer ? '추가 중...' : `+ "${customerSearch.trim()}" 신규 고객으로 추가하고 대표여행자로 지정`}
                  </button>
                )}
                {currentLeadCustomer && (
                  <button type="button" onClick={() => { setCustomerSearch(currentLeadCustomer.name); setCustomerMode('view'); }}
                    className="text-[11px] text-slate-500 hover:text-slate-700 underline">
                    ← 변경 취소 (현재 대표: {currentLeadCustomer.name})
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 동행자 */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-slate-900 mb-4">동행자</h2>
            <input
              type="text"
              value={passengerSearch}
              onChange={e => setPassengerSearch(e.target.value)}
              placeholder="이름 또는 전화번호 검색"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
            />
            {filteredPassengers.length > 0 && (
              <div className="border border-slate-200 rounded-lg overflow-hidden mb-2">
                {filteredPassengers.slice(0, 5).map(c => (
                  <button key={c.id} type="button"
                    onClick={() => { setSelectedPassengers(prev => [...prev, c]); setPassengerSearch(''); }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 text-slate-700 transition">
                    + {c.name} {c.phone && <span className="text-slate-400 ml-2">{c.phone}</span>}
                  </button>
                ))}
              </div>
            )}
            {selectedPassengers.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {selectedPassengers.map(p => (
                  <span key={p.id} className={`flex items-center gap-1 text-xs px-3 py-1 rounded-full ${
                    isPassportExpiringSoon(p.passport_expiry)
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : 'bg-slate-100 text-slate-700'
                  }`}>
                    {isPassportExpiringSoon(p.passport_expiry) && '⚠️ '}{p.name}
                    <button type="button" onClick={() => setSelectedPassengers(prev => prev.filter(x => x.id !== p.id))}
                      className="text-slate-400 hover:text-slate-600 ml-1">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 인원 및 금액 */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-slate-900 mb-4">인원 및 금액</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">성인 수</label>
                <input type="number" min={1} value={form.adultCount} onChange={e => setForm(f => ({ ...f, adultCount: +e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">소아 수</label>
                <input type="number" min={0} value={form.childCount} onChange={e => setForm(f => ({ ...f, childCount: +e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">성인 원가 (1인)</label>
                <input type="number" min={0} value={form.adultCost} onChange={e => setForm(f => ({ ...f, adultCost: +e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">성인 판매가 (1인)</label>
                <input type="number" min={0} value={form.adultPrice} onChange={e => setForm(f => ({ ...f, adultPrice: +e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">소아 원가 (1인)</label>
                <input type="number" min={0} value={form.childCost} onChange={e => setForm(f => ({ ...f, childCost: +e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">소아 판매가 (1인)</label>
                <input type="number" min={0} value={form.childPrice} onChange={e => setForm(f => ({ ...f, childPrice: +e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">유류할증료</label>
                <input type="number" min={0} value={form.fuelSurcharge} onChange={e => setForm(f => ({ ...f, fuelSurcharge: +e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {hasPriceChanged && (
                <div className="col-span-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <label className="block text-xs font-semibold text-amber-800 mb-1">
                    ⚠️ 금액 수정 사유 (필수)
                  </label>
                  <p className="text-xs text-amber-600 mb-2">금액이 변경되었습니다. 감사 로그에 기록됩니다.</p>
                  <textarea
                    value={priceChangedReason}
                    onChange={e => setPriceChangedReason(e.target.value)}
                    placeholder="수정 사유를 입력하세요 (예: 항공료 변동, 랜드사 요청, 고객 요청 할인 등)"
                    rows={2}
                    className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">출발일</label>
                <input type="date" value={form.departureDate} onChange={e => setForm(f => ({ ...f, departureDate: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-500">총 원가</span>
                <span className="font-medium">{totalCost.toLocaleString()}원</span>
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-500">총 판매가</span>
                <span className="font-medium">{totalPrice.toLocaleString()}원</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t border-slate-200 mt-1">
                <span className="text-slate-700 font-medium">마진</span>
                <div className="text-right">
                  <span className={`font-bold ${margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {margin.toLocaleString()}원
                  </span>
                  {totalPrice > 0 && (
                    <span className="text-xs text-slate-400 ml-2">({marginRate}%)</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 메모 */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-slate-900 mb-3">메모</h2>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3}
              placeholder="특이사항, 요청사항, 미정산 내역 등"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">✓ 수정이 저장되었습니다.</div>}

          <div className="flex gap-3">
            <button type="submit" disabled={saving}
              className="flex-1 bg-blue-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-slate-300 transition">
              {saving ? '저장 중...' : '수정 저장'}
            </button>
            <button type="button" onClick={() => router.push(`/admin/bookings/${id}`)}
              className="flex-1 text-center bg-slate-100 text-slate-700 py-3 rounded-xl text-sm hover:bg-slate-200 transition">
              상세 보기로
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
