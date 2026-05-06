'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

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

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [approveSuccess, setApproveSuccess] = useState<{
    referralCode: string;
    affiliateId: string;
    pin: string;
  } | null>(null);

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

  const handleApprove = async (id: string) => {
    if (!confirm('이 신청을 승인하시겠습니까? 파트너 계정이 자동 생성됩니다.')) return;
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
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : '처리 실패');
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
      setRejectTarget(null);
      setRejectReason('');
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : '처리 실패');
    } finally {
      setProcessingId(null);
    }
  };

  return (
      <div className="space-y-4">
        {approveSuccess && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
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

        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-900">파트너 신청 관리</h1>
          <div className="flex gap-2">
            {['', 'PENDING', 'APPROVED', 'REJECTED'].map(s => (
              <button key={s} onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  filter === s ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}>
                {s === '' ? '전체' : STATUS_BADGE[s]?.label || s}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-4 bg-slate-100 rounded animate-pulse w-32" />
                  <div className="h-4 bg-slate-100 rounded-full animate-pulse w-16" />
                </div>
                <div className="h-3 bg-slate-100 rounded animate-pulse w-full" />
                <div className="h-3 bg-slate-100 rounded animate-pulse w-3/4" />
              </div>
            ))}
          </div>
        ) : applications.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14">
            <svg className="w-10 h-10 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" /></svg>
            <p className="text-admin-sm font-medium text-slate-500">신청 내역이 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {applications.map(app => (
              <div key={app.id} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{app.name}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[app.status]?.color}`}>
                        {STATUS_BADGE[app.status]?.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{app.phone} · 신청일 {new Date(app.applied_at).toLocaleDateString('ko-KR')}</p>
                  </div>
                  {app.status === 'PENDING' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(app.id)}
                        disabled={processingId === app.id}
                        className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                      >승인</button>
                      <button
                        onClick={() => setRejectTarget(app.id)}
                        disabled={processingId === app.id}
                        className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium disabled:opacity-50"
                      >거절</button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <div><span className="text-slate-400">채널: </span>{CHANNEL_LABELS[app.channel_type] || app.channel_type}</div>
                  <div><span className="text-slate-400">팔로워: </span>{app.follower_count?.toLocaleString() || '-'}</div>
                  <div className="col-span-2">
                    <span className="text-slate-400">URL: </span>
                    <a href={app.channel_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      {app.channel_url}
                    </a>
                  </div>
                  {app.intro && <div className="col-span-2"><span className="text-slate-400">소개: </span>{app.intro}</div>}
                  <div><span className="text-slate-400">유형: </span>{app.business_type === 'business' ? '사업자' : '개인'}</div>
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
            ))}
          </div>
        )}

        {/* 거절 사유 모달 */}
        {rejectTarget && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
              <h3 className="font-bold text-slate-900 mb-3">거절 사유</h3>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
                placeholder="거절 사유를 입력하세요 (선택)"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-4 resize-none"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setRejectTarget(null); setRejectReason(''); }}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">취소</button>
                <button onClick={handleReject}
                  disabled={processingId === rejectTarget}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg disabled:opacity-50">거절 확정</button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}
