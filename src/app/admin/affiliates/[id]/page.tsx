'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Affiliate {
  id: string; name: string; phone?: string; email?: string;
  referral_code: string; grade: number; grade_label: string;
  bonus_rate: number; payout_type: 'PERSONAL' | 'BUSINESS';
  booking_count: number; total_commission: number; memo?: string;
  bank_info?: string; // 마스킹된 계좌
}

interface Settlement {
  id: string; settlement_period: string; qualified_booking_count: number;
  total_amount: number; carryover_balance: number; final_total: number;
  tax_deduction: number; final_payout: number;
  status: 'PENDING' | 'READY' | 'COMPLETED' | 'VOID';
  settled_at?: string; created_at: string;
}

const GRADE_COLORS: Record<number, string> = {
  1: 'bg-amber-100 text-amber-800', 2: 'bg-gray-200 text-gray-700',
  3: 'bg-yellow-200 text-yellow-800', 4: 'bg-blue-100 text-blue-800',
  5: 'bg-purple-100 text-purple-800',
};

const GRADE_NEXT: Record<number, { label: string; target: number; prevTarget: number }> = {
  1: { label: '실버', target: 10, prevTarget: 0 },
  2: { label: '골드', target: 30, prevTarget: 10 },
  3: { label: '플래티넘', target: 50, prevTarget: 30 },
  4: { label: '다이아', target: 100, prevTarget: 50 },
  5: { label: '최고 등급', target: 100, prevTarget: 100 },
};

const STATUS_BADGES: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  READY: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  VOID: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: '이월 대기', READY: '지급 대기', COMPLETED: '지급 완료', VOID: '취소됨',
};

