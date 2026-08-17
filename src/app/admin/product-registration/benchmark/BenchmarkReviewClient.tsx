'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileSearch, Plus, RefreshCw, Trash2 } from 'lucide-react';

import { EmptyState, PageHeader, SectionCard } from '@/components/admin/patterns';
import { fetchWithSessionRefresh } from '@/lib/fetch-with-session-refresh';
import type {
  BenchmarkCommercialFact,
  BenchmarkEvidenceAnchor,
  BenchmarkGroundTruthSection,
  BenchmarkItineraryDay,
  BenchmarkItineraryItem,
  BenchmarkPriceComponent,
  ReviewedBenchmarkAnnotation,
} from '@/lib/product-registration-v6/benchmark-ground-truth';
import type { ProductSourceDocumentClass } from '@/lib/product-registration-v6/document-classifier';

type SourceNode = {
  id: string;
  text?: string;
  order: number;
  page?: number;
  attributes?: { row?: number; column?: number };
};

type QueueItem = {
  corpus_source_id: string;
  source_document_id: string;
  corpus_version: string;
  source_hash: string;
  lineage_hash: string;
  input_kind: 'hwp' | 'text';
  split: 'development' | 'calibration' | 'frozen';
  supplier_key: string | null;
  document_family: string | null;
  original_filename: string;
  source_text: string;
  source_nodes: SourceNode[];
  reviewer_slot: 'first' | 'second' | 'adjudicator';
  reference_date: string | null;
};

type SectionDraft = {
  title: string;
  startNodeId: string;
  endNodeId: string;
  sourceSalePricePresent: boolean;
  destination: string;
  durationDays: string;
  nights: string;
  grade: string;
  hotelMode: 'fixed' | 'alternatives' | 'unconfirmed' | 'none';
  hotels: string;
  prices: string;
  dayCounts: string;
  itinerary: string;
  flights: string;
  inclusions: string;
  exclusions: string;
  cancellationCoverage: 'source' | 'approved_standard_fallback' | 'missing';
};

const INPUT = 'w-full rounded border border-admin-border-strong bg-white px-3 py-2 text-admin-sm text-admin-text focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const LABEL = 'block text-admin-xs font-semibold text-admin-text-2 mb-1';

