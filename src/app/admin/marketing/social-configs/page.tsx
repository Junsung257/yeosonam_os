'use client';

import { useState, useEffect } from 'react';

interface SocialConfig {
  platform: string;
  enabled: boolean;
  daily_limit: number | null;
  posts_today: number;
  last_post_at: string | null;
  access_token?: string | null;
  token_expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

const PLATFORM_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  instagram: { label: 'Instagram', icon: '📷', color: 'from-pink-500 to-purple-600' },
  threads: { label: 'Threads', icon: '🧵', color: 'from-gray-800 to-gray-600' },
  twitter: { label: 'X (Twitter)', icon: '🐦', color: 'from-blue-400 to-blue-600' },
  facebook: { label: 'Facebook', icon: '👍', color: 'from-blue-600 to-blue-800' },
  naver_blog: { label: '네이버 블로그', icon: '📝', color: 'from-green-500 to-green-700' },
};

/** Meta-family 플랫폼은 OAuth 연결 지원 */
const META_PLATFORMS = new Set(['threads', 'instagram']);

export default function SocialConfigsPage() {
  const [configs, setConfigs] = useState<SocialConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/social-configs');
      if (res.ok) {
        const data = await res.json();
        setConfigs(data.configs ?? []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchConfigs(); }, []);

  const toggleEnabled = async (platform: string, current: boolean) => {
    setSaving(platform);
    try {
      const res = await fetch('/api/admin/social-configs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, updates: { enabled: !current } }),
      });
      if (res.ok) fetchConfigs();
    } finally {
      setSaving(null);
    }
  };

  const updateDailyLimit = async (platform: string, limit: number) => {
    setSaving(platform);
    try {
      const res = await fetch('/api/admin/social-configs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, updates: { daily_limit: limit } }),
      });
      if (res.ok) fetchConfigs();
    } finally {
      setSaving(null);
    }
  };

  const connectOAuth = async (platform: string) => {
    setConnecting(platform);
    try {
      const res = await fetch('/api/admin/social-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.oauth_url) {
          window.location.href = data.oauth_url;
        }
      }
    } catch { /* ignore */ }
    setConnecting(null);
  };

  const allPlatforms = ['instagram', 'threads', 'twitter', 'facebook', 'naver_blog'];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-admin-text">소셜 플랫폼 설정</h1>
        <p className="text-sm text-admin-muted mt-1">자동 콘텐츠 발행 플랫폼 관리 · 활성화/비활성화 · 일일 한도</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border p-5 animate-pulse">
              <div className="h-5 bg-gray-100 rounded w-32 mb-3" />
              <div className="h-3 bg-gray-100 rounded w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {allPlatforms.map(platform => {
            const config = configs.find(c => c.platform === platform);
            const info = PLATFORM_LABELS[platform] || { label: platform, icon: '🔌', color: 'from-gray-400 to-gray-600' };

            return (
              <div key={platform} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${info.color} flex items-center justify-center`}>
                      <span className="text-lg">{info.icon}</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 text-sm">{info.label}</h3>
                      <p className="text-[10px] text-gray-400">
                        {config
                          ? `오늘 ${config.posts_today}회 발행${config.last_post_at ? ` · 마지막: ${new Date(config.last_post_at).toLocaleDateString()}` : ''}`
                          : '설정되지 않음'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {config && (
                      <>
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] text-gray-400">일일한도</label>
                          <input
                            type="number"
                            defaultValue={config.daily_limit ?? 10}
                            min={1}
                            max={100}
                            className="w-16 border border-gray-300 rounded px-2 py-1 text-xs text-center"
                            onBlur={e => {
                              const val = parseInt(e.target.value);
                              if (val > 0 && val !== (config.daily_limit ?? 10)) {
                                updateDailyLimit(platform, val);
                              }
                            }}
                          />
                        </div>
                        <button
                          onClick={() => toggleEnabled(platform, config?.enabled ?? false)}
                          disabled={saving === platform}
                          className={`relative w-11 h-6 rounded-full transition-colors ${
                            config?.enabled ? 'bg-green-500' : 'bg-gray-300'
                          } ${saving === platform ? 'opacity-50' : ''}`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${
                              config?.enabled ? 'translate-x-5' : ''
                            }`}
                          />
                        </button>
                      </>
                    )}

                    {/* OAuth 연결 버튼 (Meta 계열만) */}
                    {META_PLATFORMS.has(platform) && (
                      <button
                        onClick={() => connectOAuth(platform)}
                        disabled={connecting === platform}
                        className="px-3 py-1.5 text-[11px] font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {connecting === platform ? '연결 중...' : '연결'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 mt-3 text-[10px]">
                  <span className={`flex items-center gap-1 ${config?.enabled ? 'text-green-600' : 'text-gray-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${config?.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                    {config?.enabled ? '활성' : '비활성'}
                  </span>
                  {config && (
                    <span className="text-gray-400">
                      일일 한도: {config.daily_limit ?? 10}회
                    </span>
                  )}
                  {config?.token_expires_at && (
                    <span className="text-gray-400">
                      토큰 만료: {new Date(config.token_expires_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm">
        <h3 className="font-semibold text-amber-800 mb-2">🔧 X(Twitter) 발행 설정 안내</h3>
        <div className="text-amber-700 text-xs space-y-1">
          <p>1. <a href="https://developer.twitter.com" target="_blank" className="underline">Twitter Developer Portal</a>에서 Project 생성</p>
          <p>2. OAuth 2.0 Client ID / Client Secret 발급 (OAuth 2.0 PKCE 또는 OAuth 1.0a)</p>
          <p>3. 환경변수 설정</p>
        </div>
      </div>
    </div>
  );
}
