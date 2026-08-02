'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchWithSessionRefresh } from '@/lib/fetch-with-session-refresh';

type Operator = { id: string; name: string; aliases: string[] | null; is_active: boolean };
type Contract = {
  id: string;
  land_operator_id: string;
  contract_label: string;
  commission_rate: number;
  filename_markers: string[];
  source_label_markers: string[];
  raw_text_markers: string[];
  allow_operator_alias_match: boolean;
  valid_from: string;
  valid_to: string | null;
  evidence_url: string | null;
  evidence_hash: string | null;
  auto_apply: boolean;
  is_active: boolean;
  priority: number;
  land_operators?: { name?: string } | Array<{ name?: string }> | null;
};

type FormState = {
  landOperatorId: string;
  contractLabel: string;
  commissionRate: string;
  filenameMarkers: string;
  sourceLabelMarkers: string;
  rawTextMarkers: string;
  allowOperatorAliasMatch: boolean;
  validFrom: string;
  validTo: string;
  evidenceUrl: string;
  evidenceHash: string;
  priority: string;
};

const EMPTY_FORM: FormState = {
  landOperatorId: '',
  contractLabel: '',
  commissionRate: '',
  filenameMarkers: '',
  sourceLabelMarkers: '',
  rawTextMarkers: '',
  allowOperatorAliasMatch: false,
  validFrom: new Date().toISOString().slice(0, 10),
  validTo: '',
  evidenceUrl: '',
  evidenceHash: '',
  priority: '100',
};

function operatorName(contract: Contract): string {
  const relation = Array.isArray(contract.land_operators) ? contract.land_operators[0] : contract.land_operators;
  return relation?.name || '알 수 없음';
}

function markerLines(contract: Contract): string[] {
  return [
    ...contract.filename_markers.map(value => `파일명: ${value}`),
    ...contract.source_label_markers.map(value => `라벨: ${value}`),
    ...contract.raw_text_markers.map(value => `원문: ${value}`),
    ...(contract.allow_operator_alias_match ? ['랜드사명·별칭 정확 일치'] : []),
  ];
}

