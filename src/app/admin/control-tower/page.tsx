'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

// ── 타입 ─────────────────────────────────────────────────
type PolicyCategory = 'pricing' | 'mileage' | 'booking' | 'notification' | 'display' | 'product' | 'operations' | 'marketing' | 'saas';

interface Policy {
  id: string;
  category: PolicyCategory;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
  target_scope: Record<string, unknown>;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  priority: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const CATEGORIES: { key: PolicyCategory | 'all'; label: string; color: string }[] = [
  { key: 'all', label: '전체', color: '' },
  { key: 'pricing', label: '가격/할인', color: 'bg-blue-50 text-blue-700' },
  { key: 'mileage', label: '마일리지', color: 'bg-amber-50 text-amber-700' },
  { key: 'booking', label: '예약/취소', color: 'bg-emerald-50 text-emerald-700' },
  { key: 'notification', label: '알림', color: 'bg-purple-50 text-purple-700' },
  { key: 'display', label: '프론트 노출', color: 'bg-pink-50 text-pink-700' },
  { key: 'product', label: '상품/재고', color: 'bg-cyan-50 text-cyan-700' },
  { key: 'operations', label: '운영/CS', color: 'bg-slate-100 text-slate-700' },
  { key: 'marketing', label: '마케팅', color: 'bg-orange-50 text-orange-700' },
  { key: 'saas', label: 'SaaS', color: 'bg-indigo-50 text-indigo-700' },
];

const ACTION_LABELS: Record<string, string> = {
  price_discount_fixed: '정액 할인', price_discount_pct: '정률 할인', price_surcharge_pct: '할증',
  mileage_multiply: '마일리지 배수', mileage_fixed: '마일리지 정률', mileage_grant: '마일리지 지급', mileage_limit: '사용 한도',
  send_alimtalk: '알림톡 발송', send_sms: 'SMS 발송', send_email: '이메일 발송', auto_reply: '자동 응답',
  show_badge: '뱃지 표시', show_banner: '배너 노출', show_popup: '팝업 노출', hide_product: '상품 숨김',
  auto_cancel: '자동 취소', auto_refund: '자동 환불', require_document: '서류 필수', hold_approval: '승인 대기',
  deactivate_expired: '만료 비활성화', lock_stock: '재고 락', sort_bottom: '하단 정렬',
  set_holiday: '휴무 설정', block_user: '유저 차단', slack_notify: '슬랙 알림',
  pause_campaign: '캠페인 정지', scale_budget: '예산 증액', boost_keyword: '키워드 부스트',
};

const TRIGGER_LABELS: Record<string, string> = {
  condition: '조건 발동', schedule: '스케줄', event: '이벤트', cron: '크론(자동)', always: '상시',
};

const EMPTY_POLICY: Omit<Policy, 'id' | 'created_at' | 'updated_at'> = {
  category: 'pricing', name: '', description: '', trigger_type: 'condition',
  trigger_config: {}, action_type: 'price_discount_pct', action_config: {},
  target_scope: { all: true }, starts_at: new Date().toISOString().slice(0, 10),
  ends_at: null, is_active: true, priority: 100, created_by: null,
};

// ── 메인 ─────────────────────────────────────────────────
export default function ControlTowerPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [catFilter, setCatFilter] = useState<PolicyCategory | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [search, setSearch] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Partial<Policy> | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  // ── 로드 ───────────────────────────────────────────────
  const fetchPolicies = useCallback(async () => {
    try {
      const res = await fetch('/api/policies');
      const data = await res.json();
      setPolicies(data.policies ?? []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

  // ── 필터링 ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = policies;
    if (catFilter !== 'all') result = result.filter(p => p.category === catFilter);
    if (statusFilter === 'active') result = result.filter(p => p.is_active);
    if (statusFilter === 'inactive') result = result.filter(p => !p.is_active);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q));
    }
    return result;
  }, [policies, catFilter, statusFilter, search]);

  // ── KPI ────────────────────────────────────────────────
  const totalActive = policies.filter(p => p.is_active).length;
  const totalInactive = policies.filter(p => !p.is_active).length;
  const catCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of policies) { map[p.category] = (map[p.category] || 0) + 1; }
    return map;
  }, [policies]);

  // ── 토글 ───────────────────────────────────────────────
  const toggleActive = useCallback(async (policy: Policy) => {
    const prev = policy.is_active;
    setPolicies(ps => ps.map(p => p.id === policy.id ? { ...p, is_active: !prev } : p));
    try {
      const res = await fetch('/api/policies', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: policy.id, is_active: !prev }),
      });
      if (!res.ok) throw new Error();
      showToast(`${policy.name} ${!prev ? '활성화' : '비활성화'}`);
    } catch {
      setPolicies(ps => ps.map(p => p.id === policy.id ? { ...p, is_active: prev } : p));
      showToast('변경 실패');
    }
  }, []);

  // ── 저장 (생성/수정) ───────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!editTarget?.name || !editTarget?.action_type) return;
    setSaving(true);
    try {
      const isNew = !editTarget.id;
      const res = await fetch('/api/policies', {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editTarget),
      });
      if (!res.ok) throw new Error();
      showToast(isNew ? '정책 생성 완료' : '정책 수정 완료');
      setEditOpen(false);
      fetchPolicies();
    } catch { showToast('저장 실패'); }
    finally { setSaving(false); }
  }, [editTarget, fetchPolicies]);

  // ── 삭제 ───────────────────────────────────────────────
  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('정책을 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`/api/policies?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setPolicies(ps => ps.filter(p => p.id !== id));
      showToast('삭제 완료');
    } catch { showToast('삭제 실패'); }
  }, []);

  // ── 복제 ───────────────────────────────────────────────
  const handleDuplicate = useCallback((policy: Policy) => {
    const { id, created_at, updated_at, ...rest } = policy;
    setEditTarget({ ...rest, name: `${rest.name} (복사)`, is_active: false });
    setEditOpen(true);
  }, []);

  // ── 편집 폼 필드 업데이트 ──────────────────────────────
  const updateField = (field: string, value: unknown) => {
    setEditTarget(prev => prev ? { ...prev, [field]: value } : prev);
  };

  const updateJsonField = (field: string, key: string, value: unknown) => {
    setEditTarget(prev => {
      if (!prev) return prev;
      const obj = (prev[field as keyof typeof prev] as Record<string, unknown>) || {};
      return { ...prev, [field]: { ...obj, [key]: value } };
    });
  };

  const getCategoryInfo = (cat: PolicyCategory) => CATEGORIES.find(c => c.key === cat) || CATEGORIES[0];

  // ── 상태 아이콘 ────────────────────────────────────────
  const getStatusDot = (policy: Policy) => {
    if (!policy.is_active) return 'bg-slate-300';
    if (policy.ends_at && new Date(policy.ends_at) < new Date()) return 'bg-slate-300';
    return 'bg-emerald-500';
  };

  const getPeriodText = (policy: Policy) => {
    if (!policy.ends_at) return '상시';
    const end = new Date(policy.ends_at);
    if (end < new Date()) return '종료됨';
    const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
    return `D-${days}`;
  };

  return (
    <div className="space-y-4">
      {/* ── 헤더 ──────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-semibold text-slate-800">OS 관제탑</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">가격, 마일리지, 알림, 노출 등 OS 전체 정책을 한 곳에서 관리</p>
        </div>
        <button onClick={() => { setEditTarget({ ...EMPTY_POLICY }); setEditOpen(true); }}
          className="px-4 py-1.5 bg-[#001f3f] text-white text-[13px] rounded hover:bg-blue-900 transition font-medium">
          + 새 정책
        </button>
      </div>

      {/* ── KPI ────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
          <p className="text-[10px] text-slate-400">전체 정책</p>
          <p className="text-[20px] font-bold text-slate-800">{policies.length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
          <p className="text-[10px] text-emerald-600">활성</p>
          <p className="text-[20px] font-bold text-emerald-600">{totalActive}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
          <p className="text-[10px] text-slate-400">비활성</p>
          <p className="text-[20px] font-bold text-slate-400">{totalInactive}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
          <p className="text-[10px] text-slate-400">카테고리</p>
          <p className="text-[20px] font-bold text-slate-800">{Object.keys(catCounts).length}</p>
        </div>
      </div>

      {/* ── 필터 ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 flex-wrap">
          {CATEGORIES.map(c => (
            <button key={c.key} onClick={() => setCatFilter(c.key as PolicyCategory | 'all')}
              className={`px-2.5 py-1 text-[11px] rounded transition ${catFilter === c.key ? 'bg-[#001f3f] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              {c.label} {c.key !== 'all' && catCounts[c.key] ? `(${catCounts[c.key]})` : ''}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2 items-center">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            className="px-2 py-1 border border-slate-200 rounded text-[11px] text-slate-600">
            <option value="all">전체 상태</option>
            <option value="active">활성만</option>
            <option value="inactive">비활성만</option>
          </select>
          <input type="text" placeholder="검색..." value={search} onChange={e => setSearch(e.target.value)}
            className="px-2.5 py-1 border border-slate-200 rounded text-[12px] w-40 focus:ring-1 focus:ring-[#001f3f]" />
        </div>
      </div>

      {/* ── 정책 목록 ─────────────────────────────────── */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-12 text-slate-400 text-[13px]">로딩 중...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-[13px]">
            {policies.length === 0 ? 'Supabase에서 os_policies 테이블 SQL을 실행해주세요.' : '조건에 맞는 정책이 없습니다.'}
          </div>
        ) : (
          filtered.map(policy => {
            const catInfo = getCategoryInfo(policy.category);
            return (
              <div key={policy.id} className={`bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-center gap-3 group hover:border-slate-300 transition ${!policy.is_active ? 'opacity-60' : ''}`}>
                {/* 상태 점 */}
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${getStatusDot(policy)}`} />

                {/* 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[13px] font-semibold text-slate-800 truncate">{policy.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${catInfo.color}`}>{catInfo.label}</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-slate-50 text-slate-500">{ACTION_LABELS[policy.action_type] || policy.action_type}</span>
                  </div>
                  {policy.description && <p className="text-[11px] text-slate-500 truncate">{policy.description}</p>}
                </div>

                {/* 기간 */}
                <div className="text-[11px] text-slate-400 text-right flex-shrink-0 w-16">
                  {getPeriodText(policy)}
                </div>

                {/* 토글 */}
                <button onClick={() => toggleActive(policy)}
                  className={`w-10 h-5 rounded-full flex-shrink-0 transition relative ${policy.is_active ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${policy.is_active ? 'left-5' : 'left-0.5'}`} />
                </button>

                {/* 액션 */}
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                  <button onClick={() => { setEditTarget(policy); setEditOpen(true); }}
                    className="px-2 py-1 text-[10px] bg-slate-50 text-slate-600 rounded hover:bg-slate-100">편집</button>
                  <button onClick={() => handleDuplicate(policy)}
                    className="px-2 py-1 text-[10px] bg-slate-50 text-slate-600 rounded hover:bg-slate-100">복제</button>
                  <button onClick={() => handleDelete(policy.id)}
                    className="px-2 py-1 text-[10px] bg-red-50 text-red-600 rounded hover:bg-red-100">삭제</button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── 편집 드로어 ───────────────────────────────── */}
      {editOpen && editTarget && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setEditOpen(false)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <div className="relative w-full max-w-lg bg-white shadow-xl border-l border-slate-200 h-full flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between flex-shrink-0">
              <h2 className="text-[16px] font-semibold text-slate-800">{editTarget.id ? '정책 편집' : '새 정책'}</h2>
              <button onClick={() => setEditOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-600">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* 기본 정보 */}
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase block mb-1">정책 이름 *</label>
                <input type="text" value={editTarget.name || ''} onChange={e => updateField('name', e.target.value)}
                  placeholder="예: 다낭 전 상품 3만원 할인"
                  className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:ring-1 focus:ring-[#001f3f]" />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase block mb-1">설명</label>
                <input type="text" value={editTarget.description || ''} onChange={e => updateField('description', e.target.value)}
                  placeholder="정책 상세 설명"
                  className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px]" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 uppercase block mb-1">카테고리 *</label>
                  <select value={editTarget.category || 'pricing'} onChange={e => updateField('category', e.target.value)}
                    className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px]">
                    {CATEGORIES.filter(c => c.key !== 'all').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 uppercase block mb-1">우선순위</label>
                  <input type="number" value={editTarget.priority ?? 100} onChange={e => updateField('priority', parseInt(e.target.value) || 100)}
                    className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px]" />
                </div>
              </div>

              {/* 조건 */}
              <div className="border-t border-slate-100 pt-4">
                <label className="text-[11px] font-semibold text-slate-400 uppercase block mb-2">조건 (Trigger)</label>
                <select value={editTarget.trigger_type || 'condition'} onChange={e => updateField('trigger_type', e.target.value)}
                  className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] mb-2">
                  {Object.entries(TRIGGER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>

                {(editTarget.trigger_type === 'condition' || editTarget.trigger_type === 'event') && (
                  <div className="grid grid-cols-3 gap-2">
                    <input type="text" placeholder="필드 (예: destination)"
                      value={(editTarget.trigger_config as Record<string, string>)?.field || ''}
                      onChange={e => updateJsonField('trigger_config', 'field', e.target.value)}
                      className="border border-slate-200 rounded px-2 py-1.5 text-[12px]" />
                    <select value={(editTarget.trigger_config as Record<string, string>)?.operator || '='}
                      onChange={e => updateJsonField('trigger_config', 'operator', e.target.value)}
                      className="border border-slate-200 rounded px-2 py-1.5 text-[12px]">
                      <option value="=">=</option>
                      <option value="!=">!=</option>
                      <option value=">">{'>'}</option>
                      <option value="<">{'<'}</option>
                      <option value=">=">{'>='}</option>
                      <option value="<=">{'<='}</option>
                      <option value="in">포함</option>
                      <option value="between">범위</option>
                    </select>
                    <input type="text" placeholder="값"
                      value={String((editTarget.trigger_config as Record<string, unknown>)?.value ?? '')}
                      onChange={e => {
                        const v = e.target.value;
                        const num = Number(v);
                        updateJsonField('trigger_config', 'value', isNaN(num) ? v : num);
                      }}
                      className="border border-slate-200 rounded px-2 py-1.5 text-[12px]" />
                  </div>
                )}
              </div>

              {/* 액션 */}
              <div className="border-t border-slate-100 pt-4">
                <label className="text-[11px] font-semibold text-slate-400 uppercase block mb-2">액션 (Action)</label>
                <select value={editTarget.action_type || ''} onChange={e => updateField('action_type', e.target.value)}
                  className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] mb-2">
                  {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>

                {/* 액션별 파라미터 */}
                {editTarget.action_type?.includes('discount_fixed') && (
                  <div>
                    <label className="text-[10px] text-slate-400">할인 금액 (원)</label>
                    <input type="number" value={(editTarget.action_config as Record<string, number>)?.amount || 0}
                      onChange={e => updateJsonField('action_config', 'amount', parseInt(e.target.value) || 0)}
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px]" />
                  </div>
                )}
                {(editTarget.action_type?.includes('_pct') || editTarget.action_type === 'mileage_fixed') && (
                  <div>
                    <label className="text-[10px] text-slate-400">비율 (소수점, 예: 0.05 = 5%)</label>
                    <input type="number" step="0.01" value={(editTarget.action_config as Record<string, number>)?.rate || 0}
                      onChange={e => updateJsonField('action_config', 'rate', parseFloat(e.target.value) || 0)}
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px]" />
                  </div>
                )}
                {editTarget.action_type === 'mileage_multiply' && (
                  <div>
                    <label className="text-[10px] text-slate-400">배수 (예: 2 = 2배)</label>
                    <input type="number" value={(editTarget.action_config as Record<string, number>)?.multiplier || 1}
                      onChange={e => updateJsonField('action_config', 'multiplier', parseInt(e.target.value) || 1)}
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px]" />
                  </div>
                )}
                {editTarget.action_type === 'mileage_grant' && (
                  <div>
                    <label className="text-[10px] text-slate-400">지급 포인트</label>
                    <input type="number" value={(editTarget.action_config as Record<string, number>)?.points || 0}
                      onChange={e => updateJsonField('action_config', 'points', parseInt(e.target.value) || 0)}
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px]" />
                  </div>
                )}
                {editTarget.action_type === 'show_badge' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-400">뱃지 텍스트</label>
                      <input type="text" value={(editTarget.action_config as Record<string, string>)?.text || ''}
                        onChange={e => updateJsonField('action_config', 'text', e.target.value)}
                        className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px]" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400">색상</label>
                      <select value={(editTarget.action_config as Record<string, string>)?.color || 'red'}
                        onChange={e => updateJsonField('action_config', 'color', e.target.value)}
                        className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px]">
                        <option value="red">빨강</option><option value="blue">파랑</option>
                        <option value="amber">노랑</option><option value="emerald">초록</option>
                        <option value="purple">보라</option>
                      </select>
                    </div>
                  </div>
                )}
                {editTarget.action_type === 'show_banner' && (
                  <div>
                    <label className="text-[10px] text-slate-400">배너 텍스트</label>
                    <input type="text" value={(editTarget.action_config as Record<string, string>)?.banner_text || ''}
                      onChange={e => updateJsonField('action_config', 'banner_text', e.target.value)}
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px]" />
                  </div>
                )}
                {editTarget.action_type?.includes('send_') && (
                  <div>
                    <label className="text-[10px] text-slate-400">템플릿 ID</label>
                    <input type="text" value={(editTarget.action_config as Record<string, string>)?.template || ''}
                      onChange={e => updateJsonField('action_config', 'template', e.target.value)}
                      placeholder="예: d7_reminder, birthday_coupon"
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px]" />
                  </div>
                )}
                {editTarget.action_type === 'auto_refund' && (
                  <div>
                    <label className="text-[10px] text-slate-400">환불 비율 (1.0 = 전액)</label>
                    <input type="number" step="0.1" value={(editTarget.action_config as Record<string, number>)?.refund_rate || 1}
                      onChange={e => updateJsonField('action_config', 'refund_rate', parseFloat(e.target.value) || 1)}
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px]" />
                  </div>
                )}
              </div>

              {/* 대상 범위 */}
              <div className="border-t border-slate-100 pt-4">
                <label className="text-[11px] font-semibold text-slate-400 uppercase block mb-2">대상 범위 (Scope)</label>
                <div className="space-y-2">
                  <input type="text" placeholder="목적지 (예: 다낭, 비워두면 전체)"
                    value={(editTarget.target_scope as Record<string, string>)?.destination || ''}
                    onChange={e => {
                      if (e.target.value) updateJsonField('target_scope', 'destination', e.target.value);
                      else updateField('target_scope', { all: true });
                    }}
                    className="w-full border border-slate-200 rounded px-3 py-1.5 text-[12px]" />
                  <input type="text" placeholder="고객 등급 (예: VVIP, 비워두면 전체)"
                    value={(editTarget.target_scope as Record<string, string>)?.customer_grade || ''}
                    onChange={e => {
                      if (e.target.value) updateJsonField('target_scope', 'customer_grade', e.target.value);
                    }}
                    className="w-full border border-slate-200 rounded px-3 py-1.5 text-[12px]" />
                </div>
              </div>

              {/* 기간 */}
              <div className="border-t border-slate-100 pt-4">
                <label className="text-[11px] font-semibold text-slate-400 uppercase block mb-2">기간</label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400">시작일</label>
                    <input type="date" value={(editTarget.starts_at || '').slice(0, 10)}
                      onChange={e => updateField('starts_at', e.target.value)}
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-[12px]" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">종료일 (비워두면 상시)</label>
                    <input type="date" value={(editTarget.ends_at || '').slice(0, 10)}
                      onChange={e => updateField('ends_at', e.target.value || null)}
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-[12px]" />
                  </div>
                </div>
              </div>
            </div>

            {/* 저장 버튼 */}
            <div className="bg-white border-t border-slate-200 px-5 py-3 flex gap-2 flex-shrink-0">
              <button onClick={handleSave} disabled={saving || !editTarget.name}
                className="flex-1 py-2 bg-[#001f3f] text-white text-[13px] rounded hover:bg-blue-900 disabled:bg-slate-300 transition font-medium">
                {saving ? '저장 중...' : editTarget.id ? '수정 저장' : '정책 생성'}
              </button>
              <button onClick={() => setEditOpen(false)}
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-[13px] rounded hover:bg-slate-50 transition">
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] bg-[#001f3f] text-white px-5 py-3 rounded-lg text-[13px] shadow-lg">{toast}</div>
      )}
    </div>
  );
}
