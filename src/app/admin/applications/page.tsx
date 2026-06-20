'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { fmtDateISO } from '@/lib/admin-utils';
import { maskPhone } from '@/lib/pii-mask';

interface Application {
  id: string;
  name: string;
  phone: string;
  channel_type: string;
  channel_url: string;
  follower_count: number | null;
  intro: string | null;
  business_type: string;
  business_number: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reject_reason: string | null;
  applied_at: string;
  reviewed_at: string | null;
  has_invite_code?: boolean;
  terms_accepted_at?: string | null;
  disclosure_ack_at?: string | null;
  channel_url_normalized?: string | null;
  application_risk_score?: number | null;
  risk_reasons?: string[] | null;
}

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  PENDING: { label: '대기', color: 'bg-amber-100 text-amber-700' },
  APPROVED: { label: '승인', color: 'bg-green-100 text-green-700' },
  REJECTED: { label: '거절', color: 'bg-red-100 text-red-700' },
};

const CHANNEL_LABELS: Record<string, string> = {
  blog: '블로그',
  instagram: 'Instagram',
  youtube: 'YouTube',
  cafe: '카페/커뮤니티',
  other: '기타',
};

/** 채널 URL에서 핸들러/채널명 추출 */
function extractChannelHandle(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    return parts[parts.length - 1] || url;
  } catch {
    return url;
  }
}

/** 팔로워 수 기반 영향력 점수 (0~100) */
function influenceScore(app: Application): number {
  const fc = app.follower_count || 0;
  // 인스타: 1천=20, 5천=40, 1만=60, 5만=80, 10만+=100
  if (app.channel_type === 'instagram') {
    if (fc >= 100000) return 95;
    if (fc >= 50000) return 80;
    if (fc >= 10000) return 60;
    if (fc >= 5000) return 40;
    if (fc >= 1000) return 20;
    return 5;
  }
  // 유튜브: 더 높은 기준
  if (app.channel_type === 'youtube') {
    if (fc >= 500000) return 95;
    if (fc >= 100000) return 80;
    if (fc >= 50000) return 60;
    if (fc >= 10000) return 40;
    if (fc >= 5000) return 20;
    return 5;
  }
  // 블로그/기타
  if (fc >= 100000) return 80;
  if (fc >= 50000) return 60;
  if (fc >= 10000) return 40;
  if (fc >= 1000) return 20;
  return 5;
}

