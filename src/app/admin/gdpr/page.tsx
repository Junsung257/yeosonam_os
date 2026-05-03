'use client';

import { useState } from 'react';

interface StepResult {
  step: string;
  ok: boolean;
  affected?: number;
  error?: string;
}

interface DeleteResult {
  ok: boolean;
  customerId: string;
  adminNote: string | null;
  steps: StepResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
}

export default function GdprPage() {
  const [customerId, setCustomerId] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DeleteResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleDeleteRequest = () => {
    if (!customerId.trim()) {
      setErrorMsg('고객 ID를 입력하세요.');
      return;
    }
    setErrorMsg(null);
    setShowConfirm(true);
  };

  const handleConfirmDelete = async () => {
    setShowConfirm(false);
    setLoading(true);
    setResult(null);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/admin/gdpr/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      // credentials=include 로 쿠키 기반 세션 → Authorization 헤더가 필요한 경우
      // 실제 배포 시 Supabase 클라이언트에서 session.access_token 주입 필요
      const resWithAuth = await fetch('/api/admin/gdpr/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAccessTokenFromCookie()}`,
        },
        body: JSON.stringify({ customerId: customerId.trim(), adminNote }),
      });

      void res; // 첫 번째 fetch는 토큰 확인용이었으므로 무시
      const data = await resWithAuth.json();

      if (!resWithAuth.ok) {
        setErrorMsg(data.error ?? '삭제 처리 중 오류가 발생했습니다.');
        return;
      }

      setResult(data as DeleteResult);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '네트워크 오류');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">GDPR — 잊힐 권리 삭제</h1>
        <p className="text-sm text-gray-500 mt-1">
          고객 데이터를 DB 전체에서 익명화·삭제합니다. 이 작업은 되돌릴 수 없습니다.
        </p>
      </div>

      {/* 입력 폼 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            고객 ID (UUID)
          </label>
          <input
            type="text"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            삭제 사유 (선택)
          </label>
          <input
            type="text"
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            placeholder="고객 요청, 탈퇴 처리 등"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>
        {errorMsg && (
          <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {errorMsg}
          </p>
        )}
        <button
          onClick={handleDeleteRequest}
          disabled={loading}
          className="w-full bg-red-600 text-white font-semibold py-2.5 rounded-lg hover:bg-red-700 active:scale-95 transition disabled:opacity-50"
        >
          {loading ? '삭제 처리 중...' : '데이터 삭제 실행'}
        </button>
      </div>

      {/* 확인 다이얼로그 */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">정말로 삭제하시겠습니까?</h3>
                <p className="text-xs text-gray-500 mt-0.5">이 작업은 되돌릴 수 없습니다.</p>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500">삭제 대상</p>
              <p className="text-sm font-mono text-gray-800 break-all mt-0.5">{customerId}</p>
            </div>
            <p className="text-sm text-gray-600">
              conversations, customers, bookings, booking_companions, agent_tasks의 개인정보가 모두 익명화됩니다.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-2 rounded-lg hover:bg-gray-50 transition"
              >
                취소
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 bg-red-600 text-white font-semibold py-2 rounded-lg hover:bg-red-700 transition"
              >
                삭제 확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 결과 로그 */}
      {result && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">삭제 결과</h2>
            <span
              className={`text-xs font-medium px-2 py-1 rounded-full ${
                result.ok
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}
            >
              {result.ok ? '완료' : '부분 완료'}
            </span>
          </div>

          <div className="flex gap-4 text-sm">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{result.summary.total}</p>
              <p className="text-gray-500 text-xs">전체 단계</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{result.summary.succeeded}</p>
              <p className="text-gray-500 text-xs">성공</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-500">{result.summary.failed}</p>
              <p className="text-gray-500 text-xs">실패</p>
            </div>
          </div>

          <div className="space-y-2">
            {result.steps.map((step, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 px-3 py-2 rounded-lg text-sm ${
                  step.ok ? 'bg-green-50' : 'bg-red-50'
                }`}
              >
                <span className={`mt-0.5 flex-shrink-0 ${step.ok ? 'text-green-500' : 'text-red-500'}`}>
                  {step.ok ? '✓' : '✗'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs text-gray-700">{step.step}</p>
                  {step.affected !== undefined && (
                    <p className="text-xs text-gray-500">{step.affected}행 처리됨</p>
                  )}
                  {step.error && (
                    <p className="text-xs text-red-600 mt-0.5 break-all">{step.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 쿠키에서 Supabase access token 파싱 (sb-access-token 또는 sb-ixaxnvbmhzjvupissmly-auth-token) */
function getAccessTokenFromCookie(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(
    /sb-[^=]+-auth-token=([^;]+)/
  );
  if (!match) return '';
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1]));
    return parsed?.access_token ?? '';
  } catch {
    return '';
  }
}
