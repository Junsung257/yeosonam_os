'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AffiliateLoginPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('affiliate_token');
    if (token) router.replace('/affiliate/dashboard');
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/affiliate/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referral_code: code.trim().toUpperCase(), pin: pin.trim() }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error || '로그인에 실패했습니다.');
        return;
      }

      localStorage.setItem('affiliate_token', json.token);
      localStorage.setItem('affiliate_info', JSON.stringify({
        id: json.affiliate.id,
        name: json.affiliate.name,
        referral_code: json.affiliate.referral_code,
        branding_level: json.affiliate.branding_level,
        content_quota: json.affiliate.content_quota,
        content_used: json.affiliate.content_used,
      }));
      router.replace('/affiliate/dashboard');
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center p-4">
      <div className="bg-white shadow-xl rounded-2xl p-8 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">파트너 포털</h1>
          <p className="text-sm text-gray-500 mt-1">여소남과 함께하는 여행 파트너</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">파트너 코드</label>
            <input
              type="text"
              required
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="예: TRAVEL2026"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent uppercase tracking-wider"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">PIN 번호</label>
            <input
              type="password"
              required
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="PIN 4-6자리"
              maxLength={6}
              inputMode="numeric"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent tracking-widest text-center"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-amber-500 to-orange-600 text-white py-2.5 rounded-lg font-medium hover:from-amber-600 hover:to-orange-700 disabled:opacity-50 transition-all text-sm shadow-md"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p className="text-[10px] text-gray-400 text-center mt-6">
          파트너 코드와 PIN은 여소남에서 제공합니다.
        </p>
      </div>
    </main>
  );
}
