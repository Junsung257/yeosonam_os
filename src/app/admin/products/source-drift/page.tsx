'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/admin/patterns';
import { SOURCE_REGION_OPTIONS, type SourceDriftConfidence, type SourceDriftItem } from '@/lib/product-source-drift';

interface QueueResponse {
  summary: { packages: number; entries: number; source_context_candidates: number; itinerary_candidates: number; needs_review: number; normalized_name_matches: number; public_entries: number; evidence_contract_blocked: number; evidence_contract_review: number; evidence_contract_pass: number };
  items: SourceDriftItem[];
  generated_at: string;
}

const confidenceLabel: Record<SourceDriftConfidence, string> = {
  source_context: '원문 문맥 후보',
  itinerary: '일정 지역 후보',
  needs_review: '수동 확인 필요',
};

export default function ProductSourceDriftPage() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [region, setRegion] = useState('');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState<'all' | SourceDriftConfidence>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/products/source-drift', { cache: 'no-store' });
      const payload = await response.json() as QueueResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? '검수 큐를 불러오지 못했습니다.');
      setData(payload);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '검수 큐를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => (data?.items ?? []).filter(item => {
    const matchesFilter = filter === 'all' || item.confidence === filter;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [item.internal_code, item.title, item.destination, item.name].some(value => String(value ?? '').toLowerCase().includes(query));
    return matchesFilter && matchesSearch;
  }), [data?.items, filter, search]);

  const selected = items.find(item => `${item.package_id}:${item.tour_index}` === selectedKey) ?? items[0] ?? null;

  useEffect(() => {
    if (!selected) {
      setSelectedKey(null);
      return;
    }
    setSelectedKey(`${selected.package_id}:${selected.tour_index}`);
    setRegion(selected.suggested_region ?? '');
    setNote('');
  }, [selected]);

  const submit = async (decision: 'approve' | 'defer') => {
    if (!selected) return;
    setSaving(true);
    try {
      const response = await fetch('/api/admin/products/source-drift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package_id: selected.package_id, tour_index: selected.tour_index, decision, region: decision === 'approve' ? region : null, reviewer_note: note }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? '검수 결과 저장에 실패했습니다.');
      setMessage(decision === 'approve' ? '지역을 저장했습니다.' : '검토 보류를 기록했습니다.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '검수 결과 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="원문 근거 검수 큐"
        subtitle="선택관광 지역 누락을 원문 문맥으로 확인합니다. 상품 제목이나 목적지 추정값은 자동 반영하지 않습니다."
        actions={<button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 py-2 text-admin-sm font-semibold text-admin-text-2 hover:bg-admin-surface-2"><RefreshCw size={14} /> 새로고침</button>}
      />

      {message && <div role="status" className="rounded-admin-sm border border-blue-200 bg-blue-50 px-3 py-2 text-admin-sm text-blue-800">{message}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {[
          ['검수 상품', data?.summary.packages ?? 0],
          ['모호 옵션', data?.summary.entries ?? 0],
          ['원문 후보', data?.summary.source_context_candidates ?? 0],
          ['일정 후보', data?.summary.itinerary_candidates ?? 0],
          ['정규화 일치', data?.summary.normalized_name_matches ?? 0],
          ['수동 확인', data?.summary.needs_review ?? 0],
          ['근거 계약 차단', data?.summary.evidence_contract_blocked ?? 0],
          ['근거 계약 검토', data?.summary.evidence_contract_review ?? 0],
        ].map(([label, value]) => <div key={String(label)} className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-3"><div className="text-admin-xs text-admin-muted">{label}</div><div className="mt-1 text-xl font-bold text-admin-text">{value}</div></div>)}
      </div>

      <div className="grid min-h-[560px] gap-4 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.6fr)]">
        <section className="overflow-hidden rounded-admin-md border border-admin-border-mid bg-admin-surface">
          <div className="space-y-2 border-b border-admin-divider p-3">
            <input aria-label="검수 큐 검색" value={search} onChange={event => setSearch(event.target.value)} placeholder="상품명·코드·옵션 검색" className="h-9 w-full rounded-admin-sm border border-admin-border-mid bg-admin-bg px-3 text-admin-sm text-admin-text outline-none focus:border-brand" />
            <select aria-label="검수 상태 필터" value={filter} onChange={event => setFilter(event.target.value as typeof filter)} className="h-9 w-full rounded-admin-sm border border-admin-border-mid bg-admin-bg px-3 text-admin-sm text-admin-text outline-none focus:border-brand">
              <option value="all">전체 ({data?.summary.entries ?? 0})</option>
              <option value="source_context">원문 후보</option>
              <option value="itinerary">일정 후보</option>
              <option value="needs_review">수동 확인 필요</option>
            </select>
          </div>
          <div className="max-h-[650px] overflow-y-auto">
            {loading && <div className="space-y-3 p-4"><div className="h-14 animate-pulse rounded bg-admin-surface-2" /><div className="h-14 animate-pulse rounded bg-admin-surface-2" /></div>}
            {!loading && items.length === 0 && <div className="p-6 text-center text-admin-sm text-admin-muted">남은 검수 항목이 없습니다.</div>}
            {items.map(item => {
              const key = `${item.package_id}:${item.tour_index}`;
              const active = selectedKey === key;
              return <button key={key} type="button" onClick={() => { setSelectedKey(key); setRegion(item.suggested_region ?? ''); setNote(''); }} className={`w-full border-b border-admin-divider p-3 text-left transition ${active ? 'bg-brand-light' : 'hover:bg-admin-surface-2'}`}>
                <div className="flex items-start justify-between gap-2"><span className="line-clamp-2 text-admin-sm font-semibold text-admin-text">{item.name}</span><span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{confidenceLabel[item.confidence]}</span></div>
                <div className="mt-1 truncate text-admin-xs text-admin-muted">{item.internal_code ?? item.package_id} · {item.title ?? '상품명 없음'}</div>
              </button>;
            })}
          </div>
        </section>

        <section className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-4">
          {!selected && <div className="flex h-full items-center justify-center text-admin-sm text-admin-muted">왼쪽 항목을 선택하세요.</div>}
          {selected && <div className="space-y-4">
            <div className="flex items-start justify-between gap-3"><div><div className="text-admin-xs text-admin-muted">{selected.internal_code ?? selected.package_id}</div><h2 className="mt-1 text-lg font-bold text-admin-text">{selected.name}</h2><div className="mt-1 text-admin-sm text-admin-muted">{selected.title} · {selected.destination ?? '목적지 미상'}</div></div><div className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800"><AlertTriangle size={13} /> {confidenceLabel[selected.confidence]}</div></div>
            <div className="grid gap-3 sm:grid-cols-3"><div className="rounded border border-admin-divider p-3"><div className="text-[11px] text-admin-muted">원문 저장</div><div className="mt-1 font-semibold text-admin-text">{selected.raw_text_present ? '있음' : '없음'}</div></div><div className="rounded border border-admin-divider p-3"><div className="text-[11px] text-admin-muted">해시</div><div className="mt-1 font-semibold text-admin-text">{selected.raw_text_hash_present ? '검증 가능' : '없음'}</div></div><div className="rounded border border-admin-divider p-3"><div className="text-[11px] text-admin-muted">원문명 일치</div><div className="mt-1 font-semibold text-admin-text">{selected.name_found_in_raw_text ? '일치' : '불일치'}</div></div></div>
            <div className="rounded-admin-sm border border-blue-200 bg-blue-50 p-3"><div className="flex items-center gap-2 text-admin-sm font-semibold text-blue-900"><FileText size={15} /> 원문 근거 문맥</div><p className="mt-2 whitespace-pre-wrap text-admin-sm leading-6 text-blue-950">{selected.context_excerpt ?? '옵션명이 원문과 정확히 일치하지 않습니다. 원문 전체를 직접 확인한 뒤 지역을 선택하세요.'}</p></div>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-admin-sm font-semibold text-admin-text-2">확정 지역<select value={region} onChange={event => setRegion(event.target.value)} className="mt-1 h-10 w-full rounded-admin-sm border border-admin-border-mid bg-admin-bg px-3 font-normal text-admin-text outline-none focus:border-brand"><option value="">지역 선택</option>{SOURCE_REGION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select></label><label className="text-admin-sm font-semibold text-admin-text-2">검수 메모<textarea value={note} onChange={event => setNote(event.target.value)} placeholder="원문에서 확인한 근거를 입력하세요" className="mt-1 min-h-10 w-full rounded-admin-sm border border-admin-border-mid bg-admin-bg px-3 py-2 font-normal text-admin-text outline-none focus:border-brand" /></label></div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-admin-divider pt-4"><button type="button" disabled={saving || !note.trim()} onClick={() => void submit('defer')} className="rounded-admin-sm border border-admin-border-mid px-3 py-2 text-admin-sm font-semibold text-admin-text-2 hover:bg-admin-surface-2 disabled:cursor-not-allowed disabled:opacity-50">검토 보류 기록</button><button type="button" disabled={saving || !region || !note.trim()} onClick={() => void submit('approve')} className="inline-flex items-center gap-2 rounded-admin-sm bg-brand px-3 py-2 text-admin-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50">{saving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} 지역 확정 저장</button></div>
            <p className="text-[11px] text-admin-muted">이 작업은 원문과 검수 메모만 기록하며, 상품 공개 상태는 변경하지 않습니다.</p>
          </div>}
        </section>
      </div>
    </div>
  );
}
