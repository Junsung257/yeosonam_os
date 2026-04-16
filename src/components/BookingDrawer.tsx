'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  JOURNEY_STEPS, ALLOWED_TRANSITIONS, getStepIndex,
  getStatusLabel, getStatusBadgeClass,
} from '@/lib/booking-state-machine';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BankTx {
  id: string;
  transaction_type: '입금' | '출금';
  counterparty_name?: string;
  amount: number;
  received_at: string;
  match_status: string;
  memo?: string;
  is_refund: boolean;
}

interface BookingDetail {
  id: string;
  booking_no?: string;
  package_title?: string;
  lead_customer_id: string;
  adult_count: number;
  child_count: number;
  infant_count?: number;
  adult_price?: number;
  child_price?: number;
  infant_price?: number;
  adult_cost?: number;
  child_cost?: number;
  total_cost?: number;
  is_manual_cost?: boolean;
  total_price?: number;
  paid_amount?: number;
  total_paid_out?: number;
  deposit_amount?: number;
  departure_region?: string;
  land_operator?: string;
  manager_name?: string;
  status: string;
  departure_date?: string;
  return_date?: string;
  notes?: string;
  created_at: string;
  customers?: { id: string; name: string; phone?: string };
  metadata?: Record<string, unknown>;
  settlement_confirmed_at?: string | null;
  settlement_confirmed_by?: string | null;
  commission_rate?: number | null;
  commission_amount?: number | null;
}

interface MessageLog {
  id: string;
  booking_id: string;
  log_type: string;
  event_type: string;
  title: string;
  content?: string | null;
  is_mock: boolean;
  created_at: string;
  created_by: string;
}

interface BookingDrawerProps {
  bookingId: string | null;
  onClose: () => void;
  onStatusChange?: (id: string, newStatus: string) => void;
}

