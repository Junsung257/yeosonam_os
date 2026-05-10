'use client';

import { useState } from 'react';
import { PageHeader, FormRow } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { AlertTriangle } from 'lucide-react';

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
      const resWithAuth = await fetch('/api/admin/gdpr/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAccessTokenFromCookie()}`,
        },
        body: JSON.stringify({ customerId: customerId.trim(), adminNote }),
      });

      const data = await resWithAuth.json().catch(() => ({}));

      if (!resWithAuth.ok) {
        setErrorMsg((data as { error?: string }).error ?? '삭제 처리 중 오류가 발생했습니다.');
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
    <div className="max-w-2xl mx-auto space-y-5">
      <PageHeader
        title="GDPR — 잊힐 권리 삭제"
        subtitle="고객 데이터를 DB 전체에서 익명화·삭제합니다. 이 작업은 되돌릴 수 없습니다."
      />

      {/* 입력 폼 */}
      <div className="admin-card p-5 space-y-4">
        <FormRow label="고객 ID (UUID)" required>
          <Input
            type="text"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="font-mono"
          />
        </FormRow>
        <FormRow label="삭제 사유" hint="선택. 감사 로그에 기록됩니다.">
          <Input
            type="text"
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            placeholder="고객 요청, 탈퇴 처리 등"
          />
        </FormRow>
        {errorMsg && (
          <p className="text-danger text-admin-sm bg-danger-light border border-danger/20 rounded-admin-sm px-3 py-2">
            {errorMsg}
          </p>
        )}
        <Button
          variant="danger"
          size="lg"
          onClick={handleDeleteRequest}
          disabled={loading}
          className="w-full"
        >
          {loading ? '삭제 처리 중…' : '데이터 삭제 실행'}
        </Button>
      </div>

      {/* 확인 다이얼로그 */}
      {showConfirm && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
          <div className="admin-scope bg-admin-surface rounded-admin-lg p-6 max-w-sm w-full shadow-admin-xl border border-admin-border-mid space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-danger-light rounded-full flex items-center justify-center flex-shrink-0 text-danger">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="font-semibold text-admin-text text-admin-base">정말로 삭제하시겠습니까?</h3>
                <p className="text-admin-xs text-admin-muted mt-0.5">이 작업은 되돌릴 수 없습니다.</p>
              </div>
            </div>
            <div className="bg-admin-surface-2 rounded-admin-sm px-3 py-2">
              <p className="text-admin-xs text-admin-muted">삭제 대상</p>
              <p className="text-admin-sm font-mono text-admin-text-2 break-all mt-0.5">{customerId}</p>
            </div>
            <p className="text-admin-sm text-admin-muted">
              conversations, customers, bookings, booking_companions, agent_tasks 의 개인정보가 모두 익명화됩니다.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowConfirm(false)} className="flex-1">
                취소
              </Button>
              <Button variant="danger" onClick={handleConfirmDelete} className="flex-1">
                삭제 확인
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 결과 로그 */}
      {result && (
        <div className="admin-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-admin-h3 text-admin-text">삭제 결과</h2>
            <span
              className={`text-admin-xs font-semibold px-2 py-1 rounded-full ${
                result.ok
                  ? 'bg-status-successBg text-status-successFg'
                  : 'bg-status-warningBg text-status-warningFg'
              }`}
            >
              {result.ok ? '완료' : '부분 완료'}
            </span>
          </div>

          <div className="flex gap-6">
            <div className="text-center">
              <p className="text-admin-display font-bold text-admin-text admin-num">{result.summary.total}</p>
              <p className="text-admin-muted text-admin-xs">전체 단계</p>
            </div>
            <div className="text-center">
              <p className="text-admin-display font-bold text-success admin-num">{result.summary.succeeded}</p>
              <p className="text-admin-muted text-admin-xs">성공</p>
            </div>
            <div className="text-center">
              <p className="text-admin-display font-bold text-danger admin-num">{result.summary.failed}</p>
              <p className="text-admin-muted text-admin-xs">실패</p>
            </div>
          </div>

          <div className="space-y-1.5">
            {result.steps.map((step, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 px-3 py-2 rounded-admin-sm text-admin-sm ${
                  step.ok ? 'bg-status-successBg' : 'bg-status-dangerBg'
                }`}
              >
                <span className={`mt-0.5 flex-shrink-0 font-bold ${step.ok ? 'text-success' : 'text-danger'}`}>
                  {step.ok ? '✓' : '✗'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-admin-xs text-admin-text-2">{step.step}</p>
                  {step.affected !== undefined && (
                    <p className="text-admin-xs text-admin-muted admin-num">{step.affected}행 처리됨</p>
                  )}
                  {step.error && (
                    <p className="text-admin-xs text-danger mt-0.5 break-all">{step.error}</p>
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
