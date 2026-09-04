'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSearch, RefreshCw, ShieldCheck } from 'lucide-react';

import { EmptyState, PageHeader, SectionCard } from '@/components/admin/patterns';
import { fetchWithSessionRefresh } from '@/lib/fetch-with-session-refresh';
import type {
  ProductReviewDecision,
  ProductReviewSlot,
  ReviewEvidenceRefV1,
  ReviewPacketV1,
  ReviewTargetV1,
} from '@/lib/product-registration-v6/human-review';

type ReviewQueueItem = {
  caseId: string;
  status: string;
  reviewerSlot: ProductReviewSlot;
  sourceDocumentId: string;
  jobId: string;
  sourceFilename: string;
  sourceHash: string;
  parentExtractionId: string;
  parentExtractionHash: string;
  packetHash: string;
  candidateAxisSetHash: string;
  reasonCodes: string[];
  packet: ReviewPacketV1;
  createdAt: string;
};

type SourceNode = {
  id: string;
  kind: string;
  text?: string;
  page?: number;
  order: number;
  attributes?: Record<string, unknown>;
};

type SourceTableCell = {
  id: string;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  nodeId: string;
  evidence?: { page?: number; quoteHash?: string };
};

type SourceTable = {
  id: string;
  page?: number;
  rows: number;
  columns: number;
  cells: SourceTableCell[];
};

type ReviewDetail = {
  caseId: string;
  status: string;
  reviewerSlot: ProductReviewSlot;
  sourceDocument: { id: string; filename: string; sourceType: string; sourceHash: string };
  parentExtraction: { id: string; extractionHash: string; parserEngine: string; parserVersion: string };
  sourceText: string;
  sourceNodes: SourceNode[];
  sourceTables: SourceTable[];
  packet: ReviewPacketV1;
  reasonCodes: string[];
  createdAt: string;
};

type SessionState = {
  sessionId: string;
  reviewerSlot: ProductReviewSlot;
  expiresAt: string;
};

const DECISIONS: Array<{ value: ProductReviewDecision; label: string; description: string }> = [
  { value: 'accept_auto_candidate', label: '자동 후보 그대로 채택', description: '후보 상품축과 값을 원문 근거 그대로 인정합니다.' },
  { value: 'select_axis', label: '상품축 선택', description: '값은 읽히지만 어느 상품·기간인지 골라야 합니다.' },
  { value: 'correct_value_with_evidence', label: '근거로 값 수정', description: '잘못 읽힌 값을 원문 셀 근거와 함께 고칩니다.' },
  { value: 'mark_source_insufficient', label: '원문 정보 부족', description: '판매에 필요한 사실이 원문에 없습니다.' },
  { value: 'mark_system_defect', label: '시스템 결함 격리', description: '파서·저장·렌더링 문제로 안전하게 격리합니다.' },
  { value: 'defer_need_more_context', label: '추가 문맥 필요', description: '현재 패킷만으로 판단하지 않고 조정 대기로 둡니다.' },
];

function slotLabel(slot: ProductReviewSlot): string {
  if (slot === 'first') return '1차 검수';
  if (slot === 'second') return '2차 독립검수';
  return '제3자 조정';
}

function statusLabel(status: string): string {
  if (status === 'adjudication_required') return '조정 대기';
  if (status === 'awaiting_second') return '2차 대기';
  if (status === 'in_review') return '검수 중';
  return '검수 대기';
}

