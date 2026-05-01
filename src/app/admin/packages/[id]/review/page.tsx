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
  low: 'bg-slate-50 border-slate-200',
};
const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-amber-100 text-amber-700 border-amber-200',
  medium: 'bg-blue-100 text-blue-700 border-blue-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
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

export default function PackageReviewPage() {
  const params = useParams();
  const packageId = String(params?.id || '');
  const [pkg, setPkg] = useState<PackageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [saving, setSaving] = useState(false);

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

  if (loading) return <div className="p-6 text-slate-400">로딩 중…</div>;
  if (!pkg) return <div className="p-6 text-slate-400">패키지를 찾을 수 없습니다.</div>;

  const fc = pkg.field_confidences;
  const suspiciousEntries = fc?.fields ? Object.entries(fc.fields).sort(([, a], [, b]) => a.score - b.score) : [];
  const overallConf = fc?.overall_confidence ?? null;
  const overallColor = overallConf == null ? 'text-slate-500'
    : overallConf >= 0.85 ? 'text-emerald-600'
    : overallConf >= 0.7 ? 'text-amber-600'
    : 'text-red-600';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">🔍 Per-field 검토</h1>
          <p className="text-sm text-slate-500 mt-1">
            {pkg.short_code} · {pkg.title}
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/admin/packages?id=${pkg.id}`}
            className="px-3 py-1.5 bg-slate-100 text-slate-700 text-sm rounded-lg hover:bg-slate-200">← 어드민</a>
          <a href={`/packages/${pkg.id}`} target="_blank" rel="noopener"
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">고객 페이지 ↗</a>
        </div>
      </div>

      {/* 종합 정보 */}
      <div className={`rounded-xl border p-4 mb-4 ${overallConf == null ? 'bg-slate-50 border-slate-200' : overallConf < 0.7 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
        {fc ? (
          <>
            <div className="flex items-center gap-3">
              <span className={`text-3xl font-bold ${overallColor}`}>
                {(overallConf! * 100).toFixed(0)}%
              </span>
              <div className="flex-1">
                <div className="text-sm font-bold text-slate-700">
                  종합 신뢰도 — {fc.recommendation === 'pass' ? '✅ 양호' : fc.recommendation === 'review' ? '⚠️ 검토 필요' : '🚨 차단 권장'}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {fc.validator} · {new Date(fc.validated_at).toLocaleString('ko-KR')}
                </div>
              </div>
            </div>
            {fc.reasoning && <p className="text-sm text-slate-600 mt-2 italic">"{fc.reasoning}"</p>}
          </>
        ) : (
          <p className="text-sm text-slate-500">field_confidences 미저장 — Pre-INSERT gate 가 호출되지 않은 패키지 (구버전 등록 또는 SKIP_PRE_INSERT_GATE=1)</p>
        )}
      </div>

      {/* 의심 필드 목록 */}
      {suspiciousEntries.length === 0 ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
          <p className="text-emerald-700 font-bold">🎉 의심 필드 없음</p>
          <p className="text-xs text-emerald-600 mt-1">모든 필드가 cross-validator 통과. 추가 검토 불필요.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-slate-700">⚠️ 의심 필드 ({suspiciousEntries.length}건) — 점수 낮은 순</h2>
          {suspiciousEntries.map(([fieldPath, info]) => {
            const currentValue = getNestedValue(pkg, fieldPath);
            const isEditing = editingField === fieldPath;
            return (
              <div key={fieldPath} className={`rounded-xl border-2 p-4 ${SEVERITY_BG[info.severity]}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 text-[10px] font-mono rounded border ${SEVERITY_BADGE[info.severity]}`}>
                        {info.severity.toUpperCase()}
                      </span>
                      <span className="text-xs font-mono font-bold text-slate-700">{fieldPath}</span>
                      <span className="text-xs text-slate-500">신뢰도 <span className="font-bold text-red-600">{(info.score * 100).toFixed(0)}%</span></span>
                    </div>
                    <p className="text-xs text-slate-700 mt-1.5">💡 <span className="italic">{info.reason}</span></p>

                    <div className="mt-3 grid gap-2">
                      <div className="bg-white rounded border border-slate-200 p-2.5">
                        <div className="text-[10px] text-slate-500 font-bold mb-1">현재 값 (AI 추출)</div>
                        <pre className="text-xs text-slate-700 whitespace-pre-wrap break-words font-mono">
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
                  <div className="mt-3 pt-3 border-t border-slate-200">
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
                        className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs rounded-lg hover:bg-slate-200">취소</button>
                      <span className="text-[10px] text-slate-500 ml-auto">
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
      <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-bold text-slate-700 mb-2">📄 원문 (raw_text) — 참고용</h3>
        <pre className="text-[11px] text-slate-600 whitespace-pre-wrap font-mono max-h-96 overflow-auto">
          {pkg.raw_text}
        </pre>
      </div>
    </div>
  );
}
