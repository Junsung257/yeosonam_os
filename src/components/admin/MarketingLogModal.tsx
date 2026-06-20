'use client';

import React, { useState, useEffect, useRef } from 'react';

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
  const modalRef = useRef<HTMLDivElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const modalTitleId = 'marketing-log-modal-title';
  const modalDescriptionId = 'marketing-log-modal-description';
  const urlErrorId = 'marketing-log-url-error';
  const platformGroupId = 'marketing-log-platform-group';

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const getFocusableElements = () => Array.from(
      modalRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );

    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      urlInputRef.current?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (focusableElements.length === 1) {
        event.preventDefault();
        firstElement.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      window.setTimeout(() => {
        if (previousActiveElement && document.contains(previousActiveElement)) previousActiveElement.focus();
      }, 0);
    };
  }, [onClose]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 cursor-default"
        onClick={onClose}
        aria-label="발행 기록 모달 닫기"
      />
      <div
        ref={modalRef}
        className="relative bg-white rounded-admin-lg shadow-2xl w-full max-w-md mx-4 p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby={modalTitleId}
        aria-describedby={modalDescriptionId}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 id={modalTitleId} className="text-lg font-bold text-admin-text">발행 기록 남기기</h2>
            <p id={modalDescriptionId} className="text-xs text-admin-muted mt-0.5">마케팅 발행 URL을 저장합니다</p>
          </div>
          <button type="button" onClick={onClose} className="text-admin-muted-2 hover:text-admin-text-2 text-xl leading-none" aria-label="발행 기록 모달 닫기">×</button>
        </div>

        {/* URL 입력 */}
        <div className="mb-4">
          <label htmlFor="marketing-log-url" className="block text-sm font-semibold text-admin-text-2 mb-1.5">발행 URL</label>
          <input
            ref={urlInputRef}
            id="marketing-log-url"
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
            aria-invalid={Boolean(urlError)}
            aria-describedby={urlError ? urlErrorId : modalDescriptionId}
            placeholder="https://blog.naver.com/..."
            className={`w-full border-2 rounded-admin-md px-3.5 py-2.5 text-sm focus:outline-none transition-colors
              ${urlError ? 'border-red-400 focus:border-red-400' : 'border-admin-border-mid focus:border-blue-500'}`}
          />
          {urlError && <p id={urlErrorId} role="alert" className="text-xs text-red-500 mt-1.5">{urlError}</p>}
          {!urlError && autoDetected && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className={`w-4 h-4 rounded text-white text-[10px] font-bold flex items-center justify-center shrink-0 ${PLATFORM_META[autoDetected].color}`}>
                {PLATFORM_META[autoDetected].icon}
              </span>
              <span className="text-xs text-admin-muted">
                자동 감지: <strong>{PLATFORM_META[autoDetected].label}</strong>
              </span>
            </div>
          )}
        </div>

        {/* 플랫폼 선택 */}
        <div className="mb-5">
          <div id={platformGroupId} className="block text-sm font-semibold text-admin-text-2 mb-2">플랫폼 선택</div>
          <div className="grid grid-cols-5 gap-2" role="group" aria-labelledby={platformGroupId}>
            {(Object.entries(PLATFORM_META) as [Platform, typeof PLATFORM_META[Platform]][]).map(([key, m]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPlatform(key)}
                aria-pressed={platform === key}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-admin-md border-2 transition-all
                  ${platform === key
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-admin-border hover:border-admin-border-strong bg-admin-bg'
                  }`}
              >
                <span className={`w-7 h-7 rounded-lg text-white text-sm font-bold flex items-center justify-center ${m.color}`}>
                  {m.icon}
                </span>
                <span className={`text-[11px] font-medium ${platform === key ? 'text-blue-700' : 'text-admin-muted'}`}>
                  {m.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 저장 버튼 */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-admin-md border border-admin-border-mid text-sm font-medium text-admin-muted hover:bg-admin-bg transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !!urlError || !url.trim()}
            aria-busy={saving}
            className="flex-1 py-2.5 rounded-admin-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-sm font-bold text-white transition-colors"
          >
            {saving ? '저장 중...' : `${meta.label} 기록 저장`}
          </button>
        </div>
      </div>
    </div>
  );
}