function statusClass(status: string): string {
  if (status === 'adjudication_required') return 'bg-purple-50 text-purple-700 border-purple-200';
  if (status === 'in_review') return 'bg-blue-50 text-blue-700 border-blue-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

function errorMessage(payload: unknown, fallback: string): string {
  const value = payload as { error?: { message?: string } | string } | null;
  if (typeof value?.error === 'string') return value.error;
  if (value?.error && typeof value.error.message === 'string') return value.error.message;
  return fallback;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function targetCell(detail: ReviewDetail, target: ReviewTargetV1): { table: SourceTable; cell: SourceTableCell } | null {
  const address = target.cellAddress;
  if (!address) return null;
  for (const table of detail.sourceTables) {
    const cell = table.cells.find(candidate => candidate.row === address.row && candidate.column === address.col);
    if (cell) return { table, cell };
  }
  return null;
}

async function evidenceForTarget(detail: ReviewDetail, target: ReviewTargetV1): Promise<ReviewEvidenceRefV1> {
  const located = targetCell(detail, target);
  if (located) {
    const { table, cell } = located;
    return {
      evidenceId: target.sourceCellEvidenceId ?? cell.id,
      quoteHash: cell.evidence?.quoteHash ?? await sha256Hex(cell.text),
      tableKey: table.id,
      row: cell.row,
      col: cell.column,
      page: cell.evidence?.page ?? table.page ?? null,
      region: null,
    };
  }
  const node = detail.sourceNodes.find(candidate => candidate.text?.trim()) ?? null;
  const quote = node?.text?.trim() || target.candidateValues[0] || target.fieldKey;
  return {
    evidenceId: target.sourceCellEvidenceId ?? node?.id ?? target.targetId,
    quoteHash: await sha256Hex(quote),
    tableKey: null,
    row: null,
    col: null,
    page: node?.page ?? null,
    region: null,
  };
}

function SourceTablePreview({ table }: { table: SourceTable }) {
  if (table.cells.length === 0) return null;
  return (
    <div className="rounded border border-admin-border-mid bg-white p-3">
      <div className="mb-2 flex items-center justify-between text-admin-xs text-admin-muted">
        <span className="font-semibold">표 {table.id}</span>
        <span>{table.rows}행 · {table.columns}열{table.page != null ? ` · ${table.page + 1}쪽` : ''}</span>
      </div>
      <div className="grid gap-px overflow-hidden rounded bg-admin-border-mid" style={{ gridTemplateColumns: `repeat(${Math.max(table.columns, 1)}, minmax(0, 1fr))` }}>
        {table.cells.map(cell => (
          <div
            key={cell.id}
            className="min-h-9 bg-white p-2 text-[11px] leading-4 text-admin-text"
            style={{ gridColumn: `${cell.column + 1} / span ${Math.max(cell.colSpan, 1)}`, gridRow: `${cell.row + 1} / span ${Math.max(cell.rowSpan, 1)}` }}
          >
            <span className="mr-1 text-[9px] text-admin-muted-2">R{cell.row + 1}C{cell.column + 1}</span>{cell.text || '—'}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HumanReviewClient() {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [decision, setDecision] = useState<ProductReviewDecision>('accept_auto_candidate');
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [selectedAxisKey, setSelectedAxisKey] = useState('');
  const [correctedValue, setCorrectedValue] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const current = useMemo(() => items.find(item => item.caseId === selectedCaseId) ?? null, [items, selectedCaseId]);
  const selectedTarget = detail?.packet.targets.find(target => target.targetId === selectedTargetId) ?? detail?.packet.targets[0] ?? null;

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithSessionRefresh('/api/admin/product-registration/reviews/queue?limit=30', { cache: 'no-store' });
      const payload = await response.json() as { ok?: boolean; data?: { items?: ReviewQueueItem[] }; error?: unknown };
      if (!response.ok || !payload.ok) throw new Error(errorMessage(payload, '검수 대기열을 불러오지 못했습니다.'));
      const nextItems = payload.data?.items ?? [];
      setItems(nextItems);
      setSelectedCaseId(previous => previous && nextItems.some(item => item.caseId === previous) ? previous : nextItems[0]?.caseId ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '검수 대기열을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (caseId: string) => {
    setDetailLoading(true);
    setError(null);
    setMessage(null);
    setSession(null);
    setDecision('accept_auto_candidate');
    setSelectedTargetId('');
    setSelectedAxisKey('');
    setCorrectedValue('');
    setReason('');
    try {
      const response = await fetchWithSessionRefresh(`/api/admin/product-registration/reviews/${caseId}`, { cache: 'no-store' });
      const payload = await response.json() as { ok?: boolean; data?: ReviewDetail; error?: unknown };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(errorMessage(payload, '검수 원문을 불러오지 못했습니다.'));
      setDetail(payload.data);
      setSelectedTargetId(payload.data.packet.targets[0]?.targetId ?? '');
      setSelectedAxisKey(payload.data.packet.targets[0]?.candidateAxisKeys[0] ?? '');
    } catch (caught) {
      setDetail(null);
      setError(caught instanceof Error ? caught.message : '검수 원문을 불러오지 못했습니다.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { void loadQueue(); }, [loadQueue]);
  useEffect(() => {
    if (selectedCaseId) void loadDetail(selectedCaseId);
    else setDetail(null);
  }, [loadDetail, selectedCaseId]);

  const beginSession = async () => {
    if (!current || !detail || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetchWithSessionRefresh(`/api/admin/product-registration/reviews/${current.caseId}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerSlot: detail.reviewerSlot }),
      });
      const payload = await response.json() as { ok?: boolean; data?: SessionState; error?: unknown };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(errorMessage(payload, '검수 세션을 열지 못했습니다.'));
      setSession(payload.data);
      setMessage(`${slotLabel(detail.reviewerSlot)} 세션이 열렸습니다. 10분 안에 제출해 주세요.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '검수 세션을 열지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!current || !detail || !session || busy) return;
    if ((decision === 'accept_auto_candidate' || decision === 'select_axis') && !selectedAxisKey) {
      setError('검수할 상품축을 하나 선택해 주세요.');
      return;
    }
    if (decision === 'correct_value_with_evidence' && !correctedValue.trim()) {
      setError('수정할 값을 입력해 주세요.');
      return;
    }
    if (reason.trim().length < 5) {
      setError('판정 이유를 5자 이상 입력해 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const targets = detail.packet.targets;
      const evidence = [] as ReviewEvidenceRefV1[];
      for (const target of targets) {
        const ref = await evidenceForTarget(detail, target);
        if (!evidence.some(existing => existing.evidenceId === ref.evidenceId)) evidence.push(ref);
      }
      const firstTarget = selectedTarget ?? targets[0];
      const firstEvidence = evidence.find(ref => ref.evidenceId === firstTarget?.sourceCellEvidenceId) ?? evidence[0];
      const decisionPayload: Record<string, unknown> = {};
      if (decision === 'accept_auto_candidate' || decision === 'select_axis') decisionPayload.selectedAxisKey = selectedAxisKey;
      if (decision === 'correct_value_with_evidence') {
        decisionPayload.patches = [{
          fieldKey: firstTarget?.fieldKey ?? 'unknown',
          oldValue: firstTarget?.candidateValues[0] ?? '',
          newValue: correctedValue.trim(),
          sourceCellEvidenceId: firstEvidence?.evidenceId ?? firstTarget?.targetId ?? 'review-evidence',
        }];
        if (selectedAxisKey) decisionPayload.selectedAxisKey = selectedAxisKey;
      }
      const endpoint = detail.reviewerSlot === 'adjudicator'
        ? `/api/admin/product-registration/reviews/${current.caseId}/adjudicate`
        : `/api/admin/product-registration/reviews/${current.caseId}/receipt`;
      const response = await fetchWithSessionRefresh(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewerSessionId: session.sessionId,
          packetHash: detail.packet.packetHash,
          sourceHash: detail.packet.sourceHash,
          parentExtractionHash: detail.packet.parentExtractionHash,
          candidateAxisSetHash: detail.packet.candidateAxisSetHash,
          reviewerSlot: detail.reviewerSlot,
          decision,
          decisionPayload,
          evidence,
          reason: reason.trim(),
        }),
      });
      const payload = await response.json() as { ok?: boolean; data?: { status?: string }; error?: unknown };
      if (!response.ok || !payload.ok) throw new Error(errorMessage(payload, '검수 결과를 저장하지 못했습니다.'));
      setMessage(`검수 Receipt를 저장했습니다. 현재 상태: ${payload.data?.status ?? '처리 중'}`);
      setItems(previous => previous.filter(item => item.caseId !== current.caseId));
      setSelectedCaseId(null);
      setDetail(null);
      setSession(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '검수 결과를 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="V6 원문 검수"
        subtitle="원문과 셀 근거를 보고 독립적으로 판정합니다. 이 화면은 Revision·Snapshot·고객 공개를 직접 바꾸지 않습니다."
        breadcrumb={[{ label: '상품등록', href: '/admin/upload' }, { label: 'V6 원문 검수' }]}
        actions={<button type="button" onClick={() => void loadQueue()} disabled={loading} className="inline-flex items-center gap-2 rounded border border-admin-border-strong bg-white px-3 py-2 text-admin-sm"><RefreshCw size={15} /> 새로고침</button>}
      />

      <div className="flex items-start gap-3 rounded border border-blue-200 bg-blue-50 px-4 py-3 text-admin-sm text-blue-800">
        <ShieldCheck size={17} className="mt-0.5 shrink-0" />
        <p><b>안전 경계:</b> 검수 결과는 불변 Receipt로만 저장됩니다. 두 검수자가 일치하고 후속 재검증을 통과하기 전에는 고객 화면이 바뀌지 않습니다.</p>
      </div>
      {error && <div role="alert" className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-admin-sm text-red-700"><AlertTriangle size={17} className="mt-0.5 shrink-0" />{error}</div>}
      {message && <div role="status" className="flex items-start gap-2 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-admin-sm text-emerald-700"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />{message}</div>}

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_360px]"><div className="h-[680px] animate-pulse rounded bg-admin-border" /><div className="h-[680px] animate-pulse rounded bg-admin-border" /><div className="h-[680px] animate-pulse rounded bg-admin-border" /></div>
      ) : items.length === 0 ? (
        <SectionCard><EmptyState icon={FileSearch} title="현재 검수할 케이스가 없습니다" description="모호한 복구 대상이 생성되면 이 대기열에 표시됩니다." /></SectionCard>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)_360px]">
          <SectionCard title={`대기열 ${items.length}건`} description="본인이 처리한 케이스는 자동으로 숨겨집니다." flush className="lg:sticky lg:top-4">
            <div className="max-h-[75vh] overflow-y-auto">
              {items.map(item => (
                <button key={item.caseId} type="button" onClick={() => setSelectedCaseId(item.caseId)} className={`w-full border-b border-admin-border px-4 py-3 text-left last:border-b-0 ${item.caseId === selectedCaseId ? 'bg-blue-50' : 'bg-white hover:bg-admin-surface-2'}`}>
                  <div className="flex items-start justify-between gap-2"><span className="truncate text-admin-sm font-semibold text-admin-text">{item.sourceFilename}</span><span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusClass(item.status)}`}>{statusLabel(item.status)}</span></div>
                  <div className="mt-1 text-admin-xs text-admin-muted">{slotLabel(item.reviewerSlot)} · {item.reasonCodes?.join(', ') || '사유 확인 필요'}</div>
                  <div className="mt-1 truncate font-mono text-[10px] text-admin-muted-2">{item.caseId}</div>
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={detail?.sourceDocument.filename ?? current?.sourceFilename ?? '원문'} description={detail ? `${detail.sourceDocument.sourceType.toUpperCase()} · parser ${detail.parentExtraction.parserEngine} ${detail.parentExtraction.parserVersion}` : '케이스를 선택해 주세요'}>
            {detailLoading ? <div className="h-[620px] animate-pulse rounded bg-admin-border" /> : detail ? (
              <div className="space-y-4">
                <div className="grid gap-2 text-admin-xs text-admin-muted sm:grid-cols-2"><div>Source SHA <code className="break-all text-[10px]">{detail.sourceDocument.sourceHash}</code></div><div>Extraction SHA <code className="break-all text-[10px]">{detail.parentExtraction.extractionHash}</code></div></div>
                <div><h3 className="mb-2 text-admin-xs font-semibold text-admin-text-2">원문 텍스트</h3><pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-4 text-[12px] leading-6 text-slate-100">{detail.sourceText || '구조 추출 텍스트가 없습니다. 표 또는 이미지 근거를 확인하세요.'}</pre></div>
                {detail.sourceTables.length > 0 && <div className="space-y-3"><h3 className="text-admin-xs font-semibold text-admin-text-2">복원된 표 구조 ({detail.sourceTables.length})</h3>{detail.sourceTables.map(table => <SourceTablePreview key={table.id} table={table} />)}</div>}
                <p className="text-admin-xs text-admin-muted">문서 노드 {detail.sourceNodes.length}개 · 대상 {detail.packet.targets.length}개 · 렌더 정책은 패킷에 고정됨</p>
              </div>
            ) : <EmptyState icon={FileSearch} title="케이스를 선택해 주세요" description="왼쪽 대기열에서 검수할 원문을 선택합니다." />}
          </SectionCard>

          <SectionCard title="판정 및 Receipt" description={detail ? `${slotLabel(detail.reviewerSlot)} · 제출 전 다른 검수자의 판정은 보이지 않습니다.` : '원문을 선택하면 판정 폼이 열립니다.'}>
            {!detail ? <EmptyState icon={ShieldCheck} title="검수 대기" description="원문을 선택해 주세요." /> : (
              <div className="space-y-4">
                <div className="rounded border border-admin-border bg-admin-surface-2 px-3 py-2 text-admin-xs text-admin-muted">케이스 상태 <b className="text-admin-text">{statusLabel(detail.status)}</b> · 대상은 원문 셀과 상품축을 함께 확인해야 합니다.</div>
                <label className="block"><span className="mb-1 block text-admin-xs font-semibold text-admin-text-2">검수 대상</span><select value={selectedTargetId} onChange={event => { const next = detail.packet.targets.find(target => target.targetId === event.target.value); setSelectedTargetId(event.target.value); setSelectedAxisKey(next?.candidateAxisKeys[0] ?? ''); }} className="w-full rounded border border-admin-border-strong bg-white px-3 py-2 text-admin-sm"><option value="" disabled>대상 선택</option>{detail.packet.targets.map(target => <option key={target.targetId} value={target.targetId}>{target.fieldKey} · {target.reasonCodes.join(', ')}</option>)}</select></label>
                {selectedTarget && <div className="rounded border border-admin-border bg-white p-3"><div className="text-admin-xs font-semibold text-admin-text-2">자동 관측 후보</div><div className="mt-2 flex flex-wrap gap-1.5">{selectedTarget.candidateValues.length > 0 ? selectedTarget.candidateValues.map(value => <span key={value} className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">{value}</span>) : <span className="text-admin-xs text-admin-muted">값 없음</span>}</div><div className="mt-2 text-[10px] text-admin-muted">근거 정책: {selectedTarget.renderContextPolicy} {selectedTarget.cellAddress ? `· R${selectedTarget.cellAddress.row + 1}C${selectedTarget.cellAddress.col + 1}` : ''}</div></div>}
                {selectedTarget && selectedTarget.candidateAxisKeys.length > 0 && <label className="block"><span className="mb-1 block text-admin-xs font-semibold text-admin-text-2">상품축</span><select value={selectedAxisKey} onChange={event => setSelectedAxisKey(event.target.value)} className="w-full rounded border border-admin-border-strong bg-white px-3 py-2 text-admin-sm"><option value="">선택하지 않음</option>{selectedTarget.candidateAxisKeys.map(axis => <option key={axis} value={axis}>{axis}</option>)}</select></label>}
                <fieldset><legend className="mb-2 text-admin-xs font-semibold text-admin-text-2">판정</legend><div className="space-y-1.5">{DECISIONS.map(option => <label key={option.value} className={`flex cursor-pointer gap-2 rounded border px-3 py-2 ${decision === option.value ? 'border-blue-300 bg-blue-50' : 'border-admin-border bg-white'}`}><input type="radio" name="review-decision" value={option.value} checked={decision === option.value} onChange={() => setDecision(option.value)} className="mt-0.5" /><span><span className="block text-admin-xs font-semibold text-admin-text">{option.label}</span><span className="block text-[10px] leading-4 text-admin-muted">{option.description}</span></span></label>)}</div></fieldset>
                {decision === 'correct_value_with_evidence' && <label className="block"><span className="mb-1 block text-admin-xs font-semibold text-admin-text-2">수정 값</span><input value={correctedValue} onChange={event => setCorrectedValue(event.target.value)} placeholder="원문에서 확인한 정확한 값" className="w-full rounded border border-admin-border-strong bg-white px-3 py-2 text-admin-sm" /></label>}
                <label className="block"><span className="mb-1 block text-admin-xs font-semibold text-admin-text-2">판정 이유 (필수)</span><textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} placeholder="원문 셀과 상품축을 확인한 근거를 5자 이상 작성" className="w-full rounded border border-admin-border-strong bg-white px-3 py-2 text-admin-sm" /></label>
                {!session ? <button type="button" onClick={() => void beginSession()} disabled={busy} className="w-full rounded bg-slate-900 px-4 py-3 text-admin-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">{busy ? '세션 여는 중…' : `${slotLabel(detail.reviewerSlot)} 시작`}</button> : <div className="space-y-2"><div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">세션 활성 · {new Date(session.expiresAt).toLocaleTimeString('ko-KR')} 만료</div><button type="button" onClick={() => void submit()} disabled={busy} className="w-full rounded bg-blue-600 px-4 py-3 text-admin-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'Receipt 저장 중…' : detail.reviewerSlot === 'adjudicator' ? '조정 Receipt 제출' : '검수 Receipt 제출'}</button></div>}
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
