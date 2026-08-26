'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import Button from '@/components/ui/Button';
import { EmptyState, PageHeader, SectionCard } from '@/components/admin/patterns';
import { DataTable, StatusBadge, type ColumnDef } from '@/components/admin/ui';
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

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export default function TenantTokensPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ provider: 'meta', access_token: '', refresh_token: '', expires_at: '', scopes: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadTenants = useCallback(async () => {
    setLoadingTenants(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/tenants');
      if (!response.ok) throw new Error(`테넌트 조회 실패 (HTTP ${response.status})`);
      const data = await response.json() as { tenants: Tenant[] };
      setTenants(data.tenants ?? []);
      setSelectedTenant(current => current || data.tenants?.[0]?.id || '');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '테넌트 목록을 불러오지 못했습니다.');
    } finally {
      setLoadingTenants(false);
    }
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  const loadTokens = useCallback(async () => {
    if (!selectedTenant) {
      setTokens([]);
      return;
    }
    setLoadingTokens(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/tenant-tokens?tenant_id=${encodeURIComponent(selectedTenant)}`);
      if (!res.ok) throw new Error(`토큰 조회 실패 (HTTP ${res.status})`);
      const d = await res.json() as { tokens: TokenMeta[] };
      setTokens(d.tokens ?? []);
    } catch (error) {
      setTokens([]);
      setLoadError(error instanceof Error ? error.message : '토큰 목록을 불러오지 못했습니다.');
    } finally {
      setLoadingTokens(false);
    }
  }, [selectedTenant]);

  useEffect(() => { void loadTokens(); }, [loadTokens]);

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
    } catch (error) {
      setMessage({ type: 'err', text: error instanceof Error ? error.message : '저장 요청에 실패했습니다.' });
    } finally {
      setSaving(false);
    }
  }

  const handleRevoke = useCallback(async (id: string) => {
    if (!confirm('이 토큰을 비활성화하시겠습니까?')) return;
    try {
      const res = await fetch(`/api/tenant-tokens?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        setMessage({ type: 'err', text: json.error ?? '비활성화 실패' });
        return;
      }
      setMessage({ type: 'ok', text: '토큰을 비활성화했습니다.' });
      void loadTokens();
    } catch (error) {
      setMessage({ type: 'err', text: error instanceof Error ? error.message : '비활성화 요청에 실패했습니다.' });
    }
  }, [loadTokens]);

  const tokenColumns = useMemo<ColumnDef<TokenMeta>[]>(() => [
    {
      key: 'provider',
      header: '플랫폼',
      priority: 1,
      sortValue: token => token.provider,
      cell: token => {
        const provider = PROVIDER_LABELS[token.provider];
        return (
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${provider?.color ?? 'bg-admin-surface-2 text-admin-muted'}`}>
            {provider?.icon} {provider?.label ?? token.provider}
          </span>
        );
      },
    },
    {
      key: 'scopes',
      header: '스코프',
      priority: 3,
      cell: token => (
        <span className="text-admin-muted text-xs">
          {token.scopes.length > 0 ? token.scopes.join(', ') : '—'}
        </span>
      ),
    },
    {
      key: 'expires_at',
      header: '만료일',
      priority: 2,
      sortDescFirst: true,
      sortValue: token => token.expires_at ? new Date(token.expires_at).getTime() : Number.MAX_SAFE_INTEGER,
      cell: token => token.expires_at ? (
        <span className={`text-xs ${isExpired(token.expires_at) ? 'text-danger font-medium' : 'text-admin-muted'}`}>
          {isExpired(token.expires_at) ? '만료됨' : fmtDate(token.expires_at)}
        </span>
      ) : <span className="text-xs text-admin-muted-2">—</span>,
    },
    {
      key: 'status',
      header: '상태',
      priority: 1,
      sortValue: token => !token.is_active ? 0 : isExpired(token.expires_at) ? 1 : 2,
      cell: token => {
        const expired = isExpired(token.expires_at);
        const label = !token.is_active ? '비활성' : expired ? '만료됨' : '활성';
        const tone = !token.is_active ? 'neutral' : expired ? 'danger' : 'success';
        return <StatusBadge kind="custom" value={label} label={label} tone={tone} withDot />;
      },
    },
    {
      key: 'updated_at',
      header: '최종 수정',
      priority: 2,
      sortDescFirst: true,
      sortValue: token => new Date(token.updated_at).getTime(),
      cell: token => <span className="text-admin-muted-2 text-xs">{fmtMonthDayTime(token.updated_at)}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">관리</span>,
      sortLabel: '관리',
      align: 'right',
      priority: 1,
      cell: token => token.is_active ? (
        <Button variant="ghost" size="sm" className="text-danger" onClick={() => void handleRevoke(token.id)}>
          비활성화
        </Button>
      ) : <span className="text-admin-muted-2 text-xs">처리 완료</span>,
    },
  ], [handleRevoke]);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <PageHeader
        title="테넌트 API 토큰 관리"
        subtitle="여행사별 소셜·광고 플랫폼 OAuth 토큰을 AES-256 암호화로 보관합니다. 원문 토큰은 목록에 노출하지 않습니다."
        actions={(
          <Button
            onClick={() => { setShowForm(!showForm); setMessage(null); }}
            disabled={!selectedTenant || loadingTenants}
          >
            <Plus size={14} />
            {showForm ? '등록 취소' : '토큰 추가'}
          </Button>
        )}
      />

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
      </div>

      {/* 알림 */}
      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm ${
          message.type === 'ok' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>{message.text}</div>
      )}

      {loadError && (
        <div role="alert" className="rounded-admin-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="font-medium">목록을 불러오지 못했습니다.</div>
          <div className="mt-0.5 text-xs">{loadError}</div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 text-danger"
            onClick={() => void (selectedTenant ? loadTokens() : loadTenants())}
          >
            다시 시도
          </Button>
        </div>
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
            <label htmlFor="tenant-token-access-token" className="block text-sm font-medium text-admin-text-2 mb-1">Access Token <span className="text-red-500">*</span></label>
            <textarea
              id="tenant-token-access-token"
              value={form.access_token}
              onChange={e => setForm(f => ({ ...f, access_token: e.target.value }))}
              rows={3}
              placeholder="access_token 값을 여기에 붙여넣으세요 (저장 시 AES-256 암호화됩니다)"
              className="w-full border border-admin-border-strong rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div>
            <label htmlFor="tenant-token-refresh-token" className="block text-sm font-medium text-admin-text-2 mb-1">Refresh Token (선택)</label>
            <input
              id="tenant-token-refresh-token"
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
          <button type="button"
            onClick={handleSave}
            disabled={saving || !form.access_token}
            className="px-5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition"
          >
            {saving ? '저장 중...' : '🔐 암호화 저장'}
          </button>
        </div>
      )}

      {/* 토큰 목록 */}
      <SectionCard
        title="등록된 토큰"
        description="토큰 원문은 표시하지 않습니다. 헤더를 눌러 플랫폼·만료·상태·수정일 순으로 정렬할 수 있습니다."
        flush
      >
        <DataTable
          columns={tokenColumns}
          rows={tokens}
          getRowKey={token => token.id}
          loading={loadingTokens || loadingTenants}
          skeletonRows={5}
          initialSort={{ key: 'updated_at', desc: true }}
          emptyState={(
            <EmptyState
              icon={KeyRound}
              title={selectedTenant ? '등록된 토큰이 없습니다' : '여행사를 먼저 선택해 주세요'}
              description={selectedTenant ? '광고·분석 플랫폼 연동이 필요할 때 첫 토큰을 등록하세요.' : '여행사별로 토큰을 분리해 안전하게 관리합니다.'}
              action={selectedTenant ? (
                <Button size="sm" onClick={() => setShowForm(true)}>
                  <Plus size={14} /> 첫 토큰 등록
                </Button>
              ) : undefined}
            />
          )}
          className="rounded-none border-0 shadow-none"
        />
      </SectionCard>
    </div>
  );
}
