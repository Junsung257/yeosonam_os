'use client';

import { useState, useEffect, useCallback } from 'react';

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

  async function handleRevoke(id: string) {
    if (!confirm('이 토큰을 비활성화하시겠습니까?')) return;
    const res = await fetch(`/api/tenant-tokens?id=${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = await res.json() as { error?: string };
      setMessage({ type: 'err', text: json.error ?? '비활성화 실패' });
      return;
    }
    void loadTokens();
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">테넌트 API 토큰 관리</h1>
        <p className="text-sm text-slate-500 mt-1">여행사별 소셜/광고 플랫폼 OAuth 토큰을 AES-256 암호화로 안전하게 보관합니다</p>
      </div>

      {/* 테넌트 선택 */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-slate-700">여행사 선택</label>
        <select
          value={selectedTenant}
          onChange={e => setSelectedTenant(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-800">새 토큰 등록</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">플랫폼</label>
              <select
                value={form.provider}
                onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PROVIDERS.map(p => (
                  <option key={p} value={p}>{PROVIDER_LABELS[p]?.label ?? p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">만료일 (선택)</label>
              <input
                type="datetime-local"
                value={form.expires_at}
                onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Access Token <span className="text-red-500">*</span></label>
            <textarea
              value={form.access_token}
              onChange={e => setForm(f => ({ ...f, access_token: e.target.value }))}
              rows={3}
              placeholder="access_token 값을 여기에 붙여넣으세요 (저장 시 AES-256 암호화됩니다)"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Refresh Token (선택)</label>
            <input
              type="text"
              value={form.refresh_token}
              onChange={e => setForm(f => ({ ...f, refresh_token: e.target.value }))}
              placeholder="refresh_token"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Scopes (쉼표 구분, 선택)</label>
            <input
              type="text"
              value={form.scopes}
              onChange={e => setForm(f => ({ ...f, scopes: e.target.value }))}
              placeholder="예: ads_management, pages_show_list"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">등록된 토큰</h2>
          <span className="text-xs text-slate-400">access_token은 표시되지 않습니다 (보안)</span>
        </div>
        {tokens.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-sm">등록된 토큰이 없습니다</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['플랫폼', '스코프', '만료일', '상태', '최종수정', ''].map(h => (
                  <th key={h} className="text-left py-2.5 px-4 font-medium text-slate-500 text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tokens.map(token => {
                const p = PROVIDER_LABELS[token.provider];
                const expired = isExpired(token.expires_at);
                return (
                  <tr key={token.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p?.color ?? 'bg-slate-100 text-slate-600'}`}>
                        {p?.icon} {p?.label ?? token.provider}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500 text-xs">
                      {token.scopes.length > 0 ? token.scopes.join(', ') : '—'}
                    </td>
                    <td className="py-3 px-4">
                      {token.expires_at ? (
                        <span className={`text-xs ${expired ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                          {expired ? '⚠️ 만료됨' : new Date(token.expires_at).toLocaleDateString('ko-KR')}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        !token.is_active ? 'bg-slate-100 text-slate-400' :
                        expired ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'
                      }`}>
                        {!token.is_active ? '비활성' : expired ? '만료됨' : '활성'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-xs">
                      {new Date(token.updated_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => handleRevoke(token.id)}
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
    </div>
  );
}
