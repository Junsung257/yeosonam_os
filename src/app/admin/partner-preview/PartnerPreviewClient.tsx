'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';

const STORAGE_KEY = 'admin.partnerPreview.referralCode';

function sanitizeCode(raw: string): string {
  return normalizeAffiliateReferralCode(raw.replace(/^\/+|\/+$/g, ''));
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function PartnerPreviewClient() {
  const envDefault = process.env.NEXT_PUBLIC_DEV_AFFILIATE_CODE?.trim() ?? '';
  const [code, setCode] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [siteOrigin, setSiteOrigin] = useState('');
  const [copiedHint, setCopiedHint] = useState<string | null>(null);

  useEffect(() => {
    const fromEnv = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');
    setSiteOrigin(fromEnv || (typeof window !== 'undefined' ? window.location.origin : ''));
  }, []);

  useEffect(() => {
    try {
      const urlCode =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('code')
          : null;
      const fromUrl = urlCode ? sanitizeCode(urlCode) : '';
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      const fromStore = saved ? sanitizeCode(saved) : '';
      const initial = fromUrl || fromStore || envDefault;
      setCode(initial);
      if (fromUrl && typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, fromUrl);
      }
    } finally {
      setHydrated(true);
    }
  }, [envDefault]);

  const persist = useCallback((next: string) => {
    const c = sanitizeCode(next);
    setCode(c);
    if (typeof window !== 'undefined') {
      if (c) window.localStorage.setItem(STORAGE_KEY, c);
      else window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const safeCode = useMemo(() => sanitizeCode(code), [code]);
  const withUrl = safeCode ? `/with/${encodeURIComponent(safeCode)}` : '';
  const portalUrl = safeCode ? `/influencer/${encodeURIComponent(safeCode)}` : '';

  const absolute = useCallback(
    (path: string) => (siteOrigin && path ? `${siteOrigin}${path}` : ''),
    [siteOrigin],
  );

  const onCopy = useCallback(async (label: string, fullUrl: string) => {
    if (!fullUrl) return;
    const ok = await copyText(fullUrl);
    setCopiedHint(ok ? label : '복사 실패');
    window.setTimeout(() => setCopiedHint(null), 2000);
  }, []);

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">파트너 프론트 미리보기</h1>
        <p className="text-sm text-slate-500 mt-1">
          공개 가입 폼·코브랜딩 랜딩·인플루언서 포털을 새 탭에서 바로 엽니다. 추천코드는 이 브라우저에만 저장됩니다.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">추천코드 (슬러그)</label>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onBlur={() => hydrated && persist(code)}
          placeholder="예: HEIZE"
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => persist(code)}
            className="text-xs px-3 py-1.5 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            코드 저장 (로컬)
          </button>
          {envDefault ? (
            <span className="text-xs text-slate-400 self-center">
              빌드 시 기본값: <span className="font-mono text-slate-600">{envDefault}</span> (NEXT_PUBLIC_DEV_AFFILIATE_CODE)
            </span>
          ) : null}
        </div>
      </div>

      {siteOrigin ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">공유용 전체 URL 복사</p>
            {copiedHint ? (
              <span className="text-[11px] text-emerald-600 font-medium">{copiedHint === '복사 실패' ? copiedHint : `복사됨: ${copiedHint}`}</span>
            ) : null}
          </div>
          <p className="text-[11px] text-slate-400 break-all">기준 도메인: {siteOrigin}</p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => onCopy('가입 신청', absolute('/partner-apply'))}
              className="text-left text-xs px-3 py-2 rounded-md bg-white border border-slate-200 hover:bg-slate-50 text-slate-700"
            >
              가입 신청 페이지 URL
            </button>
            <button
              type="button"
              disabled={!safeCode}
              onClick={() => onCopy('코브랜딩', absolute(withUrl))}
              className={`text-left text-xs px-3 py-2 rounded-md border ${
                safeCode
                  ? 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                  : 'bg-slate-100 border-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              코브랜딩 랜딩 URL (/with/…)
            </button>
            <button
              type="button"
              disabled={!safeCode}
              onClick={() => onCopy('인플루언서 포털', absolute(portalUrl))}
              className={`text-left text-xs px-3 py-2 rounded-md border ${
                safeCode
                  ? 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                  : 'bg-slate-100 border-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              인플루언서 포털 URL (/influencer/…)
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">열기</p>
        <ul className="space-y-2">
          <li>
            <a
              href="/partner-apply"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-800 hover:bg-blue-50"
            >
              <span>파트너 가입 신청 (공개)</span>
              <span className="text-blue-500 text-xs">↗ /partner-apply</span>
            </a>
          </li>
          <li>
            <a
              href={withUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!safeCode}
              onClick={(e) => {
                if (!safeCode) e.preventDefault();
              }}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
                safeCode
                  ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900 hover:bg-emerald-50'
                  : 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
              }`}
            >
              <span>코브랜딩 랜딩 (고객용)</span>
              <span className="text-xs font-mono opacity-80">{safeCode ? withUrl : '코드 입력'}</span>
            </a>
          </li>
          <li>
            <a
              href={portalUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!safeCode}
              onClick={(e) => {
                if (!safeCode) e.preventDefault();
              }}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
                safeCode
                  ? 'border-violet-200 bg-violet-50/80 text-violet-900 hover:bg-violet-50'
                  : 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
              }`}
            >
              <span>인플루언서 포털 (파트너용)</span>
              <span className="text-xs font-mono opacity-80">{safeCode ? portalUrl : '코드 입력'}</span>
            </a>
          </li>
        </ul>
      </div>

      <p className="text-xs text-slate-400">
        운영 메뉴: <span className="font-mono">/admin/applications</span> (신청 심사),{' '}
        <span className="font-mono">/admin/affiliates</span> (제휴 관리).
      </p>
    </div>
  );
}
