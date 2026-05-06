'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type NoticeSurface = 'a4' | 'mobile' | 'booking_guide';
type NoticeSeverity = 'critical' | 'standard' | 'info';

interface NoticeBlock {
  type: string;
  title: string;
  text: string;
  severity?: NoticeSeverity;
  surfaces?: NoticeSurface[];
}

interface TermsTemplate {
  id?: string;
  name: string;
  tier: 1 | 2 | 3;
  scope: {
    all?: boolean;
    land_operator_id?: string;
    product_type_keywords?: string[];
  };
  notices: NoticeBlock[];
  priority: number;
  is_active?: boolean;
  starts_at?: string;
  ends_at?: string | null;
  notes?: string | null;
}

interface LandOperator {
  id: string;
  name: string;
}

const ALL_TYPES = ['RESERVATION', 'PAYMENT', 'PASSPORT', 'LIABILITY', 'COMPLAINT', 'NOSHOW', 'PANDEMIC', 'SURCHARGE', 'SHOPPING', 'GOLF_SPECIAL', 'CRITICAL', 'POLICY', 'INFO'];
const ALL_SURFACES: NoticeSurface[] = ['a4', 'mobile', 'booking_guide'];
const ALL_SEVERITIES: NoticeSeverity[] = ['critical', 'standard', 'info'];