function todaySeoul(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function blankSection(nodes: SourceNode[]): SectionDraft {
  const textNodes = nodes.filter(node => node.text?.trim());
  return {
    title: '',
    startNodeId: textNodes[0]?.id ?? '',
    endNodeId: textNodes.at(-1)?.id ?? '',
    sourceSalePricePresent: true,
    destination: '',
    durationDays: '',
    nights: '',
    grade: '',
    hotelMode: 'unconfirmed',
    hotels: '',
    prices: '',
    dayCounts: '',
    itinerary: '',
    flights: '',
    inclusions: '',
    exclusions: '',
    cancellationCoverage: 'approved_standard_fallback',
  };
}

function lines(value: string): string[] {
  return value.split(/\r?\n/u).map(item => item.trim()).filter(Boolean);
}

function numberOrNull(value: string): number | null {
  const normalized = value.replace(/[^0-9-]/gu, '');
  if (!normalized || normalized === '-') return null;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function nodeAnchor(item: QueueItem, nodeId: string, boundary: 'start' | 'end'): Promise<BenchmarkEvidenceAnchor> {
  const node = item.source_nodes.find(candidate => candidate.id === nodeId);
  if (!node?.text) throw new Error('상품의 시작과 끝 원문 줄을 선택해 주세요.');
  const firstOffset = item.source_text.indexOf(node.text);
  const startOffset = firstOffset >= 0 ? firstOffset : null;
  return {
    anchorId: node.id,
    quoteHash: await sha256(node.text),
    quote: node.text,
    page: node.page ?? null,
    row: Number.isInteger(node.attributes?.row) ? node.attributes?.row ?? null : null,
    column: Number.isInteger(node.attributes?.column) ? node.attributes?.column ?? null : null,
    startOffset,
    endOffset: startOffset == null ? null : startOffset + node.text.length + (boundary === 'end' ? 0 : 0),
  };
}

async function evidenceLineAnchor(item: QueueItem, lineNumberRaw: string | undefined, fallback: BenchmarkEvidenceAnchor): Promise<BenchmarkEvidenceAnchor> {
  const lineNumber = Number(lineNumberRaw);
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return fallback;
  const node = item.source_nodes.find(candidate => candidate.order + 1 === lineNumber && candidate.text?.trim());
  return node ? nodeAnchor(item, node.id, 'start') : fallback;
}

function valueAndEvidenceLine(value: string): { value: string; lineNumber?: string } {
  const parts = value.split('|').map(item => item.trim());
  const last = parts.at(-1);
  if (last && /^\d+$/u.test(last) && parts.length > 1) return { value: parts.slice(0, -1).join(' | '), lineNumber: last };
  return { value: value.trim() };
}

async function parseItinerary(item: QueueItem, value: string, fallback: BenchmarkEvidenceAnchor): Promise<BenchmarkItineraryDay[]> {
  const byDay = new Map<number, BenchmarkItineraryItem[]>();
  for (const row of lines(value)) {
    const parts = row.split('|').map(valuePart => valuePart.trim());
    const dayRaw = parts.shift();
    const orderRaw = parts.shift();
    const typeRaw = parts.shift() ?? '';
    const timeRaw = parts.shift();
    const lastPart = parts.at(-1);
    const evidenceLine = lastPart && /^\d+$/u.test(lastPart) ? parts.pop() : undefined;
    const textParts = parts;
    const day = Number(dayRaw);
    const order = Number(orderRaw);
    const allowed = new Set<BenchmarkItineraryItem['type']>(['flight', 'ferry', 'ground_transport', 'attraction', 'meal', 'lodging', 'shopping', 'optional_tour', 'free_time', 'meeting', 'note']);
    const type = allowed.has(typeRaw as BenchmarkItineraryItem['type']) ? typeRaw as BenchmarkItineraryItem['type'] : 'note';
    if (!Number.isInteger(day) || day < 1 || !Number.isInteger(order) || order < 1 || textParts.length === 0) continue;
    const items = byDay.get(day) ?? [];
    items.push({ order, type, time: timeRaw || null, text: textParts.join('|'), evidence: [await evidenceLineAnchor(item, evidenceLine, fallback)] });
    byDay.set(day, items);
  }
  return [...byDay.entries()].sort(([left], [right]) => left - right).map(([day, items]) => ({
    day,
    items: items.sort((left, right) => left.order - right.order).map((item, index) => ({ ...item, order: index + 1 })),
  }));
}

async function buildSection(item: QueueItem, draft: SectionDraft): Promise<BenchmarkGroundTruthSection> {
  const startAnchor = await nodeAnchor(item, draft.startNodeId, 'start');
  const endAnchor = await nodeAnchor(item, draft.endNodeId, 'end');
  const hotels = lines(draft.hotels);
  const flightCandidates = await Promise.all(lines(draft.flights).map(async row => {
    const [code, departureAirport, arrivalAirport, departureTime, arrivalTime, evidenceLine] = row.split('|').map(value => value.trim());
    return code ? { code, departureAirport: departureAirport || null, arrivalAirport: arrivalAirport || null, departureTime: departureTime || null, arrivalTime: arrivalTime || null, evidence: [await evidenceLineAnchor(item, evidenceLine, startAnchor)] } : null;
  }));
  const flights: BenchmarkGroundTruthSection['flights'] = [];
  for (const flight of flightCandidates) {
    if (flight) flights.push(flight);
  }
  const departurePrices: BenchmarkGroundTruthSection['departurePrices'] = [];
  const priceComponents: BenchmarkPriceComponent[] = [];
  for (const row of lines(draft.prices)) {
    const [date, saleRaw, listRaw, fuelRaw, currencyRaw, evidenceLine] = row.split('|').map(value => value.trim());
    const amount = numberOrNull(saleRaw ?? '');
    if (!date || amount == null) continue;
    const currency = currencyRaw || 'KRW';
    const listPrice = numberOrNull(listRaw ?? '');
    const fuelSurcharge = numberOrNull(fuelRaw ?? '');
    departurePrices.push({ date, amount, currency, listPrice, fuelSurcharge });
    const evidence = [await evidenceLineAnchor(item, evidenceLine, startAnchor)];
    priceComponents.push({ componentType: 'sale_price', amount, currency, chargeBasis: 'per_person', inclusion: 'included', scope: { kind: 'specific_departure', date }, evidence });
    if (listPrice != null) priceComponents.push({ componentType: 'list_price', amount: listPrice, currency, chargeBasis: 'per_person', inclusion: 'included', scope: { kind: 'specific_departure', date }, evidence });
    if (fuelSurcharge != null) priceComponents.push({ componentType: 'fuel_surcharge', amount: fuelSurcharge, currency, chargeBasis: 'per_person', inclusion: 'included', scope: { kind: 'specific_departure', date }, evidence });
  }
  const inclusionRows = lines(draft.inclusions).map(valueAndEvidenceLine);
  const exclusionRows = lines(draft.exclusions).map(valueAndEvidenceLine);
  const inclusions = inclusionRows.map(row => row.value);
  const exclusions = exclusionRows.map(row => row.value);
  const commercialFacts: BenchmarkCommercialFact[] = [
    ...await Promise.all(inclusionRows.map(async row => ({ kind: 'inclusion' as const, value: row.value, scope: 'product_variant' as const, evidence: [await evidenceLineAnchor(item, row.lineNumber, startAnchor)] }))),
    ...await Promise.all(exclusionRows.map(async row => ({ kind: 'exclusion' as const, value: row.value, scope: 'product_variant' as const, evidence: [await evidenceLineAnchor(item, row.lineNumber, startAnchor)] }))),
  ];
  return {
    title: draft.title || null,
    boundary: { startAnchor, endAnchor },
    productIdentity: {
      destination: draft.destination || null,
      durationDays: numberOrNull(draft.durationDays),
      nights: numberOrNull(draft.nights),
      grade: draft.grade || null,
      hotelMode: draft.hotelMode,
      hotels,
      flightCodes: flights.map(flight => flight.code),
    },
    sourceSalePricePresent: draft.sourceSalePricePresent,
    departurePrices: draft.sourceSalePricePresent ? departurePrices : [],
    priceComponents: draft.sourceSalePricePresent ? priceComponents : [],
    dayCounts: draft.dayCounts.split(',').map(value => Number(value.trim())).filter(value => Number.isInteger(value) && value > 0),
    itinerary: await parseItinerary(item, draft.itinerary, startAnchor),
    flights,
    hotels,
    hotelMode: draft.hotelMode,
    inclusions,
    exclusions,
    commercialFacts,
    cancellationPresent: draft.cancellationCoverage === 'source',
    cancellationCoverage: draft.cancellationCoverage,
  };
}

export function BenchmarkReviewClient() {
  const [tenantId, setTenantId] = useState('');
  const [items, setItems] = useState<QueueItem[]>([]);
  const [index, setIndex] = useState(0);
  const [sections, setSections] = useState<SectionDraft[]>([]);
  const [referenceDate, setReferenceDate] = useState(todaySeoul());
  const [sourceDepartureYear, setSourceDepartureYear] = useState('');
  const [expectedDocumentClass, setExpectedDocumentClass] = useState<ProductSourceDocumentClass>('travel_product');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = items[index] ?? null;

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithSessionRefresh('/api/admin/product-registration/benchmark/queue?limit=20', { cache: 'no-store' });
      const payload = await response.json() as { ok?: boolean; data?: { tenantId?: string; items?: QueueItem[] }; error?: { message?: string } };
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? '검수 대기열을 불러오지 못했습니다.');
      const nextItems = payload.data?.items ?? [];
      setTenantId(payload.data?.tenantId ?? '');
      setItems(nextItems);
      setIndex(0);
      setSections(nextItems[0] ? [blankSection(nextItems[0].source_nodes ?? [])] : []);
      setReferenceDate(nextItems[0]?.reference_date ?? todaySeoul());
      setExpectedDocumentClass('travel_product');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '검수 대기열을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  const moveTo = useCallback((nextIndex: number) => {
    const item = items[nextIndex];
    setIndex(nextIndex);
    setSections(item ? [blankSection(item.source_nodes ?? [])] : []);
    setReferenceDate(item?.reference_date ?? todaySeoul());
    setSourceDepartureYear('');
    setExpectedDocumentClass('travel_product');
    setMessage(null);
    setError(null);
  }, [items]);

  const sourceNodes = useMemo(() => (current?.source_nodes ?? []).filter(node => node.text?.trim()).sort((left, right) => left.order - right.order), [current]);

  const updateSection = (sectionIndex: number, patch: Partial<SectionDraft>) => {
    setSections(values => values.map((value, valueIndex) => valueIndex === sectionIndex ? { ...value, ...patch } : value));
  };

  const submit = async () => {
    if (!current) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const builtSections = await Promise.all(sections.map(draft => buildSection(current, draft)));
      const annotation: ReviewedBenchmarkAnnotation = {
        schemaVersion: 'product-registration-reviewed-benchmark-2',
        referenceDate,
        sourceDepartureYear: sourceDepartureYear ? Number(sourceDepartureYear) : null,
        expectedDocumentClass,
        sections: builtSections,
      };
      const endpoint = current.reviewer_slot === 'adjudicator'
        ? '/api/admin/product-registration/benchmark/adjudications'
        : '/api/admin/product-registration/benchmark/reviews';
      const response = await fetchWithSessionRefresh(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, corpusSourceId: current.corpus_source_id, reviewerSlot: current.reviewer_slot, annotation }),
      });
      const payload = await response.json() as { ok?: boolean; error?: { message?: string }; data?: { result?: { state?: string } } };
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? '검수 결과를 저장하지 못했습니다.');
      setMessage(payload.data?.result?.state === 'conflict' ? '두 검수 결과가 달라 제3자 조정 대기열로 이동했습니다.' : '검수 결과를 안전하게 저장했습니다.');
      const remaining = items.filter(item => item.corpus_source_id !== current.corpus_source_id);
      setItems(remaining);
      setIndex(0);
      setSections(remaining[0] ? [blankSection(remaining[0].source_nodes ?? [])] : []);
      setExpectedDocumentClass('travel_product');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '검수 결과를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="상품등록 정답지 검수"
        subtitle="엔진 답을 보지 않고 원문만 확인합니다. 서로 다른 두 관리자가 같은 결과를 제출해야 정확도 계산에 포함됩니다."
        breadcrumb={[{ label: '상품등록', href: '/admin/upload' }, { label: '정답지 검수' }]}
        actions={<button type="button" onClick={() => void loadQueue()} className="inline-flex items-center gap-2 rounded border border-admin-border-strong bg-white px-3 py-2 text-admin-sm" disabled={loading}><RefreshCw size={15} /> 새로고침</button>}
      />

      {error && <div role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-admin-sm text-red-700">{error}</div>}
      {message && <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-admin-sm text-emerald-700"><CheckCircle2 size={16} />{message}</div>}

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2"><div className="h-[600px] animate-pulse rounded bg-admin-border" /><div className="h-[600px] animate-pulse rounded bg-admin-border" /></div>
      ) : !current ? (
        <SectionCard><EmptyState icon={FileSearch} title="현재 검수할 원문이 없습니다" description="corpus 후보가 들어오면 이 화면에 자동으로 나타납니다." /></SectionCard>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)]">
          <SectionCard
            title={current.original_filename}
            description={`${current.input_kind.toUpperCase()} · ${current.split} · ${current.reviewer_slot === 'first' ? '1차 검수' : current.reviewer_slot === 'second' ? '2차 검수' : '불일치 조정'}`}
            className="xl:sticky xl:top-4 xl:self-start"
          >
            <div className="mb-3 flex items-center justify-between text-admin-xs text-admin-muted"><span>{index + 1} / {items.length}</span><span>{current.supplier_key ?? '공급사 미확인'}</span></div>
            <pre className="max-h-[68vh] overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-4 text-[12px] leading-6 text-slate-100">{current.source_text}</pre>
            <div className="mt-3 flex justify-between">
              <button type="button" onClick={() => moveTo(Math.max(0, index - 1))} disabled={index === 0} className="rounded border px-3 py-2 text-admin-sm disabled:opacity-40">이전 원문</button>
              <button type="button" onClick={() => moveTo(Math.min(items.length - 1, index + 1))} disabled={index >= items.length - 1} className="rounded border px-3 py-2 text-admin-sm disabled:opacity-40">다음 원문</button>
            </div>
          </SectionCard>

          <div className="space-y-4">
            <SectionCard title="검수 기준" description="업로드 기준일과 연도 없는 일정의 기준 연도입니다.">
              <div className="grid gap-3 sm:grid-cols-2">
                <label><span className={LABEL}>원문 종류</span><select value={expectedDocumentClass} onChange={event => {
                  const next = event.target.value as ProductSourceDocumentClass;
                  setExpectedDocumentClass(next);
                  if (next !== 'travel_product') {
                    setSections([{
                      ...blankSection(sourceNodes),
                      sourceSalePricePresent: false,
                      cancellationCoverage: 'missing',
                    }]);
                  }
                }} className={INPUT}><option value="travel_product">여행상품 원문</option><option value="non_travel">여행상품이 아닌 문서</option><option value="unsupported">지원하지 않는 문서</option><option value="corrupt">손상·판독 불가 문서</option></select></label>
                <label><span className={LABEL}>기준일</span><input type="date" value={referenceDate} onChange={event => setReferenceDate(event.target.value)} className={INPUT} /></label>
                <label><span className={LABEL}>원문 확인 연도 (선택)</span><input inputMode="numeric" value={sourceDepartureYear} onChange={event => setSourceDepartureYear(event.target.value)} placeholder="예: 2026" className={INPUT} /></label>
              </div>
            </SectionCard>

            {expectedDocumentClass !== 'travel_product' && (
              <SectionCard title="비상품 문서 확인" description="상품 revision을 만들지 않고 안전 종결합니다. 원문 전체의 시작·끝 줄만 아래 상품 1 영역에서 지정하면 됩니다.">
                <p className="text-admin-sm text-admin-muted">가격·일정·호텔 값은 입력하지 않으며, 아래 영역에는 원문 경계만 기록합니다.</p>
              </SectionCard>
            )}

            {sections.map((section, sectionIndex) => (
              <SectionCard
                key={sectionIndex}
                title={`상품 ${sectionIndex + 1}`}
                description="호텔·기간·등급이 다르면 상품을 추가해 각각 기록합니다."
                actions={sections.length > 1 ? <button type="button" onClick={() => setSections(values => values.filter((_, indexValue) => indexValue !== sectionIndex))} className="text-red-600" aria-label={`상품 ${sectionIndex + 1} 삭제`}><Trash2 size={16} /></button> : null}
              >
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label><span className={LABEL}>상품 시작 원문 줄</span><select value={section.startNodeId} onChange={event => updateSection(sectionIndex, { startNodeId: event.target.value })} className={INPUT}>{sourceNodes.map(node => <option key={node.id} value={node.id}>{node.order + 1}. {node.text?.slice(0, 70)}</option>)}</select></label>
                    <label><span className={LABEL}>상품 끝 원문 줄</span><select value={section.endNodeId} onChange={event => updateSection(sectionIndex, { endNodeId: event.target.value })} className={INPUT}>{sourceNodes.map(node => <option key={node.id} value={node.id}>{node.order + 1}. {node.text?.slice(0, 70)}</option>)}</select></label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label><span className={LABEL}>상품명</span><input value={section.title} onChange={event => updateSection(sectionIndex, { title: event.target.value })} className={INPUT} /></label>
                    <label><span className={LABEL}>목적지</span><input value={section.destination} onChange={event => updateSection(sectionIndex, { destination: event.target.value })} className={INPUT} /></label>
                    <label><span className={LABEL}>여행일수</span><input inputMode="numeric" value={section.durationDays} onChange={event => updateSection(sectionIndex, { durationDays: event.target.value })} placeholder="5" className={INPUT} /></label>
                    <label><span className={LABEL}>숙박일수</span><input inputMode="numeric" value={section.nights} onChange={event => updateSection(sectionIndex, { nights: event.target.value })} placeholder="3" className={INPUT} /></label>
                    <label><span className={LABEL}>숙박 상태</span><select value={section.hotelMode} onChange={event => updateSection(sectionIndex, { hotelMode: event.target.value as SectionDraft['hotelMode'] })} className={INPUT}><option value="fixed">호텔 확정</option><option value="alternatives">여러 예비호텔 중 한 곳</option><option value="unconfirmed">미정·동급 예정</option><option value="none">숙박 없음</option></select></label>
                    <label><span className={LABEL}>등급</span><input value={section.grade} onChange={event => updateSection(sectionIndex, { grade: event.target.value })} placeholder="예: 4성급" className={INPUT} /></label>
                  </div>
                  <label><span className={LABEL}>호텔 (한 줄에 한 곳)</span><textarea rows={3} value={section.hotels} onChange={event => updateSection(sectionIndex, { hotels: event.target.value })} className={INPUT} /></label>
                  <label className="flex items-center gap-2 text-admin-sm"><input type="checkbox" checked={section.sourceSalePricePresent} onChange={event => updateSection(sectionIndex, { sourceSalePricePresent: event.target.checked })} /> 원문에 실제 판매가가 있다</label>
                  {section.sourceSalePricePresent && <label><span className={LABEL}>날짜별 가격 — 날짜 | 판매가 | 정상가 | 유류할증료 | 통화 | 원문줄번호</span><textarea rows={4} value={section.prices} onChange={event => updateSection(sectionIndex, { prices: event.target.value })} placeholder={'2026-09-01 | 599000 | 839000 | 50000 | KRW | 24'} className={INPUT} /></label>}
                  <label><span className={LABEL}>DAY 수 (여러 variant는 쉼표)</span><input value={section.dayCounts} onChange={event => updateSection(sectionIndex, { dayCounts: event.target.value })} placeholder="5 또는 5,6" className={INPUT} /></label>
                  <label><span className={LABEL}>일정 순서 — 일차 | 순서 | 종류 | 시간 | 내용 | 원문줄번호</span><textarea rows={5} value={section.itinerary} onChange={event => updateSection(sectionIndex, { itinerary: event.target.value })} placeholder={'1 | 1 | flight | 19:00 | 부산 출발 | 52\n1 | 2 | ground_transport | | 호텔 이동 | 53'} className={INPUT} /></label>
                  <label><span className={LABEL}>항공 — 편명 | 출발공항 | 도착공항 | 출발시각 | 도착시각 | 원문줄번호</span><textarea rows={3} value={section.flights} onChange={event => updateSection(sectionIndex, { flights: event.target.value })} placeholder="BX321 | PUS | DAD | 19:00 | 22:00 | 18" className={INPUT} /></label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label><span className={LABEL}>포함 — 내용 | 원문줄번호</span><textarea rows={4} value={section.inclusions} onChange={event => updateSection(sectionIndex, { inclusions: event.target.value })} placeholder="왕복항공료 | 41" className={INPUT} /></label>
                    <label><span className={LABEL}>불포함 — 내용 | 원문줄번호</span><textarea rows={4} value={section.exclusions} onChange={event => updateSection(sectionIndex, { exclusions: event.target.value })} placeholder="가이드비 | 45" className={INPUT} /></label>
                  </div>
                  <label><span className={LABEL}>취소조건</span><select value={section.cancellationCoverage} onChange={event => updateSection(sectionIndex, { cancellationCoverage: event.target.value as SectionDraft['cancellationCoverage'] })} className={INPUT}><option value="source">원문에 있음</option><option value="approved_standard_fallback">원문에 없어 승인된 표준약관 적용</option><option value="missing">적용 약관 없음</option></select></label>
                </div>
              </SectionCard>
            ))}

            {expectedDocumentClass === 'travel_product' && <button type="button" onClick={() => setSections(values => [...values, blankSection(sourceNodes)])} className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-admin-border-strong bg-white px-4 py-3 text-admin-sm text-admin-text-2"><Plus size={16} /> 다른 호텔·기간 상품 추가</button>}
            <button type="button" onClick={() => void submit()} disabled={saving || sections.length === 0} className="w-full rounded bg-blue-600 px-4 py-3 text-admin-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? '검수 결과 저장 중…' : current.reviewer_slot === 'adjudicator' ? '제3자 조정 결과 저장' : `${current.reviewer_slot === 'first' ? '1차' : '2차'} 검수 결과 저장`}</button>
          </div>
        </div>
      )}
    </div>
  );
}
