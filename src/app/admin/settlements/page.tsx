'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { PageHeader, KpiCard } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Wallet, Receipt, Clock, AlertCircle, Coins } from 'lucide-react';

interface Settlement {
  id: string;
  settlement_period: string;
  qualified_booking_count: number;
  total_amount: number;
  carryover_balance: number;
  final_total: number;
  tax_deduction: number;
  final_payout: number;
  status: 'PENDING' | 'READY' | 'COMPLETED' | 'VOID';
  settled_at?: string;
  affiliates?: { id: string; name: string; referral_code: string; grade: number; payout_type: string };
}

interface Affiliate { id: string; name: string; referral_code: string; }

const STATUS_BADGES: Record<string, string> = {
  PENDING:   'bg-status-neutralBg text-status-neutralFg',
  READY:     'bg-status-infoBg text-status-infoFg',
  COMPLETED: 'bg-status-successBg text-status-successFg',
  VOID:      'bg-status-dangerBg text-status-dangerFg',
};
const STATUS_LABELS: Record<string, string> = {
  PENDING: '이월 대기', READY: '지급 대기', COMPLETED: '지급 완료', VOID: '취소됨',
};

// 최근 12개월 목록
function getMonthOptions(): string[] {
  const options: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return options;
}

export default function SettlementsPage() {
  const [period, setPeriod] = useState(new Date().toISOString().substring(0, 7));
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState<string | null>(null); // affiliateId
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, aRes] = await Promise.all([
        fetch(`/api/settlements?period=${period}`),
        fetch('/api/affiliates'),
      ]);
      const sJson = await sRes.json();
      const aJson = await aRes.json();
      setSettlements(sJson.settlements || []);
      setAffiliates(aJson.affiliates || []);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  // 정산 마감 실행
  const closeSettlement = async (affiliateId: string) => {
    setClosing(affiliateId);
    try {
      const res = await fetch('/api/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ affiliateId, period }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error || '마감 실패'); return; }
      load();
    } finally {
      setClosing(null);
    }
  };

  // 상태 변경 (COMPLETED, VOID)
  const updateStatus = async (id: string, status: string) => {
    if (!confirm(`상태를 "${STATUS_LABELS[status]}"로 변경하시겠습니까?`)) return;
    setStatusUpdating(id);
    try {
      const res = await fetch('/api/settlements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) { const j = await res.json(); alert(j.error); return; }
      load();
    } finally {
      setStatusUpdating(null);
    }
  };

  // 정산이 없는 어필리에이트 (이번 달 마감 전)
  const settledIds = new Set(settlements.map(s => s.affiliates?.id));
  const unsettledAffiliates = affiliates.filter(a => !settledIds.has(a.id));

  // KPI
  const totalPayout = settlements.reduce((s, x) => s + x.final_payout, 0);
  const totalTax = settlements.reduce((s, x) => s + x.tax_deduction, 0);
  const readyCount = settlements.filter(s => s.status === 'READY').length;
  const pendingCount = settlements.filter(s => s.status === 'PENDING').length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="정산 관리"
        subtitle="월간 어필리에이트 수수료 정산"
        actions={
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          >
            {getMonthOptions().map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="총 지급 예정액"
          value={`₩${totalPayout.toLocaleString()}`}
          icon={Wallet}
          tone="positive"
        />
        <KpiCard
          label="총 원천세 공제"
          value={`-₩${totalTax.toLocaleString()}`}
          icon={Receipt}
          tone="negative"
        />
        <KpiCard
          label="지급 대기"
          value={readyCount.toLocaleString()}
          unit="건"
          icon={Clock}
        />
        <KpiCard
          label="이월 대기"
          value={pendingCount.toLocaleString()}
          unit="건"
          icon={AlertCircle}
          tone={pendingCount > 0 ? 'negative' : 'neutral'}
        />
      </div>

      {/* 정산 현황 테이블 */}
      <div className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-admin-border flex items-center justify-between">
          <h2 className="text-admin-h3 text-admin-text admin-num">{period} 정산 현황</h2>
          <span className="text-admin-xs text-admin-muted admin-num">{settlements.length}건</span>
        </div>
        <table className="admin-data-table">
          <thead>
            <tr>
              {['파트너', '건수', '발생 수수료', '이월 포함', '원천세', '실지급액', '상태', '액션'].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {[100, 40, 80, 80, 60, 80, 56, 80].map((w, j) => (
                    <td key={j}>
                      <div className="h-3 bg-admin-surface-2 rounded animate-pulse" style={{ width: w }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : settlements.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-14 text-center" style={{ height: 'auto' }}>
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-admin-surface-2 flex items-center justify-center text-admin-muted">
                      <Coins size={20} strokeWidth={1.75} />
                    </div>
                    <p className="text-admin-sm font-medium text-admin-muted">이번 달 정산 데이터가 없습니다.</p>
                  </div>
                </td>
              </tr>
            ) : settlements.map(s => (
              <tr key={s.id}>
                <td>
                  <div className="font-medium text-admin-text">{s.affiliates?.name}</div>
                  <div className="text-admin-xs text-admin-muted font-mono">{s.affiliates?.referral_code}</div>
                </td>
                <td className="admin-num">{s.qualified_booking_count}건</td>
                <td className="admin-num">₩{s.total_amount.toLocaleString()}</td>
                <td className="font-medium admin-num">₩{s.final_total.toLocaleString()}</td>
                <td className="text-danger admin-num">
                  {s.tax_deduction > 0 ? `-₩${s.tax_deduction.toLocaleString()}` : '—'}
                </td>
                <td className="font-bold text-success admin-num">₩{s.final_payout.toLocaleString()}</td>
                <td>
                  <span className={`px-2 py-0.5 rounded-admin-xs text-admin-xs font-semibold ${STATUS_BADGES[s.status]}`}>
                    {STATUS_LABELS[s.status]}
                  </span>
                </td>
                <td>
                  <div className="flex gap-1.5 items-center">
                    {s.status === 'READY' && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => updateStatus(s.id, 'COMPLETED')}
                        disabled={statusUpdating === s.id}
                      >
                        지급 완료
                      </Button>
                    )}
                    {['READY', 'PENDING'].includes(s.status) && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => updateStatus(s.id, 'VOID')}
                        disabled={statusUpdating === s.id}
                      >
                        취소
                      </Button>
                    )}
                    <Link
                      href={`/admin/affiliates/${s.affiliates?.id}`}
                      className="text-admin-xs text-brand hover:text-brand-dark font-medium"
                    >
                      상세
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 미마감 어필리에이트 */}
      {unsettledAffiliates.length > 0 && (
        <div className="admin-card overflow-hidden">
          <div className="px-4 py-3 border-b border-admin-border">
            <h2 className="text-admin-h3 text-admin-text">정산 마감 대기 <span className="admin-num text-admin-muted">({unsettledAffiliates.length}명)</span></h2>
            <p className="text-admin-xs text-admin-muted mt-0.5 admin-num">
              아래 파트너는 {period} 정산 마감이 실행되지 않았습니다.
            </p>
          </div>
          <div>
            {unsettledAffiliates.map(a => (
              <div key={a.id} className="px-4 py-2 flex items-center justify-between border-b border-admin-border last:border-b-0">
                <div>
                  <span className="font-medium text-admin-text text-admin-sm">{a.name}</span>
                  <span className="ml-2 text-admin-xs text-admin-muted font-mono">{a.referral_code}</span>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => closeSettlement(a.id)}
                  disabled={closing === a.id}
                >
                  {closing === a.id ? '마감 중…' : '정산 마감 실행'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
