'use client';

import { useCallback, useEffect, useState } from 'react';

type Profile = {
  id: string;
  affiliate_id: string;
  status: string;
  submitted_at: string;
  reviewed_at: string | null;
  review_reason: string | null;
  masked_account?: string;
  masked_identifier?: string;
  payout_type?: string;
  tax_type?: string;
  affiliates?: { name?: string; referral_code?: string } | null;
};

export default function AffiliateProfilesReviewPage() {
  const [type, setType] = useState<'payout' | 'tax'>('payout');
  const [rows, setRows] = useState<Profile[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async (nextType: 'payout' | 'tax' = type) => {
    const response = await fetch(`/api/admin/affiliate-profiles?type=${nextType}`, { cache: 'no-store' });
    if (!response.ok) return setMessage('검토 대기열을 불러오지 못했습니다.');
    const result = await response.json();
    setRows(result.profiles || []);
  }, [type]);

  useEffect(() => { void load(type); }, [load, type]);

  async function review(row: Profile, status: 'VERIFIED' | 'CHANGES_REQUIRED') {
    const reason = status === 'CHANGES_REQUIRED' ? window.prompt('보완 사유를 입력하세요.') || '' : '';
    if (status === 'CHANGES_REQUIRED' && reason.trim().length < 3) return;
    const response = await fetch('/api/admin/affiliate-profiles', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `profile-review:${row.id}:${status}` },
      body: JSON.stringify({ profile_type: type, id: row.id, status, reason }),
    });
    if (!response.ok) return setMessage('상태 변경에 실패했습니다.');
    setMessage('검토 상태를 저장했습니다.');
    await load();
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-bold text-blue-700">제휴 운영</p>
        <h1 className="mt-1 text-3xl font-black">지급·세금 정보 검토</h1>
        <p className="mt-2 text-sm text-slate-600">원문은 표시하지 않고 마스킹값과 검토 상태만 확인합니다.</p>
      </header>
      {message ? <p role="status" className="rounded-xl bg-blue-50 p-4 text-sm font-bold text-blue-900">{message}</p> : null}
      <div className="flex gap-2">
        {(['payout', 'tax'] as const).map((value) => (
          <button key={value} type="button" onClick={() => setType(value)} className={`min-h-11 rounded-xl px-4 text-sm font-bold ${type === value ? 'bg-slate-950 text-white' : 'border border-slate-300 bg-white'}`}>
            {value === 'payout' ? '지급 계좌' : '세금 정보'}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr>{['파트너', '식별값', '상태', '제출일', '사유', '검토'].map((label) => <th key={label} className="px-4 py-3 text-left text-xs text-slate-500">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-bold">{row.affiliates?.name || row.affiliate_id}<span className="ml-2 text-xs text-slate-500">{row.affiliates?.referral_code || ''}</span></td>
                <td className="px-4 py-3 font-mono">{row.masked_account || row.masked_identifier || '-'}</td>
                <td className="px-4 py-3">{row.status}</td>
                <td className="px-4 py-3">{new Date(row.submitted_at).toLocaleString('ko-KR')}</td>
                <td className="px-4 py-3 text-slate-600">{row.review_reason || '-'}</td>
                <td className="px-4 py-3"><div className="flex gap-2"><button type="button" onClick={() => void review(row, 'VERIFIED')} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white">검증 완료</button><button type="button" onClick={() => void review(row, 'CHANGES_REQUIRED')} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800">보완 요청</button></div></td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">검토 대기 정보가 없습니다.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
