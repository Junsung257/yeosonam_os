'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { fmtDateTime } from '@/lib/admin-utils';
import { maskPhone } from '@/lib/pii-mask';

interface MockApiConfig {
  id:        string;
  api_name:  string;
  mode:      'success' | 'fail' | 'timeout';
  delay_ms:  number;
  updated_at: string;
}

interface Transaction {
  id:              string;
  session_id:      string;
  status:          string;
  total_cost:      number;
  total_price:     number;
  net_margin:      number;
  customer_name?:  string;
  customer_phone?: string;
  created_at:      string;
}

const STATUS_BADGE: Record<string, string> = {
  PENDING:          'bg-admin-surface-2 text-admin-muted',
  CUSTOMER_PAID:    'bg-blue-50 text-blue-700',
  API_PROCESSING:   'bg-amber-50 text-amber-700',
  COMPLETED:        'bg-emerald-50 text-emerald-700',
  PARTIAL_FAIL:     'bg-red-50 text-red-700',
  REFUNDED:         'bg-purple-50 text-purple-700',
};

const MODE_BADGE: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700',
  fail:    'bg-red-50 text-red-700',
  timeout: 'bg-amber-50 text-amber-700',
};

const API_DISPLAY: Record<string, string> = {
  agoda_mock:  'Agoda Mock (호텔)',
  klook_mock:  'Klook Mock (액티비티)',
  cruise_mock: 'Cruise Mock (크루즈)',
};