function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: '상', color: 'bg-green-100 text-green-700' };
  if (score >= 40) return { label: '중', color: 'bg-yellow-100 text-yellow-700' };
  return { label: '보통', color: 'bg-gray-100 text-gray-500' };
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
}

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [inviteFilter, setInviteFilter] = useState<string>(''); // ''=all, 'invited', 'open'
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [showChecklist, setShowChecklist] = useState<string | null>(null);
  const [approveSuccess, setApproveSuccess] = useState<{
    referralCode: string;
    affiliateId: string;
    pin: string;
  } | null>(null);
  const approveSuccessRef = useRef<HTMLDivElement | null>(null);
  const checklistDialogRef = useRef<HTMLDivElement | null>(null);
  const checklistFirstInputRef = useRef<HTMLInputElement | null>(null);
  const checklistReturnFocusRef = useRef<HTMLElement | null>(null);
  const approveDialogRef = useRef<HTMLDivElement | null>(null);
  const approveCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const approveReturnFocusRef = useRef<HTMLElement | null>(null);
  const rejectDialogRef = useRef<HTMLDivElement | null>(null);
  const rejectTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const rejectReturnFocusRef = useRef<HTMLElement | null>(null);
  const checklistTitleId = 'application-review-checklist-title';
  const checklistDescriptionId = 'application-review-checklist-description';
  const checklistStatusId = 'application-review-checklist-status';
  const approveTitleId = 'application-approve-confirm-title';
  const approveDescriptionId = 'application-approve-confirm-description';
  const approveStatusId = 'application-approve-confirm-status';
  const rejectTitleId = 'application-reject-title';
  const rejectDescriptionId = 'application-reject-description';
  const rejectStatusId = 'application-reject-status';
  const checklistOpen = showChecklist !== null;
  const approveOpen = approveTarget !== null;
  const rejectOpen = rejectTarget !== null;

  const closeChecklist = useCallback((restoreFocus = true) => {
    setShowChecklist(null);
    if (restoreFocus) requestAnimationFrame(() => checklistReturnFocusRef.current?.focus());
  }, []);

  const closeApproveDialog = useCallback(() => {
    setApproveTarget(null);
    requestAnimationFrame(() => approveReturnFocusRef.current?.focus());
  }, []);

  const closeRejectDialog = useCallback(() => {
    setRejectTarget(null);
    setRejectReason('');
    requestAnimationFrame(() => rejectReturnFocusRef.current?.focus());
  }, []);

  const load = async () => {
    try {
      const url = filter ? `/api/admin/applications?status=${filter}` : '/api/admin/applications';
      const res = await fetch(url);
      const data = await res.json();
      setApplications(data.applications || []);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/id-trigger-only intentional
  useEffect(() => { load(); }, [filter]);

  const filteredApps = applications.filter(app => {
    if (inviteFilter === 'invited') return app.has_invite_code;
    if (inviteFilter === 'open') return !app.has_invite_code;
    return true;
  });

  const handleApprove = async (id: string) => {
    setProcessingId(id);
    try {
      const res = await fetch('/api/admin/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId: id, action: 'approve' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const aff = data.affiliate;
      if (aff?.referral_code && aff?.id) {
        setApproveSuccess({
          referralCode: aff.referral_code,
          affiliateId: aff.id,
          pin: typeof aff.pin === 'string' ? aff.pin : '',
        });
      }
      setNotice(null);
      setApproveTarget(null);
      requestAnimationFrame(() => approveSuccessRef.current?.focus());
      load();
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : '처리 실패' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    setProcessingId(rejectTarget);
    try {
      const res = await fetch('/api/admin/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId: rejectTarget, action: 'reject', reject_reason: rejectReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      closeRejectDialog();
      setNotice({ tone: 'success', message: '파트너 신청을 거절 처리했습니다.' });
      load();
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : '처리 실패' });
    } finally {
      setProcessingId(null);
    }
  };

  useEffect(() => {
    if (!checklistOpen) return undefined;
    const dialog = checklistDialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => checklistFirstInputRef.current?.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeChecklist();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(dialog);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [checklistOpen, closeChecklist]);

  useEffect(() => {
    if (!rejectOpen) return undefined;
    const dialog = rejectDialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => rejectTextareaRef.current?.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRejectDialog();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(dialog);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeRejectDialog, rejectOpen]);

  useEffect(() => {
    if (!approveOpen) return undefined;
    const dialog = approveDialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => approveCancelButtonRef.current?.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeApproveDialog();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(dialog);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [approveOpen, closeApproveDialog]);

  const openChecklist = (app: Application, trigger?: HTMLElement) => {
    checklistReturnFocusRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setChecklist({
      channel_valid: true,
      follower_quality: (app.follower_count || 0) >= 1000,
      intro_adequate: !!app.intro && app.intro.length >= 10,
      no_duplicate: true,
    });
    setShowChecklist(app.id);
  };

  const openApproveDialog = (id: string, trigger?: HTMLElement | null) => {
    approveReturnFocusRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setApproveTarget(id);
  };

  const openRejectDialog = (id: string, trigger?: HTMLElement) => {
    rejectReturnFocusRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setRejectTarget(id);
  };

  return (
      <div className="space-y-4">
        {approveSuccess && (
          <div
            ref={approveSuccessRef}
            tabIndex={-1}
            aria-live="polite"
            className="rounded-admin-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900 flex flex-col gap-2 md:flex-row md:items-center md:justify-between focus:outline-none focus:shadow-admin-focus"
          >
            <div>
              <p className="font-semibold">승인 완료</p>
              <p className="text-xs mt-1 font-mono">
                추천코드 <span className="text-green-800">{approveSuccess.referralCode}</span>
                {approveSuccess.pin ? (
                  <> · PIN <span className="text-green-800">{approveSuccess.pin}</span></>
                ) : null}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/admin/partner-preview?code=${encodeURIComponent(approveSuccess.referralCode)}`}
                className="px-3 py-1.5 rounded-lg bg-green-700 text-white text-xs font-medium hover:bg-green-800"
              >
                프론트 미리보기 허브
              </Link>
              <Link
                href={`/admin/affiliates/${approveSuccess.affiliateId}`}
                className="px-3 py-1.5 rounded-lg bg-white border border-green-300 text-green-800 text-xs font-medium hover:bg-green-100/80"
              >
                제휴 상세
              </Link>
              <button
                type="button"
                onClick={() => setApproveSuccess(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-green-800 hover:bg-green-100/60"
              >
                닫기
              </button>
            </div>
          </div>
        )}

        {notice && (
          <div
            role={notice.tone === 'error' ? 'alert' : 'status'}
            aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
            className={`rounded-admin-md border px-4 py-3 text-admin-sm font-medium ${
              notice.tone === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {notice.message}
          </div>
        )}

        <PageHeader
          title="파트너 신청 관리"
          subtitle="인플루언서·파트너 가입 신청을 검토하고 승인합니다"
          actions={
            <div className="flex gap-1.5 flex-wrap">
              {['', 'PENDING', 'APPROVED', 'REJECTED'].map(s => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`h-8 px-3 rounded-admin-sm text-admin-sm font-medium transition-colors ${
                    filter === s
                      ? 'bg-brand text-white'
                      : 'bg-admin-surface border border-admin-border-mid text-admin-text-2 hover:bg-admin-surface-2 hover:border-admin-border-strong'
                  }`}
                >
                  {s === '' ? '전체' : STATUS_BADGE[s]?.label || s}
                </button>
              ))}
              <span className="w-px bg-admin-border-mid mx-1" />
              {[
                { key: '', label: '전체 유입' },
                { key: 'invited', label: '📩 초대' },
                { key: 'open', label: '📢 자유' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setInviteFilter(key)}
                  className={`h-8 px-2.5 rounded-admin-sm text-admin-xs font-medium transition-colors ${
                    inviteFilter === key
                      ? 'bg-brand/10 text-brand border border-brand/30'
                      : 'bg-admin-surface border border-admin-border-mid text-admin-text-2 hover:bg-admin-surface-2'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        />

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white rounded-admin-md border border-admin-border p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-4 bg-admin-surface-2 rounded animate-pulse w-32" />
                  <div className="h-4 bg-admin-surface-2 rounded-full animate-pulse w-16" />
                </div>
                <div className="h-3 bg-admin-surface-2 rounded animate-pulse w-full" />
                <div className="h-3 bg-admin-surface-2 rounded animate-pulse w-3/4" />
              </div>
            ))}
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14">
            <svg className="w-10 h-10 text-admin-border-mid" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" /></svg>
            <p className="text-admin-sm font-medium text-admin-muted">조건에 맞는 신청 내역이 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredApps.map(app => {
              const score = influenceScore(app);
              const sLabel = scoreLabel(score);
              return (
              <div key={app.id} className="bg-white rounded-admin-md border border-admin-border-mid p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-admin-text">{app.name}</h3>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        Number(app.application_risk_score || 0) >= 60
                          ? 'bg-red-50 text-red-600'
                          : Number(app.application_risk_score || 0) >= 30
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        Risk {Number(app.application_risk_score || 0)}
                      </span>
                      <span className={app.terms_accepted_at ? 'text-[10px] text-emerald-700' : 'text-[10px] text-red-600'}>
                        Terms {app.terms_accepted_at ? 'OK' : 'Missing'}
                      </span>
                      <span className={app.disclosure_ack_at ? 'text-[10px] text-emerald-700' : 'text-[10px] text-red-600'}>
                        Disclosure {app.disclosure_ack_at ? 'OK' : 'Missing'}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[app.status]?.color}`}>
                        {STATUS_BADGE[app.status]?.label}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sLabel.color}`}>
                        영향력 {sLabel.label} ({score})
                      </span>
                      {app.has_invite_code ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">📩 초대</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-medium">📢 자유신청</span>
                      )}
                    </div>
                    <p className="text-xs text-admin-muted mt-0.5">{maskPhone(app.phone, 'marketer')} · 신청일 {fmtDateISO(app.applied_at)}</p>
                  </div>
                  {app.status === 'PENDING' && (
                    <div className="flex gap-2">
                      <button
                        onClick={event => openChecklist(app, event.currentTarget)}
                        disabled={processingId === app.id}
                        className="px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg text-xs font-medium disabled:opacity-50 hover:bg-blue-100"
                      >심사</button>
                      <button
                        onClick={event => openApproveDialog(app.id, event.currentTarget)}
                        disabled={processingId === app.id}
                        aria-haspopup="dialog"
                        aria-controls={approveTarget === app.id ? 'application-approve-confirm-dialog' : undefined}
                        className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                      >승인</button>
                      <button
                        onClick={event => openRejectDialog(app.id, event.currentTarget)}
                        disabled={processingId === app.id}
                        className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium disabled:opacity-50"
                      >거절</button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-admin-muted">
                  <div><span className="text-admin-muted-2">채널: </span>{CHANNEL_LABELS[app.channel_type] || app.channel_type}</div>
                  <div><span className="text-admin-muted-2">팔로워: </span>{app.follower_count?.toLocaleString() || '-'}</div>
                  <div className="col-span-2">
                    <span className="text-admin-muted-2">URL: </span>
                    <a href={app.channel_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      {extractChannelHandle(app.channel_url)}
                    </a>
                  </div>
                  {app.intro && <div className="col-span-2"><span className="text-admin-muted-2">소개: </span>{app.intro}</div>}
                  <div><span className="text-admin-muted-2">유형: </span>{app.business_type === 'business' ? '사업자' : '개인'}</div>
                  {app.reject_reason && (
                    <div className="col-span-2 text-red-600"><span className="text-red-400">거절 사유: </span>{app.reject_reason}</div>
                  )}
                  {app.status === 'APPROVED' && (
                    <div className="col-span-2 pt-1 flex flex-wrap gap-3 text-[11px]">
                      <Link href="/admin/affiliates" className="text-blue-600 hover:underline font-medium">
                        제휴 관리 (추천코드·미리보기)
                      </Link>
                      <Link href="/admin/partner-preview" className="text-blue-600 hover:underline">
                        프론트 미리보기 허브
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            );
            })}
          </div>
        )}

        {/* 심사 체크리스트 모달 */}
        {showChecklist && (() => {
          const app = applications.find(a => a.id === showChecklist);
          if (!app) return null;
          const allChecked = Object.values(checklist).every(Boolean);
          const checklistStatusText = allChecked
            ? '모든 심사 항목이 체크되었습니다. 승인 진행을 선택할 수 있습니다.'
            : '모든 심사 항목을 체크해야 승인 진행을 선택할 수 있습니다.';
          return (
          <div className="fixed inset-0 z-50 flex h-dvh items-center justify-center overflow-y-auto bg-slate-900/40 px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div
              ref={checklistDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={checklistTitleId}
              aria-describedby={`${checklistDescriptionId} ${checklistStatusId}`}
              tabIndex={-1}
              className="admin-scope bg-admin-surface rounded-admin-md shadow-admin-xl border border-admin-border-mid p-6 max-w-md w-full"
            >
              <h3 id={checklistTitleId} className="text-admin-h3 text-admin-text mb-1">심사 체크리스트</h3>
              <p id={checklistDescriptionId} className="text-xs text-admin-muted mb-4">{app.name} · {CHANNEL_LABELS[app.channel_type] || app.channel_type}</p>
              <p id={checklistStatusId} role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {checklistStatusText}
              </p>
              <div className="space-y-2 mb-4">
                {[
                  { key: 'channel_valid', label: '채널 URL 유효함 (접속 가능)' },
                  { key: 'follower_quality', label: `팔로워 ${(app.follower_count || 0).toLocaleString()}명 — ${influenceScore(app) >= 40 ? '✅ 충분' : '⚠️ 적음'}` },
                  { key: 'intro_adequate', label: '자기소개 10자 이상 작성' },
                  { key: 'no_duplicate', label: '중복 신청 아님 (전화번호 기준)' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      ref={key === 'channel_valid' ? checklistFirstInputRef : undefined}
                      checked={checklist[key] || false}
                      onChange={(e) => setChecklist(prev => ({ ...prev, [key]: e.target.checked }))}
                      className="mt-0.5"
                    />
                    <span className="text-sm text-admin-text">{label}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => closeChecklist()}>닫기</Button>
                <Button
                  variant="primary"
                  disabled={!allChecked}
                  onClick={() => {
                    const returnTarget = checklistReturnFocusRef.current;
                    closeChecklist(false);
                    openApproveDialog(app.id, returnTarget);
                  }}
                >
                  {allChecked ? '✅ 체크 완료 — 승인 진행' : '모든 항목 체크 필요'}
                </Button>
              </div>
            </div>
          </div>
          );
        })()}

        {/* 승인 확인 모달 */}
        {approveTarget && (() => {
          const app = applications.find(a => a.id === approveTarget);
          if (!app) return null;
          const approveStatusText = processingId === approveTarget
            ? '파트너 계정을 생성하며 신청을 승인하는 중입니다.'
            : '승인하면 파트너 계정과 추천 코드가 자동 생성됩니다.';
          return (
          <div className="fixed inset-0 z-50 flex h-dvh items-center justify-center overflow-y-auto bg-slate-900/40 px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div
              id="application-approve-confirm-dialog"
              ref={approveDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={approveTitleId}
              aria-describedby={`${approveDescriptionId} ${approveStatusId}`}
              tabIndex={-1}
              className="admin-scope w-full max-w-sm rounded-admin-md border border-admin-border-mid bg-admin-surface p-6 shadow-admin-xl"
            >
              <h3 id={approveTitleId} className="text-admin-h3 text-admin-text">파트너 신청 승인</h3>
              <p id={approveDescriptionId} className="mt-2 text-admin-sm leading-6 text-admin-muted">
                {app.name} 신청을 승인합니다. 승인 즉시 파트너 계정, 추천 코드, 미리보기 허브 연결 정보가 생성됩니다.
              </p>
              <p id={approveStatusId} role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {approveStatusText}
              </p>
              <div className="mt-4 rounded-admin-sm border border-green-200 bg-green-50 px-3 py-2 text-admin-xs text-green-800">
                채널 {CHANNEL_LABELS[app.channel_type] || app.channel_type} · 팔로워 {(app.follower_count || 0).toLocaleString()}명 · 영향력 {scoreLabel(influenceScore(app)).label}
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  ref={approveCancelButtonRef}
                  onClick={closeApproveDialog}
                  disabled={processingId === approveTarget}
                  className="rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 py-2 text-admin-sm font-medium text-admin-text-2 hover:bg-admin-surface-2 focus:outline-none focus:shadow-admin-focus disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => handleApprove(approveTarget)}
                  disabled={processingId === approveTarget}
                  aria-busy={processingId === approveTarget}
                  className="rounded-admin-sm bg-green-600 px-3 py-2 text-admin-sm font-semibold text-white hover:bg-green-700 focus:outline-none focus:shadow-admin-focus disabled:opacity-50"
                >
                  승인 확정
                </button>
              </div>
            </div>
          </div>
          );
        })()}

        {/* 거절 사유 모달 */}
        {rejectTarget && (
          <div className="fixed inset-0 z-50 flex h-dvh items-center justify-center overflow-y-auto bg-slate-900/40 px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div
              ref={rejectDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={rejectTitleId}
              aria-describedby={`${rejectDescriptionId} ${rejectStatusId}`}
              tabIndex={-1}
              className="admin-scope bg-admin-surface rounded-admin-md shadow-admin-xl border border-admin-border-mid p-6 max-w-sm w-full"
            >
              <h3 id={rejectTitleId} className="text-admin-h3 text-admin-text mb-2">거절 사유</h3>
              <p id={rejectDescriptionId} className="text-xs text-admin-muted mb-3">
                선택한 신청을 거절합니다. 사유는 선택 입력이며 파트너 심사 기록에 남습니다.
              </p>
              <p id={rejectStatusId} role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {processingId === rejectTarget ? '거절 처리 중입니다.' : '거절 사유 입력창이 열렸습니다.'}
              </p>
              <textarea
                ref={rejectTextareaRef}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
                aria-describedby={`${rejectDescriptionId} ${rejectStatusId}`}
                placeholder="거절 사유를 입력하세요 (선택)"
                className="w-full border border-admin-border-mid rounded-admin-sm px-3 py-2 text-admin-sm bg-admin-surface text-admin-text mb-4 resize-none focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={closeRejectDialog}>
                  취소
                </Button>
                <Button variant="danger" onClick={handleReject} disabled={processingId === rejectTarget} aria-busy={processingId === rejectTarget}>
                  거절 확정
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}
