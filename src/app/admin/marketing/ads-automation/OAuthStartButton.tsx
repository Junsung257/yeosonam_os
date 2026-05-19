'use client';

import { useState } from 'react';

interface Props {
  tenantId: string | null;
  configured: boolean;
}

export default function OAuthStartButton({ tenantId, configured }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = !tenantId || loading;

  async function handleClick() {
    if (!tenantId) {
      setError('tenant_id 미해결 — Supabase tenants 테이블이 비어있는지 확인하세요.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/auth/google-oauth-start?tenant_id=${encodeURIComponent(tenantId)}`,
        { cache: 'no-store' },
      );
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        setError(json.error ?? `OAuth 시작 실패 (HTTP ${res.status})`);
        setLoading(false);
        return;
      }
      // Google 로그인 페이지로 리다이렉트
      window.location.href = json.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OAuth 요청 예외');
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`inline-flex w-fit items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
          disabled
            ? 'cursor-not-allowed bg-gray-200 text-gray-500'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        {loading ? '⏳ Google 로그인 페이지로 이동 중…' : '🔑 Google Ads OAuth 시작 (refresh_token 발급)'}
      </button>
      {configured && (
        <p className="text-xs text-emerald-600">
          ✓ 이미 발급됨 — 새로 발급하려면 위 버튼 클릭 (기존 토큰 덮어쓰기)
        </p>
      )}
      {!tenantId && (
        <p className="text-xs text-amber-700">
          tenant_id 미해결. tenants 테이블에 row 가 1개 이상 있어야 합니다.
        </p>
      )}
      {error && <p className="text-xs text-rose-600">⚠ {error}</p>}
    </div>
  );
}
