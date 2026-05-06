'use client';

import { useCallback, useEffect, useState } from 'react';
import type { IntegrationStatus } from '@/app/api/admin/integrations/route';

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

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [resolvedTenantId, setResolvedTenantId] = useState<string | null>(null);
  const [aiPolicies, setAiPolicies] = useState<AiPolicy[]>([]);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policySaving, setPolicySaving] = useState(false);
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

  const handleDisconnect = async (platform: string) => {
    if (!confirm(`${platform} 연결을 해제하시겠습니까?`)) return;
    setDisconnecting(platform);
    try {
      const res = await fetch('/api/admin/integrations/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: resolvedTenantId, platform }),
      });
      if (res.ok) await fetchIntegrations();
    } catch (err) {
      console.error(err);
    } finally {
      setDisconnecting(null);
    }
  };

  const handleSavePolicy = async () => {
    if (!policyForm.task.trim()) return alert('task를 입력하세요. (예: card-news, blog-generate, *)');
    setPolicySaving(true);
    try {
      const res = await fetch('/api/admin/ai-policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policyForm),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: '정책 저장 실패' }));
        alert(e.error || '정책 저장 실패');
        return;
      }
      await fetchPolicies();
      alert('AI 정책 저장 완료');
    } catch (err) {
      console.error(err);
      alert('정책 저장 실패');
    } finally {
      setPolicySaving(false);
    }
  };

  const handleDeletePolicy = async (task: string) => {
    if (!confirm(`정말 ${task} 정책을 삭제할까요?`)) return;
    try {
      const res = await fetch(`/api/admin/ai-policies?task=${encodeURIComponent(task)}`, {
        method: 'DELETE',
      });
      if (res.ok) await fetchPolicies();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-admin-lg font-bold text-slate-800">외부 플랫폼 연동</h1>
        <p className="text-admin-sm text-slate-500 mt-1">
          Google Ads, Meta 등 외부 광고·분석 플랫폼을 연결하여 마케팅 자동화를 활성화하세요.
        </p>
      </div>

      {/* 연동 카드 목록 */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {integrations.map((item) => (
            <div
              key={item.platform}
              className="bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between gap-4"
            >
              {/* 플랫폼 정보 */}
              <div className="flex items-center gap-4">
                <span className="text-2xl">{PLATFORM_ICONS[item.platform] ?? '🔗'}</span>
                <div>
                  <p className="text-admin-base font-semibold text-slate-800">{item.label}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`w-2 h-2 rounded-full ${item.connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <span className="text-admin-xs text-slate-500">
                      {item.connected
                        ? `연결됨 · ${item.connected_at ? new Date(item.connected_at).toLocaleDateString('ko-KR') : ''}`
                        : '미연결'}
                    </span>
                  </div>
                  {item.connected && item.scopes.length > 0 && (
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      범위: {item.scopes.slice(0, 2).join(', ')}{item.scopes.length > 2 ? ' 외' : ''}
                    </p>
                  )}
                  {item.connected && item.expires_at && (
                    <p className="text-[11px] text-slate-400">
                      만료: {new Date(item.expires_at).toLocaleDateString('ko-KR')}
                    </p>
                  )}
                </div>
              </div>

              {/* 액션 버튼 */}
              <div className="flex-shrink-0">
                {item.connected ? (
                  <button
                    onClick={() => handleDisconnect(item.platform)}
                    disabled={disconnecting === item.platform}
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
                  <span className="text-admin-xs text-slate-400 px-4 py-2">준비 중</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 안내 */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-admin-sm text-blue-700">
        <p className="font-semibold mb-1">연동 안내</p>
        <ul className="list-disc list-inside space-y-0.5 text-admin-xs">
          <li>OAuth 토큰은 AES-256-GCM으로 암호화되어 DB에 저장됩니다.</li>
          <li>Google Ads 연동 시 광고 ROAS 자동 집계 및 예산 최적화가 활성화됩니다.</li>
          <li>Meta 연동 시 캠페인 성과 실시간 동기화 및 자동 최적화가 활성화됩니다.</li>
          <li>토큰 만료 5분 전 자동 갱신이 시도됩니다.</li>
        </ul>
      </div>

      {/* AI 정책 운영 */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div>
          <h2 className="text-admin-md font-bold text-slate-800">AI 모델 전환 정책</h2>
          <p className="text-admin-xs text-slate-500 mt-1">
            `system_ai_policies`를 수정해 재배포 없이 태스크별 모델을 즉시 전환합니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className="border border-slate-200 rounded-lg px-3 py-2 text-admin-sm"
            placeholder="task (예: card-news, blog-generate, *)"
            value={policyForm.task}
            onChange={(e) => setPolicyForm((p) => ({ ...p, task: e.target.value }))}
          />
          <select
            className="border border-slate-200 rounded-lg px-3 py-2 text-admin-sm"
            value={policyForm.provider}
            onChange={(e) => setPolicyForm((p) => ({ ...p, provider: e.target.value as AiProvider }))}
          >
            <option value="deepseek">deepseek</option>
            <option value="claude">claude</option>
            <option value="gemini">gemini</option>
          </select>
          <input
            className="border border-slate-200 rounded-lg px-3 py-2 text-admin-sm"
            placeholder="model"
            value={policyForm.model ?? ''}
            onChange={(e) => setPolicyForm((p) => ({ ...p, model: e.target.value || null }))}
          />
          <select
            className="border border-slate-200 rounded-lg px-3 py-2 text-admin-sm"
            value={policyForm.fallback_provider ?? ''}
            onChange={(e) => setPolicyForm((p) => ({ ...p, fallback_provider: (e.target.value || null) as AiProvider | null }))}
          >
            <option value="">fallback 없음</option>
            <option value="deepseek">deepseek</option>
            <option value="claude">claude</option>
            <option value="gemini">gemini</option>
          </select>
          <input
            className="border border-slate-200 rounded-lg px-3 py-2 text-admin-sm"
            placeholder="fallback_model"
            value={policyForm.fallback_model ?? ''}
            onChange={(e) => setPolicyForm((p) => ({ ...p, fallback_model: e.target.value || null }))}
          />
          <input
            type="number"
            className="border border-slate-200 rounded-lg px-3 py-2 text-admin-sm"
            placeholder="timeout_ms"
            value={policyForm.timeout_ms ?? ''}
            onChange={(e) => setPolicyForm((p) => ({ ...p, timeout_ms: e.target.value ? Number(e.target.value) : null }))}
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="text-admin-xs text-slate-600 flex items-center gap-2">
            <input
              type="checkbox"
              checked={policyForm.enabled}
              onChange={(e) => setPolicyForm((p) => ({ ...p, enabled: e.target.checked }))}
            />
            활성
          </label>
          <input
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-admin-sm"
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

        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-admin-xs">
            <thead className="bg-slate-50 text-slate-600">
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
                        <div className="h-3 bg-slate-100 rounded animate-pulse" style={{ width: j === 0 ? 80 : j === 5 ? 60 : 48 }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : aiPolicies.length === 0 ? (
                <tr><td className="px-3 py-3 text-slate-500" colSpan={6}>정책 없음</td></tr>
              ) : (
                aiPolicies.map((p) => (
                  <tr key={p.task} className="border-t border-slate-100">
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
                        onClick={() => handleDeletePolicy(p.task)}
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
    </div>
  );
}