export default function TermsTemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [operators, setOperators] = useState<LandOperator[]>([]);
  const [tpl, setTpl] = useState<TermsTemplate>({
    name: '',
    tier: 1,
    scope: { all: true },
    notices: [],
    priority: 50,
    is_active: true,
    starts_at: new Date().toISOString(),
    ends_at: null,
    notes: null,
  });

  useEffect(() => {
    params.then(({ id: pathId }) => {
      setId(pathId);
      setIsNew(pathId === 'new');
    });
  }, [params]);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      // 랜드사 목록
      const opsRes = await fetch('/api/land-operators');
      const opsJson = await opsRes.json();
      setOperators((opsJson.operators ?? opsJson.data ?? []) as LandOperator[]);

      if (!isNew) {
        const res = await fetch(`/api/terms-templates/${id}`);
        const json = await res.json();
        if (json.data) setTpl(json.data);
      }
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => { if (id) loadData(); }, [id, loadData]);

  const updateField = <K extends keyof TermsTemplate>(key: K, value: TermsTemplate[K]) => {
    setTpl(prev => ({ ...prev, [key]: value }));
  };

  const updateScope = (key: string, value: unknown) => {
    setTpl(prev => ({ ...prev, scope: { ...prev.scope, [key]: value } }));
  };

  const updateNotice = (idx: number, patch: Partial<NoticeBlock>) => {
    setTpl(prev => ({
      ...prev,
      notices: prev.notices.map((n, i) => (i === idx ? { ...n, ...patch } : n)),
    }));
  };

  const addNotice = () => {
    setTpl(prev => ({
      ...prev,
      notices: [
        ...prev.notices,
        { type: 'INFO', title: '', text: '', severity: 'standard', surfaces: ['mobile', 'booking_guide'] },
      ],
    }));
  };

  const removeNotice = (idx: number) => {
    setTpl(prev => ({ ...prev, notices: prev.notices.filter((_, i) => i !== idx) }));
  };

  const handleTierChange = (tier: 1 | 2 | 3) => {
    setTpl(prev => {
      const scope = tier === 1
        ? { all: true }
        : tier === 2
        ? { land_operator_id: prev.scope.land_operator_id ?? '' }
        : { land_operator_id: prev.scope.land_operator_id ?? '', product_type_keywords: prev.scope.product_type_keywords ?? [] };
      return { ...prev, tier, scope };
    });
  };

  const save = async () => {
    if (!tpl.name.trim()) { alert('이름은 필수입니다'); return; }
    if (tpl.notices.length === 0) { alert('notice 블록이 최소 1개 필요합니다'); return; }
    setSaving(true);
    try {
      const url = isNew ? '/api/terms-templates' : `/api/terms-templates/${id}`;
      const method = isNew ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tpl),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '저장 실패');
      alert('저장 완료');
      if (isNew && json.data?.id) {
        router.push(`/admin/terms-templates/${json.data.id}`);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const softDelete = async () => {
    if (!confirm('비활성화(soft delete)합니다. 기존 예약 스냅샷은 유지됩니다. 계속?')) return;
    const res = await fetch(`/api/terms-templates/${id}`, { method: 'DELETE' });
    if (res.ok) { alert('비활성화 완료'); router.push('/admin/terms-templates'); }
  };

  if (loading) return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      <div className="h-6 bg-slate-100 rounded animate-pulse w-48" />
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-6 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 bg-slate-100 rounded animate-pulse w-24" />
            <div className="h-9 bg-slate-50 rounded-lg animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/terms-templates" className="text-sm text-slate-500 hover:underline">← 목록</Link>
          <h1 className="text-2xl font-extrabold text-slate-900 mt-1">
            {isNew ? '새 약관 템플릿' : '약관 템플릿 수정'}
          </h1>
        </div>
        <div className="flex gap-2">
          {!isNew && (
            <button onClick={softDelete} className="px-3 py-2 border border-red-300 text-red-600 rounded text-sm">
              비활성화
            </button>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-slate-900 text-white rounded font-bold text-sm disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>

      {/* 기본 정보 */}
      <section className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4 space-y-3">
        <h2 className="text-sm font-bold text-slate-900">기본 정보</h2>
        <div>
          <label className="text-xs font-bold text-slate-600">이름 *</label>
          <input
            type="text"
            value={tpl.name}
            onChange={e => updateField('name', e.target.value)}
            placeholder="예: 랜드부산 골프 전용 약관"
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-600">Tier *</label>
            <select
              value={tpl.tier}
              onChange={e => handleTierChange(Number(e.target.value) as 1 | 2 | 3)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            >
              <option value={1}>T1 플랫폼</option>
              <option value={2}>T2 랜드사 공통</option>
              <option value={3}>T3 랜드사 × 상품타입</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600">Priority</label>
            <input
              type="number"
              value={tpl.priority}
              onChange={e => updateField('priority', Number(e.target.value))}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600">활성</label>
            <select
              value={tpl.is_active ? 'true' : 'false'}
              onChange={e => updateField('is_active', e.target.value === 'true')}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            >
              <option value="true">활성</option>
              <option value="false">비활성</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600">메모</label>
          <input
            type="text"
            value={tpl.notes ?? ''}
            onChange={e => updateField('notes', e.target.value || null)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            placeholder="용도·주의사항 메모"
          />
        </div>
      </section>

      {/* Scope */}
      <section className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4 space-y-3">
        <h2 className="text-sm font-bold text-slate-900">Scope (적용 조건)</h2>
        {tpl.tier === 1 && (
          <p className="text-xs text-slate-500">Tier 1 은 모든 상품에 적용됩니다 ({`{"all": true}`}).</p>
        )}
        {(tpl.tier === 2 || tpl.tier === 3) && (
          <div>
            <label className="text-xs font-bold text-slate-600">랜드사 *</label>
            <select
              value={(tpl.scope.land_operator_id ?? '') as string}
              onChange={e => updateScope('land_operator_id', e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            >
              <option value="">선택하세요</option>
              {operators.map(op => (
                <option key={op.id} value={op.id}>{op.name}</option>
              ))}
            </select>
          </div>
        )}
        {tpl.tier === 3 && (
          <div>
            <label className="text-xs font-bold text-slate-600">상품타입 키워드 * (쉼표로 구분, 예: 전세기, 골프, 하드블록)</label>
            <input
              type="text"
              value={(tpl.scope.product_type_keywords ?? []).join(', ')}
              onChange={e => updateScope(
                'product_type_keywords',
                e.target.value.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean),
              )}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              placeholder="전세기, 골프"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              상품의 product_type 필드를 `|,/공백` 으로 토큰화하여 이 키워드와 매칭. 하나라도 일치하면 적용.
            </p>
          </div>
        )}
      </section>

      {/* Notices */}
      <section className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">Notice 블록 ({tpl.notices.length}개)</h2>
          <button
            onClick={addNotice}
            className="text-xs px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded font-bold"
          >
            + 블록 추가
          </button>
        </div>
        {tpl.notices.map((notice, idx) => (
          <div key={idx} className="border border-slate-200 rounded p-3 space-y-2 bg-slate-50">
            <div className="grid grid-cols-3 gap-2">
              <select
                value={notice.type}
                onChange={e => updateNotice(idx, { type: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1 text-xs"
              >
                {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select
                value={notice.severity ?? 'standard'}
                onChange={e => updateNotice(idx, { severity: e.target.value as NoticeSeverity })}
                className="border border-slate-300 rounded px-2 py-1 text-xs"
              >
                {ALL_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                onClick={() => removeNotice(idx)}
                className="text-xs text-red-600 border border-red-200 rounded px-2 py-1"
              >
                삭제
              </button>
            </div>
            <input
              type="text"
              value={notice.title}
              onChange={e => updateNotice(idx, { title: e.target.value })}
              placeholder="제목 (예: 📋 예약 및 취소 규정)"
              className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
            />
            <textarea
              value={notice.text}
              onChange={e => updateNotice(idx, { text: e.target.value })}
              placeholder="본문 (불렛: • 항목1\n• 항목2)"
              rows={4}
              className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono"
            />
            <div className="flex items-center gap-3 text-xs">
              <span className="font-bold text-slate-600">노출 surface:</span>
              {ALL_SURFACES.map(s => (
                <label key={s} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={(notice.surfaces ?? ['mobile', 'booking_guide']).includes(s)}
                    onChange={e => {
                      const current = notice.surfaces ?? ['mobile', 'booking_guide'];
                      const next = e.target.checked
                        ? Array.from(new Set([...current, s]))
                        : current.filter(x => x !== s);
                      updateNotice(idx, { surfaces: next });
                    }}
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>
        ))}
        {tpl.notices.length === 0 && (
          <p className="text-xs text-slate-400 italic">블록이 없습니다. 상단 [+ 블록 추가] 버튼을 눌러 추가하세요.</p>
        )}
      </section>

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-2.5 bg-slate-900 text-white rounded font-bold text-sm disabled:opacity-50"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}
