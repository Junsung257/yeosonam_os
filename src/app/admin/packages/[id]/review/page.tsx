/**
 * /admin/packages/[id]/review
 *
 * Per-field confidence review 페이지 — Pre-INSERT cross-validate gate 가
 * field_confidences 에 저장한 의심 필드를 카드 형식으로 노출.
 *
 * 사장님 워크플로우:
 *   1. 등록된 패키지의 의심 필드 (score < 0.7) 확인
 *   2. 원문 발췌 + AI 추론 vs 정답 비교
 *   3. 1클릭 "정답 입력" → PATCH /api/packages
 *   4. PATCH hook 이 자동으로 extractions_corrections 에 정정 적립 (Reflexion)
 *
 * → 다음 등록부터 동일 패턴 자동 회피
 */

'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import SensitiveRawText from '@/components/admin/SensitiveRawText';
import { buildStandardNoticeCustomerSavePayload } from '@/lib/product-registration-v3/admin-review';
import {
  buildStandardNoticeDraft,
  extractStandardNoticesFromRemarkLines,
  type StandardNoticeCategory,
  type StandardNoticeDraft,
  type StandardNoticeReviewStatus,
} from '@/lib/product-registration-v3/standard-notices';
import type { StructuredFact } from '@/lib/product-registration-v3/structured-facts';

interface FieldConfidence {
  score: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
}
interface FieldConfidences {
  overall_confidence: number;
  fields: Record<string, FieldConfidence>;
  recommendation: 'pass' | 'review' | 'reject';
  reasoning: string;
  validated_at: string;
  validator: string;
}
interface PackageData {
  id: string;
  short_code: string;
  title: string;
  destination: string;
  raw_text: string;
  field_confidences: FieldConfidences | null;
  audit_status: string;
  status: string;
  [key: string]: unknown;
}
interface QualityFailedCheck {
  id?: string;
  severity?: string | null;
  message?: string | null;
  passed?: boolean | null;
}
interface QualityCoverage {
  total: number;
  covered?: number;
  supported?: number;
  missing?: string[];
  ratio: number;
}
interface UnsupportedRenderClaim {
  id: string;
  value: string;
  surface: string;
  severity: string;
}
interface QualityData {
  audit_status: string | null;
  quality_log_created_at: string | null;
  confidence: number | null;
  failed_checks: QualityFailedCheck[];
  source_evidence_coverage: QualityCoverage | null;
  render_claim_coverage: (QualityCoverage & { unsupported: UnsupportedRenderClaim[] }) | null;
  publish_gate: {
    decision: 'allow' | 'force_required' | 'block';
    status: string;
    reasons: string[];
    warnings: string[];
  };
  v3_draft?: {
    id: string;
    status: 'ready_to_publish' | 'needs_review' | 'blocked' | null;
    created_at: string | null;
    standard_notices: StandardNoticeDraft[];
    structured_facts: StructuredFact[];
    blocks_approval: boolean;
    block_reasons: string[];
    gate_result?: unknown;
  } | null;
}

type ReviewNotice = {
  tone: 'success' | 'error';
  message: string;
};

