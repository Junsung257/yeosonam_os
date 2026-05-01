'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

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
}

function isPassportExpiringSoon(expiry?: string) {
  if (!expiry) return false;
  const d = new Date(expiry);
  const sixMonths = new Date();
  sixMonths.setMonth(sixMonths.getMonth() + 6);
  return d <= sixMonths;
}

function NewBookingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initCustomerId = searchParams.get('customerId') || '';
  const initCustomerName = searchParams.get('customerName') || '';

  const [packages, setPackages] = useState<Package[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState(initCustomerName);
  const [passengerSearch, setPassengerSearch] = useState('');
  const [selectedPassengers, setSelectedPassengers] = useState<Customer[]>([]);

  const [form, setForm] = useState({
    packageId: '',
    packageTitle: '',
    leadCustomerId: initCustomerId,
    adultCount: 1,
    childCount: 0,
    adultCost: 0,
    adultPrice: 0,
    childCost: 0,
    childPrice: 0,
    fuelSurcharge: 0,
    departureDate: '',
    notes: '',
  });

  // surcharge 항목별 분리 입력
  const [surchargeItems, setSurchargeItems] = useState<{ name: string; amount: number }[]>([]);

  const addSurchargeItem = () => setSurchargeItems(prev => [...prev, { name: '', amount: 0 }]);
  const removeSurchargeItem = (idx: number) => setSurchargeItems(prev => prev.filter((_, i) => i !== idx));
  const updateSurchargeItem = (idx: number, field: 'name' | 'amount', value: string | number) => {
    setSurchargeItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };
  const surchargeTotal = surchargeItems.reduce((s, item) => s + (item.amount || 0), 0);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 어필리에이트 선택
  const [affiliates, setAffiliates] = useState<{ id: string; name: string; referral_code: string; grade: number; grade_label: string; bonus_rate: number }[]>([]);
  const [selectedAffiliateId, setSelectedAffiliateId] = useState('');
  const [exchangeRate, setExchangeRate] = useState(1400);
  const [usdCost, setUsdCost] = useState(0);

  // 새 고객 인라인 등록
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({ name: '', phone: '', passport_no: '', passport_expiry: '', birth_date: '' });
  const [savingNewCustomer, setSavingNewCustomer] = useState(false);

  useEffect(() => {
    fetch('/api/packages').then(r => r.json()).then(d => setPackages(d.packages || []));
    fetch('/api/customers').then(r => r.json()).then(d => setCustomers(d.customers || []));
    fetch('/api/affiliates').then(r => r.json()).then(d => setAffiliates(d.affiliates || []));
    // 현재 환율 조회
    fetch('/api/exchange-rate').then(r => r.json()).then(d => {
      if (d.rate) setExchangeRate(d.rate);
    }).catch(() => {});
  }, []);

  const filteredCustomers = customerSearch.length >= 1
    ? customers.filter(c => c.name.includes(customerSearch) || (c.phone || '').includes(customerSearch))
    : [];

  const filteredPassengers = passengerSearch.length >= 1
    ? customers.filter(c =>
        (c.name.includes(passengerSearch) || (c.phone || '').includes(passengerSearch)) &&
        c.id !== form.leadCustomerId &&
        !selectedPassengers.find(p => p.id === c.id)
      )
    : [];

  const selectPackage = (pkg: Package) => {
    setForm(f => ({
      ...f,
      packageId: pkg.id,
      packageTitle: pkg.title,
      adultCost: pkg.price || 0,
      adultPrice: pkg.price ? Math.round(pkg.price * 1.09) : 0,
    }));
  };

  const saveNewCustomer = async () => {
    if (!newCustomerForm.name.trim()) { alert('이름을 입력해주세요.'); return; }
    setSavingNewCustomer(true);
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCustomerForm),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || '저장 실패'); return; }
      const newC = data.customer as Customer;
      setCustomers(prev => [newC, ...prev]);
      setSelectedPassengers(prev => [...prev, newC]);
      setShowNewCustomerForm(false);
      setNewCustomerForm({ name: '', phone: '', passport_no: '', passport_expiry: '', birth_date: '' });
    } catch { alert('고객 등록 중 오류가 발생했습니다.'); }
    finally { setSavingNewCustomer(false); }
  };

  const totalCost = form.adultCount * form.adultCost + form.childCount * form.childCost + form.fuelSurcharge + surchargeTotal;
  const totalPrice = form.adultCount * form.adultPrice + form.childCount * form.childPrice + form.fuelSurcharge + surchargeTotal;
  const margin = totalPrice - totalCost;

  const idempotencyKey = useRef(crypto.randomUUID());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.leadCustomerId) { setError('대표 예약자를 선택해주세요.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          idempotencyKey: idempotencyKey.current,
          passengerIds: selectedPassengers.map(p => p.id),
          affiliateId: selectedAffiliateId || undefined,
          bookingType: selectedAffiliateId ? 'AFFILIATE' : 'DIRECT',
          usdCost: usdCost > 0 ? usdCost : undefined,
          costSnapshotKrw: usdCost > 0 ? Math.round(usdCost * exchangeRate) : form.adultCost * form.adultCount,
          surchargeBreakdown: surchargeItems.length > 0
            ? Object.fromEntries(surchargeItems.filter(i => i.name && i.amount).map(i => [i.name, i.amount]))
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push('/admin/bookings');
    } catch (err) {
      setError(err instanceof Error ? err.message : '예약 생성 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-3xl mx-auto px-4">
        <div className="mb-4">
          <Link href="/admin/bookings" className="text-sm text-blue-600 hover:underline">← 예약 목록</Link>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-6">예약 등록</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 어필리에이트 연결 */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-3">예약 경로 (어필리에이트)</h2>
            <div className="flex gap-3 items-start">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">인플루언서/파트너 선택</label>
                <select
                  value={selectedAffiliateId}
                  onChange={e => setSelectedAffiliateId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">직접 예약 (어필리에이트 없음)</option>
                  {affiliates.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} [{a.referral_code}] {a.grade_label} — 기본+보너스 +{(a.bonus_rate * 100).toFixed(1)}%
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-40">
                <label className="block text-xs text-gray-500 mb-1">USD 원가 (자동 환산)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={usdCost || ''}
                  onChange={e => {
                    const v = parseFloat(e.target.value) || 0;
                    setUsdCost(v);
                    // KRW 원가 자동 세팅
                    if (v > 0) setForm(f => ({ ...f, adultCost: Math.round(v * exchangeRate) }));
                  }}
                  placeholder="0.00"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            {usdCost > 0 && (
              <p className="text-xs text-blue-500 mt-2">
                USD {usdCost.toFixed(2)} × {exchangeRate.toLocaleString()} = ₩{Math.round(usdCost * exchangeRate).toLocaleString()} (환율: {exchangeRate.toLocaleString()})
              </p>
            )}
          </div>

          {/* 상품 선택 */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-4">상품 선택</h2>
            <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
              {packages.map(pkg => (
                <button key={pkg.id} type="button" onClick={() => selectPackage(pkg)}
                  className={`text-left p-3 rounded-lg border transition ${
                    form.packageId === pkg.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <p className="font-medium text-gray-900 text-sm">{pkg.title}</p>
                  <p className="text-xs text-gray-500">{pkg.destination} {pkg.price && `· ${pkg.price.toLocaleString()}원`}</p>
                </button>
              ))}
              {packages.length === 0 && (
                <div className="text-center py-4 text-gray-400 text-sm">
                  승인된 상품이 없습니다.
                  <Link href="/admin" className="ml-2 text-blue-600 hover:underline">상품 관리</Link>
                </div>
              )}
            </div>
            {form.packageId && (
              <div className="mt-3 p-2 bg-blue-50 rounded text-sm text-blue-700">
                선택됨: {form.packageTitle}
                <button type="button" onClick={() => setForm(f => ({...f, packageId: '', packageTitle: ''}))}
                  className="ml-2 text-blue-400 hover:text-blue-600">×</button>
              </div>
            )}
          </div>

          {/* 대표 예약자 */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-4">대표 예약자</h2>
            <input
              type="text"
              value={customerSearch}
              onChange={e => setCustomerSearch(e.target.value)}
              placeholder="이름 또는 전화번호 검색"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
            />
            {filteredCustomers.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                {filteredCustomers.slice(0, 5).map(c => (
                  <button key={c.id} type="button"
                    onClick={() => { setForm(f => ({...f, leadCustomerId: c.id})); setCustomerSearch(c.name); }}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition ${form.leadCustomerId === c.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}>
                    {c.name} {c.phone && <span className="text-gray-400 ml-2">{c.phone}</span>}
                  </button>
                ))}
              </div>
            )}
            {form.leadCustomerId && (
              <p className="mt-2 text-xs text-green-600">✓ 대표예약자 선택됨</p>
            )}
          </div>

          {/* 동행자 */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">동행자 (선택)</h2>
              <button type="button" onClick={() => setShowNewCustomerForm(true)}
                className="text-xs bg-green-50 text-green-700 border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-100 transition">
                + 새 고객 등록
              </button>
            </div>
            <input
              type="text"
              value={passengerSearch}
              onChange={e => setPassengerSearch(e.target.value)}
              placeholder="이름 또는 전화번호 검색"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
            />
            {filteredPassengers.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden mb-2">
                {filteredPassengers.slice(0, 5).map(c => (
                  <button key={c.id} type="button"
                    onClick={() => { setSelectedPassengers(prev => [...prev, c]); setPassengerSearch(''); }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 text-gray-700 transition flex items-center gap-2">
                    <span>+ {c.name} {c.phone && <span className="text-gray-400 ml-2">{c.phone}</span>}</span>
                    {isPassportExpiringSoon(c.passport_expiry) && (
                      <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">여권만료임박</span>
                    )}
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
                      : 'bg-gray-100 text-gray-700'
                  }`}>
                    {isPassportExpiringSoon(p.passport_expiry) && '⚠️ '}
                    {p.name}
                    <button type="button" onClick={() => setSelectedPassengers(prev => prev.filter(x => x.id !== p.id))}
                      className="text-gray-400 hover:text-gray-600 ml-1">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 새 고객 인라인 등록 모달 */}
          {showNewCustomerForm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-sm w-full">
                <div className="p-4 border-b flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">새 고객 빠른 등록</h3>
                  <button type="button" onClick={() => setShowNewCustomerForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">이름 *</label>
                    <input value={newCustomerForm.name} onChange={e => setNewCustomerForm(f => ({...f, name: e.target.value}))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">전화번호</label>
                    <input value={newCustomerForm.phone} onChange={e => setNewCustomerForm(f => ({...f, phone: e.target.value}))}
                      placeholder="010-0000-0000"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">여권번호</label>
                      <input value={newCustomerForm.passport_no} onChange={e => setNewCustomerForm(f => ({...f, passport_no: e.target.value}))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">여권 만료일</label>
                      <input type="date" value={newCustomerForm.passport_expiry} onChange={e => setNewCustomerForm(f => ({...f, passport_expiry: e.target.value}))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">생년월일</label>
                    <input type="date" value={newCustomerForm.birth_date} onChange={e => setNewCustomerForm(f => ({...f, birth_date: e.target.value}))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button type="button" onClick={saveNewCustomer} disabled={savingNewCustomer}
                      className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 transition">
                      {savingNewCustomer ? '저장 중...' : '등록 후 동행자 추가'}
                    </button>
                    <button type="button" onClick={() => setShowNewCustomerForm(false)}
                      className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-200 transition">
                      취소
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 인원 및 금액 */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-4">인원 및 금액</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">성인 수</label>
                <input type="number" min={1} value={form.adultCount} onChange={e => setForm(f => ({...f, adultCount: +e.target.value}))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">소아 수</label>
                <input type="number" min={0} value={form.childCount} onChange={e => setForm(f => ({...f, childCount: +e.target.value}))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">성인 원가 (1인)</label>
                <input type="number" min={0} value={form.adultCost} onChange={e => setForm(f => ({...f, adultCost: +e.target.value}))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">성인 판매가 (1인)</label>
                <input type="number" min={0} value={form.adultPrice} onChange={e => setForm(f => ({...f, adultPrice: +e.target.value}))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">소아 원가 (1인)</label>
                <input type="number" min={0} value={form.childCost} onChange={e => setForm(f => ({...f, childCost: +e.target.value}))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">소아 판매가 (1인)</label>
                <input type="number" min={0} value={form.childPrice} onChange={e => setForm(f => ({...f, childPrice: +e.target.value}))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">유류할증료</label>
                <input type="number" min={0} value={form.fuelSurcharge} onChange={e => setForm(f => ({...f, fuelSurcharge: +e.target.value}))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">출발일</label>
                <input type="date" value={form.departureDate} onChange={e => setForm(f => ({...f, departureDate: e.target.value}))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            {/* 추가 비용 항목 (surcharge_breakdown) */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-700">추가 비용 항목 (커미션 제외)</label>
                <button type="button" onClick={addSurchargeItem}
                  className="text-xs text-blue-600 hover:text-blue-800">+ 항목 추가</button>
              </div>
              {surchargeItems.map((item, idx) => (
                <div key={idx} className="flex gap-2 mb-2">
                  <input type="text" placeholder="항목명 (싱글차지, 비자비 등)" value={item.name}
                    onChange={e => updateSurchargeItem(idx, 'name', e.target.value)}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <input type="number" placeholder="금액" value={item.amount || ''}
                    onChange={e => updateSurchargeItem(idx, 'amount', +e.target.value)}
                    className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <button type="button" onClick={() => removeSurchargeItem(idx)}
                    className="text-red-400 hover:text-red-600 text-sm px-2">✕</button>
                </div>
              ))}
              {surchargeTotal > 0 && (
                <p className="text-xs text-gray-500 mt-1">추가 비용 합계: {surchargeTotal.toLocaleString()}원</p>
              )}
            </div>

            {/* 합계 미리보기 */}
            <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">총 원가</span>
                <span className="font-medium">{totalCost.toLocaleString()}원</span>
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">총 판매가</span>
                <span className="font-medium">{totalPrice.toLocaleString()}원</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t border-gray-200 mt-1">
                <span className="text-gray-700 font-medium">마진</span>
                <span className={`font-bold ${margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>{margin.toLocaleString()}원</span>
              </div>
            </div>
          </div>

          {/* 메모 */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-3">메모 (선택)</h2>
            <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} rows={3}
              placeholder="특이사항, 요청사항 등"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          <div className="flex gap-3">
            <button type="submit" disabled={saving}
              className="flex-1 bg-blue-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 transition">
              {saving ? '저장 중...' : '예약 등록'}
            </button>
            <Link href="/admin/bookings" className="flex-1 text-center bg-gray-100 text-gray-700 py-3 rounded-xl text-sm hover:bg-gray-200 transition">
              취소
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function NewBookingPage() {
  return (
    <Suspense>
      <NewBookingForm />
    </Suspense>
  );
}