export default function CommercialContractsPage() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithSessionRefresh('/api/admin/commercial-contracts', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok || json?.ok === false) throw new Error(json?.error?.message || '계약 원장을 불러오지 못했습니다.');
      setContracts(json?.data?.contracts ?? []);
      setOperators(json?.data?.operators ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '계약 원장을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeCount = useMemo(() => contracts.filter(contract => contract.is_active && contract.auto_apply).length, [contracts]);

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetchWithSessionRefresh('/api/admin/commercial-contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          commissionRate: Number(form.commissionRate),
          priority: Number(form.priority),
        }),
      });
      const json = await response.json();
      if (!response.ok || json?.ok === false) throw new Error(json?.error?.message || '계약 저장에 실패했습니다.');
      setMessage('계약 원장을 저장했습니다. 다음 업로드부터 일치하는 상품에 자동 적용됩니다.');
      setForm(EMPTY_FORM);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '계약 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: string) {
    if (!window.confirm('이 계약의 자동 적용을 중지할까요? 기존 상품 값은 바뀌지 않습니다.')) return;
    setError(null);
    const response = await fetchWithSessionRefresh('/api/admin/commercial-contracts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'deactivate' }),
    });
    const json = await response.json();
    if (!response.ok || json?.ok === false) {
      setError(json?.error?.message || '자동 적용 중지에 실패했습니다.');
      return;
    }
    await load();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-admin-muted-2">상품 등록 자동화</p>
          <h1 className="text-2xl font-bold text-admin-text">검증된 계약 원장</h1>
          <p className="mt-2 max-w-3xl text-sm text-admin-muted-2">
            실제 계약 근거와 명시적 파일·원문 표식을 한 번 등록하면 `/admin/upload`가 랜드사와 커미션을 자동 확정합니다.
            `15T`, `10T`, `8T`, `TL` 같은 관행 코드는 근거로 사용하지 않습니다.
          </p>
        </div>
        <Link href="/admin/upload" className="rounded-lg border border-admin-border px-4 py-2 text-sm text-admin-text hover:bg-admin-surface-2">
          상품 등록으로 돌아가기
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-admin-border bg-admin-surface p-4"><p className="text-xs text-admin-muted-2">자동 적용 계약</p><p className="mt-1 text-2xl font-bold">{activeCount}</p></div>
        <div className="rounded-xl border border-admin-border bg-admin-surface p-4"><p className="text-xs text-admin-muted-2">활성 랜드사</p><p className="mt-1 text-2xl font-bold">{operators.length}</p></div>
        <div className="rounded-xl border border-admin-border bg-admin-surface p-4"><p className="text-xs text-admin-muted-2">안전 원칙</p><p className="mt-1 text-sm font-semibold text-emerald-700">근거·유효기간·단일 매칭 필수</p></div>
      </div>

      <section className="rounded-xl border border-admin-border bg-admin-surface p-5">
        <h2 className="text-lg font-semibold text-admin-text">계약 한 번 등록</h2>
        <p className="mt-1 text-xs text-admin-muted-2">표식은 계약서에서 확인된 공급사 파일명 접두어·문구를 사용하세요. 줄바꿈으로 여러 개를 넣을 수 있습니다.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm">랜드사
            <select className="mt-1 w-full rounded-lg border border-admin-border bg-white px-3 py-2" value={form.landOperatorId} onChange={event => setForm(current => ({ ...current, landOperatorId: event.target.value }))}>
              <option value="">선택</option>
              {operators.map(operator => <option key={operator.id} value={operator.id}>{operator.name}</option>)}
            </select>
          </label>
          <label className="text-sm">계약 구분명
            <input className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2" value={form.contractLabel} onChange={event => setForm(current => ({ ...current, contractLabel: event.target.value }))} placeholder="예: 2026 하계 중국 패키지 계약" />
          </label>
          <label className="text-sm">계약 커미션율 (%)
            <input type="number" min="0.01" max="50" step="0.01" className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2" value={form.commissionRate} onChange={event => setForm(current => ({ ...current, commissionRate: event.target.value }))} />
          </label>
          <label className="text-sm">파일명 표식
            <textarea className="mt-1 min-h-20 w-full rounded-lg border border-admin-border px-3 py-2" value={form.filenameMarkers} onChange={event => setForm(current => ({ ...current, filenameMarkers: event.target.value }))} placeholder="예: 투어라운지-계약A" />
          </label>
          <label className="text-sm">원문 첫 부분 표식
            <textarea className="mt-1 min-h-20 w-full rounded-lg border border-admin-border px-3 py-2" value={form.rawTextMarkers} onChange={event => setForm(current => ({ ...current, rawTextMarkers: event.target.value }))} placeholder="계약서에서 확인된 공급사 고유 문구" />
          </label>
          <label className="text-sm">계약 근거 HTTPS URL
            <input type="url" className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2" value={form.evidenceUrl} onChange={event => setForm(current => ({ ...current, evidenceUrl: event.target.value }))} placeholder="https://..." />
          </label>
          <label className="text-sm">계약 증빙 해시 (URL이 없을 때)
            <input className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 font-mono text-xs" value={form.evidenceHash} onChange={event => setForm(current => ({ ...current, evidenceHash: event.target.value }))} placeholder="SHA-256" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">적용 시작일<input type="date" className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2" value={form.validFrom} onChange={event => setForm(current => ({ ...current, validFrom: event.target.value }))} /></label>
            <label className="text-sm">종료일 (선택)<input type="date" className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2" value={form.validTo} onChange={event => setForm(current => ({ ...current, validTo: event.target.value }))} /></label>
          </div>
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm text-admin-text">
          <input type="checkbox" className="mt-1" checked={form.allowOperatorAliasMatch} onChange={event => setForm(current => ({ ...current, allowOperatorAliasMatch: event.target.checked }))} />
          <span>파일·원문에 랜드사 정식명 또는 등록 별칭이 정확히 있을 때 이 계약을 기본 적용합니다. 랜드사 안에서도 상품별 계약률이 다르면 체크하지 마세요.</span>
        </label>
        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {message && <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
        <button type="button" disabled={saving} onClick={() => void save()} className="mt-5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? '저장 중…' : '검증 계약 저장'}
        </button>
      </section>

      <section className="rounded-xl border border-admin-border bg-admin-surface p-5">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-admin-text">등록된 계약</h2><button type="button" onClick={() => void load()} className="text-sm text-blue-600">새로고침</button></div>
        {loading ? <p className="mt-4 text-sm text-admin-muted-2">불러오는 중…</p> : contracts.length === 0 ? <p className="mt-4 text-sm text-admin-muted-2">등록된 계약이 없습니다.</p> : (
          <div className="mt-4 space-y-3">
            {contracts.map(contract => (
              <article key={contract.id} className={`rounded-lg border p-4 ${contract.is_active && contract.auto_apply ? 'border-emerald-200 bg-emerald-50/40' : 'border-admin-border bg-admin-surface-2 opacity-70'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="font-semibold text-admin-text">{operatorName(contract)} · {contract.contract_label}</p><p className="mt-1 text-sm text-admin-muted-2">커미션 {Number(contract.commission_rate).toFixed(2)}% · {contract.valid_from} ~ {contract.valid_to || '종료일 없음'}</p></div>
                  {contract.is_active && contract.auto_apply ? <button type="button" onClick={() => void deactivate(contract.id)} className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-700">자동 적용 중지</button> : <span className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-600">중지됨</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">{markerLines(contract).map(marker => <span key={marker} className="rounded bg-white px-2 py-1 text-xs text-admin-text shadow-sm">{marker}</span>)}</div>
                <p className="mt-3 break-all text-xs text-admin-muted-2">근거: {contract.evidence_url || contract.evidence_hash || '-'}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
