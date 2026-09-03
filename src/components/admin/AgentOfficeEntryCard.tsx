'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type EntryState = 'loading' | 'hidden' | 'ready' | 'error';
type OfficeStatus = {
  route: '/admin/agent-mas';
  phase: 'foundation-shadow' | 'blocked';
  label: string;
  description: string;
  canWrite: false;
  autonomousLoop: false;
};

/** A platform-admin-only, backend-attested entry point for the read-only Office. */
export default function AgentOfficeEntryCard() {
  const [state, setState] = useState<EntryState>('loading');
  const [status, setStatus] = useState<OfficeStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const sessionResponse = await fetch('/api/admin/session', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!sessionResponse.ok) {
          setState('hidden');
          return;
        }
        const session = await sessionResponse.json() as { user?: { role?: string } | null };
        if (session.user?.role !== 'platform_admin') {
          setState('hidden');
          return;
        }

        const response = await fetch('/api/admin/agent/office/status', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          setState('error');
          return;
        }
        const payload = await response.json() as OfficeStatus;
        setStatus(payload);
        setState('ready');
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  if (state === 'hidden') return null;
  if (state === 'loading') {
    return <div aria-label="AI 운영실 진입점 로딩 중" className="h-[92px] animate-pulse rounded-admin-md bg-admin-surface-2" />;
  }

  const href = status?.route ?? '/admin/agent-mas';
  const label = state === 'error' ? '상태 확인 필요' : status?.label ?? 'Foundation · Shadow 읽기 전용';
  const description = state === 'error'
    ? '운영실 상태를 확인할 수 없습니다. 페이지에서 다시 확인하세요.'
    : status?.description ?? 'Technology Scout 1개 역할의 계약·차단 상태를 확인하는 관찰 전용 Foundation입니다.';

  return (
    <Link
      href={href}
      className="group block rounded-admin-md border border-slate-700 bg-slate-950 px-4 py-3 text-white shadow-admin-xs transition-colors hover:border-slate-500 focus-visible:outline-none focus-visible:shadow-admin-focus"
      aria-label="AI 운영실 열기"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">YEOSONAM OFFICE</span>
            <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">{label}</span>
          </div>
          <p className="mt-1 text-base font-bold">AI 운영실</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{description}</p>
        </div>
        <span className="shrink-0 rounded-full border border-slate-600 px-2.5 py-1 text-[10px] font-semibold text-slate-200 transition-colors group-hover:border-slate-400">
          관제 열기 →
        </span>
      </div>
      <p className="mt-2 text-[10px] text-slate-400">읽기 전용 · 자동 변경 없음 · 승인/Command 잠금</p>
    </Link>
  );
}
