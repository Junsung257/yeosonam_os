'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface SocialConfig {
  platform: string;
  enabled: boolean;
  account_id: string | null;
  daily_limit: number | null;
  posts_today: number;
  last_post_at: string | null;
  token_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: '인스타그램',
  threads: 'Threads',
  twitter: 'X',
  facebook: '페이스북',
  naver_cafe: '네이버 카페',
};

const PLATFORM_ORDER = ['instagram', 'threads', 'facebook', 'naver_cafe', 'twitter'];

function formatDate(value: string | null): string {
  if (!value) return '기록 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function SocialConfigsPage() {
  const [configs, setConfigs] = useState<SocialConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/social-configs', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? '소셜 채널 설정을 불러오지 못했습니다.');
      setConfigs(payload.configs ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '소셜 채널 설정을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfigs();
  }, [fetchConfigs]);

  async function updateConfig(platform: string, updates: Record<string, boolean | number>) {
    setSaving(platform);
    setError(null);
    try {
      const response = await fetch('/api/admin/social-configs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, updates }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? '설정을 저장하지 못했습니다.');
      await fetchConfigs();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '설정을 저장하지 못했습니다.');
    } finally {
      setSaving(null);
    }
  }

  async function connectThreads() {
    setConnecting('threads');
    setError(null);
    try {
      const response = await fetch('/api/admin/social-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'threads' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.oauth_url) {
        throw new Error(payload.error ?? 'Threads 연결을 시작하지 못했습니다.');
      }
      window.location.assign(payload.oauth_url);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Threads 연결을 시작하지 못했습니다.');
      setConnecting(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-admin-lg font-bold text-admin-text-2">소셜 채널 연결</h1>
          <p className="mt-1 text-admin-sm text-admin-muted">
            계정 연결 상태와 하루 발행 한도를 관리합니다.
          </p>
        </div>
        <Link
          href="/admin/marketing"
          className="rounded-admin-sm border border-admin-border-strong bg-white px-4 py-2 text-admin-sm font-semibold text-admin-text-2 hover:bg-admin-bg"
        >
          마케팅 운영으로 돌아가기
        </Link>
      </header>

      <section className="rounded-admin-md border border-blue-200 bg-blue-50 p-4 text-admin-sm text-blue-900">
        <p className="font-semibold">상태 표시 기준</p>
        <p className="mt-1 leading-6">
          ‘발행 허용’은 자동 발행 스위치일 뿐, 계정 연결 완료를 뜻하지 않습니다.
          실제 운영 가능 여부는 마케팅 운영 화면의 채널 상태에서 확인하세요.
        </p>
      </section>

      {error && (
        <div role="alert" className="rounded-admin-md border border-red-200 bg-red-50 p-4 text-admin-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div aria-live="polite" className="rounded-admin-md border border-admin-border-mid bg-white p-8 text-center text-admin-sm text-admin-muted">
          채널 설정을 확인하고 있습니다.
        </div>
      ) : (
        <div className="space-y-3">
          {PLATFORM_ORDER.map((platform) => {
            const config = configs.find((item) => item.platform === platform);
            const hasAccount = Boolean(config?.account_id);
            const isSaving = saving === platform;
            return (
              <section key={platform} className="rounded-admin-md border border-admin-border-mid bg-white p-5 shadow-admin-xs">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-bold text-admin-text-2">{PLATFORM_LABELS[platform] ?? platform}</h2>
                      <span className={`rounded-full border px-2.5 py-1 text-admin-xs font-semibold ${
                        hasAccount
                          ? 'border-blue-200 bg-blue-50 text-blue-700'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                      }`}>
                        {hasAccount ? '계정 정보 있음' : '계정 연결 필요'}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-admin-xs font-semibold ${
                        config?.enabled
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-slate-50 text-slate-600'
                      }`}>
                        {config?.enabled ? '발행 허용' : '발행 중지'}
                      </span>
                    </div>
                    <dl className="mt-3 grid gap-x-6 gap-y-2 text-admin-xs text-admin-muted sm:grid-cols-3">
                      <div>
                        <dt className="font-semibold">오늘 발행</dt>
                        <dd className="mt-1">{config?.posts_today ?? 0}건</dd>
                      </div>
                      <div>
                        <dt className="font-semibold">마지막 발행</dt>
                        <dd className="mt-1">{formatDate(config?.last_post_at ?? null)}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold">연결 만료</dt>
                        <dd className="mt-1">{formatDate(config?.token_expires_at ?? null)}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    {config ? (
                      <>
                        <label className="text-admin-xs font-semibold text-admin-muted">
                          하루 발행 한도
                          <input
                            type="number"
                            defaultValue={config.daily_limit ?? 3}
                            min={1}
                            max={100}
                            aria-label={`${PLATFORM_LABELS[platform]} 하루 발행 한도`}
                            className="mt-1 block w-24 rounded-admin-sm border border-admin-border-strong px-3 py-2 text-admin-sm text-admin-text-2"
                            onBlur={(event) => {
                              const value = Number.parseInt(event.target.value, 10);
                              if (
                                Number.isInteger(value) &&
                                value !== (config.daily_limit ?? 3)
                              ) {
                                void updateConfig(platform, { daily_limit: value });
                              }
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={config.enabled}
                          aria-label={`${PLATFORM_LABELS[platform]} 발행 허용`}
                          onClick={() => void updateConfig(platform, { enabled: !config.enabled })}
                          disabled={isSaving}
                          className={`relative h-10 w-16 rounded-full border transition ${
                            config.enabled
                              ? 'border-emerald-500 bg-emerald-500'
                              : 'border-slate-300 bg-slate-200'
                          } disabled:opacity-50`}
                        >
                          <span className={`absolute top-1 h-8 w-8 rounded-full bg-white shadow transition-transform ${
                            config.enabled ? 'left-7' : 'left-1'
                          }`} />
                        </button>
                      </>
                    ) : (
                      <span className="text-admin-xs text-admin-muted">설정 행이 없습니다.</span>
                    )}

                    {platform === 'threads' ? (
                      <button
                        type="button"
                        onClick={() => void connectThreads()}
                        disabled={connecting === platform}
                        className="rounded-admin-sm bg-blue-600 px-4 py-2 text-admin-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {connecting === platform ? '연결 화면 여는 중' : 'Threads 계정 연결'}
                      </button>
                    ) : (
                      <span className="rounded-admin-sm bg-admin-bg px-3 py-2 text-admin-xs font-semibold text-admin-muted">
                        연결 화면 준비 중
                      </span>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <section className="rounded-admin-md border border-admin-border-mid bg-white p-5">
        <h2 className="font-bold text-admin-text-2">아직 직접 연결할 수 없는 채널</h2>
        <p className="mt-2 text-admin-sm leading-6 text-admin-muted">
          인스타그램, 페이스북, 네이버 카페, X는 현재 이 화면에서 계정 연결을 완료할 수 없습니다.
          버튼만 보여 연결된 것처럼 만들지 않고, 연결 기능이 준비될 때까지 ‘준비 중’으로 표시합니다.
        </p>
      </section>
    </div>
  );
}
