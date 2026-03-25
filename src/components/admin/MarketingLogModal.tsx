'use client';

import React, { useState, useEffect } from 'react';

type Platform = 'blog' | 'instagram' | 'cafe' | 'threads' | 'other';

const PLATFORM_META: Record<Platform, { label: string; icon: string; color: string; example: string }> = {
  blog:      { label: '블로그',   icon: 'N',  color: 'bg-green-500',  example: 'blog.naver.com/...' },
  instagram: { label: '인스타',   icon: '📸', color: 'bg-pink-500',   example: 'instagram.com/p/...' },
  cafe:      { label: '카페',     icon: '☕', color: 'bg-amber-500',  example: 'cafe.naver.com/...' },
  threads:   { label: '스레드',   icon: '◎',  color: 'bg-gray-800',   example: 'threads.net/...' },
  other:     { label: '기타',     icon: '🔗', color: 'bg-gray-500',   example: 'https://...' },
};

const URL_RE = /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&//=]*)$/i;

function validateUrl(url: string) {
  return URL_RE.test(url.trim());
}

function autoDetectPlatform(url: string): Platform {
  const u = url.toLowerCase();
  if (/cafe\.naver\.com/.test(u))               return 'cafe';
  if (/blog\.naver\.com|m\.blog\.naver/.test(u)) return 'blog';
  if (/naver\.com/.test(u))                      return 'blog';
  if (/instagram\.com/.test(u))                  return 'instagram';
  if (/threads\.net/.test(u))                    return 'threads';
  return 'other';
}

interface Props {
  productId?:        string;
  travelPackageId?:  string;
  onClose:           () => void;
  onSaved:           () => void;
}

export default function MarketingLogModal({ productId, travelPackageId, onClose, onSaved }: Props) {
  const [url, setUrl]               = useState('');
  const [platform, setPlatform]     = useState<Platform>('blog');
  const [autoDetected, setAutoDetected] = useState<Platform | null>(null);
  const [urlError, setUrlError]     = useState('');
  const [saving, setSaving]         = useState(false);

  // URL 변경 시 실시간 자동 감지
  useEffect(() => {
    if (!url.trim()) { setAutoDetected(null); setUrlError(''); return; }
    if (!validateUrl(url.trim())) {
      setUrlError('유효하지 않은 URL 형식입니다.');
      setAutoDetected(null);
    } else {
      setUrlError('');
      const detected = autoDetectPlatform(url.trim());
      setAutoDetected(detected);
      setPlatform(detected);
    }
  }, [url]);

  async function handleSave() {
    if (!url.trim()) { setUrlError('URL을 입력하세요.'); return; }
    if (!validateUrl(url.trim())) { setUrlError('유효하지 않은 URL 형식입니다.'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/marketing-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id:        productId        ?? null,
          travel_package_id: travelPackageId  ?? null,
          platform,
          url: url.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setUrlError(err.error ?? '저장 실패');
        return;
      }
      onSaved();
      onClose();
    } catch {
      setUrlError('네트워크 오류 — 다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  }

  const meta = PLATFORM_META[platform];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">발행 기록 남기기</h2>
            <p className="text-xs text-gray-500 mt-0.5">마케팅 발행 URL을 저장합니다</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        {/* URL 입력 */}
        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">발행 URL</label>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
            placeholder="https://blog.naver.com/..."
            className={`w-full border-2 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none transition-colors
              ${urlError ? 'border-red-400 focus:border-red-400' : 'border-gray-200 focus:border-blue-500'}`}
          />
          {urlError && <p className="text-xs text-red-500 mt-1.5">{urlError}</p>}
          {!urlError && autoDetected && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className={`w-4 h-4 rounded text-white text-[10px] font-bold flex items-center justify-center shrink-0 ${PLATFORM_META[autoDetected].color}`}>
                {PLATFORM_META[autoDetected].icon}
              </span>
              <span className="text-xs text-gray-500">
                자동 감지: <strong>{PLATFORM_META[autoDetected].label}</strong>
              </span>
            </div>
          )}
        </div>

        {/* 플랫폼 선택 */}
        <div className="mb-5">
          <label className="block text-sm font-semibold text-gray-700 mb-2">플랫폼 선택</label>
          <div className="grid grid-cols-5 gap-2">
            {(Object.entries(PLATFORM_META) as [Platform, typeof PLATFORM_META[Platform]][]).map(([key, m]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPlatform(key)}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 transition-all
                  ${platform === key
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-100 hover:border-gray-300 bg-gray-50'
                  }`}
              >
                <span className={`w-7 h-7 rounded-lg text-white text-sm font-bold flex items-center justify-center ${m.color}`}>
                  {m.icon}
                </span>
                <span className={`text-[11px] font-medium ${platform === key ? 'text-blue-700' : 'text-gray-600'}`}>
                  {m.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 저장 버튼 */}
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !!urlError || !url.trim()}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-sm font-bold text-white transition-colors"
          >
            {saving ? '저장 중...' : `${meta.label} 기록 저장`}
          </button>
        </div>
      </div>
    </div>
  );
}
