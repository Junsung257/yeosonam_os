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

export default function PackageReviewPage() {
  const params = useParams();
  const packageId = String(params?.id || '');
  const [pkg, setPkg] = useState<PackageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [saving, setSaving] = useState(false);
  // N4 박제 (2026-05-16 트립박스 표준): 호텔 마스터 검색 inline
  const [hotelSearchQ, setHotelSearchQ] = useState<string>('');
  const [hotelResults, setHotelResults] = useState<HotelSearchResult[]>([]);
  const [hotelSearchOpen, setHotelSearchOpen] = useState<string | null>(null); // fieldPath of which day's hotel

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/packages?id=${packageId}`);
      const json = await res.json();
      const data: PackageData | null = json.package || json.data || (Array.isArray(json.packages) ? json.packages[0] : null);
      setPkg(data);
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
      if (!res.ok) { alert(data.error || '저장 실패'); return; }
      alert(`호텔 적용 완료: ${hotel.name}`);
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
        alert(`저장 실패: ${json.error || 'unknown'}`);
        return;
      }
      // 자동으로 extractions_corrections 에 정정 적립됨 (PATCH hook)
      alert('정정 저장 완료. Reflexion 메모리에 자동 적립됨 (다음 등록부터 자동 회피).');
      setEditingField(null);
      load();
    } catch (e) {
      alert(`오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
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
                      autoFocus
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
                      autoFocus
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

      {/* 원문 발췌 (참고용) */}
      <div className="mt-6 bg-admin-bg border border-admin-border-mid rounded-admin-md p-4">
        <h3 className="text-sm font-bold text-admin-text-2 mb-2">검수 원문 참고</h3>
        <SensitiveRawText value={pkg.raw_text} title="검수 원문" />
      </div>
    </div>
  );
}