const SEVERITY_BG: Record<string, string> = {
  critical: 'bg-red-50 border-red-300',
  high: 'bg-amber-50 border-amber-300',
  medium: 'bg-blue-50 border-blue-300',
  low: 'bg-admin-bg border-admin-border-mid',
};
const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-amber-100 text-amber-700 border-amber-200',
  medium: 'bg-blue-100 text-blue-700 border-blue-200',
  low: 'bg-admin-surface-2 text-admin-muted border-admin-border-mid',
};

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(0)}%`;
}

function QualityGatePanel({ quality }: { quality: QualityData }) {
  const gate = quality.publish_gate;
  const gateClass = gate.decision === 'block'
    ? 'bg-red-50 border-red-200 text-red-700'
    : gate.decision === 'force_required'
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-emerald-50 border-emerald-200 text-emerald-700';
  const gateLabel = gate.decision === 'block'
    ? 'BLOCK'
    : gate.decision === 'force_required'
      ? 'FORCE REQUIRED'
      : 'ALLOW';
  const sourceCoverage = quality.source_evidence_coverage;
  const renderCoverage = quality.render_claim_coverage;
  const failed = quality.failed_checks.filter(c => c?.passed === false);
  const unsupported = renderCoverage?.unsupported ?? [];

  return (
    <div className={`rounded-admin-md border p-4 mb-4 ${gateClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-mono font-bold tracking-wide">{gateLabel}</div>
          <div className="text-sm font-bold text-admin-text-2 mt-1">출판 게이트 / 원문 근거</div>
          <div className="text-xs text-admin-muted mt-1">
            audit={quality.audit_status ?? '-'} · AI={quality.confidence == null ? '-' : `${quality.confidence.toFixed(1)}%`}
            {quality.quality_log_created_at ? ` · ${new Date(quality.quality_log_created_at).toLocaleString('ko-KR')}` : ''}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right text-xs">
          <div className="bg-white/70 border border-current/20 rounded-admin-sm px-3 py-2">
            <div className="font-bold text-admin-text-2">{formatPercent(sourceCoverage?.ratio)}</div>
            <div className="text-admin-muted">source</div>
          </div>
          <div className="bg-white/70 border border-current/20 rounded-admin-sm px-3 py-2">
            <div className="font-bold text-admin-text-2">{formatPercent(renderCoverage?.ratio)}</div>
            <div className="text-admin-muted">render</div>
          </div>
        </div>
      </div>

      {(gate.reasons.length > 0 || gate.warnings.length > 0) && (
        <div className="mt-3 space-y-1.5">
          {[...gate.reasons, ...gate.warnings].slice(0, 8).map((reason, idx) => (
            <div key={idx} className="text-xs bg-white/70 border border-current/20 rounded-admin-sm px-2 py-1.5 text-admin-text-2">
              {reason}
            </div>
          ))}
        </div>
      )}

      {(failed.length > 0 || unsupported.length > 0 || (sourceCoverage?.missing?.length ?? 0) > 0) && (
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <div className="bg-white/70 border border-current/20 rounded-admin-sm p-2">
            <div className="text-[10px] font-bold text-admin-muted mb-1">QUALITY FAIL</div>
            {failed.length === 0 ? (
              <div className="text-xs text-admin-muted">none</div>
            ) : failed.slice(0, 6).map((check, idx) => (
              <div key={idx} className="text-[11px] text-admin-text-2 truncate">
                {check.severity ?? 'high'} · {check.message ?? check.id ?? 'failed_check'}
              </div>
            ))}
          </div>
          <div className="bg-white/70 border border-current/20 rounded-admin-sm p-2">
            <div className="text-[10px] font-bold text-admin-muted mb-1">SOURCE MISSING</div>
            {(sourceCoverage?.missing?.length ?? 0) === 0 ? (
              <div className="text-xs text-admin-muted">none</div>
            ) : sourceCoverage?.missing?.slice(0, 6).map(field => (
              <div key={field} className="text-[11px] text-admin-text-2 truncate">{field}</div>
            ))}
          </div>
          <div className="bg-white/70 border border-current/20 rounded-admin-sm p-2">
            <div className="text-[10px] font-bold text-admin-muted mb-1">RENDER UNSUPPORTED</div>
            {unsupported.length === 0 ? (
              <div className="text-xs text-admin-muted">none</div>
            ) : unsupported.slice(0, 6).map(claim => (
              <div key={`${claim.id}:${claim.value}`} className="text-[11px] text-admin-text-2 truncate">
                {claim.surface} · {claim.value}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  // 'inclusions[2]' / 'itinerary_data.days[1].schedule[2].activity'
  const tokens = path.match(/[^.[\]]+/g) || [];
  let cur: unknown = obj;
  for (const t of tokens) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(t);
      cur = isNaN(idx) ? undefined : cur[idx];
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[t];
    } else {
      return undefined;
    }
  }
  return cur;
}

interface HotelSearchResult {
  id: string;
  name: string;
  short_desc: string | null;
  region: string | null;
  country: string | null;
  photo: string | null;
  aliases: string[];
}

const STANDARD_NOTICE_CATEGORIES: StandardNoticeCategory[] = [
  'single_room_surcharge',
  'passport_validity',
  'local_law_restriction',
  'room_assignment',
  'itinerary_change',
  'tip_guideline',
  'group_schedule_penalty',
  'restaurant_access',
  'local_guide_operation',
];

const STANDARD_NOTICE_VISIBILITIES: StandardNoticeDraft['visibility'][] = [
  'customer_visible',
  'internal_only',
  'hidden_by_default',
];

const STANDARD_NOTICE_REVIEW_STATUSES: StandardNoticeReviewStatus[] = [
  'auto_clean',
  'review_needed',
  'manual_approved',
  'rejected',
];

function noticeReviewKey(row: StandardNoticeDraft, index: number): string {
  const line = row.evidence[0]?.line_start ?? index;
  return `${line}:${row.category}:${row.source_text.slice(0, 80)}`;
}

type NoticeEdit = {
  category?: StandardNoticeCategory;
  valuesText?: string;
  visibility?: StandardNoticeDraft['visibility'];
  review_status?: StandardNoticeReviewStatus;
};

export default function PackageReviewPage() {
  const params = useParams();
  const packageId = String(params?.id || '');
  const [pkg, setPkg] = useState<PackageData | null>(null);
  const [quality, setQuality] = useState<QualityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [noticeEdits, setNoticeEdits] = useState<Record<string, NoticeEdit>>({});
  const [noticeSaving, setNoticeSaving] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [reviewNotice, setReviewNotice] = useState<ReviewNotice | null>(null);
  // N4 박제 (2026-05-16 트립박스 표준): 호텔 마스터 검색 inline
  const [hotelSearchQ, setHotelSearchQ] = useState<string>('');
  const [hotelResults, setHotelResults] = useState<HotelSearchResult[]>([]);
  const [hotelSearchOpen, setHotelSearchOpen] = useState<string | null>(null); // fieldPath of which day's hotel

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, qualityRes] = await Promise.all([
        fetch(`/api/packages?id=${packageId}`),
        fetch(`/api/admin/packages/${packageId}/quality`),
      ]);
      const [json, qualityJson] = await Promise.all([
        res.json(),
        qualityRes.ok ? qualityRes.json() : Promise.resolve(null),
      ]);
      const data: PackageData | null = json.package || json.data || (Array.isArray(json.packages) ? json.packages[0] : null);
      setPkg(data);
      setQuality(qualityJson?.quality ?? null);
    } finally {
      setLoading(false);
    }
  }, [packageId]);

  useEffect(() => { if (packageId) load(); }, [packageId, load]);

  // N4 박제: 호텔 마스터 검색 (트립박스 표준)
  const searchHotels = useCallback(async (q: string, region?: string) => {
    if (q.length < 1 && !region) { setHotelResults([]); return; }
    try {
      const url = `/api/admin/attractions/search-hotel?q=${encodeURIComponent(q)}${region ? `&region=${encodeURIComponent(region)}` : ''}&limit=10`;
      const res = await fetch(url);
      const data = await res.json();
      setHotelResults(data.hotels ?? []);
    } catch { setHotelResults([]); }
  }, []);

  const applyHotel = useCallback(async (dayFieldPath: string, hotel: HotelSearchResult) => {
    if (!pkg) return;
    // dayFieldPath 예: "itinerary_data.days[0].hotel"
    const rootKey = 'itinerary_data';
    const rootVal = JSON.parse(JSON.stringify((pkg as Record<string, unknown>)[rootKey] ?? { days: [] }));
    const m = dayFieldPath.match(/days\[(\d+)\]/);
    if (!m) return;
    const idx = Number(m[1]);
    if (!Array.isArray(rootVal.days) || !rootVal.days[idx]) return;
    rootVal.days[idx].hotel = { name: hotel.name, grade: rootVal.days[idx].hotel?.grade ?? null };
    setSaving(true);
    try {
      const res = await fetch('/api/packages', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkg.id, [rootKey]: rootVal }),
      });
      const data = await res.json();
      if (!res.ok) { setReviewNotice({ tone: 'error', message: data.error || '저장 실패' }); return; }
      setReviewNotice({ tone: 'success', message: `호텔 적용 완료: ${hotel.name}` });
      setHotelSearchOpen(null);
      load();
    } finally { setSaving(false); }
  }, [pkg, load]);

  const startEdit = (fieldPath: string) => {
    if (!pkg) return;
    const current = getNestedValue(pkg, fieldPath);
    setEditingField(fieldPath);
    setEditValue(typeof current === 'string' ? current : JSON.stringify(current, null, 2));
  };

  const saveEdit = async (fieldPath: string) => {
    if (!pkg) return;
    setSaving(true);
    try {
      // 단순 top-level 필드만 직접 PATCH 지원. 중첩 필드는 전체 객체 PATCH.
      const tokens = fieldPath.match(/[^.[\]]+/g) || [];
      let parsedValue: unknown = editValue;
      try {
        if (editValue.trim().startsWith('{') || editValue.trim().startsWith('[')) {
          parsedValue = JSON.parse(editValue);
        }
      } catch { /* string 그대로 */ }

      let payload: Record<string, unknown>;
      const firstToken = tokens[0];
      if (!firstToken) throw new Error('field_path 파싱 실패');
      if (tokens.length === 1) {
        payload = { packageId: pkg.id, [firstToken]: parsedValue };
      } else {
        // 중첩 필드 — 전체 root 필드를 다시 보내야 함 (PATCH 가 sanitized 화이트리스트 사용)
        const rootKey: string = firstToken;
        const rootVal = JSON.parse(JSON.stringify((pkg as Record<string, unknown>)[rootKey]));
        // 중첩 경로에 값 설정
        let cur: unknown = rootVal;
        for (let i = 1; i < tokens.length - 1; i++) {
          const t = tokens[i];
          if (typeof t !== 'string') break;
          const idx = Number(t);
          if (Array.isArray(cur)) cur = cur[idx];
          else if (typeof cur === 'object' && cur !== null) cur = (cur as Record<string, unknown>)[t];
          else throw new Error('경로 탐색 실패');
        }
        const lastToken = tokens[tokens.length - 1];
        if (typeof lastToken === 'string') {
          if (Array.isArray(cur)) {
            const idx = Number(lastToken);
            if (!isNaN(idx)) (cur as unknown[])[idx] = parsedValue;
          } else if (typeof cur === 'object' && cur !== null) {
            (cur as Record<string, unknown>)[lastToken] = parsedValue;
          }
        }
        payload = { packageId: pkg.id, [rootKey]: rootVal };
      }

      const res = await fetch('/api/packages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setReviewNotice({ tone: 'error', message: `저장 실패: ${json.error || 'unknown'}` });
        return;
      }
      // 자동으로 extractions_corrections 에 정정 적립됨 (PATCH hook)
      setReviewNotice({ tone: 'success', message: '정정 저장 완료. Reflexion 메모리에 자동 적립됨 (다음 등록부터 자동 회피).' });
      setEditingField(null);
      load();
    } catch (e) {
      setReviewNotice({ tone: 'error', message: `오류: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  const updateNoticeEdit = (key: string, patch: NoticeEdit) => {
    setNoticeEdits(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), ...patch },
    }));
    setNoticeMessage(null);
  };

  const saveStandardNotices = async (rows: Array<StandardNoticeDraft & { review_key: string; values_valid: boolean }>) => {
    if (!pkg) return;
    const built = buildStandardNoticeCustomerSavePayload(pkg.id, rows);
    if (!built.ok) {
      setNoticeMessage(built.error);
      return;
    }
    setNoticeSaving(true);
    try {
      const res = await fetch(`/api/admin/packages/${pkg.id}/standard-notices`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNoticeMessage(json.error || '표준 유의사항 저장에 실패했습니다.');
        return;
      }
      setNoticeMessage(`표준 유의사항 ${built.payload.saved_count}건을 고객 노출 필드에 저장했습니다. 검수 필요/숨김 ${built.payload.skipped_count}건은 제외했습니다.`);
      setNoticeEdits({});
      load();
    } finally {
      setNoticeSaving(false);
    }
  };

  if (loading) return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="h-6 bg-admin-surface-2 rounded animate-pulse w-48" />
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-3.5 bg-admin-surface-2 rounded animate-pulse" style={{ width: `${90 - i * 5}%` }} />
        ))}
      </div>
    </div>
  );
  if (!pkg) return <div className="p-6 text-admin-muted-2">패키지를 찾을 수 없습니다.</div>;

  const fc = pkg.field_confidences;
  const suspiciousEntries = fc?.fields ? Object.entries(fc.fields).sort(([, a], [, b]) => a.score - b.score) : [];

  // N2+N3 박제 (2026-05-16 트립박스/Travefy 표준): 누락 필드 강제 표시.
  //   field_confidences 의심 점수 없어도 핵심 필드 null/0 면 사장님 1-click 보완 필요.
  const missingFieldEntries: Array<[string, FieldConfidence]> = [];
  const addMissing = (path: string, reason: string, severity: 'critical' | 'high' = 'high') => {
    if (suspiciousEntries.some(([p]) => p === path)) return;
    missingFieldEntries.push([path, { score: 0, severity, reason }]);
  };
  if (!pkg.airline) addMissing('airline', '항공사 누락 — 트립박스 표준: 편명 prefix 로 추론 (SC→산동항공, LJ→진에어 등)', 'critical');
  if (!pkg.departure_airport) addMissing('departure_airport', '출발 공항 누락 — 모바일 hero 카드에 표시 필요', 'high');
  const itin = (pkg as { itinerary_data?: { days?: unknown[]; meta?: Record<string, unknown> } }).itinerary_data;
  if (!itin?.days || !Array.isArray(itin.days) || itin.days.length === 0) {
    addMissing('itinerary_data', '일정표 누락 — Phase 2 LLM 추출 실패. day-table deterministic 폴백도 실패한 경우. 사장님이 일차별 JSON 직접 입력 필요', 'critical');
  } else {
    if (!itin.meta || !(itin.meta as { flight_out?: string }).flight_out) {
      addMissing('itinerary_data.meta', 'meta.flight_out / flight_in 누락 — 항공편 카드 표시 안 됨', 'high');
    }
    for (let i = 0; i < itin.days.length; i++) {
      const d = itin.days[i] as { hotel?: { name?: string }; schedule?: unknown[] };
      if (i < itin.days.length - 1 && !d.hotel?.name) {
        addMissing(`itinerary_data.days[${i}].hotel`, `DAY ${i + 1} 호텔명 누락 — 마지막 day 제외 모든 day 호텔 필수 (트립박스 표준)`, 'high');
      }
      if (!d.schedule || (d.schedule as unknown[]).length === 0) {
        addMissing(`itinerary_data.days[${i}].schedule`, `DAY ${i + 1} schedule 비어있음`, 'high');
      }
    }
  }
  const overallConf = fc?.overall_confidence ?? null;
  const overallColor = overallConf == null ? 'text-admin-muted'
    : overallConf >= 0.85 ? 'text-emerald-600'
    : overallConf >= 0.7 ? 'text-amber-600'
    : 'text-red-600';
  const detectedNoticeRows = extractStandardNoticesFromRemarkLines(
    (pkg.raw_text ?? '')
      .split(/\r?\n/)
      .map((line, idx) => ({
        text: String(line || '').trim(),
        evidence: {
          line_start: idx + 1,
          line_end: idx + 1,
          char_start: 0,
          char_end: String(line || '').length,
          quote: String(line || '').trim(),
        },
      }))
      .filter(item => item.text.length > 4),
  );
  const v3DraftNoticeRows = Array.isArray(quality?.v3_draft?.standard_notices)
    ? quality.v3_draft.standard_notices
    : [];
  const structuredFactRows = Array.isArray(quality?.v3_draft?.structured_facts)
    ? quality.v3_draft.structured_facts
    : [];
  const reviewSourceNoticeRows = v3DraftNoticeRows.length > 0 ? v3DraftNoticeRows : detectedNoticeRows;
  const noticeRows = reviewSourceNoticeRows.map((row, idx) => {
    const review_key = noticeReviewKey(row, idx);
    const edit = noticeEdits[review_key] ?? {};
    const valuesText = edit.valuesText ?? JSON.stringify(row.values, null, 2);
    let values = row.values;
    let values_valid = true;
    try {
      values = JSON.parse(valuesText) as Record<string, string | number | boolean | null>;
    } catch {
      values_valid = false;
    }
    const rebuilt = values_valid
      ? buildStandardNoticeDraft({
        source_text: row.source_text,
        category: edit.category ?? row.category,
        values,
        evidence: row.evidence,
        visibility: edit.visibility ?? row.visibility,
        review_status: edit.review_status ?? row.review_status,
      })
      : null;
    return {
      ...(rebuilt ?? row),
      review_key,
      values_text: valuesText,
      values_valid,
    };
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-admin-text-2">🔍 Per-field 검토</h1>
          <p className="text-sm text-admin-muted mt-1">
            {pkg.short_code} · {pkg.title}
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/admin/packages?id=${pkg.id}`}
            className="px-3 py-1.5 bg-admin-surface-2 text-admin-text-2 text-sm rounded-lg hover:bg-slate-200">← 어드민</a>
          <a href={`/packages/${pkg.id}`} target="_blank" rel="noopener"
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">고객 페이지 ↗</a>
        </div>
      </div>

      {reviewNotice && (
        <div
          role={reviewNotice.tone === 'error' ? 'alert' : 'status'}
          aria-live={reviewNotice.tone === 'error' ? 'assertive' : 'polite'}
          className={`mb-4 rounded-admin-md border px-4 py-3 text-admin-sm ${
            reviewNotice.tone === 'error'
              ? 'border-status-dangerBorder bg-status-dangerBg text-status-dangerFg'
              : 'border-status-successBorder bg-status-successBg text-status-successFg'
          }`}
        >
          {reviewNotice.message}
        </div>
      )}

      {/* 종합 정보 */}
      <div className={`rounded-admin-md border p-4 mb-4 ${overallConf == null ? 'bg-admin-bg border-admin-border-mid' : overallConf < 0.7 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
        {fc ? (
          <>
            <div className="flex items-center gap-3">
              <span className={`text-3xl font-bold ${overallColor}`}>
                {(overallConf! * 100).toFixed(0)}%
              </span>
              <div className="flex-1">
                <div className="text-sm font-bold text-admin-text-2">
                  종합 신뢰도 — {fc.recommendation === 'pass' ? '✅ 양호' : fc.recommendation === 'review' ? '⚠️ 검토 필요' : '🚨 차단 권장'}
                </div>
                <div className="text-xs text-admin-muted mt-0.5">
                  {fc.validator} · {new Date(fc.validated_at).toLocaleString('ko-KR')}
                </div>
              </div>
            </div>
            {fc.reasoning && <p className="text-sm text-admin-muted mt-2 italic">"{fc.reasoning}"</p>}
          </>
        ) : (
          <p className="text-sm text-admin-muted">field_confidences 미저장 — Pre-INSERT gate 가 호출되지 않은 패키지 (구버전 등록 또는 SKIP_PRE_INSERT_GATE=1)</p>
        )}
      </div>

      {/* N2+N3 박제: 누락 필드 강제 표시 (트립박스/Travefy 표준 inline 보완) */}
      {quality && <QualityGatePanel quality={quality} />}

      {missingFieldEntries.length > 0 && (
        <div className="space-y-3 mb-4">
          <h2 className="text-sm font-bold text-red-700">🚨 누락 필드 ({missingFieldEntries.length}건) — 사장님 1-click 보완 필요 (트립박스/Travefy 표준)</h2>
          {missingFieldEntries.map(([fieldPath, info]) => {
            const isEditing = editingField === fieldPath;
            return (
              <div key={fieldPath} className={`rounded-admin-md border-2 p-4 ${SEVERITY_BG[info.severity]}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 text-[10px] font-mono rounded border ${SEVERITY_BADGE[info.severity]}`}>
                        {info.severity.toUpperCase()}
                      </span>
                      <span className="text-xs font-mono font-bold text-admin-text-2">{fieldPath}</span>
                      <span className="text-xs text-red-600 font-bold">⚠ 누락</span>
                    </div>
                    <p className="text-xs text-admin-text-2 mt-1.5">💡 <span className="italic">{info.reason}</span></p>
                  </div>
                  {!isEditing && (
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <button onClick={() => startEdit(fieldPath)}
                        className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 font-medium">
                        ✏️ 직접 입력
                      </button>
                      {/* N4 박제: hotel 필드 면 마스터 검색 버튼 */}
                      {fieldPath.endsWith('.hotel') && (
                        <button
                          onClick={() => {
                            setHotelSearchOpen(fieldPath);
                            setHotelSearchQ(pkg?.destination ?? '');
                            void searchHotels(pkg?.destination ?? '', pkg?.destination ?? '');
                          }}
                          className="px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 font-medium"
                          title="attractions 마스터에서 호텔 검색"
                        >🏨 마스터 검색</button>
                      )}
                    </div>
                  )}
                </div>
                {/* N4 박제: 호텔 검색 결과 패널 */}
                {hotelSearchOpen === fieldPath && (
                  <div className="mt-3 pt-3 border-t border-admin-border-mid">
                    <div className="flex gap-2 mb-2">
                      <input
                        value={hotelSearchQ}
                        onChange={e => setHotelSearchQ(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') searchHotels(hotelSearchQ, pkg?.destination ?? ''); }}
                        className="flex-1 text-xs border rounded-lg px-3 py-1.5"
                        placeholder="호텔명 또는 지역 (예: 하이탠 / 칭다오)"
                      />
                      <button onClick={() => searchHotels(hotelSearchQ, pkg?.destination ?? '')}
                        className="px-3 py-1 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700">검색</button>
                      <button onClick={() => setHotelSearchOpen(null)}
                        className="px-3 py-1 bg-admin-surface-2 text-admin-muted text-xs rounded-lg hover:bg-slate-200">닫기</button>
                    </div>
                    {hotelResults.length > 0 ? (
                      <div className="space-y-1.5 max-h-64 overflow-y-auto">
                        {hotelResults.map(h => (
                          <button
                            key={h.id}
                            onClick={() => applyHotel(fieldPath, h)}
                            disabled={saving}
                            className="w-full flex items-center gap-2 p-2 bg-white border border-emerald-200 rounded-lg hover:bg-emerald-50 text-left disabled:opacity-50"
                          >
                            {h.photo && <img src={h.photo} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-bold text-admin-text-2 truncate">{h.name}</div>
                              {h.region && <div className="text-[11px] text-admin-muted">📍 {h.region} · {h.country}</div>}
                              {h.short_desc && <div className="text-[10px] text-admin-muted-2 truncate">{h.short_desc}</div>}
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-admin-muted-2">검색 결과 없음 — 다른 키워드 시도</p>
                    )}
                  </div>
                )}
                {isEditing && (
                  <div className="mt-3 pt-3 border-t border-admin-border-mid">
                    <div className="text-[10px] text-blue-600 font-bold mb-1.5">✅ 값 입력 (텍스트 또는 JSON)</div>
                    <textarea
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      className="w-full text-xs border border-blue-300 rounded-lg px-3 py-2 font-mono min-h-[80px] focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      placeholder={fieldPath === 'airline' ? '예: 산동항공 (SC)' : fieldPath === 'departure_airport' ? '예: 인천' : 'JSON 또는 텍스트'}
                      aria-label={`${fieldPath} 추가 입력`}
                    />
                    <div className="flex gap-2 mt-2 items-center">
                      <button onClick={() => saveEdit(fieldPath)} disabled={saving}
                        className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
                        {saving ? '저장 중...' : '저장 + Reflexion 적립'}
                      </button>
                      <button onClick={() => setEditingField(null)}
                        className="px-3 py-1.5 bg-admin-surface-2 text-admin-muted text-xs rounded-lg hover:bg-slate-200">취소</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 의심 필드 목록 */}
      {suspiciousEntries.length === 0 && missingFieldEntries.length === 0 ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-admin-md p-6 text-center">
          <p className="text-emerald-700 font-bold">🎉 의심 필드 없음</p>
          <p className="text-xs text-emerald-600 mt-1">모든 필드가 cross-validator 통과. 추가 검토 불필요.</p>
        </div>
      ) : suspiciousEntries.length === 0 ? null : (
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-admin-text-2">⚠️ 의심 필드 ({suspiciousEntries.length}건) — 점수 낮은 순</h2>
          {suspiciousEntries.map(([fieldPath, info]) => {
            const currentValue = getNestedValue(pkg, fieldPath);
            const isEditing = editingField === fieldPath;
            return (
              <div key={fieldPath} className={`rounded-admin-md border-2 p-4 ${SEVERITY_BG[info.severity]}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 text-[10px] font-mono rounded border ${SEVERITY_BADGE[info.severity]}`}>
                        {info.severity.toUpperCase()}
                      </span>
                      <span className="text-xs font-mono font-bold text-admin-text-2">{fieldPath}</span>
                      <span className="text-xs text-admin-muted">신뢰도 <span className="font-bold text-red-600">{(info.score * 100).toFixed(0)}%</span></span>
                    </div>
                    <p className="text-xs text-admin-text-2 mt-1.5">💡 <span className="italic">{info.reason}</span></p>

                    <div className="mt-3 grid gap-2">
                      <div className="bg-white rounded border border-admin-border-mid p-2.5">
                        <div className="text-[10px] text-admin-muted font-bold mb-1">현재 값 (AI 추출)</div>
                        <pre className="text-xs text-admin-text-2 whitespace-pre-wrap break-words font-mono">
                          {typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                  {!isEditing && (
                    <button onClick={() => startEdit(fieldPath)}
                      className="flex-shrink-0 px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 font-medium">
                      ✏️ 정답 입력
                    </button>
                  )}
                </div>

                {isEditing && (
                  <div className="mt-3 pt-3 border-t border-admin-border-mid">
                    <div className="text-[10px] text-emerald-600 font-bold mb-1.5">✅ 정답 값 (사장님 정정)</div>
                    <textarea
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      className="w-full text-xs border border-emerald-300 rounded-lg px-3 py-2 font-mono min-h-[80px] focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                      aria-label={`${fieldPath} 정답 값`}
                    />
                    <div className="flex gap-2 mt-2 items-center">
                      <button onClick={() => saveEdit(fieldPath)}
                        disabled={saving}
                        className="px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                        {saving ? '저장 중...' : '저장 + Reflexion 적립'}
                      </button>
                      <button onClick={() => setEditingField(null)}
                        className="px-3 py-1.5 bg-admin-surface-2 text-admin-muted text-xs rounded-lg hover:bg-slate-200">취소</button>
                      <span className="text-[10px] text-admin-muted ml-auto">
                        저장 시 PATCH /api/packages → extractions_corrections 자동 적립 → 다음 등록부터 자동 회피
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {structuredFactRows.length > 0 && (
        <div className="mt-6 bg-admin-bg border border-admin-border-mid rounded-admin-md p-4 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h3 className="text-sm font-bold text-admin-text-2">정형 키워드 추출 테이블</h3>
            <div className="text-[11px] text-admin-muted">원문 evidence → 카테고리/값 → 여소남 표준문구</div>
          </div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-admin-surface-2">
                <th className="border border-admin-border-mid p-2 text-left">원문</th>
                <th className="border border-admin-border-mid p-2 text-left">카테고리</th>
                <th className="border border-admin-border-mid p-2 text-left">추출값</th>
                <th className="border border-admin-border-mid p-2 text-left">여소남 표준문구</th>
                <th className="border border-admin-border-mid p-2 text-left">Evidence</th>
                <th className="border border-admin-border-mid p-2 text-left">노출여부</th>
                <th className="border border-admin-border-mid p-2 text-left">Risk</th>
                <th className="border border-admin-border-mid p-2 text-left">검수상태</th>
              </tr>
            </thead>
            <tbody>
              {structuredFactRows.map((row, idx) => (
                <tr key={`${row.category}:${row.evidence[0]?.line_start ?? idx}:${idx}`}>
                  <td className="border border-admin-border-mid p-2 align-top max-w-72">
                    <div className="line-clamp-3">
                      {row.evidence[0]?.quote ?? '-'}
                    </div>
                  </td>
                  <td className="border border-admin-border-mid p-2 align-top font-mono">{row.category}</td>
                  <td className="border border-admin-border-mid p-2 align-top" aria-label={`${row.category} 추출값`}>
                    <pre className="w-56 whitespace-pre-wrap break-words font-mono">
                      {JSON.stringify(row.values, null, 2)}
                    </pre>
                  </td>
                  <td className="border border-admin-border-mid p-2 align-top">{row.standard_text}</td>
                  <td className="border border-admin-border-mid p-2 align-top">L{row.evidence[0]?.line_start ?? '-'}</td>
                  <td className="border border-admin-border-mid p-2 align-top">{row.visibility}</td>
                  <td className="border border-admin-border-mid p-2 align-top">
                    <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-bold ${
                      row.risk_level === 'high'
                        ? 'bg-red-50 text-red-700'
                        : row.risk_level === 'medium'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                    }`}>
                      {row.risk_level}
                    </span>
                  </td>
                  <td className="border border-admin-border-mid p-2 align-top">{row.review_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 원문 발췌 (참고용) */}
      {noticeRows.length > 0 && (
        <div className="mt-6 bg-admin-bg border border-admin-border-mid rounded-admin-md p-4 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h3 className="text-sm font-bold text-admin-text-2">REMARK 표준언어 검수 테이블</h3>
            <button
              type="button"
              onClick={() => saveStandardNotices(noticeRows)}
              disabled={noticeSaving}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {noticeSaving ? '저장 중...' : '고객 유의사항 저장'}
            </button>
          </div>
          {noticeMessage && (
            <div className="mb-2 rounded-admin-sm border border-admin-border-mid bg-white px-3 py-2 text-xs text-admin-text-2">
              {noticeMessage}
            </div>
          )}
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-admin-surface-2">
                <th className="border border-admin-border-mid p-2 text-left">원문</th>
                <th className="border border-admin-border-mid p-2 text-left">카테고리</th>
                <th className="border border-admin-border-mid p-2 text-left">추출값</th>
                <th className="border border-admin-border-mid p-2 text-left">여소남 표준문구</th>
                <th className="border border-admin-border-mid p-2 text-left">증거</th>
                <th className="border border-admin-border-mid p-2 text-left">위험도</th>
                <th className="border border-admin-border-mid p-2 text-left">노출</th>
                <th className="border border-admin-border-mid p-2 text-left">검수상태</th>
              </tr>
            </thead>
            <tbody>
              {noticeRows.map((row) => (
                <tr key={row.review_key}>
                  <td className="border border-admin-border-mid p-2 align-top">{row.source_text}</td>
                  <td className="border border-admin-border-mid p-2 align-top">
                    <select
                      aria-label={`${row.source_text} 카테고리`}
                      value={row.category}
                      onChange={e => updateNoticeEdit(row.review_key, { category: e.target.value as StandardNoticeCategory })}
                      className="w-full min-w-40 rounded border border-admin-border-mid bg-white px-2 py-1"
                    >
                      {STANDARD_NOTICE_CATEGORIES.map(category => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </td>
                  <td className="border border-admin-border-mid p-2 align-top">
                    <textarea
                      aria-label={`${row.source_text} 추출값`}
                      value={row.values_text}
                      onChange={e => updateNoticeEdit(row.review_key, { valuesText: e.target.value })}
                      className={`min-h-20 w-52 rounded border px-2 py-1 font-mono ${row.values_valid ? 'border-admin-border-mid' : 'border-red-400 bg-red-50'}`}
                    />
                  </td>
                  <td className="border border-admin-border-mid p-2 align-top">{row.standard_text}</td>
                  <td className="border border-admin-border-mid p-2 align-top" aria-label={`${row.category} 추출값`}>
                    <div className="min-w-32 space-y-1">
                      <div className="font-mono text-[11px] text-admin-muted">
                        L{row.evidence[0]?.line_start ?? '-'}
                        {row.evidence[0]?.line_end && row.evidence[0]?.line_end !== row.evidence[0]?.line_start
                          ? `-L${row.evidence[0].line_end}`
                          : ''}
                      </div>
                      <div className="max-w-56 truncate text-admin-text-2">
                        {row.evidence[0]?.quote ?? row.source_text}
                      </div>
                    </div>
                  </td>
                  <td className="border border-admin-border-mid p-2 align-top">
                    <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-bold ${
                      row.risk_level === 'high'
                        ? 'bg-red-50 text-red-700'
                        : row.risk_level === 'medium'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                    }`}>
                      {row.risk_level}
                    </span>
                  </td>
                  <td className="border border-admin-border-mid p-2 align-top">
                    <select
                      aria-label={`${row.source_text} 노출 범위`}
                      value={row.visibility}
                      onChange={e => updateNoticeEdit(row.review_key, { visibility: e.target.value as StandardNoticeDraft['visibility'] })}
                      className="w-full min-w-36 rounded border border-admin-border-mid bg-white px-2 py-1"
                    >
                      {STANDARD_NOTICE_VISIBILITIES.map(visibility => (
                        <option key={visibility} value={visibility}>{visibility}</option>
                      ))}
                    </select>
                  </td>
                  <td className="border border-admin-border-mid p-2 align-top">
                    <select
                      aria-label={`${row.source_text} 검수 상태`}
                      value={row.review_status}
                      onChange={e => updateNoticeEdit(row.review_key, { review_status: e.target.value as StandardNoticeReviewStatus })}
                      className="w-full min-w-36 rounded border border-admin-border-mid bg-white px-2 py-1"
                    >
                      {STANDARD_NOTICE_REVIEW_STATUSES.map(status => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-6 bg-admin-bg border border-admin-border-mid rounded-admin-md p-4">
        <h3 className="text-sm font-bold text-admin-text-2 mb-2">검수 원문 참고</h3>
        <SensitiveRawText value={pkg.raw_text} title="검수 원문" />
      </div>
    </div>
  );
}
