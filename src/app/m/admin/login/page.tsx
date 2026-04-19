'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';

function MobileLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const hasAccess = document.cookie
      .split('; ')
      .some(r => r.startsWith('sb-access-token='));
    if (hasAccess) {
      const redirect = searchParams.get('redirect') || '/m/admin';
      router.replace(redirect);
    }
  }, [router, searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setError('Supabase 설정이 없습니다.');
        return;
      }
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError || !data.session) {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.');
        return;
      }

      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        }),
      });

      if (!res.ok) {
        setError('로그인 처리 중 오류가 발생했습니다.');
        return;
      }

      const redirect = searchParams.get('redirect') || '/m/admin';
      window.location.href = redirect;
    } catch {
      setError('로그인 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      className="min-h-[100dvh] bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-6"
      style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
    >
      <div className="bg-white rounded-3xl p-7 w-full max-w-sm shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900">여소남 OS</h1>
          <p className="text-sm text-slate-500 mt-1">모바일 관리자</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">이메일</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@example.com"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">비밀번호</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500 pt-1">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            한 번 로그인하면 본인 폰에서 계속 유지됩니다 (최대 365일)
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-medium hover:bg-slate-800 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors text-base mt-2 active:scale-[0.98]"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p className="text-[11px] text-slate-400 text-center mt-6">
          홈 화면에 추가하면 앱처럼 사용할 수 있습니다
        </p>
      </div>
    </main>
  );
}

export default function MobileLoginPage() {
  return (
    <Suspense>
      <MobileLoginForm />
    </Suspense>
  );
}
