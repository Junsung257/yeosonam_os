'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IntegrationStatus } from '@/app/api/admin/integrations/route';
import { fmtDate } from '@/lib/admin-utils';

const PLATFORM_ICONS: Record<string, string> = {
  google_ads: '🔵',
  meta: '🟣',
  naver: '🟢',
  google_analytics: '📊',
};

const PLATFORM_OAUTH_START: Record<string, string> = {
  google_ads: '/api/auth/google-oauth-start',
  meta: '/api/auth/meta-oauth-start',
};

type AiProvider = 'deepseek' | 'claude' | 'gemini';
interface AiPolicy {
  task: string;
  provider: AiProvider;
  model: string | null;
  fallback_provider: AiProvider | null;
  fallback_model: string | null;
  timeout_ms: number | null;
  enabled: boolean;
  note: string | null;
}

type PolicyNotice = {
  tone: 'success' | 'error';
  message: string;
};

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [resolvedTenantId, setResolvedTenantId] = useState<string | null>(null);
  const [aiPolicies, setAiPolicies] = useState<AiPolicy[]>([]);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyNotice, setPolicyNotice] = useState<PolicyNotice | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<IntegrationStatus | null>(null);
  const [deletePolicyTarget, setDeletePolicyTarget] = useState<AiPolicy | null>(null);
  const disconnectCancelRef = useRef<HTMLButtonElement | null>(null);
  const deletePolicyCancelRef = useRef<HTMLButtonElement | null>(null);
  const [policyForm, setPolicyForm] = useState<AiPolicy>({
    task: 'card-news',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    fallback_provider: 'gemini',
    fallback_model: 'gemini-2.5-flash',
    timeout_ms: 15000,
    enabled: true,
    note: '카드뉴스 기본 정책',
  });

  const fetchIntegrations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/integrations');
      if (res.ok) {
        const { integrations: list, resolvedTenantId: tid } = await res.json();
        setIntegrations(list ?? []);
        if (tid) setResolvedTenantId(tid);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);

  const fetchPolicies = useCallback(async () => {
    setPolicyLoading(true);
    try {
      const res = await fetch('/api/admin/ai-policies');
      if (res.ok) {
        const data = await res.json();
        setAiPolicies(data.policies ?? []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPolicyLoading(false);
    }
  }, []);

  useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

  useEffect(() => {
    if (!disconnectTarget) return;
    requestAnimationFrame(() => disconnectCancelRef.current?.focus());
  }, [disconnectTarget]);

  useEffect(() => {
    if (!deletePolicyTarget) return;
    requestAnimationFrame(() => deletePolicyCancelRef.current?.focus());
  }, [deletePolicyTarget]);

  const handleConnect = (platform: string) => {
    const startUrl = PLATFORM_OAUTH_START[platform];
    if (!startUrl) return;
    const url = new URL(startUrl, window.location.origin);
    if (resolvedTenantId) url.searchParams.set('tenant_id', resolvedTenantId);
    if (platform === 'google_ads') {
      fetch(url.toString())
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((data: { url?: string }) => { if (data.url) window.location.href = data.url; })
        .catch((err) => console.error('OAuth redirect failed:', err));
    } else {
      window.location.href = url.toString();
    }
  };

  const handleDisconnect = (item: IntegrationStatus) => {
    setDisconnectTarget(item);
  };

  const submitDisconnect = async () => {
    if (!disconnectTarget) return;
    const platform = disconnectTarget.platform;
    setDisconnecting(platform);
    try {
      const res = await fetch('/api/admin/integrations/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: resolvedTenantId, platform }),
      });
      if (res.ok) {
        setDisconnectTarget(null);
        await fetchIntegrations();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDisconnecting(null);
    }
  };

  const handleSavePolicy = async () => {
    if (!policyForm.task.trim()) {
      setPolicyNotice({ tone: 'error', message: 'task를 입력하세요. (예: card-news, blog-generate, *)' });
      return;
    }
    setPolicySaving(true);
    setPolicyNotice(null);
    try {
      const res = await fetch('/api/admin/ai-policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policyForm),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: '정책 저장 실패' }));
        setPolicyNotice({ tone: 'error', message: e.error || '정책 저장 실패' });
        return;
      }
      await fetchPolicies();
      setPolicyNotice({ tone: 'success', message: 'AI 정책 저장 완료' });
    } catch (err) {
      console.error(err);
      setPolicyNotice({ tone: 'error', message: '정책 저장 실패' });
    } finally {
      setPolicySaving(false);
    }
  };

  const handleDeletePolicy = (policy: AiPolicy) => {
    setDeletePolicyTarget(policy);
  };

  const submitDeletePolicy = async () => {
    if (!deletePolicyTarget) return;
    const task = deletePolicyTarget.task;
    try {
      const res = await fetch(`/api/admin/ai-policies?task=${encodeURIComponent(task)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setDeletePolicyTarget(null);
        await fetchPolicies();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-admin-lg font-bold text-admin-text-2">외부 플랫폼 연동</h1>
        <p className="text-admin-sm text-admin-muted mt-1">
          Google Ads, Meta 등 외부 광고·분석 플랫폼을 연결하여 마케팅 자동화를 활성화하세요.
        </p>
      </div>

      {/* 연동 카드 목록 */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white rounded-admin-md border border-admin-border-mid p-5 animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {integrations.map((item) => (
            <div
              key={item.platform}
              className="bg-white rounded-admin-md border border-admin-border-mid p-5 flex items-center justify-between gap-4"
            >
              {/* 플랫폼 정보 */}
              <div className="flex items-center gap-4">
                <span className="text-2xl">{PLATFORM_ICONS[item.platform] ?? '🔗'}</span>
                <div>
                  <p className="text-admin-base font-semibold text-admin-text-2">{item.label}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`w-2 h-2 rounded-full ${item.connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <span className="text-admin-xs text-admin-muted">
                      {item.connected
                        ? `연결됨 · ${fmtDate(item.connected_at ?? undefined)}`
                        : '미연결'}
                    </span>
                  </div>
                  {item.connected && item.scopes.length > 0 && (
                    <p className="text-[11px] text-admin-muted-2 mt-0.5">
                      범위: {item.scopes.slice(0, 2).join(', ')}{item.scopes.length > 2 ? ' 외' : ''}
                    </p>
                  )}
                  {item.connected && item.expires_at && (
                    <p className="text-[11px] text-admin-muted-2">
                      만료: {fmtDate(item.expires_at)}
                    </p>
                  )}
                </div>
              </div>

              {/* 액션 버튼 */}
              <div className="flex-shrink-0">
                {item.connected ? (
                  <button
                    type="button"
                    onClick={() => handleDisconnect(item)}
                    disabled={disconnecting === item.platform}
                    aria-haspopup="dialog"
                    aria-expanded={disconnectTarget?.platform === item.platform}
                    aria-controls="integration-disconnect-confirm-dialog"
                    className="px-4 py-2 text-admin-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition"
                  >
                    {disconnecting === item.platform ? '해제 중...' : '연결 해제'}
                  </button>
                ) : PLATFORM_OAUTH_START[item.platform] ? (
                  <button
                    onClick={() => handleConnect(item.platform)}
                    className="px-4 py-2 text-admin-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition"
                  >
                    연결하기
                  </button>
                ) : (
                  <span className="text-admin-xs text-admin-muted-2 px-4 py-2">준비 중</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 안내 */}
      <div className="bg-blue-50 border border-blue-200 rounded-admin-md p-4 text-admin-sm text-blue-700">
        <p className="font-semibold mb-1">연동 안내</p>
        <ul className="list-disc list-inside space-y-0.5 text-admin-xs">
          <li>OAuth 토큰은 AES-256-GCM으로 암호화되어 DB에 저장됩니다.</li>
          <li>Google Ads 연동 시 광고 ROAS 자동 집계 및 예산 최적화가 활성화됩니다.</li>
          <li>Meta 연동 시 캠페인 성과 실시간 동기화 및 자동 최적화가 활성화됩니다.</li>
          <li>토큰 만료 5분 전 자동 갱신이 시도됩니다.</li>
        </ul>
      </div>

      {/* AI 정책 운영 */}
      <div className="bg-white rounded-admin-md border border-admin-border-mid p-5 space-y-4">
        <div>
          <h2 className="text-admin-md font-bold text-admin-text-2">AI 모델 전환 정책</h2>
          <p className="text-admin-xs text-admin-muted mt-1">
            `system_ai_policies`를 수정해 재배포 없이 태스크별 모델을 즉시 전환합니다.
          </p>
        </div>

        {policyNotice && (
          <div
            role={policyNotice.tone === 'error' ? 'alert' : 'status'}
            aria-live={policyNotice.tone === 'error' ? 'assertive' : 'polite'}
            className={`rounded-admin-md border px-3 py-2 text-admin-xs ${
              policyNotice.tone === 'error'
                ? 'border-status-dangerBorder bg-status-dangerBg text-status-dangerFg'
                : 'border-status-successBorder bg-status-successBg text-status-successFg'
            }`}
          >
            {policyNotice.message}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className="border border-admin-border-mid rounded-lg px-3 py-2 text-admin-sm"
            placeholder="task (예: card-news, blog-generate, *)"
            value={policyForm.task}
            onChange={(e) => setPolicyForm((p) => ({ ...p, task: e.target.value }))}
          />
          <select
            className="border border-admin-border-mid rounded-lg px-3 py-2 text-admin-sm"
            value={policyForm.provider}
            onChange={(e) => setPolicyForm((p) => ({ ...p, provider: e.target.value as AiProvider }))}
          >
            <option value="deepseek">deepseek</option>
            <option value="claude">claude</option>
            <option value="gemini">gemini</option>
          </select>
          <input
            className="border border-admin-border-mid rounded-lg px-3 py-2 text-admin-sm"
            placeholder="model"
            value={policyForm.model ?? ''}
            onChange={(e) => setPolicyForm((p) => ({ ...p, model: e.target.value || null }))}
          />
          <select
            className="border border-admin-border-mid rounded-lg px-3 py-2 text-admin-sm"
            value={policyForm.fallback_provider ?? ''}
            onChange={(e) => setPolicyForm((p) => ({ ...p, fallback_provider: (e.target.value || null) as AiProvider | null }))}
          >
            <option value="">fallback 없음</option>
            <option value="deepseek">deepseek</option>
            <option value="claude">claude</option>
            <option value="gemini">gemini</option>
          </select>
          <input
            className="border border-admin-border-mid rounded-lg px-3 py-2 text-admin-sm"
            placeholder="fallback_model"
            value={policyForm.fallback_model ?? ''}
            onChange={(e) => setPolicyForm((p) => ({ ...p, fallback_model: e.target.value || null }))}
          />
          <input
            type="number"
            className="border border-admin-border-mid rounded-lg px-3 py-2 text-admin-sm"
            placeholder="timeout_ms"
            value={policyForm.timeout_ms ?? ''}
            onChange={(e) => setPolicyForm((p) => ({ ...p, timeout_ms: e.target.value ? Number(e.target.value) : null }))}
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="text-admin-xs text-admin-muted flex items-center gap-2">
            <input
              type="checkbox"
              checked={policyForm.enabled}
              onChange={(e) => setPolicyForm((p) => ({ ...p, enabled: e.target.checked }))}
            />
            활성
          </label>
          <input
            className="flex-1 border border-admin-border-mid rounded-lg px-3 py-2 text-admin-sm"
            placeholder="note"
            value={policyForm.note ?? ''}
            onChange={(e) => setPolicyForm((p) => ({ ...p, note: e.target.value || null }))}
          />
          <button
            onClick={handleSavePolicy}
            disabled={policySaving}
            className="px-4 py-2 text-admin-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {policySaving ? '저장 중...' : '정책 저장'}
          </button>
        </div>

        <div className="border border-admin-border-mid rounded-lg overflow-hidden">
          <table className="w-full text-admin-xs">
            <thead className="bg-admin-bg text-admin-muted">
              <tr>
                <th className="text-left px-3 py-2">task</th>
                <th className="text-left px-3 py-2">provider/model</th>
                <th className="text-left px-3 py-2">fallback</th>
                <th className="text-left px-3 py-2">timeout</th>
                <th className="text-left px-3 py-2">enabled</th>
                <th className="text-left px-3 py-2">action</th>
              </tr>
            </thead>
            <tbody>
              {policyLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-t border-slate-50">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="h-3 bg-admin-surface-2 rounded animate-pulse" style={{ width: j === 0 ? 80 : j === 5 ? 60 : 48 }} />
                        <span className="sr-only">정책 정보 로딩 중</span>
                      </td>
                    ))}
                  </tr>
                ))
              ) : aiPolicies.length === 0 ? (
                <tr><td className="px-3 py-3 text-admin-muted" colSpan={6}>정책 없음</td></tr>
              ) : (
                aiPolicies.map((p) => (
                  <tr key={p.task} className="border-t border-admin-border">
                    <td className="px-3 py-2 font-mono">{p.task}</td>
                    <td className="px-3 py-2">{p.provider} / {p.model ?? '-'}</td>
                    <td className="px-3 py-2">{p.fallback_provider ? `${p.fallback_provider}/${p.fallback_model ?? '-'}` : '-'}</td>
                    <td className="px-3 py-2">{p.timeout_ms ?? '-'}</td>
                    <td className="px-3 py-2">{p.enabled ? 'Y' : 'N'}</td>
                    <td className="px-3 py-2">
                      <button
                        className="text-blue-700 hover:underline mr-3"
                        onClick={() => setPolicyForm(p)}
                      >
                        편집
                      </button>
                      <button
                        className="text-red-600 hover:underline"
                        type="button"
                        onClick={() => handleDeletePolicy(p)}
                        aria-haspopup="dialog"
                        aria-expanded={deletePolicyTarget?.task === p.task}
                        aria-controls="ai-policy-delete-confirm-dialog"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {disconnectTarget && (
        <div className="fixed inset-0 z-[60] flex h-dvh items-center justify-center overflow-y-auto px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            aria-label="외부 연동 해제 확인 닫기"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => setDisconnectTarget(null)}
          />
          <div
            id="integration-disconnect-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="integration-disconnect-confirm-title"
            aria-describedby="integration-disconnect-confirm-description integration-disconnect-confirm-summary"
            className="relative w-full max-w-md rounded-admin-md border border-red-100 bg-white p-5 shadow-admin-lg"
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-600">External integration</p>
              <h2 id="integration-disconnect-confirm-title" className="text-lg font-bold text-admin-text">
                외부 연동을 해제할까요?
              </h2>
              <p id="integration-disconnect-confirm-description" className="text-sm leading-6 text-admin-muted">
                광고, 분석, 자동화 데이터 수집이 중단될 수 있습니다. 연결 대상을 확인한 뒤 진행하세요.
              </p>
            </div>

            <dl
              id="integration-disconnect-confirm-summary"
              className="mt-4 grid grid-cols-1 gap-2 rounded-admin-sm bg-red-50 p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">플랫폼</dt>
                <dd className="font-semibold text-admin-text">{disconnectTarget.label}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">연결일</dt>
                <dd className="font-semibold text-admin-text">{fmtDate(disconnectTarget.connected_at ?? undefined)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">스코프</dt>
                <dd className="max-w-[13rem] truncate font-semibold text-admin-text">
                  {disconnectTarget.scopes.length > 0 ? disconnectTarget.scopes.join(', ') : '-'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">만료일</dt>
                <dd className="font-semibold text-admin-text">
                  {disconnectTarget.expires_at ? fmtDate(disconnectTarget.expires_at) : '-'}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={disconnectCancelRef}
                type="button"
                onClick={() => setDisconnectTarget(null)}
                className="rounded-admin-sm border border-admin-border bg-white px-4 py-2 text-sm font-medium text-admin-text hover:bg-admin-surface-2"
              >
                다시 확인
              </button>
              <button
                type="button"
                onClick={submitDisconnect}
                disabled={disconnecting === disconnectTarget.platform}
                className="rounded-admin-sm bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {disconnecting === disconnectTarget.platform ? '해제 중...' : '연결 해제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deletePolicyTarget && (
        <div className="fixed inset-0 z-[60] flex h-dvh items-center justify-center overflow-y-auto px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            aria-label="AI 정책 삭제 확인 닫기"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => setDeletePolicyTarget(null)}
          />
          <div
            id="ai-policy-delete-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-policy-delete-confirm-title"
            aria-describedby="ai-policy-delete-confirm-description ai-policy-delete-confirm-summary"
            className="relative w-full max-w-md rounded-admin-md border border-red-100 bg-white p-5 shadow-admin-lg"
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-600">AI policy</p>
              <h2 id="ai-policy-delete-confirm-title" className="text-lg font-bold text-admin-text">
                AI 정책을 삭제할까요?
              </h2>
              <p id="ai-policy-delete-confirm-description" className="text-sm leading-6 text-admin-muted">
                해당 task의 모델 전환 규칙이 사라집니다. 운영 중인 자동 생성 흐름에 영향이 없는지 확인하세요.
              </p>
            </div>

            <dl
              id="ai-policy-delete-confirm-summary"
              className="mt-4 grid grid-cols-1 gap-2 rounded-admin-sm bg-red-50 p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">task</dt>
                <dd className="font-mono text-xs font-semibold text-admin-text">{deletePolicyTarget.task}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">provider</dt>
                <dd className="font-semibold text-admin-text">{deletePolicyTarget.provider}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">fallback</dt>
                <dd className="font-semibold text-admin-text">
                  {deletePolicyTarget.fallback_provider ?? '-'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">enabled</dt>
                <dd className="font-semibold text-admin-text">{deletePolicyTarget.enabled ? 'Y' : 'N'}</dd>
              </div>
            </dl>

            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={deletePolicyCancelRef}
                type="button"
                onClick={() => setDeletePolicyTarget(null)}
                className="rounded-admin-sm border border-admin-border bg-white px-4 py-2 text-sm font-medium text-admin-text hover:bg-admin-surface-2"
              >
                다시 확인
              </button>
              <button
                type="button"
                onClick={submitDeletePolicy}
                className="rounded-admin-sm bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