export default function AdminConciergePage() {
  const [configs, setConfigs]             = useState<MockApiConfig[]>([]);
  const [transactions, setTransactions]   = useState<Transaction[]>([]);
  const [saving, setSaving]               = useState<Record<string, boolean>>({});
  const [localConfigs, setLocalConfigs]   = useState<Record<string, Partial<MockApiConfig>>>({});
  const [txFilter, setTxFilter]           = useState('');

  const loadData = useCallback(async () => {
    const [cfgRes, txRes] = await Promise.all([
      fetch('/api/admin/mock-configs'),
      fetch('/api/concierge/transactions'),
    ]);
    const [cfgData, txData] = await Promise.all([cfgRes.json(), txRes.json()]);
    setConfigs(cfgData.configs ?? []);
    setTransactions(txData.transactions ?? []);
    const local: Record<string, Partial<MockApiConfig>> = {};
    for (const c of cfgData.configs ?? []) {
      local[c.api_name] = { mode: c.mode, delay_ms: c.delay_ms };
    }
    setLocalConfigs(local);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function saveConfig(apiName: string) {
    setSaving(s => ({ ...s, [apiName]: true }));
    try {
      await fetch(`/api/admin/mock-configs/${apiName}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(localConfigs[apiName]),
      });
      await loadData();
    } finally {
      setSaving(s => ({ ...s, [apiName]: false }));
    }
  }

  function updateLocal(apiName: string, key: string, value: unknown) {
    setLocalConfigs(prev => ({
      ...prev,
      [apiName]: { ...prev[apiName], [key]: value },
    }));
  }

  const filtered = transactions.filter(tx =>
    !txFilter ||
    tx.status === txFilter ||
    tx.customer_name?.includes(txFilter) ||
    tx.id.includes(txFilter)
  );

  const totalMargin   = transactions.filter(t => t.status === 'COMPLETED').reduce((s, t) => s + t.net_margin, 0);
  const completedCount = transactions.filter(t => t.status === 'COMPLETED').length;
  const failCount      = transactions.filter(t => t.status === 'PARTIAL_FAIL').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-admin-lg font-bold text-admin-text-2">AI 컨시어지 관제탑</h1>
          <p className="text-admin-sm text-admin-muted mt-1">Mock API 제어판 / 트랜잭션 모니터링</p>
        </div>
        <Link
          href="/concierge"
          target="_blank"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-admin-sm font-medium hover:bg-blue-700"
        >
          컨시어지 열기
        </Link>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4">
          <p className="text-admin-sm text-admin-muted">완료된 거래</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{completedCount}</p>
        </div>
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4">
          <p className="text-admin-sm text-admin-muted">순마진 합계</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">{totalMargin.toLocaleString()}원</p>
        </div>
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4">
          <p className="text-admin-sm text-admin-muted">실패 건수</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{failCount}</p>
        </div>
      </div>

      {/* Mock API 제어판 */}
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-admin-border-mid">
          <h2 className="text-admin-base font-semibold text-admin-text-2">Mock API 에러 주입 제어판</h2>
          <p className="text-admin-sm text-admin-muted mt-0.5">success / fail / timeout 모드 설정 후 저장</p>
        </div>
        <div>
          {configs.map(cfg => {
            const local = localConfigs[cfg.api_name] ?? {};
            return (
              <div key={cfg.api_name} className="px-4 py-2 flex items-center gap-6 border-b border-admin-border-mid last:border-b-0">
                <div className="flex-1">
                  <p className="font-medium text-admin-text-2 text-admin-sm">{API_DISPLAY[cfg.api_name] ?? cfg.api_name}</p>
                  <p className="text-[11px] text-admin-muted-2 mt-0.5">
                    마지막 수정: {fmtDateTime(cfg.updated_at)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={(local.mode ?? cfg.mode) as string}
                    onChange={e => updateLocal(cfg.api_name, 'mode', e.target.value)}
                    className={`text-admin-sm border border-admin-border-mid rounded-lg px-3 py-1.5 font-medium ${MODE_BADGE[local.mode ?? cfg.mode]}`}
                  >
                    <option value="success">success</option>
                    <option value="fail">fail</option>
                    <option value="timeout">timeout</option>
                  </select>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-admin-muted">delay</span>
                    <input
                      type="number"
                      min="0"
                      max="30000"
                      step="500"
                      value={local.delay_ms ?? cfg.delay_ms}
                      onChange={e => updateLocal(cfg.api_name, 'delay_ms', Number(e.target.value))}
                      className="w-20 border border-admin-border-mid rounded-lg px-2 py-1.5 text-admin-sm text-center"
                    />
                    <span className="text-[11px] text-admin-muted">ms</span>
                  </div>
                  <button
                    onClick={() => saveConfig(cfg.api_name)}
                    disabled={saving[cfg.api_name]}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-admin-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving[cfg.api_name] ? '저장 중...' : '저장'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 트랜잭션 목록 */}
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-admin-border-mid flex items-center justify-between">
          <h2 className="text-admin-base font-semibold text-admin-text-2">트랜잭션 목록</h2>
          <div className="flex items-center gap-2">
            <select
              value={txFilter}
              onChange={e => setTxFilter(e.target.value)}
              className="text-admin-sm border border-admin-border-mid rounded-lg px-2 py-1.5"
            >
              <option value="">전체</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="PARTIAL_FAIL">PARTIAL_FAIL</option>
              <option value="REFUNDED">REFUNDED</option>
              <option value="API_PROCESSING">API_PROCESSING</option>
            </select>
            <button
              onClick={loadData}
              className="text-admin-sm bg-white border border-admin-border-strong text-admin-text-2 px-3 py-1.5 rounded-lg hover:bg-admin-bg"
            >
              새로고침
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-admin-sm">
            <thead>
              <tr className="border-b border-admin-border-mid">
                <th className="px-3 py-2 text-left text-[11px] font-medium text-admin-muted">ID</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-admin-muted">고객</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-admin-muted">상태</th>
                <th className="px-3 py-2 text-right text-[11px] font-medium text-admin-muted">판매가</th>
                <th className="px-3 py-2 text-right text-[11px] font-medium text-admin-muted">원가</th>
                <th className="px-3 py-2 text-right text-[11px] font-medium text-admin-muted">순마진</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-admin-muted">생성일</th>
                <th className="px-3 py-2">
                  <span className="sr-only">작업</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-admin-muted-2 text-admin-sm">
                    트랜잭션이 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map(tx => (
                  <tr key={tx.id} className="border-b border-admin-border-mid hover:bg-admin-bg">
                    <td className="px-3 py-2 font-mono text-[11px] text-admin-muted">
                      {tx.id.slice(0, 8)}...
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-admin-text-2">{tx.customer_name ?? '-'}</p>
                      {tx.customer_phone && (
                        <p className="text-[11px] text-admin-muted-2">{maskPhone(tx.customer_phone, 'cs_agent')}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_BADGE[tx.status] ?? 'bg-admin-surface-2 text-admin-muted'}`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-admin-text-2">{tx.total_price.toLocaleString()}원</td>
                    <td className="px-3 py-2 text-right text-admin-muted">{tx.total_cost.toLocaleString()}원</td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-600">
                      {tx.net_margin.toLocaleString()}원
                    </td>
                    <td className="px-3 py-2 text-[11px] text-admin-muted-2">
                      {fmtDateTime(tx.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/concierge/transactions/${tx.id}`}
                        className="text-admin-sm text-blue-700 hover:underline"
                      >
                        상세
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
