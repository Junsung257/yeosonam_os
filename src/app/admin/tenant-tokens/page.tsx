'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { fmtDate, fmtMonthDayTime } from '@/lib/admin-utils';

interface Tenant { id: string; name: string; }

interface TokenMeta {
  id: string;
  tenant_id: string;
  provider: string;
  expires_at: string | null;
  scopes: string[];
  is_active: boolean;
  updated_at: string;
}

const PROVIDER_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  meta:              { label: 'Meta (FB/IG)', color: 'text-blue-700 bg-blue-50',   icon: '📘' },
  google_ads:        { label: 'Google Ads',   color: 'text-red-700 bg-red-50',     icon: '🔴' },
  naver:             { label: 'Naver',         color: 'text-green-700 bg-green-50', icon: '🟢' },
  google_analytics:  { label: 'GA4',           color: 'text-orange-700 bg-orange-50', icon: '📊' },
  kakao_biz:         { label: 'Kakao Biz',    color: 'text-yellow-700 bg-yellow-50', icon: '💛' },
};

const PROVIDERS = Object.keys(PROVIDER_LABELS);

export default function TenantTokensPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ provider: 'meta', access_token: '', refresh_token: '', expires_at: '', scopes: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<TokenMeta | null>(null);
  const [revoking, setRevoking] = useState(false);
  const revokeCancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    fetch('/api/tenants')
      .then(r => r.json())
      .then((d: { tenants: Tenant[] }) => {
        setTenants(d.tenants ?? []);
        if (d.tenants?.[0]) setSelectedTenant(d.tenants[0].id);
      });
  }, []);

  const loadTokens = useCallback(async () => {
    if (!selectedTenant) return;
    const res = await fetch(`/api/tenant-tokens?tenant_id=${selectedTenant}`);
    if (res.ok) {
      const d = await res.json() as { tokens: TokenMeta[] };
      setTokens(d.tokens ?? []);
    }
  }, [selectedTenant]);

  useEffect(() => { void loadTokens(); }, [loadTokens]);

  useEffect(() => {
    if (!revokeTarget) return;
    requestAnimationFrame(() => revokeCancelRef.current?.focus());
  }, [revokeTarget]);

  function isExpired(expiresAt: string | null): boolean {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  }

  async function handleSave() {
    if (!selectedTenant || !form.access_token) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/tenant-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id:     selectedTenant,
          provider:      form.provider,
          access_token:  form.access_token,
          refresh_token: form.refresh_token || undefined,
          expires_at:    form.expires_at || undefined,
          scopes:        form.scopes ? form.scopes.split(',').map(s => s.trim()) : [],
        }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) {
        setMessage({ type: 'err', text: json.error ?? '저장 실패' });
      } else {
        setMessage({ type: 'ok', text: '✅ 토큰 저장 완료 (AES-256 암호화)' });
        setShowForm(false);
        setForm({ provider: 'meta', access_token: '', refresh_token: '', expires_at: '', scopes: '' });
        void loadTokens();
      }
    } finally {
      setSaving(false);
    }
  }

  function handleRevoke(token: TokenMeta) {
    setMessage(null);
    setRevokeTarget(token);
  }

  async function submitRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/tenant-tokens?id=${revokeTarget.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        setMessage({ type: 'err', text: json.error ?? '비활성화 실패' });
        return;
      }
      setRevokeTarget(null);
      setMessage({ type: 'ok', text: '토큰 비활성화 완료' });
      void loadTokens();
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-admin-text">테넌트 API 토큰 관리</h1>
        <p className="text-sm text-admin-muted mt-1">여행사별 소셜/광고 플랫폼 OAuth 토큰을 AES-256 암호화로 안전하게 보관합니다</p>
      </div>

      {/* 테넌트 선택 */}
      <div className="flex items-center gap-3">
        <label htmlFor="tenant-token-tenant" className="text-sm font-medium text-admin-text-2">여행사 선택</label>
        <select
          id="tenant-token-tenant"
          value={selectedTenant}
          onChange={e => setSelectedTenant(e.target.value)}
          className="border border-admin-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {tenants.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button
          onClick={() => { setShowForm(!showForm); setMessage(null); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
        >
          {showForm ? '취소' : '+ 토큰 추가'}
        </button>
      </div>

      {/* 알림 */}
      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm ${
          message.type === 'ok' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>{message.text}</div>
      )}

      {/* 토큰 추가 폼 */}
      {showForm && (
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5 space-y-4">
          <h2 className="text-base font-semibold text-admin-text-2">새 토큰 등록</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="tenant-token-provider" className="block text-sm font-medium text-admin-text-2 mb-1">플랫폼</label>
              <select
                id="tenant-token-provider"
                value={form.provider}
                onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
                className="w-full border border-admin-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PROVIDERS.map(p => (
                  <option key={p} value={p}>{PROVIDER_LABELS[p]?.label ?? p}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tenant-token-expires-at" className="block text-sm font-medium text-admin-text-2 mb-1">만료일 (선택)</label>
              <input
                id="tenant-token-expires-at"
                type="datetime-local"
                value={form.expires_at}
                onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                className="w-full border border-admin-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label htmlFor="tenant-token-access" className="block text-sm font-medium text-admin-text-2 mb-1">Access Token <span className="text-red-500">*</span></label>
            <textarea
              id="tenant-token-access"
              value={form.access_token}
              onChange={e => setForm(f => ({ ...f, access_token: e.target.value }))}
              rows={3}
              placeholder="access_token 값을 여기에 붙여넣으세요 (저장 시 AES-256 암호화됩니다)"
              className="w-full border border-admin-border-strong rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div>
            <label htmlFor="tenant-token-refresh" className="block text-sm font-medium text-admin-text-2 mb-1">Refresh Token (선택)</label>
            <input
              id="tenant-token-refresh"
              type="text"
              value={form.refresh_token}
              onChange={e => setForm(f => ({ ...f, refresh_token: e.target.value }))}
              placeholder="refresh_token"
              className="w-full border border-admin-border-strong rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="tenant-token-scopes" className="block text-sm font-medium text-admin-text-2 mb-1">Scopes (쉼표 구분, 선택)</label>
            <input
              id="tenant-token-scopes"
              type="text"
              value={form.scopes}
              onChange={e => setForm(f => ({ ...f, scopes: e.target.value }))}
              placeholder="예: ads_management, pages_show_list"
              className="w-full border border-admin-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !form.access_token}
            className="px-5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition"
          >
            {saving ? '저장 중...' : '🔐 암호화 저장'}
          </button>
        </div>
      )}

      {/* 토큰 목록 */}
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        <div className="px-5 py-3 border-b border-admin-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-admin-text-2">등록된 토큰</h2>
          <span className="text-xs text-admin-muted-2">access_token은 표시되지 않습니다 (보안)</span>
        </div>
        {tokens.length === 0 ? (
          <div className="p-6 text-center text-admin-muted-2 text-sm">등록된 토큰이 없습니다</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-admin-bg">
              <tr>
                {['플랫폼', '스코프', '만료일', '상태', '최종수정', ''].map(h => (
                  <th key={h} className="text-left py-2.5 px-4 font-medium text-admin-muted text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tokens.map(token => {
                const p = PROVIDER_LABELS[token.provider];
                const expired = isExpired(token.expires_at);
                return (
                  <tr key={token.id} className="border-t border-admin-border hover:bg-admin-bg">
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p?.color ?? 'bg-admin-surface-2 text-admin-muted'}`}>
                        {p?.icon} {p?.label ?? token.provider}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-admin-muted text-xs">
                      {token.scopes.length > 0 ? token.scopes.join(', ') : '—'}
                    </td>
                    <td className="py-3 px-4">
                      {token.expires_at ? (
                        <span className={`text-xs ${expired ? 'text-red-600 font-medium' : 'text-admin-muted'}`}>
                          {expired ? '⚠️ 만료됨' : fmtDate(token.expires_at)}
                        </span>
                      ) : (
                        <span className="text-xs text-admin-muted-2">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        !token.is_active ? 'bg-admin-surface-2 text-admin-muted-2' :
                        expired ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'
                      }`}>
                        {!token.is_active ? '비활성' : expired ? '만료됨' : '활성'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-admin-muted-2 text-xs">
                      {fmtMonthDayTime(token.updated_at)}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => handleRevoke(token)}
                        aria-haspopup="dialog"
                        aria-expanded={revokeTarget?.id === token.id}
                        aria-controls="tenant-token-revoke-confirm-dialog"
                        className="text-xs text-red-500 hover:underline"
                      >
                        비활성화
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {revokeTarget && (
        <div className="fixed inset-0 z-[60] flex h-dvh items-center justify-center overflow-y-auto px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            aria-label="토큰 비활성화 확인 닫기"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => setRevokeTarget(null)}
          />
          <div
            id="tenant-token-revoke-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tenant-token-revoke-confirm-title"
            aria-describedby="tenant-token-revoke-confirm-description tenant-token-revoke-confirm-summary"
            className="relative w-full max-w-md rounded-admin-md border border-red-100 bg-white p-5 shadow-admin-lg"
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Token access</p>
              <h2 id="tenant-token-revoke-confirm-title" className="text-lg font-bold text-admin-text">
                API 토큰을 비활성화할까요?
              </h2>
              <p id="tenant-token-revoke-confirm-description" className="text-sm leading-6 text-admin-muted">
                이 토큰을 사용하는 광고, 분석, 메시지 연동이 즉시 실패할 수 있습니다.
              </p>
            </div>

            <dl
              id="tenant-token-revoke-confirm-summary"
              className="mt-4 grid grid-cols-1 gap-2 rounded-admin-sm bg-red-50 p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">플랫폼</dt>
                <dd className="font-semibold text-admin-text">
                  {PROVIDER_LABELS[revokeTarget.provider]?.label ?? revokeTarget.provider}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">스코프</dt>
                <dd className="max-w-[13rem] truncate font-semibold text-admin-text">
                  {revokeTarget.scopes.length > 0 ? revokeTarget.scopes.join(', ') : '-'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">만료일</dt>
                <dd className="font-semibold text-admin-text">
                  {revokeTarget.expires_at ? fmtDate(revokeTarget.expires_at) : '-'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">현재 상태</dt>
                <dd className="font-semibold text-admin-text">{revokeTarget.is_active ? '활성' : '비활성'}</dd>
              </div>
            </dl>

            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={revokeCancelRef}
                type="button"
                onClick={() => setRevokeTarget(null)}
                className="rounded-admin-sm border border-admin-border bg-white px-4 py-2 text-sm font-medium text-admin-text hover:bg-admin-surface-2"
              >
                다시 확인
              </button>
              <button
                type="button"
                onClick={submitRevoke}
                disabled={revoking}
                className="rounded-admin-sm bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {revoking ? '처리 중...' : '비활성화'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
