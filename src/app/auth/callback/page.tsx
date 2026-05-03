'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    async function handleCallback() {
      const supabase = getSupabaseClient();

      // PKCE 방식: ?code= 쿼리 파라미터
      const code = searchParams.get('code');
      const type = searchParams.get('type');

      if (code) {
        try {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error || !data.session) {
            console.error('코드 교환 실패:', error);
            router.replace('/login?error=invalid_token');
            return;
          }

          // 세션 쿠키 저장
          await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              access_token: data.session.access_token,
              refresh_token: data.session.refresh_token,
            }),
          });

          if (type === 'recovery') {
            router.replace('/auth/reset-password');
          } else {
            router.replace('/admin');
          }
          return;
        } catch (err) {
          console.error('PKCE 처리 오류:', err);
        }
      }

      // Implicit 방식 폴백: URL hash #access_token=...
      const hash = window.location.hash.substring(1);
      if (hash) {
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        const hashType = params.get('type');

        if (accessToken) {
          try {
            await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || '',
            });

            await fetch('/api/auth/session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
            });

            if (hashType === 'recovery') {
              router.replace('/auth/reset-password');
            } else {
              router.replace('/admin');
            }
            return;
          } catch (err) {
            console.error('Implicit 처리 오류:', err);
          }
        }
      }

      // 처리 실패
      router.replace('/login?error=invalid_token');
    }

    handleCallback();
  }, [router, searchParams]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#F0F7FF] to-[#DBEAFE] flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-600 text-sm">인증 처리 중...</p>
      </div>
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-gradient-to-br from-[#F0F7FF] to-[#DBEAFE] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 text-sm">인증 처리 중...</p>
        </div>
      </main>
    }>
      <CallbackHandler />
    </Suspense>
  );
}
