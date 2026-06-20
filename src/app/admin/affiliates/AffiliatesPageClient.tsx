'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Leaderboard } from '@/components/affiliate/Leaderboard';
import { PageHeader, KpiCard } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Plus, Users, Wallet, Gem, Award, X } from 'lucide-react';
import { maskPhone } from '@/lib/pii-mask';

interface Affiliate {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  referral_code: string;
  grade: number;
  grade_label: string;
  bonus_rate: number;
  payout_type: 'PERSONAL' | 'BUSINESS';
  booking_count: number;
  total_commission: number;
  memo?: string;
}

const GRADE_COLORS: Record<number, string> = {
  1: 'bg-amber-50 text-amber-700',
  2: 'bg-admin-surface-2 text-admin-muted',
  3: 'bg-yellow-50 text-yellow-700',
  4: 'bg-blue-50 text-blue-700',
  5: 'bg-purple-50 text-purple-700',
};

const GRADE_NEXT: Record<number, { label: string; target: number }> = {
  1: { label: '실버', target: 10 },
  2: { label: '골드', target: 30 },
  3: { label: '플래티넘', target: 50 },
  4: { label: '다이아', target: 100 },
  5: { label: '최고 등급', target: 100 },
};

export default function AffiliatesPageClient({
  initialAffiliates,
}: {
  initialAffiliates: Affiliate[];
}) {
  const router = useRouter();
  const [showPanel, setShowPanel] = useState(false);
  const [form, setForm] = useState({
    name: '', phone: '', email: '', referral_code: '',
    payout_type: 'PERSONAL' as 'PERSONAL' | 'BUSINESS',
    bank_info: '', memo: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const affiliatePanelTitleId = 'affiliate-create-panel-title';
  const affiliatePanelDescriptionId = 'affiliate-create-panel-description';
  const affiliatePanelStatusId = 'affiliate-create-panel-status';
  const affiliatePanelErrorId = 'affiliate-create-panel-error';

  const affiliates = initialAffiliates;

  const totalStats = {
    total: affiliates.length,
    totalCommission: affiliates.reduce((s, a) => s + a.total_commission, 0),
    diamond: affiliates.filter(a => a.grade === 5).length,
    platinum: affiliates.filter(a => a.grade === 4).length,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/affiliates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || '등록 실패'); return; }
      setShowPanel(false);
      setForm({ name: '', phone: '', email: '', referral_code: '', payout_type: 'PERSONAL', bank_info: '', memo: '' });
      // 서버 컴포넌트 재조회로 목록 갱신 (useEffect fetch 대체)
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!showPanel) return undefined;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstInputRef.current?.focus();

    const getFocusableElements = () => Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(element => !element.hasAttribute('disabled') && !element.getAttribute('aria-hidden'));

    const closePanel = () => {
      setShowPanel(false);
      setError('');
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus();
    };
  }, [showPanel]);

  const affiliatePanelStatusText = saving
    ? '파트너 정보를 등록 중입니다.'
    : error || '파트너 이름, 추천코드, 정산 유형을 입력해 신규 파트너를 등록합니다.';

  return (
    <div className="space-y-5">
      <PageHeader
        title="어필리에이트 관리"
        subtitle="인플루언서/파트너 등급 및 수수료 관리"
        actions={
          <Button variant="primary" size="sm" onClick={() => setShowPanel(true)}>
            <Plus size={14} />
            파트너 등록
          </Button>
        }
      />

      {/* 월간 리더보드 */}
      <Leaderboard />

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="총 파트너 수" value={totalStats.total.toLocaleString()} unit="명" icon={Users} />
        <KpiCard label="누적 수수료 지급" value={`${totalStats.totalCommission.toLocaleString()}원`} icon={Wallet} tone="positive" />
        <KpiCard label="다이아 등급" value={totalStats.diamond.toLocaleString()} unit="명" icon={Gem} />
        <KpiCard label="플래티넘 등급" value={totalStats.platinum.toLocaleString()} unit="명" icon={Award} />
      </div>

      {/* 테이블 */}
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        <table className="admin-data-table">
          <thead>
            <tr>
              {['이름', '추천코드', '프론트', '등급', '예약수', '보너스요율', '정산유형', '누적수수료', ''].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {affiliates.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-admin-muted text-admin-base" style={{ height: 'auto' }}>
                  등록된 파트너가 없습니다.
                </td>
              </tr>
            ) : affiliates.map(a => {
              const next = GRADE_NEXT[a.grade];
              const progress = a.grade < 5
                ? Math.min(100, Math.round((a.booking_count / next.target) * 100))
                : 100;

              return (
                <tr key={a.id}>
                  <td className="font-medium text-admin-text">
                    <div>{a.name}</div>
                    {a.phone && <div className="text-admin-xs text-admin-muted admin-num">{maskPhone(a.phone, 'finance')}</div>}
                  </td>
                  <td className="font-mono text-admin-xs text-brand">
                    {a.referral_code}
                  </td>
                  <td aria-label={`${a.name} 프론트 링크`}>
                    <div className="flex flex-col gap-1">
                      <Link
                        href={`/admin/partner-preview?code=${encodeURIComponent(a.referral_code)}`}
                        className="text-admin-xs text-brand hover:text-brand-dark hover:underline w-fit"
                      >
                        미리보기 허브
                      </Link>
                      <a
                        href={`/with/${encodeURIComponent(a.referral_code)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-admin-xs text-success hover:underline w-fit"
                      >
                        /with 새 탭
                      </a>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-admin-xs text-admin-xs font-semibold ${GRADE_COLORS[a.grade]}`}>
                        {a.grade_label}
                      </span>
                    </div>
                    {a.grade < 5 && (
                      <div className="mt-1.5">
                        <div className="flex justify-between text-admin-2xs text-admin-muted mb-1 admin-num">
                          <span>{a.booking_count}/{next.target}건</span>
                          <span>{next.label}까지 {next.target - a.booking_count}건</span>
                        </div>
                        <div className="w-24 bg-admin-surface-2 rounded-full h-1.5">
                          <div
                            className="bg-brand h-1.5 rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="text-admin-muted admin-num">{a.booking_count}건</td>
                  <td className="text-brand font-mono admin-num">+{(a.bonus_rate * 100).toFixed(1)}%</td>
                  <td>
                    <span className={`px-2 py-0.5 rounded-admin-xs text-admin-xs font-semibold ${
                      a.payout_type === 'PERSONAL' ? 'bg-status-warningBg text-status-warningFg' : 'bg-status-successBg text-status-successFg'
                    }`}>
                      {a.payout_type === 'PERSONAL' ? '개인 (3.3%)' : '사업자'}
                    </span>
                  </td>
                  <td className="font-medium text-brand admin-num">
                    {Number(a.total_commission).toLocaleString()}원
                  </td>
                  <td>
                    <Link
                      href={`/admin/affiliates/${a.id}`}
                      className="text-admin-xs text-admin-muted hover:text-admin-text font-medium"
                    >
                      상세
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 등록 슬라이드 패널 */}
      {showPanel && (
        <div className="fixed inset-0 z-50 flex h-dvh max-h-dvh justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/30 cursor-default"
            onClick={() => { setShowPanel(false); setError(''); }}
            tabIndex={-1}
            aria-hidden="true"
            aria-label="파트너 등록 패널 닫기"
          />
          <div
            ref={panelRef}
            className="admin-scope relative w-full max-w-md bg-admin-surface h-dvh max-h-dvh overflow-y-auto border-l border-admin-border-mid shadow-admin-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby={affiliatePanelTitleId}
            aria-describedby={`${affiliatePanelDescriptionId} ${affiliatePanelStatusId}`}
          >
            <div className="p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 id={affiliatePanelTitleId} className="text-admin-h2 text-admin-text">파트너 신규 등록</h2>
                  <p id={affiliatePanelDescriptionId} className="sr-only">어필리에이트 파트너의 연락처, 추천코드, 정산 유형을 등록하는 패널입니다.</p>
                  <p id={affiliatePanelStatusId} role="status" aria-live="polite" aria-atomic="true" className="sr-only">{affiliatePanelStatusText}</p>
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={() => { setShowPanel(false); setError(''); }}
                  className="p-1.5 rounded-admin-sm text-admin-muted hover:text-admin-text hover:bg-admin-surface-2 transition-colors"
                  aria-label="닫기"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              {error && (
                <p id={affiliatePanelErrorId} role="alert" className="text-admin-sm text-danger bg-danger-light px-3 py-2 rounded-admin-sm border border-danger/20">{error}</p>
              )}
              <form onSubmit={handleSubmit} className="space-y-3">
                {[
                  { label: '이름 *', key: 'name', type: 'text', placeholder: '홍길동' },
                  { label: '연락처', key: 'phone', type: 'tel', placeholder: '010-0000-0000' },
                  { label: '이메일', key: 'email', type: 'email', placeholder: 'example@email.com' },
                  { label: '추천코드 *', key: 'referral_code', type: 'text', placeholder: 'BLOGGER_KIM' },
                  { label: '계좌번호 (암호화 저장)', key: 'bank_info', type: 'text', placeholder: '신한은행 110-123-456789' },
                ].map(f => (
                  <div key={f.key}>
                    <label htmlFor={`affiliate-${f.key}`} className="block text-admin-xs font-medium text-admin-text-2 mb-1.5">{f.label}</label>
                    <input
                      ref={f.key === 'name' ? firstInputRef : undefined}
                      id={`affiliate-${f.key}`}
                      type={f.type}
                      placeholder={f.placeholder}
                      value={(form as Record<string, string>)[f.key]}
                      onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      required={f.label.includes('*')}
                      aria-invalid={error && f.label.includes('*') ? 'true' : undefined}
                      aria-describedby={error && f.label.includes('*') ? `${affiliatePanelStatusId} ${affiliatePanelErrorId}` : affiliatePanelStatusId}
                      className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
                    />
                  </div>
                ))}
                <div>
                  <label htmlFor="affiliate-payout-type" className="block text-admin-xs font-medium text-admin-text-2 mb-1.5">정산 유형</label>
                  <select
                    id="affiliate-payout-type"
                    value={form.payout_type}
                    onChange={e => setForm(prev => ({ ...prev, payout_type: e.target.value as 'PERSONAL' | 'BUSINESS' }))}
                    className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
                  >
                    <option value="PERSONAL">개인 (원천세 3.3% 공제)</option>
                    <option value="BUSINESS">사업자 (세금계산서 별도)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="affiliate-memo" className="block text-admin-xs font-medium text-admin-text-2 mb-1.5">메모</label>
                  <textarea
                    id="affiliate-memo"
                    value={form.memo}
                    onChange={e => setForm(prev => ({ ...prev, memo: e.target.value }))}
                    rows={2}
                    className="w-full border border-admin-border-mid rounded-admin-sm px-3 py-2 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors resize-none"
                    placeholder="특이사항…"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => { setShowPanel(false); setError(''); }}
                    aria-describedby={affiliatePanelStatusId}
                    className="flex-1"
                  >
                    취소
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={saving}
                    aria-busy={saving}
                    aria-describedby={affiliatePanelStatusId}
                    className="flex-1"
                  >
                    {saving ? '등록 중…' : '등록하기'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