export default function AffiliateDetailPage() {
  const params = useParams<{ id: string }>();
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBankInfo, setShowBankInfo] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', memo: '', payout_type: 'PERSONAL' as 'PERSONAL'|'BUSINESS' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, sRes] = await Promise.all([
        fetch(`/api/affiliates?id=${params.id}&showBankInfo=false`),
        fetch(`/api/settlements?affiliateId=${params.id}`),
      ]);
      const aJson = await aRes.json();
      const sJson = await sRes.json();
      setAffiliate(aJson.affiliate);
      setSettlements(sJson.settlements || []);
      if (aJson.affiliate) {
        setForm({
          name: aJson.affiliate.name,
          phone: aJson.affiliate.phone || '',
          email: aJson.affiliate.email || '',
          memo: aJson.affiliate.memo || '',
          payout_type: aJson.affiliate.payout_type,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  const toggleBankInfo = async () => {
    const res = await fetch(`/api/affiliates?id=${params.id}&showBankInfo=true`);
    const json = await res.json();
    setAffiliate(prev => prev ? { ...prev, bank_info: json.affiliate?.bank_info } : prev);
    setShowBankInfo(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/affiliates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: params.id, ...form }),
      });
      setEditMode(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  // 이번 달 정산 예정액 계산
  const thisMonth = new Date().toISOString().substring(0, 7);
  const thisMonthSettlement = settlements.find(s => s.settlement_period === thisMonth);

  if (loading) return <div className="p-6 text-gray-400">불러오는 중...</div>;
  if (!affiliate) return <div className="p-6 text-red-500">어필리에이트를 찾을 수 없습니다.</div>;

  const gradeInfo = GRADE_NEXT[affiliate.grade];
  const progress = affiliate.grade < 5
    ? Math.round(
        ((affiliate.booking_count - gradeInfo.prevTarget) /
         (gradeInfo.target - gradeInfo.prevTarget)) * 100
      )
    : 100;
  const remaining = Math.max(0, gradeInfo.target - affiliate.booking_count);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* 뒤로가기 */}
      <Link href="/admin/affiliates" className="text-sm text-gray-500 hover:text-gray-700">
        ← 파트너 목록
      </Link>

      {/* 파트너 기본 정보 */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">{affiliate.name}</h1>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${GRADE_COLORS[affiliate.grade]}`}>
                {affiliate.grade_label}
              </span>
            </div>
            <p className="text-sm text-gray-500 font-mono mt-1">코드: {affiliate.referral_code}</p>
            {affiliate.phone && <p className="text-sm text-gray-500">{affiliate.phone}</p>}
          </div>
          <button
            onClick={() => setEditMode(!editMode)}
            className="text-sm text-blue-600 hover:underline"
          >
            {editMode ? '취소' : '정보 수정'}
          </button>
        </div>

        {editMode ? (
          <div className="space-y-3 border-t pt-4">
            {[
              { label: '이름', key: 'name', type: 'text' },
              { label: '연락처', key: 'phone', type: 'tel' },
              { label: '이메일', key: 'email', type: 'email' },
            ].map(f => (
              <div key={f.key} className="flex items-center gap-3">
                <label className="w-16 text-xs text-gray-500">{f.label}</label>
                <input
                  type={f.type}
                  value={(form as any)[f.key]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <label className="w-16 text-xs text-gray-500">정산유형</label>
              <select
                value={form.payout_type}
                onChange={e => setForm(prev => ({ ...prev, payout_type: e.target.value as 'PERSONAL'|'BUSINESS' }))}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="PERSONAL">개인 (3.3%)</option>
                <option value="BUSINESS">사업자</option>
              </select>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 border-t pt-4 text-sm">
            <div><span className="text-gray-400">이메일 </span>{affiliate.email || '-'}</div>
            <div><span className="text-gray-400">정산유형 </span>
              {affiliate.payout_type === 'PERSONAL' ? '개인 (원천세 3.3%)' : '사업자'}
            </div>
            <div>
              <span className="text-gray-400">계좌 </span>
              {showBankInfo
                ? <span className="font-mono text-red-600">{affiliate.bank_info || '등록 없음'}</span>
                : <button onClick={toggleBankInfo} className="text-blue-500 hover:underline text-xs">
                    {affiliate.bank_info || '클릭하여 확인'}
                  </button>
              }
            </div>
            {affiliate.memo && <div className="col-span-2 text-gray-500">{affiliate.memo}</div>}
          </div>
        )}
      </div>

      {/* KPI 카드 3종 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 등급 & 진행률 */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs text-gray-500 mb-2">등급 진행률</p>
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2 py-0.5 rounded-full text-sm font-bold ${GRADE_COLORS[affiliate.grade]}`}>
              {affiliate.grade_label}
            </span>
            {affiliate.grade < 5 && (
              <span className="text-xs text-gray-400">→ {gradeInfo.label}</span>
            )}
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3 mb-2">
            <div
              className="bg-purple-500 h-3 rounded-full transition-all"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">
            {affiliate.grade < 5
              ? `${affiliate.booking_count}건 완료 · ${gradeInfo.label}까지 ${remaining}건 남음`
              : '최고 등급 달성!'}
          </p>
        </div>

        {/* 이번 달 정산 예정 */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs text-gray-500 mb-2">이번 달 정산 예정</p>
          {thisMonthSettlement ? (
            <>
              <p className="text-xl font-bold text-gray-900">
                ₩{thisMonthSettlement.final_total.toLocaleString()}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                세전 · 이월 포함
              </p>
              <p className="text-sm font-medium text-green-600 mt-2">
                실지급 ₩{thisMonthSettlement.final_payout.toLocaleString()}
              </p>
              {thisMonthSettlement.tax_deduction > 0 && (
                <p className="text-xs text-red-400">
                  원천세 -₩{thisMonthSettlement.tax_deduction.toLocaleString()}
                </p>
              )}
            </>
          ) : (
            <p className="text-gray-400 text-sm">정산 데이터 없음</p>
          )}
        </div>

        {/* 누적 수수료 */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs text-gray-500 mb-2">누적 수수료 수익</p>
          <p className="text-xl font-bold text-purple-700">
            ₩{Number(affiliate.total_commission).toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-1">총 {affiliate.booking_count}건 연결</p>
          <p className="text-xs text-blue-500 mt-2">
            기본 요율 + 보너스 +{(affiliate.bonus_rate * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* 정산 이력 */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">정산 이력</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['기간', '건수', '발생 수수료', '이월', '합계(세전)', '원천세', '실지급액', '상태'].map(h => (
                <th key={h} className="text-left px-4 py-2 text-xs text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {settlements.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-6 text-gray-400">정산 이력 없음</td></tr>
            ) : settlements.map(s => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{s.settlement_period}</td>
                <td className="px-4 py-3">{s.qualified_booking_count}건</td>
                <td className="px-4 py-3">₩{s.total_amount.toLocaleString()}</td>
                <td className="px-4 py-3 text-orange-600">
                  {s.carryover_balance > 0 ? `+₩${s.carryover_balance.toLocaleString()}` : '-'}
                </td>
                <td className="px-4 py-3 font-medium">₩{s.final_total.toLocaleString()}</td>
                <td className="px-4 py-3 text-red-500">
                  {s.tax_deduction > 0 ? `-₩${s.tax_deduction.toLocaleString()}` : '-'}
                </td>
                <td className="px-4 py-3 font-bold text-green-700">₩{s.final_payout.toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${STATUS_BADGES[s.status]}`}>
                    {STATUS_LABELS[s.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