type QuoteRow = {
  id:        string;
  label:     string;
  count:     number;
  salePrice: number;
  netPrice:  number;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const LOG_TYPE_COLOR: Record<string, string> = {
  system: 'bg-blue-100 text-blue-600', kakao: 'bg-yellow-100 text-yellow-700',
  mock: 'bg-gray-100 text-gray-500', scheduler: 'bg-purple-100 text-purple-600', manual: 'bg-green-100 text-green-700',
};
const LOG_TYPE_LABEL: Record<string, string> = {
  system: '시스템', kakao: '알림톡', mock: 'Mock', scheduler: '스케줄러', manual: '관리자',
};
const EVENT_ICON: Record<string, string> = {
  DEPOSIT_NOTICE: '📋', DEPOSIT_CONFIRMED: '💰', BALANCE_NOTICE: '📨',
  BALANCE_CONFIRMED: '✅', CONFIRMATION_GUIDE: '✈️', HAPPY_CALL: '😊',
  CANCELLATION: '❌', MANUAL_MEMO: '📝', PAYMENT_OUT: '🏢',
};

const QUICK_TAGS = ['카드 직결제', '수수료 공제', '단가 네고'] as const;

// ─── Sub-components ───────────────────────────────────────────────────────────

/** 금액 행 — 라벨 + 우정렬 금액 */
function AmountRow({
  label, amount, colorClass, sub,
}: {
  label: string;
  amount: number;
  colorClass?: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-slate-500 shrink-0">{label}</span>
      <div className="text-right">
        <span className={`text-[14px] font-bold tabular-nums ${colorClass ?? 'text-slate-800'}`}>
          {amount.toLocaleString()}원
        </span>
        {sub && <p className="text-[11px] text-slate-400 tabular-nums">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Dual Control Tower ───────────────────────────────────────────────────────
// 장부(Blueprint) vs 통장(Reality) 듀얼 대시보드 + 액션 경고등

function DualControlTower({
  totalSale,
  effectiveNet,
  netOverride,
  actualIncome,
  actualExpense,
}: {
  totalSale:     number;
  effectiveNet:  number;
  netOverride:   number | null;
  actualIncome:  number;    // txs 기준 총 입금
  actualExpense: number;    // txs 기준 총 출금
}) {
  const blueprintMargin = totalSale - effectiveNet;
  const blueprintRate   = totalSale > 0 ? (blueprintMargin / totalSale) * 100 : 0;
  const realizedProfit  = actualIncome - actualExpense;
  const realizedRate    = actualIncome > 0 ? (realizedProfit / actualIncome) * 100 : 0;

  // 액션 경고등 델타
  const customerUnpaid  = totalSale - actualIncome;    // 고객 미수금
  const landUnpaid      = effectiveNet - actualExpense; // 랜드사 미지급금
  // effectiveNet > 0 이어야만 정산 판별 가능 (원가 미입력 시 판별 불가)
  const hasCostEntered  = effectiveNet > 0;
  const isSettled       = hasCostEntered && customerUnpaid <= 0 && landUnpaid <= 0;

  return (
    <div className="rounded-2xl overflow-hidden ring-1 ring-slate-200 shadow-lg">

      {/* ── 헤더 ──────────────────────────────────────────────────────── */}
      <div className="px-5 py-3 bg-gradient-to-r from-slate-800 to-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-white font-extrabold text-[13px] tracking-wide">📊 정산 관제탑</span>
          <span className="text-slate-400 text-[11px]">Dual Control Tower</span>
        </div>
        {netOverride !== null && (
          <span className="text-[10px] bg-blue-400/25 text-blue-200 px-2 py-0.5 rounded-full font-bold border border-blue-400/40">
            원가 수동 조정됨
          </span>
        )}
      </div>

      {/* ── 2-Col 대시보드 ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 divide-x divide-gray-100">

        {/* 좌측: 장부상 계획 (Blueprint) */}
        <div className="p-4 bg-white space-y-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest">📝 장부</span>
            <span className="text-[10px] text-slate-400">Blueprint</span>
          </div>

          <div className="space-y-2">
            <AmountRow label="총 판매가" amount={totalSale} colorClass="text-slate-800" />
            <AmountRow
              label={netOverride !== null ? '총 원가 🔵수정' : '총 랜드사 원가'}
              amount={effectiveNet}
              colorClass={netOverride !== null ? 'text-blue-600' : 'text-amber-700'}
            />
          </div>

          {/* 예상 마진 — 회색 톤으로 시선 분산 방지 */}
          <div className="border-t border-dashed border-slate-200 pt-2.5 space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-slate-400 font-medium">= 예상 마진</span>
              <span className={`text-[16px] font-bold tabular-nums ${
                blueprintMargin > 0 ? 'text-slate-600' : blueprintMargin < 0 ? 'text-red-400' : 'text-slate-300'
              }`}>
                {blueprintMargin > 0 ? '+' : ''}{blueprintMargin.toLocaleString()}원
              </span>
            </div>
            {totalSale > 0 && (
              <p className="text-right text-[11px] text-slate-400 tabular-nums">
                마진율 {blueprintRate.toFixed(1)}%
              </p>
            )}
          </div>
        </div>

        {/* 우측: 실제 통장 현금흐름 (Reality) */}
        <div className="p-4 bg-blue-50/40 space-y-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-extrabold text-blue-600 uppercase tracking-widest">🏦 통장</span>
            <span className="text-[10px] text-blue-400">Reality</span>
          </div>

          <div className="space-y-2">
            <AmountRow
              label="📥 매칭된 총 입금"
              amount={actualIncome}
              colorClass="text-blue-700"
            />
            <AmountRow
              label="📤 매칭된 총 출금"
              amount={actualExpense}
              colorClass="text-red-600"
            />
          </div>

          {/* 💎 실현 수익 — 가장 크고 굵은 파란색 */}
          <div className="border-t border-dashed border-blue-200 pt-2.5 space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-blue-600 font-bold">💎 실현 수익</span>
              <span className={`text-[22px] font-extrabold tabular-nums leading-none ${
                realizedProfit > 0 ? 'text-blue-600' :
                realizedProfit < 0 ? 'text-red-600' : 'text-slate-400'
              }`}>
                {realizedProfit > 0 ? '+' : ''}{realizedProfit.toLocaleString()}원
              </span>
            </div>
            {actualIncome > 0 && (
              <p className={`text-right text-[11px] font-semibold tabular-nums ${
                realizedRate >= 20 ? 'text-emerald-600' :
                realizedRate >= 10 ? 'text-amber-600' : 'text-red-500'
              }`}>
                수익률 {realizedRate.toFixed(1)}%
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── 액션 경고등 (Actionable Insights) ─────────────────────── */}
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 space-y-2">
        {!hasCostEntered ? (
          /* 원가 미입력 — 정산 판별 불가 (주황 경고) */
          <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5">
            <span className="text-[16px]">⚠️</span>
            <div>
              <p className="text-[13px] font-extrabold text-amber-700">원가(장부) 미입력 — 정산 판별 불가</p>
              <p className="text-[11px] text-amber-600">견적 빌더에서 랜드사 원가를 입력하세요</p>
            </div>
          </div>
        ) : isSettled ? (
          <div className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-2.5">
            <span className="text-[16px]">✅</span>
            <div>
              <p className="text-[13px] font-extrabold text-emerald-700">정산 완벽히 종료됨</p>
              <p className="text-[11px] text-emerald-600">미수금 · 미지급금 없음</p>
            </div>
          </div>
        ) : (
          <>
            {customerUnpaid > 0 && (
              <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[15px]">🚨</span>
                  <div>
                    <p className="text-[13px] font-extrabold text-red-700">고객 미수금</p>
                    <p className="text-[11px] text-red-500">판매가 대비 입금 부족</p>
                  </div>
                </div>
                <span className="text-[16px] font-extrabold text-red-600 tabular-nums whitespace-nowrap">
                  {customerUnpaid.toLocaleString()}원 남음
                </span>
              </div>
            )}
            {landUnpaid > 0 && (
              <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[15px]">⚠️</span>
                  <div>
                    <p className="text-[13px] font-extrabold text-amber-700">랜드사 미지급금</p>
                    <p className="text-[11px] text-amber-600">원가 대비 출금 부족</p>
                  </div>
                </div>
                <span className="text-[16px] font-extrabold text-amber-600 tabular-nums whitespace-nowrap">
                  {landUnpaid.toLocaleString()}원 남음
                </span>
              </div>
            )}
            {customerUnpaid <= 0 && landUnpaid > 0 && (
              <div className="text-[11px] text-slate-400 text-center py-0.5">
                고객 입금 완료 · 랜드사 정산 대기 중
              </div>
            )}
            {customerUnpaid > 0 && landUnpaid <= 0 && (
              <div className="text-[11px] text-slate-400 text-center py-0.5">
                랜드사 정산 완료 · 고객 잔금 수취 대기 중
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Dynamic Quote Builder ────────────────────────────────────────────────────
// 역할: 좌측 '장부상 계획(Blueprint)' 수치를 설정하는 예산안 도구

function DynamicQuoteBuilder({
  rows, setRows, isDirty, setIsDirty,
  netOverride, setNetOverride,
  overrideMemo, setOverrideMemo,
  commissionRate, setCommissionRate,
  commissionAmount, setCommissionAmount,
  disabled,
}: {
  rows: QuoteRow[];
  setRows: React.Dispatch<React.SetStateAction<QuoteRow[]>>;
  isDirty: boolean;
  setIsDirty: (v: boolean) => void;
  netOverride: number | null;
  setNetOverride: (v: number | null) => void;
  overrideMemo: string;
  setOverrideMemo: (v: string) => void;
  commissionRate: number | null;
  setCommissionRate: (v: number | null) => void;
  commissionAmount: number | null;
  setCommissionAmount: (v: number | null) => void;
  disabled?: boolean;
}) {
  const [isEditingNet, setIsEditingNet] = useState(false);
  const netInputRef = useRef<HTMLInputElement>(null);

  const computedNet = rows.reduce((s, r) => s + r.count * r.netPrice, 0);
  const totalSale    = rows.reduce((s, r) => s + r.count * r.salePrice, 0);

  // effectiveNet 계산 우선순위:
  //  1) netOverride (수동 조정) — 최우선
  //  2) rows의 netPrice 합 (행별 원가 입력됨)
  //  3) totalSale - commissionAmount (커미션 기반 역산)
  //  4) 0
  const effectiveNet =
    netOverride !== null ? netOverride
    : computedNet > 0 ? computedNet
    : (commissionAmount && commissionAmount > 0) ? totalSale - commissionAmount
    : 0;

  const updateRow = (idx: number, field: keyof QuoteRow, val: string | number) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));
    setIsDirty(true);
  };

  const addCustomRow = () => {
    setRows(prev => [...prev, {
      id:        typeof crypto !== 'undefined' ? crypto.randomUUID() : `custom-${Date.now()}`,
      label:     '커스텀',
      count:     1,
      salePrice: 0,
      netPrice:  0,
    }]);
    setIsDirty(true);
  };

  const commitNetOverride = (raw: string) => {
    const v = parseInt(raw.replace(/[^0-9-]/g, ''), 10);
    if (!isNaN(v) && v !== computedNet) {
      setNetOverride(v);
      setIsDirty(true);
    } else {
      setNetOverride(null);
    }
    setIsEditingNet(false);
  };

  const resetOverride = () => {
    setNetOverride(null);
    setOverrideMemo('');
    setIsDirty(true);
  };

  useEffect(() => {
    if (isEditingNet && netInputRef.current) {
      netInputRef.current.focus();
      netInputRef.current.select();
    }
  }, [isEditingNet]);

  return (
    <div className={`bg-white rounded-2xl ring-1 ring-gray-900/5 shadow-sm overflow-hidden${disabled ? ' opacity-50 pointer-events-none' : ''}`}>
      {/* Header */}
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
            🧮 견적 빌더 — 장부 예산안 설정
          </h3>
          <p className="text-[10px] text-gray-400 mt-0.5">단가/인원 입력 → 위 장부 수치에 실시간 반영</p>
        </div>
        {isDirty && <span className="text-[11px] text-blue-600 font-medium animate-pulse">· 미저장</span>}
      </div>

      <div className="px-4 pt-3 pb-4">
        {/* Column labels */}
        <div className="grid grid-cols-[1fr_76px_108px_108px_88px_28px] gap-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-1 mb-2">
          <span>항목</span>
          <span className="text-center">인원</span>
          <span className="text-right">판매단가</span>
          <span className="text-right bg-amber-50 rounded px-1">랜드사원가</span>
          <span className="text-right">소계</span>
          <span />
        </div>

        {/* Rows */}
        <div className="space-y-1.5">
          {rows.map((row, idx) => {
            const isFixed = ['adult', 'child', 'infant'].includes(row.id);
            return (
              <div key={row.id}
                className="grid grid-cols-[1fr_76px_108px_108px_88px_28px] gap-1.5 items-center py-1 border-t border-gray-50 first:border-none">
                {isFixed ? (
                  <span className="text-[14px] font-bold text-gray-700 px-1">{row.label}</span>
                ) : (
                  <input value={row.label}
                    onChange={e => updateRow(idx, 'label', e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400 w-full" />
                )}

                {/* Count */}
                <div className="flex items-center gap-0.5 justify-center">
                  <button onMouseDown={() => updateRow(idx, 'count', Math.max(0, row.count - 1))}
                    disabled={disabled}
                    className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 text-[14px] font-bold flex items-center justify-center select-none transition disabled:opacity-50">−</button>
                  <span className="w-6 text-center tabular-nums text-[14px] font-extrabold">{row.count}</span>
                  <button onMouseDown={() => updateRow(idx, 'count', row.count + 1)}
                    disabled={disabled}
                    className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 text-[14px] font-bold flex items-center justify-center select-none transition disabled:opacity-50">+</button>
                </div>

                {/* Sale price */}
                <input type="number" min={0} value={row.salePrice || ''}
                  placeholder="0"
                  disabled={disabled}
                  onChange={e => updateRow(idx, 'salePrice', parseInt(e.target.value) || 0)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-right text-[13px] tabular-nums w-full focus:outline-none focus:ring-2 focus:ring-blue-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50" />

                {/* Net price */}
                <input type="number" min={0} value={row.netPrice || ''}
                  placeholder="0"
                  disabled={disabled}
                  onChange={e => updateRow(idx, 'netPrice', parseInt(e.target.value) || 0)}
                  className="border border-amber-200 bg-amber-50 rounded-lg px-2 py-1 text-right text-[13px] tabular-nums w-full focus:outline-none focus:ring-2 focus:ring-amber-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50" />

                {/* Subtotal */}
                <p className={`text-right text-[13px] tabular-nums font-bold pr-1 ${row.count === 0 ? 'text-gray-300' : 'text-gray-800'}`}>
                  {(row.count * row.salePrice).toLocaleString()}
                </p>

                {!isFixed ? (
                  <button onMouseDown={() => { setRows(prev => prev.filter((_, i) => i !== idx)); setIsDirty(true); }}
                    className="w-7 h-7 rounded flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition text-[14px]">✕</button>
                ) : <span />}
              </div>
            );
          })}
        </div>

        {/* Add custom row */}
        <button onMouseDown={addCustomRow}
          className="mt-3 flex items-center gap-1.5 text-[13px] text-blue-600 hover:text-blue-700 font-medium transition">
          <span className="text-[18px] leading-none font-light">+</span> 커스텀 항목 추가
        </button>

        {/* ── 랜드사 커미션 (rate ↔ amount 상호 자동 계산) ────────────── */}
        <div className="mt-4 pt-3 border-t border-dashed border-gray-200 bg-amber-50/40 -mx-4 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-bold text-amber-800 flex items-center gap-1">
              🏷️ 랜드사 커미션
              <span className="text-[10px] text-amber-600 font-normal">(% 또는 총액 — 한쪽만 입력, 나머지 자동)</span>
            </span>
            {(commissionRate || commissionAmount) ? (
              <button onMouseDown={() => { setCommissionRate(null); setCommissionAmount(null); setIsDirty(true); }}
                disabled={disabled}
                className="text-[10px] text-gray-400 hover:text-red-500 transition">초기화</button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-amber-700 mb-0.5">커미션율 (%)</label>
              <input type="number" min={0} max={100} step={0.1}
                placeholder="예: 10"
                value={commissionRate ?? ''}
                disabled={disabled}
                onChange={e => {
                  const v = e.target.value === '' ? null : parseFloat(e.target.value);
                  setCommissionRate(v);
                  if (v !== null && totalSale > 0) {
                    setCommissionAmount(Math.round(totalSale * v / 100));
                  } else if (v === null) {
                    setCommissionAmount(null);
                  }
                  setIsDirty(true);
                }}
                className="w-full border border-amber-200 bg-white rounded-lg px-2 py-1.5 text-right text-[13px] tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            </div>
            <div>
              <label className="block text-[10px] text-amber-700 mb-0.5">커미션 총액 (원)</label>
              <input type="number" min={0}
                placeholder="또는 직접 입력"
                value={commissionAmount ?? ''}
                disabled={disabled}
                onChange={e => {
                  const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
                  setCommissionAmount(v);
                  if (v !== null && totalSale > 0) {
                    setCommissionRate(Math.round((v / totalSale) * 10000) / 100);
                  } else if (v === null) {
                    setCommissionRate(null);
                  }
                  setIsDirty(true);
                }}
                className="w-full border border-amber-200 bg-white rounded-lg px-2 py-1.5 text-right text-[13px] tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            </div>
          </div>
          {commissionAmount && commissionAmount > 0 && totalSale > 0 && netOverride === null && computedNet === 0 && (
            <p className="text-[11px] text-amber-700 mt-2">
              ↳ 실 원가 자동: {totalSale.toLocaleString()} − {commissionAmount.toLocaleString()} = <strong>{(totalSale - commissionAmount).toLocaleString()}원</strong>
              <span className="text-[10px] text-amber-600 ml-1">(성인/아동 행에 원가 직접 입력하면 그쪽 우선)</span>
            </p>
          )}
        </div>

        {/* ── 판매가 합계 ─────────────────────────────────────────────── */}
        <div className="mt-4 pt-3 border-t-2 border-gray-100 flex items-center justify-between">
          <span className="text-[13px] font-bold text-gray-500 px-1">총 판매가</span>
          <p className="text-right text-[20px] font-extrabold tabular-nums text-gray-900 pr-1">
            {totalSale.toLocaleString()}
            <span className="text-[12px] font-semibold text-gray-400 ml-0.5">원</span>
          </p>
        </div>

        {/* ── 랜드사 원가 합계 — Audit-Trail Override ─────────────────── */}
        <div className="mt-2 pt-2 border-t border-dashed border-gray-200">
          <div className="flex items-center justify-between min-h-[36px]">
            <span className="text-[13px] font-bold text-amber-700 px-1 flex items-center gap-1">
              총 랜드사 원가
              {netOverride === null && (
                <span className="text-[10px] text-gray-400 font-normal">(클릭해서 수동 조정)</span>
              )}
            </span>

            <div className="flex items-center gap-2">
              {/* 원본값 (override 시 취소선으로 표시) */}
              {netOverride !== null && !isEditingNet && (
                <>
                  <span className="text-[13px] text-gray-400 line-through tabular-nums">
                    {computedNet.toLocaleString()}원
                  </span>
                  <button onClick={resetOverride}
                    title="빌더 자동 계산으로 되돌리기"
                    className="text-gray-400 hover:text-blue-500 transition text-[16px] leading-none px-1 py-0.5 rounded hover:bg-blue-50">
                    ↺
                  </button>
                </>
              )}

              {/* 편집 Input */}
              {isEditingNet ? (
                <input
                  ref={netInputRef}
                  type="number"
                  defaultValue={netOverride ?? computedNet}
                  onBlur={e => commitNetOverride(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); commitNetOverride((e.target as HTMLInputElement).value); }
                    if (e.key === 'Escape') { setIsEditingNet(false); }
                  }}
                  className="w-36 border-2 border-blue-500 rounded-lg px-2 py-1 text-right text-[14px] tabular-nums font-bold focus:outline-none bg-white shadow-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              ) : (
                /* 현재 유효 금액 — 클릭해서 편집 진입 */
                <button onClick={() => setIsEditingNet(true)}
                  className="group flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-amber-50 transition">
                  <span className={`text-[16px] font-extrabold tabular-nums ${
                    netOverride !== null ? 'text-blue-600' : 'text-amber-700'
                  }`}>
                    {effectiveNet.toLocaleString()}원
                  </span>
                  <svg className="w-3 h-3 text-gray-300 group-hover:text-blue-400 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 0l.172.172a2 2 0 010 2.828L12 15H9v-2z" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Quick Adjustment Note (override 활성 시에만 표시) */}
          {netOverride !== null && (
            <div className="mt-2 space-y-2 pl-1">
              <div className="flex gap-1.5 flex-wrap">
                <span className="text-[11px] text-gray-400 self-center">조정 사유:</span>
                {QUICK_TAGS.map(tag => (
                  <button key={tag}
                    onClick={() => setOverrideMemo(overrideMemo === tag ? '' : tag)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition border ${
                      overrideMemo === tag
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                    }`}>
                    {tag}
                  </button>
                ))}
              </div>
              <input type="text" value={overrideMemo}
                onChange={e => setOverrideMemo(e.target.value)}
                placeholder="또는 직접 조정 사유를 입력하세요..."
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-[12px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-gray-300" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BookingDrawer({ bookingId, onClose, onStatusChange }: BookingDrawerProps) {
  const [booking, setBooking]               = useState<BookingDetail | null>(null);
  const [logs, setLogs]                     = useState<MessageLog[]>([]);
  const [loading, setLoading]               = useState(false);
  const [transitioning, setTransitioning]   = useState<string | null>(null);
  const [memo, setMemo]                     = useState('');
  const [savingMemo, setSavingMemo]         = useState(false);
  const [toast, setToast]                   = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [txs, setTxs]                       = useState<BankTx[]>([]);
  const [txLoading, setTxLoading]           = useState(false);

  // Quote builder
  const [rows, setRows] = useState<QuoteRow[]>([
    { id: 'adult',  label: '성인', count: 1, salePrice: 0, netPrice: 0 },
    { id: 'child',  label: '아동', count: 0, salePrice: 0, netPrice: 0 },
    { id: 'infant', label: '유아', count: 0, salePrice: 0, netPrice: 0 },
  ]);
  const [isDirty, setIsDirty]               = useState(false);
  const [savingSettlement, setSavingSettlement] = useState(false);

  // Audit-trail override (장부 원가 수동 조정)
  const [netOverride, setNetOverride]       = useState<number | null>(null);
  const [overrideMemo, setOverrideMemo]     = useState('');

  // 랜드사 커미션 (rate ↔ amount 상호 자동 계산, UI에서만 연동)
  const [commissionRate, setCommissionRate]     = useState<number | null>(null);
  const [commissionAmount, setCommissionAmount] = useState<number | null>(null);

  const timelineRef = useRef<HTMLDivElement>(null);
  const visible = !!bookingId;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // ── Blueprint (장부) 계산 ─────────────────────────────────────────────────
  // effectiveNet 우선순위: netOverride > rows.netPrice 합 > (totalSale - commissionAmount)
  const blueprint = useMemo(() => {
    const totalSale   = rows.reduce((s, r) => s + r.count * r.salePrice, 0);
    const totalNet    = rows.reduce((s, r) => s + r.count * r.netPrice,  0);
    let effectiveNet: number;
    if (netOverride !== null) effectiveNet = netOverride;
    else if (totalNet > 0)    effectiveNet = totalNet;
    else if (commissionAmount && commissionAmount > 0) effectiveNet = Math.max(0, totalSale - commissionAmount);
    else effectiveNet = 0;
    return { totalSale, totalNet, effectiveNet };
  }, [rows, netOverride, commissionAmount]);

  // ── Reality (통장) 계산 — txs 배열에만 의존, 빌더와 완전 분리 ───────────
  const reality = useMemo(() => {
    const actualIncome  = txs
      .filter(t => t.transaction_type === '입금' && !t.is_refund)
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    const actualExpense = txs
      .filter(t => t.transaction_type === '출금')
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    return { actualIncome, actualExpense };
  }, [txs]);

  const transitions = booking ? (ALLOWED_TRANSITIONS[booking.status] ?? []) : [];

  // ── Data Fetch ─────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const [bRes, lRes] = await Promise.all([
        fetch(`/api/bookings?id=${id}`),
        fetch(`/api/bookings/${id}/timeline`),
      ]);
      if (bRes.ok) { const { booking: b } = await bRes.json(); setBooking(b); }
      if (lRes.ok) { const { logs: l } = await lRes.json(); setLogs(l ?? []); }
    } finally { setLoading(false); }
  }, []);

  const fetchTxs = useCallback(async (id: string) => {
    setTxLoading(true);
    try {
      const res = await fetch(`/api/bank-transactions?booking_id=${id}&status=all`);
      if (res.ok) { const { transactions } = await res.json(); setTxs(transactions ?? []); }
    } finally { setTxLoading(false); }
  }, []);

  useEffect(() => {
    if (bookingId) {
      setBooking(null); setLogs([]); setTxs([]);
      fetchAll(bookingId);
      fetchTxs(bookingId);
    }
  }, [bookingId, fetchAll, fetchTxs]);

  // rows + override 초기화 (booking 로드 후)
  useEffect(() => {
    if (!booking) return;
    const customRows = (booking.metadata?.customRows as QuoteRow[] | undefined) ?? [];
    setRows([
      { id: 'adult',  label: '성인', count: booking.adult_count  || 1, salePrice: booking.adult_price  || 0, netPrice: booking.adult_cost  || 0 },
      { id: 'child',  label: '아동', count: booking.child_count  || 0, salePrice: booking.child_price  || 0, netPrice: booking.child_cost  || 0 },
      { id: 'infant', label: '유아', count: booking.infant_count || 0, salePrice: booking.infant_price || 0, netPrice: 0 },
      ...customRows,
    ]);
    // DB is_manual_cost가 source of truth.
    // true → DB의 total_cost 값 자체를 override로 복원 (재오픈 후에도 Lock 유지)
    // false → metadata.netOverride 레거시 폴백 (마이그레이션 전 저장분 호환)
    if (booking.is_manual_cost === true && typeof booking.total_cost === 'number') {
      setNetOverride(booking.total_cost);
    } else {
      const savedOverride = booking.metadata?.netOverride;
      setNetOverride(typeof savedOverride === 'number' ? savedOverride : null);
    }
    setOverrideMemo(typeof booking.metadata?.overrideMemo === 'string' ? booking.metadata.overrideMemo : '');
    setCommissionRate(typeof booking.commission_rate === 'number' ? booking.commission_rate : null);
    setCommissionAmount(typeof booking.commission_amount === 'number' && booking.commission_amount > 0 ? booking.commission_amount : null);
    setIsDirty(false);
  }, [booking]);

  // ESC
  useEffect(() => {
    if (!visible) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [visible, onClose]);

  useEffect(() => {
    if (timelineRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [logs]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleTransition = async (to: string) => {
    if (!bookingId) return;
    setTransitioning(to);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/transition`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error ?? '전이 실패', 'err'); return; }
      await fetchAll(bookingId);
      onStatusChange?.(bookingId, to);
      showToast(`"${getStatusLabel(to)}"으로 변경됨`);
    } finally { setTransitioning(null); }
  };

  // ── 정산 확정 / 되돌리기 ─────────────────────────────────────────────
  const isConfirmedSettlement = !!booking?.settlement_confirmed_at;
  const [confirmingSettlement, setConfirmingSettlement] = useState(false);

  const handleConfirmSettlement = async (confirm: boolean) => {
    if (!bookingId) return;
    setConfirmingSettlement(true);
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settlement_confirmed_at: confirm ? new Date().toISOString() : null,
          settlement_confirmed_by: confirm ? 'admin' : null,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showToast(`정산 확정 실패 — ${(errData as { error?: string }).error ?? '다시 시도'}`, 'err');
        return;
      }
      await fetchAll(bookingId);
      showToast(confirm ? '✅ 정산 확정 — 목록에서 숨겨집니다' : '♻️ 정산 확정 해제');
    } catch {
      showToast('네트워크 오류 — 다시 시도해주세요', 'err');
    } finally {
      setConfirmingSettlement(false);
    }
  };

  const handleSettlementSave = async () => {
    if (!bookingId) return;
    setSavingSettlement(true);

    // ── 낙관적 롤백 스냅샷 ─────────────────────────────────────────────────
    const previousRows        = rows.map(r => ({ ...r }));
    const previousNetOverride = netOverride;

    try {
      const adultRow   = rows.find(r => r.id === 'adult');
      const childRow   = rows.find(r => r.id === 'child');
      const infantRow  = rows.find(r => r.id === 'infant');
      const customRows = rows.filter(r => !['adult', 'child', 'infant'].includes(r.id));

      // ── 새 전용 엔드포인트 호출 (URL 파라미터로 ID 전달) ─────────────────
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adult_count:     adultRow?.count     ?? 0,
          adult_price:     adultRow?.salePrice ?? 0,
          adult_cost:      adultRow?.netPrice  ?? 0,
          child_count:     childRow?.count     ?? 0,
          child_price:     childRow?.salePrice ?? 0,
          child_cost:      childRow?.netPrice  ?? 0,
          // override-aware total 저장
          total_price:     blueprint.totalSale,
          total_cost:      blueprint.effectiveNet,
          // 오버라이드 잠금 플래그 — netOverride가 있을 때만 true
          is_manual_cost:  netOverride !== null,
          // 랜드사 커미션 (null이면 명시적으로 클리어)
          commission_rate:   commissionRate,
          commission_amount: commissionAmount ?? 0,
          metadata: {
            ...(booking?.metadata ?? {}),
            customRows,
            infantCount:  infantRow?.count     ?? 0,
            infantPrice:  infantRow?.salePrice ?? 0,
            // 레거시 호환 및 audit-trail 보존
            netOverride:  netOverride,
            overrideMemo: overrideMemo,
          },
        }),
      });

      if (!res.ok) {
        // ── 실패: 낙관적 롤백 ──────────────────────────────────────────────
        setRows(previousRows);
        setNetOverride(previousNetOverride);
        const errData = await res.json().catch(() => ({}));
        showToast(`저장 실패 — ${(errData as { error?: string }).error ?? '다시 시도해주세요'}`, 'err');
        return;
      }

      // ── 성공: 서버 최신 데이터로 리렌더링 ──────────────────────────────
      setIsDirty(false);
      await fetchAll(bookingId);
      const profitLabel = `실현 수익 ${(reality.actualIncome - reality.actualExpense).toLocaleString()}원`;
      showToast(`✅ 저장됨 — ${profitLabel}`);
    } catch {
      // ── 네트워크 예외: 롤백 ────────────────────────────────────────────
      setRows(previousRows);
      setNetOverride(previousNetOverride);
      showToast('저장 중 오류 발생 — 네트워크를 확인해주세요', 'err');
    } finally {
      setSavingSettlement(false);
    }
  };

  const resetSettlementEdit = () => {
    if (!booking) return;
    const customRows = (booking.metadata?.customRows as QuoteRow[] | undefined) ?? [];
    setRows([
      { id: 'adult',  label: '성인', count: booking.adult_count  || 1, salePrice: booking.adult_price  || 0, netPrice: booking.adult_cost  || 0 },
      { id: 'child',  label: '아동', count: booking.child_count  || 0, salePrice: booking.child_price  || 0, netPrice: booking.child_cost  || 0 },
      { id: 'infant', label: '유아', count: booking.infant_count || 0, salePrice: booking.infant_price || 0, netPrice: 0 },
      ...customRows,
    ]);
    // useEffect와 동일한 로직으로 override 복원 (일관성 유지)
    if (booking.is_manual_cost === true && typeof booking.total_cost === 'number') {
      setNetOverride(booking.total_cost);
    } else {
      const savedOverride = booking.metadata?.netOverride;
      setNetOverride(typeof savedOverride === 'number' ? savedOverride : null);
    }
    setOverrideMemo(typeof booking.metadata?.overrideMemo === 'string' ? booking.metadata.overrideMemo : '');
    setCommissionRate(typeof booking.commission_rate === 'number' ? booking.commission_rate : null);
    setCommissionAmount(typeof booking.commission_amount === 'number' && booking.commission_amount > 0 ? booking.commission_amount : null);
    setIsDirty(false);
  };

  const handleAddMemo = async () => {
    if (!memo.trim() || !bookingId) return;
    setSavingMemo(true);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/timeline`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: memo }),
      });
      if (res.ok) {
        setMemo('');
        const { logs: l } = await (await fetch(`/api/bookings/${bookingId}/timeline`)).json();
        setLogs(l ?? []);
        showToast('메모 추가됨');
      }
    } finally { setSavingMemo(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/30 backdrop-blur-[2px] z-40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div className={`fixed inset-y-0 right-0 z-50 w-[min(960px,60vw)] bg-white shadow-2xl flex flex-col
        transform transition-transform duration-300 ease-out
        ${visible ? 'translate-x-0' : 'translate-x-full'}`}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white/95 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {booking ? (
              <>
                <span className="font-mono text-[14px] font-extrabold text-gray-800 shrink-0">
                  {booking.booking_no || booking.id.slice(0, 8)}
                </span>
                <span className={`text-[12px] font-semibold px-2.5 py-1 rounded-full shrink-0 ${getStatusBadgeClass(booking.status)}`}>
                  {getStatusLabel(booking.status)}
                </span>
                {booking.customers?.name && (
                  <span className="text-[15px] font-extrabold text-gray-800 truncate">
                    {booking.customers.name}
                  </span>
                )}
                {booking.departure_date && (
                  <span className="text-[13px] text-gray-400 shrink-0">
                    ✈ {booking.departure_date.slice(0, 10)}
                  </span>
                )}
              </>
            ) : (
              <div className="h-5 w-48 bg-gray-100 rounded animate-pulse" />
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {booking && (
              <Link href={`/admin/bookings/${booking.id}/edit`} target="_blank"
                className="text-[12px] text-gray-500 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition">
                전체 편집 ↗
              </Link>
            )}
            <button onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition text-[16px]">
              ✕
            </button>
          </div>
        </div>

        {/* ── Body — 2컬럼 그리드 ─────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden grid grid-cols-[300px_1fr] divide-x divide-gray-100 min-h-0">

          {/* ── 좌측: 기본 정보 + 진행 상태 + 메모 ──────────────────── */}
          <div className="overflow-y-auto p-5 space-y-4">
            {loading ? (
              <div className="space-y-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="animate-pulse space-y-2">
                    <div className="h-3 bg-gray-100 rounded w-1/3" />
                    <div className="h-10 bg-gray-100 rounded" />
                  </div>
                ))}
              </div>
            ) : !booking ? (
              <div className="text-center text-gray-400 text-[14px] py-8">불러오는 중...</div>
            ) : (
              <>
                {/* 예약 진행 Progress Bar */}
                {booking.status !== 'cancelled' && (
                  <div className="bg-gray-50 rounded-2xl p-4">
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">예약 진행 상태</p>
                    <div className="relative flex items-center justify-between">
                      <div className="absolute top-4 left-0 right-0 h-0.5 bg-gray-200 z-0" />
                      <div className="absolute top-4 left-0 h-0.5 bg-blue-500 z-0 transition-all duration-500"
                        style={{ width: `${getStepIndex(booking.status) === 0 ? 0 : (getStepIndex(booking.status) / (JOURNEY_STEPS.length - 1)) * 100}%` }} />
                      {JOURNEY_STEPS.map((step) => {
                        const isDone    = step.step < getStepIndex(booking.status);
                        const isCurrent = step.step === getStepIndex(booking.status);
                        return (
                          <div key={step.status} className="relative flex flex-col items-center z-10">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-extrabold transition-all ${
                              isDone ? 'bg-blue-500 text-white' : isCurrent ? 'bg-blue-600 text-white ring-4 ring-blue-100' : 'bg-white text-gray-400 border-2 border-gray-200'
                            }`}>
                              {isDone ? '✓' : step.step + 1}
                            </div>
                            <p className={`mt-2 text-[11px] text-center max-w-[56px] leading-tight ${isCurrent ? 'font-bold text-blue-700' : isDone ? 'text-blue-500' : 'text-gray-400'}`}>
                              {step.label}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 기본 정보 */}
                <div className="bg-white rounded-2xl ring-1 ring-gray-900/5 shadow-sm p-4">
                  <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">기본 정보</h3>
                  <div className="space-y-2.5">
                    {[
                      { label: '고객명', val: booking.customers?.name },
                      { label: '연락처', val: booking.customers?.phone },
                      { label: '출발일', val: booking.departure_date?.slice(0, 10) },
                      { label: '귀국일', val: booking.return_date?.slice(0, 10) },
                      { label: '상품명', val: booking.package_title },
                      { label: '출발지', val: booking.departure_region },
                      { label: '랜드사', val: booking.land_operator },
                      { label: '담당자', val: booking.manager_name },
                    ].map(({ label, val }) => (
                      <div key={label} className="flex justify-between text-[13px]">
                        <span className="text-gray-400 shrink-0 w-14">{label}</span>
                        <span className="font-semibold text-gray-900 text-right truncate ml-2">
                          {val || <span className="text-gray-300">—</span>}
                        </span>
                      </div>
                    ))}
                    {booking.notes && (
                      <div className="border-t border-gray-100 pt-2.5 text-[12px] text-gray-500 leading-relaxed">
                        {booking.notes}
                      </div>
                    )}
                  </div>
                </div>

                {/* Activity Log + Memo */}
                <div className="bg-white rounded-2xl ring-1 ring-gray-900/5 shadow-sm p-4">
                  <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">
                    📋 Activity Log
                  </h3>
                  <div ref={timelineRef} className="space-y-3 max-h-52 overflow-y-auto pr-1">
                    {logs.length === 0 ? (
                      <p className="text-[13px] text-gray-400 text-center py-3">기록 없음</p>
                    ) : logs.map((log, idx) => (
                      <div key={log.id} className="flex gap-3">
                        <div className="flex flex-col items-center flex-shrink-0">
                          <div className="w-7 h-7 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-[13px]">
                            {EVENT_ICON[log.event_type] ?? '💬'}
                          </div>
                          {idx < logs.length - 1 && <div className="w-px flex-1 bg-gray-100 mt-1" />}
                        </div>
                        <div className="flex-1 pb-3 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13px] font-semibold text-gray-800">{log.title}</span>
                            <span className={`text-[11px] px-1.5 py-0.5 rounded ${LOG_TYPE_COLOR[log.log_type] ?? 'bg-gray-100 text-gray-500'}`}>
                              {LOG_TYPE_LABEL[log.log_type] ?? log.log_type}
                            </span>
                          </div>
                          {log.content && (
                            <p className="text-[13px] text-gray-600 mt-0.5 leading-relaxed">{log.content}</p>
                          )}
                          <p className="text-[11px] text-gray-400 mt-1">
                            {new Date(log.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            {' · '}{log.created_by}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-100 flex gap-2">
                    <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddMemo(); } }}
                      placeholder="메모 후 Enter..."
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    <button onClick={handleAddMemo} disabled={savingMemo || !memo.trim()}
                      className="px-3 py-2 bg-blue-600 text-white text-[13px] rounded-lg hover:bg-blue-700 disabled:opacity-50 transition">
                      {savingMemo ? '...' : '추가'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── 우측: 듀얼 관제탑 → 견적 빌더 → 통장 내역 ──────────── */}
          <div className="overflow-y-auto p-5 space-y-4">

            {/* ① 듀얼 관제탑 — 최상단 (장부 vs 통장) */}
            <DualControlTower
              totalSale={blueprint.totalSale}
              effectiveNet={blueprint.effectiveNet}
              netOverride={netOverride}
              actualIncome={reality.actualIncome}
              actualExpense={reality.actualExpense}
            />

            {/* ② 견적 빌더 — 장부(Blueprint) 예산안 설정 도구 */}
            <DynamicQuoteBuilder
              rows={rows}
              setRows={setRows}
              isDirty={isDirty}
              setIsDirty={setIsDirty}
              netOverride={netOverride}
              setNetOverride={setNetOverride}
              overrideMemo={overrideMemo}
              setOverrideMemo={setOverrideMemo}
              commissionRate={commissionRate}
              setCommissionRate={setCommissionRate}
              commissionAmount={commissionAmount}
              setCommissionAmount={setCommissionAmount}
              disabled={savingSettlement}
            />

            {/* ③ 통장 입출금 내역 — 매칭된 거래만 표시 */}
            <div className="bg-white rounded-2xl ring-1 ring-gray-900/5 shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                  🏦 통장 매칭 내역
                </h3>
                {txs.length > 0 && (
                  <div className="flex items-center gap-3 text-[12px] tabular-nums">
                    <span className="text-blue-600 font-semibold">
                      📥 {reality.actualIncome.toLocaleString()}원
                    </span>
                    {reality.actualExpense > 0 && (
                      <span className="text-red-500 font-semibold">
                        📤 {reality.actualExpense.toLocaleString()}원
                      </span>
                    )}
                  </div>
                )}
              </div>
              {txLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => <div key={i} className="animate-pulse h-14 bg-gray-100 rounded-xl" />)}
                </div>
              ) : txs.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-3xl mb-2">🏦</p>
                  <p className="text-[13px]">매칭된 입출금 내역이 없습니다.</p>
                  <Link href="/admin/payments" className="text-[12px] text-blue-500 mt-1 inline-block hover:underline">
                    입금 관리에서 매칭하기 →
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {txs.map(tx => (
                    <div key={tx.id} className={`rounded-xl p-3 ${
                      tx.transaction_type === '입금' && !tx.is_refund
                        ? 'bg-blue-50'
                        : tx.transaction_type === '출금'
                          ? 'bg-red-50/60'
                          : 'bg-orange-50/60'
                    }`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[14px] font-bold flex-shrink-0 ${
                            tx.transaction_type === '입금'
                              ? tx.is_refund ? 'bg-orange-100 text-orange-600' : 'bg-blue-500 text-white'
                              : 'bg-red-100 text-red-600'
                          }`}>
                            {tx.transaction_type === '입금' ? (tx.is_refund ? '↩' : '↓') : '↑'}
                          </div>
                          <div>
                            <p className="text-[13px] font-semibold text-gray-800">{tx.counterparty_name || '—'}</p>
                            <p className="text-[11px] text-gray-400">
                              {new Date(tx.received_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              {tx.memo && ` · ${tx.memo}`}
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className={`text-[15px] font-extrabold tabular-nums ${
                            tx.transaction_type === '입금' && !tx.is_refund ? 'text-blue-600' : 'text-red-600'
                          }`}>
                            {tx.transaction_type === '출금' ? '−' : '+'}{tx.amount.toLocaleString()}원
                          </p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded mt-0.5 inline-block font-semibold ${
                            tx.match_status === 'auto'   ? 'bg-green-100 text-green-700'  :
                            tx.match_status === 'manual' ? 'bg-blue-100 text-blue-700'    :
                            'bg-gray-100 text-gray-500'
                          }`}>
                            {tx.match_status === 'auto' ? '자동' : tx.match_status === 'manual' ? '수동' : tx.match_status}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Sticky Footer ───────────────────────────────────────────── */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-3.5 flex items-center gap-2 flex-shrink-0">
          {/* 상태 전이 버튼 */}
          {transitions.length > 0 && (
            <div className="flex gap-1.5 flex-wrap flex-1">
              {transitions.map(t => (
                <button key={t.to} onClick={() => handleTransition(t.to)}
                  disabled={transitioning !== null}
                  className={`px-3 py-1.5 text-[12px] font-semibold rounded-lg transition disabled:opacity-50 whitespace-nowrap ${
                    t.isMock
                      ? 'bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}>
                  {transitioning === t.to ? '처리 중...' : t.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            {isDirty && (
              <button onClick={resetSettlementEdit}
                className="px-4 py-2 text-[13px] text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
                되돌리기
              </button>
            )}
            <button onClick={handleSettlementSave}
              disabled={savingSettlement || !isDirty}
              className={`px-5 py-2 text-[13px] font-extrabold rounded-lg transition flex items-center gap-2 ${
                savingSettlement
                  ? 'bg-blue-400 text-white cursor-wait'
                  : isDirty
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-100 text-gray-400 cursor-default'
              }`}>
              {savingSettlement && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {savingSettlement ? '저장 중...' : isDirty ? '장부 저장' : '저장됨'}
            </button>

            {/* 정산 확정 / 해제 */}
            {isConfirmedSettlement ? (
              <button onClick={() => handleConfirmSettlement(false)}
                disabled={confirmingSettlement}
                title={`확정 시각: ${booking?.settlement_confirmed_at?.slice(0,19).replace('T',' ') ?? ''}`}
                className="px-4 py-2 text-[13px] bg-slate-100 text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-200 transition whitespace-nowrap">
                ♻️ 정산확정됨 · 해제
              </button>
            ) : (
              <button onClick={() => handleConfirmSettlement(true)}
                disabled={confirmingSettlement}
                title="이 예약을 '정산 끝'으로 마킹 → 목록에서 기본 숨김"
                className="px-4 py-2 text-[13px] bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition whitespace-nowrap font-semibold">
                ✅ 정산 확정
              </button>
            )}

            <button onClick={onClose}
              className="px-4 py-2 text-[13px] text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
              닫기
            </button>
          </div>
        </div>

        {/* ── Toast ─────────────────────────────────────────────────── */}
        {toast && (
          <div className={`fixed bottom-8 right-8 z-[60] px-4 py-2.5 rounded-xl shadow-2xl text-white text-[13px] font-semibold pointer-events-none flex items-center gap-2
            ${toast.type === 'err' ? 'bg-red-600' : 'bg-gray-900'}`}>
            {toast.type === 'err' ? '🚨' : '✅'} {toast.msg}
          </div>
        )}
      </div>
    </>
  );
}
