'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Leaderboard } from '@/components/affiliate/Leaderboard';

interface Affiliate {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  referral_code: string;
  grade: number;
  grade_label: string;
  bonus_rate: number;
  payout_type: 'PERSONAL' | 'BUSINESS';
  booking_count: number;
  total_commission: number;
  memo?: string;
}

const GRADE_COLORS: Record<number, string> = {
  1: 'bg-amber-50 text-amber-700',
  2: 'bg-slate-100 text-slate-600',
  3: 'bg-yellow-50 text-yellow-700',
  4: 'bg-blue-50 text-blue-700',
  5: 'bg-purple-50 text-purple-700',
};

const GRADE_NEXT: Record<number, { label: string; target: number }> = {
  1: { label: '실버', target: 10 },
  2: { label: '골드', target: 30 },
  3: { label: '플래티넘', target: 50 },
  4: { label: '다이아', target: 100 },
  5: { label: '최고 등급', target: 100 },
};

export default function AffiliatesPage() {
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPanel, setShowPanel] = useState(false);
  const [form, setForm] = useState({
    name: '', phone: '', email: '', referral_code: '',
    payout_type: 'PERSONAL' as 'PERSONAL' | 'BUSINESS',
    bank_info: '', memo: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/affiliates');
      const json = await res.json();
      setAffiliates(json.affiliates || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/affiliates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || '등록 실패'); return; }
      setShowPanel(false);
      setForm({ name: '', phone: '', email: '', referral_code: '', payout_type: 'PERSONAL', bank_info: '', memo: '' });
      load();
    } finally {
      setSaving(false);
    }
  };

  const totalStats = {
    total: affiliates.length,
    totalCommission: affiliates.reduce((s, a) => s + a.total_commission, 0),
    diamond: affiliates.filter(a => a.grade === 5).length,
    platinum: affiliates.filter(a => a.grade === 4).length,
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-slate-800">어필리에이트 관리</h1>
          <p className="text-[13px] text-slate-500 mt-1">인플루언서/파트너 등급 및 수수료 관리</p>
        </div>
        <button
          onClick={() => setShowPanel(true)}
          className="px-4 py-2 bg-[#001f3f] text-white rounded-lg hover:bg-blue-900 text-[13px] font-medium"
        >
          + 파트너 등록
        </button>
      </div>

      {/* 월간 리더보드 (실명) */}
      <Leaderboard />

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: '총 파트너 수', value: `${totalStats.total}명`, color: 'text-slate-800' },
          { label: '누적 수수료 지급', value: `${totalStats.totalCommission.toLocaleString()}원`, color: 'text-purple-700' },
          { label: '다이아 등급', value: `${totalStats.diamond}명`, color: 'text-purple-600' },
          { label: '플래티넘 등급', value: `${totalStats.platinum}명`, color: 'text-blue-600' },
        ].map(card => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-[11px] text-slate-500">{card.label}</p>
            <p className={`text-xl font-bold mt-1 ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* 테이블 */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['이름', '추천코드', '등급', '예약수', '보너스요율', '정산유형', '누적수수료', ''].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[11px] font-medium text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-8 text-slate-500 text-[14px]">불러오는 중...</td></tr>
            ) : affiliates.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8 text-slate-500 text-[14px]">등록된 파트너가 없습니다.</td></tr>
            ) : affiliates.map(a => {
              const next = GRADE_NEXT[a.grade];
              const progress = a.grade < 5
                ? Math.min(100, Math.round((a.booking_count / next.target) * 100))
                : 100;

              return (
                <tr key={a.id} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800">
                    <div>{a.name}</div>
                    {a.phone && <div className="text-[11px] text-slate-500">{a.phone}</div>}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-purple-700">
                    {a.referral_code}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${GRADE_COLORS[a.grade]}`}>
                        {a.grade_label}
                      </span>
                    </div>
                    {a.grade < 5 && (
                      <div className="mt-1">
                        <div className="flex justify-between text-[11px] text-slate-500 mb-0.5">
                          <span>{a.booking_count}/{next.target}건</span>
                          <span>{next.label}까지 {next.target - a.booking_count}건</span>
                        </div>
                        <div className="w-24 bg-slate-100 rounded-full h-1.5">
                          <div
                            className="bg-purple-400 h-1.5 rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{a.booking_count}건</td>
                  <td className="px-3 py-2 text-blue-600 font-mono">+{(a.bonus_rate * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-[11px] ${
                      a.payout_type === 'PERSONAL' ? 'bg-orange-50 text-orange-700' : 'bg-green-50 text-green-700'
                    }`}>
                      {a.payout_type === 'PERSONAL' ? '개인 (3.3%)' : '사업자'}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium text-purple-700">
                    {Number(a.total_commission).toLocaleString()}원
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/affiliates/${a.id}`}
                      className="text-[11px] text-slate-500 hover:text-slate-800"
                    >
                      상세
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 등록 슬라이드 패널 */}
      {showPanel && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setShowPanel(false); setError(''); }} />
          <div className="relative w-full max-w-md bg-white h-full overflow-y-auto border-l border-slate-200">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[16px] font-bold text-slate-800">파트너 신규 등록</h2>
                <button onClick={() => { setShowPanel(false); setError(''); }} className="text-slate-500 hover:text-slate-700 text-lg">&times;</button>
              </div>
              {error && <p className="text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg border border-red-200">{error}</p>}
              <form onSubmit={handleSubmit} className="space-y-3">
                {[
                  { label: '이름 *', key: 'name', type: 'text', placeholder: '홍길동' },
                  { label: '연락처', key: 'phone', type: 'tel', placeholder: '010-0000-0000' },
                  { label: '이메일', key: 'email', type: 'email', placeholder: 'example@email.com' },
                  { label: '추천코드 *', key: 'referral_code', type: 'text', placeholder: 'BLOGGER_KIM' },
                  { label: '계좌번호 (암호화 저장)', key: 'bank_info', type: 'text', placeholder: '신한은행 110-123-456789' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">{f.label}</label>
                    <input
                      type={f.type}
                      placeholder={f.placeholder}
                      value={(form as any)[f.key]}
                      onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      required={f.label.includes('*')}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">정산 유형</label>
                  <select
                    value={form.payout_type}
                    onChange={e => setForm(prev => ({ ...prev, payout_type: e.target.value as 'PERSONAL' | 'BUSINESS' }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px]"
                  >
                    <option value="PERSONAL">개인 (원천세 3.3% 공제)</option>
                    <option value="BUSINESS">사업자 (세금계산서 별도)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">메모</label>
                  <textarea
                    value={form.memo}
                    onChange={e => setForm(prev => ({ ...prev, memo: e.target.value }))}
                    rows={2}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px]"
                    placeholder="특이사항..."
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => { setShowPanel(false); setError(''); }}
                    className="flex-1 py-2 bg-white border border-slate-300 rounded-lg text-[14px] text-slate-700 hover:bg-slate-50"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 py-2 bg-[#001f3f] text-white rounded-lg text-[14px] font-medium hover:bg-blue-900 disabled:opacity-50"
                  >
                    {saving ? '등록 중...' : '등록하기'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
