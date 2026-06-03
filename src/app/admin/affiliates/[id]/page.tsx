'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { maskEmail, maskPhone } from '@/lib/pii-mask';

interface Affiliate {
  id: string; name: string; phone?: string; email?: string;
  referral_code: string; grade: number; grade_label: string;
  bonus_rate: number; payout_type: 'PERSONAL' | 'BUSINESS';
  booking_count: number; total_commission: number; memo?: string;
  bank_info?: string; // 마스킹된 계좌
  landing_intro?: string | null;
  landing_pick_package_ids?: string[] | null;
  landing_video_url?: string | null;
  commission_rate?: number;
  is_active?: boolean;
  business_number?: string;
}

interface Settlement {
  id: string; settlement_period: string; qualified_booking_count: number;
  total_amount: number; carryover_balance: number; final_total: number;
  tax_deduction: number; final_payout: number;
  status: 'PENDING' | 'READY' | 'COMPLETED' | 'VOID';
  settled_at?: string; created_at: string;
}

interface PromoPerformance {
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  uses_count: number;
  bookings: number;
  revenue: number;
  commission: number;
}

const GRADE_COLORS: Record<number, string> = {
  1: 'bg-amber-100 text-amber-800', 2: 'bg-slate-200 text-admin-text-2',
  3: 'bg-yellow-200 text-yellow-800', 4: 'bg-blue-100 text-blue-800',
  5: 'bg-purple-100 text-purple-800',
};

const GRADE_NEXT: Record<number, { label: string; target: number; prevTarget: number }> = {
  1: { label: '실버', target: 10, prevTarget: 0 },
  2: { label: '골드', target: 30, prevTarget: 10 },
  3: { label: '플래티넘', target: 50, prevTarget: 30 },
  4: { label: '다이아', target: 100, prevTarget: 50 },
  5: { label: '최고 등급', target: 100, prevTarget: 100 },
};

const STATUS_BADGES: Record<string, string> = {
  PENDING: 'bg-admin-surface-2 text-admin-muted',
  READY: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  VOID: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: '이월 대기', READY: '지급 대기', COMPLETED: '지급 완료', VOID: '취소됨',
};

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

export default function AffiliateDetailPage() {
  const params = useParams<{ id?: string | string[] }>();
  const affiliateId = getRouteParam(params?.id);
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBankInfo, setShowBankInfo] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', memo: '', payout_type: 'PERSONAL' as 'PERSONAL'|'BUSINESS', commission_rate: 0.09, business_number: '', is_active: true });
  const [saving, setSaving] = useState(false);
  const [landingIntro, setLandingIntro] = useState('');
  const [landingVideoUrl, setLandingVideoUrl] = useState('');
  const [pickPackageIds, setPickPackageIds] = useState<string[]>([]);
  const [pickTitles, setPickTitles] = useState<Record<string, string>>({});
  const [pkgQuery, setPkgQuery] = useState('');
  const [pkgResults, setPkgResults] = useState<Array<{ id: string; title?: string; display_title?: string; destination?: string; status?: string }>>([]);
  const [savingLanding, setSavingLanding] = useState(false);
  const [promoRows, setPromoRows] = useState<PromoPerformance[]>([]);

  const [siteOrigin, setSiteOrigin] = useState('');
  useEffect(() => {
    setSiteOrigin(typeof window !== 'undefined' ? window.location.origin : '');
  }, []);

  const load = useCallback(async () => {
    if (!affiliateId) {
      setAffiliate(null);
      setSettlements([]);
      setPromoRows([]);
      setLoading(false);
      return;
    }

    const encodedAffiliateId = encodeURIComponent(affiliateId);
    setLoading(true);
    try {
      const [aRes, sRes, pRes] = await Promise.all([
        fetch(`/api/affiliates?id=${encodedAffiliateId}&showBankInfo=false`),
        fetch(`/api/settlements?affiliateId=${encodedAffiliateId}`),
        fetch(`/api/admin/affiliate-promo-report?affiliateId=${encodedAffiliateId}`),
      ]);
      const aJson = await aRes.json();
      const sJson = await sRes.json();
      const pJson = await pRes.json();
      setAffiliate(aJson.affiliate);
      setSettlements(sJson.settlements || []);
      setPromoRows(pJson.rows || []);
      if (aJson.affiliate) {
        const a = aJson.affiliate as Affiliate & { commission_rate?: number; business_number?: string; is_active?: boolean };
        setForm({
          name: a.name,
          phone: a.phone || '',
          email: a.email || '',
          memo: a.memo || '',
          payout_type: a.payout_type,
          commission_rate: a.commission_rate ?? 0.09,
          business_number: a.business_number || '',
          is_active: a.is_active ?? true,
        });
        setLandingIntro((a.landing_intro as string | null | undefined) || '');
        setLandingVideoUrl((a.landing_video_url as string | null | undefined) || '');
        setPickPackageIds(Array.isArray(a.landing_pick_package_ids) ? [...a.landing_pick_package_ids] : []);
      }
    } finally {
      setLoading(false);
    }
  }, [affiliateId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (pickPackageIds.length === 0) {
      setPickTitles({});
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        pickPackageIds.map(async id => {
          try {
            const r = await fetch(`/api/packages?id=${encodeURIComponent(id)}`);
            const j = await r.json();
            const p = j.package as { title?: string; display_title?: string } | undefined;
            if (!p) return [id, ''] as const;
            return [id, (p.display_title || p.title || id).slice(0, 120)] as const;
          } catch {
            return [id, ''] as const;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, string> = {};
      entries.forEach(([id, t]) => { if (t) next[id] = t; });
      setPickTitles(next);
    })();
    return () => { cancelled = true; };
  }, [pickPackageIds]);

  useEffect(() => {
    const q = pkgQuery.trim();
    if (q.length < 1) {
      setPkgResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/packages?q=${encodeURIComponent(q)}&limit=40`);
        const j = await res.json();
        const rows = (j.data || []) as Array<{ id: string; title?: string; display_title?: string; destination?: string; status?: string }>;
        setPkgResults(rows.filter(p => ['active', 'approved'].includes(String(p.status || ''))));
      } catch {
        setPkgResults([]);
      }
    }, 320);
    return () => clearTimeout(t);
  }, [pkgQuery]);

  const toggleBankInfo = async () => {
    if (!affiliateId) return;
    const res = await fetch(`/api/affiliates?id=${encodeURIComponent(affiliateId)}&showBankInfo=true`);
    const json = await res.json();
    setAffiliate(prev => prev ? { ...prev, bank_info: json.affiliate?.bank_info } : prev);
    setShowBankInfo(true);
  };

  const handleSave = async () => {
    if (!affiliateId) return;
    setSaving(true);
    try {
      await fetch('/api/affiliates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: affiliateId, ...form }),
      });
      setEditMode(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleSaveLanding = async () => {
    if (!affiliateId) return;
    setSavingLanding(true);
    try {
      const res = await fetch('/api/affiliates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: affiliateId,
          landing_intro: landingIntro.trim() || null,
          landing_video_url: landingVideoUrl.trim() || null,
          landing_pick_package_ids: pickPackageIds,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j as { error?: string }).error || '저장 실패');
        return;
      }
      await load();
    } finally {
      setSavingLanding(false);
    }
  };

  const addPick = (id: string) => {
    if (pickPackageIds.includes(id)) return;
    if (pickPackageIds.length >= 12) return;
    setPickPackageIds(prev => [...prev, id]);
  };

  const removePick = (id: string) => {
    setPickPackageIds(prev => prev.filter(x => x !== id));
  };

  const movePick = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= pickPackageIds.length) return;
    setPickPackageIds(prev => {
      const copy = [...prev];
      const tmp = copy[idx];
      copy[idx] = copy[j]!;
      copy[j] = tmp!;
      return copy;
    });
  };

  // 이번 달 정산 예정액 계산
  const thisMonth = new Date().toISOString().substring(0, 7);
  const thisMonthSettlement = settlements.find(s => s.settlement_period === thisMonth);

  if (loading) return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="h-6 bg-admin-surface-2 rounded animate-pulse w-40" />
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-28 shrink-0" />
            <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse flex-1" />
          </div>
        ))}
      </div>
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 bg-admin-bg rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  );
  if (!affiliate) return <div className="p-6 text-red-500">어필리에이트를 찾을 수 없습니다.</div>;

  const gradeInfo = GRADE_NEXT[affiliate.grade];
  const progress = affiliate.grade < 5
    ? Math.round(
        ((affiliate.booking_count - gradeInfo.prevTarget) /
         (gradeInfo.target - gradeInfo.prevTarget)) * 100
      )
    : 100;
  const remaining = Math.max(0, gradeInfo.target - affiliate.booking_count);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* 뒤로가기 */}
      <Link href="/admin/affiliates" className="text-sm text-admin-muted hover:text-admin-text-2">
        ← 파트너 목록
      </Link>

      {/* 파트너 기본 정보 */}
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-admin-text">{affiliate.name}</h1>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${GRADE_COLORS[affiliate.grade]}`}>
                {affiliate.grade_label}
              </span>
            </div>
            <p className="text-sm text-admin-muted font-mono mt-1">코드: {affiliate.referral_code}</p>
            {affiliate.phone && <p className="text-sm text-admin-muted">{maskPhone(affiliate.phone, 'finance')}</p>}
          </div>
          <button
            onClick={() => setEditMode(!editMode)}
            className="text-sm text-blue-600 hover:underline"
          >
            {editMode ? '취소' : '정보 수정'}
          </button>
        </div>

        {editMode ? (
          <div className="space-y-3 border-t pt-4">
            {[
              { label: '이름', key: 'name', type: 'text' },
              { label: '연락처', key: 'phone', type: 'tel' },
              { label: '이메일', key: 'email', type: 'email' },
            ].map(f => (
              <div key={f.key} className="flex items-center gap-3">
                <label className="w-16 text-xs text-admin-muted">{f.label}</label>
                <input
                  type={f.type}
                  value={(form as Record<string, string | number | boolean>)[f.key] as string}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className="flex-1 border border-admin-border-strong rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <label className="w-16 text-xs text-admin-muted">정산유형</label>
              <select
                value={form.payout_type}
                onChange={e => setForm(prev => ({ ...prev, payout_type: e.target.value as 'PERSONAL'|'BUSINESS' }))}
                className="border border-admin-border-strong rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="PERSONAL">개인 (3.3%)</option>
                <option value="BUSINESS">사업자</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <label className="w-16 text-xs text-admin-muted">커미션율</label>
              <input type="number" step="0.01" min={0} max={0.5}
                value={form.commission_rate}
                onChange={e => setForm(prev => ({ ...prev, commission_rate: +e.target.value }))}
                className="w-24 border border-admin-border-strong rounded-lg px-3 py-1.5 text-sm" />
              <span className="text-xs text-admin-muted-2">({(form.commission_rate * 100).toFixed(1)}%)</span>
            </div>
            {form.payout_type === 'BUSINESS' && (
              <div className="flex items-center gap-3">
                <label className="w-16 text-xs text-admin-muted">사업자번호</label>
                <input type="text" value={form.business_number}
                  onChange={e => setForm(prev => ({ ...prev, business_number: e.target.value }))}
                  placeholder="000-00-00000"
                  className="flex-1 border border-admin-border-strong rounded-lg px-3 py-1.5 text-sm" />
              </div>
            )}
            <div className="flex items-start gap-3">
              <label className="w-16 text-xs text-admin-muted shrink-0 pt-2">메모</label>
              <textarea
                value={form.memo}
                onChange={e => setForm(prev => ({ ...prev, memo: e.target.value }))}
                rows={3}
                placeholder="내부 메모 (고객에게 노출되지 않음)"
                className="flex-1 border border-admin-border-strong rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="w-16 text-xs text-admin-muted">활성상태</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active}
                  onChange={e => setForm(prev => ({ ...prev, is_active: e.target.checked }))}
                  className="rounded" />
                <span className="text-sm">{form.is_active ? '활성' : '비활성 (휴면)'}</span>
              </label>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 border-t pt-4 text-sm">
            <div><span className="text-admin-muted-2">이메일 </span>{maskEmail(affiliate.email || null, 'finance') || '-'}</div>
            <div><span className="text-admin-muted-2">정산유형 </span>
              {affiliate.payout_type === 'PERSONAL' ? '개인 (원천세 3.3%)' : '사업자'}
            </div>
            <div><span className="text-admin-muted-2">커미션율 </span>{((affiliate.commission_rate ?? 0.09) * 100).toFixed(1)}%</div>
            <div><span className="text-admin-muted-2">상태 </span>
              {affiliate.is_active !== false
                ? <span className="text-green-600">활성</span>
                : <span className="text-red-500">비활성</span>}
            </div>
            <div>
              <span className="text-admin-muted-2">계좌 </span>
              {showBankInfo
                ? <span className="font-mono text-red-600">{affiliate.bank_info || '등록 없음'}</span>
                : <button onClick={toggleBankInfo} className="text-blue-500 hover:underline text-xs">
                    {affiliate.bank_info || '클릭하여 확인'}
                  </button>
              }
            </div>
            {affiliate.memo && <div className="col-span-2 text-admin-muted">{affiliate.memo}</div>}
          </div>
        )}
      </div>

      {/* 코브랜딩 랜딩 /with/[추천코드] */}
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-admin-text">코브랜딩 랜딩</h2>
            <p className="text-xs text-admin-muted mt-1">
              고객용 URL — 인스타·유튜브 바이오에 걸기 좋은 전용 페이지입니다. (검색엔진 noindex)
            </p>
          </div>
          <div className="flex flex-wrap gap-3 shrink-0 text-sm font-medium">
            <Link
              href={`/admin/partner-preview?code=${encodeURIComponent(affiliate.referral_code)}`}
              className="text-blue-700 hover:underline"
            >
              프론트 미리보기 허브
            </Link>
            <a
              href={`/with/${encodeURIComponent(affiliate.referral_code)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-700 hover:underline"
            >
              코브랜딩만 새 탭 →
            </a>
          </div>
        </div>
        <p className="text-xs font-mono text-admin-muted break-all bg-admin-bg rounded-lg px-3 py-2">
          {(siteOrigin || (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '') || '(배포 도메인)')}/with/{affiliate.referral_code}
        </p>
        <div>
          <label className="block text-xs font-medium text-admin-muted mb-1">상단 영상 URL (YouTube)</label>
          <input
            type="url"
            value={landingVideoUrl}
            onChange={e => setLandingVideoUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="w-full border border-admin-border-strong rounded-lg px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-admin-muted-2 mt-1">
            입력하면 /with 랜딩 상단에 자동 임베드됩니다. 비우면 영상 없이 텍스트만 노출됩니다.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-admin-muted mb-1">랜딩 인사말 · 소개</label>
          <textarea
            value={landingIntro}
            onChange={e => setLandingIntro(e.target.value)}
            rows={5}
            maxLength={4000}
            placeholder={`예: 안녕하세요, ${affiliate.name}입니다. 제가 다녀온 여행지를 여소남과 함께 엄선했습니다.`}
            className="w-full border border-admin-border-strong rounded-lg px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-admin-muted-2 mt-1">비워 두면 랜딩 페이지에 기본 문구가 표시됩니다. HTML 대신 줄바꿈만 사용하세요.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-admin-muted mb-1">Pick 상품 (순서대로 최대 12개)</label>
          {pickPackageIds.length === 0 ? (
            <p className="text-sm text-admin-muted-2 py-2">선택된 상품 없음 — 아래 검색에서 추가하면 랜딩 상단에만 노출됩니다. 비우면 최신 상품 자동.</p>
          ) : (
            <ul className="space-y-2 mb-3">
              {pickPackageIds.map((id, idx) => (
                <li key={id} className="flex items-center gap-2 text-sm bg-admin-bg rounded-lg px-3 py-2 border border-admin-border">
                  <span className="text-admin-muted-2 w-6 text-center">{idx + 1}</span>
                  <span className="flex-1 truncate" title={pickTitles[id] || id}>
                    {pickTitles[id] || id}
                  </span>
                  <button type="button" className="text-xs text-admin-muted hover:text-admin-text-2 px-1" onClick={() => movePick(idx, -1)} disabled={idx === 0}>
                    ↑
                  </button>
                  <button type="button" className="text-xs text-admin-muted hover:text-admin-text-2 px-1" onClick={() => movePick(idx, 1)} disabled={idx === pickPackageIds.length - 1}>
                    ↓
                  </button>
                  <button type="button" className="text-red-600 text-xs hover:underline" onClick={() => removePick(id)}>
                    제거
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            type="search"
            value={pkgQuery}
            onChange={e => setPkgQuery(e.target.value)}
            placeholder="상품명·코드 검색…"
            className="w-full border border-admin-border-strong rounded-lg px-3 py-2 text-sm mb-2"
          />
          {pkgResults.length > 0 && (
            <ul className="max-h-52 overflow-y-auto border border-admin-border-mid rounded-lg divide-y divide-gray-100">
              {pkgResults.map(p => {
                const title = p.display_title || p.title || p.id;
                const on = pickPackageIds.includes(p.id);
                return (
                  <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-admin-bg">
                    <span className="flex-1 truncate" title={title}>{title}</span>
                    <span className="text-[10px] text-admin-muted-2 shrink-0">{p.destination || ''}</span>
                    <button
                      type="button"
                      disabled={on || pickPackageIds.length >= 12}
                      onClick={() => addPick(p.id)}
                      className="text-xs text-blue-600 hover:underline disabled:text-admin-muted-2 disabled:no-underline shrink-0"
                    >
                      {on ? '추가됨' : '추가'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={handleSaveLanding}
          disabled={savingLanding}
          className="px-4 py-2 bg-emerald-700 text-white rounded-lg text-sm disabled:opacity-50"
        >
          {savingLanding ? '저장 중…' : '랜딩 설정 저장'}
        </button>
      </div>

      {/* KPI 카드 3종 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 등급 & 진행률 */}
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5">
          <p className="text-xs text-admin-muted mb-2">등급 진행률</p>
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2 py-0.5 rounded-full text-sm font-bold ${GRADE_COLORS[affiliate.grade]}`}>
              {affiliate.grade_label}
            </span>
            {affiliate.grade < 5 && (
              <span className="text-xs text-admin-muted-2">→ {gradeInfo.label}</span>
            )}
          </div>
          <div className="w-full bg-admin-surface-2 rounded-full h-3 mb-2">
            <div
              className="bg-purple-500 h-3 rounded-full transition-all"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          <p className="text-xs text-admin-muted">
            {affiliate.grade < 5
              ? `${affiliate.booking_count}건 완료 · ${gradeInfo.label}까지 ${remaining}건 남음`
              : '최고 등급 달성!'}
          </p>
        </div>

        {/* 이번 달 정산 예정 */}
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5">
          <p className="text-xs text-admin-muted mb-2">이번 달 정산 예정</p>
          {thisMonthSettlement ? (
            <>
              <p className="text-xl font-bold text-admin-text">
                ₩{thisMonthSettlement.final_total.toLocaleString()}
              </p>
              <p className="text-xs text-admin-muted-2 mt-1">
                세전 · 이월 포함
              </p>
              <p className="text-sm font-medium text-green-600 mt-2">
                실지급 ₩{thisMonthSettlement.final_payout.toLocaleString()}
              </p>
              {thisMonthSettlement.tax_deduction > 0 && (
                <p className="text-xs text-red-400">
                  원천세 -₩{thisMonthSettlement.tax_deduction.toLocaleString()}
                </p>
              )}
            </>
          ) : (
            <p className="text-admin-muted-2 text-sm">정산 데이터 없음</p>
          )}
        </div>

        {/* 누적 수수료 */}
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5">
          <p className="text-xs text-admin-muted mb-2">누적 수수료 수익</p>
          <p className="text-xl font-bold text-purple-700">
            ₩{Number(affiliate.total_commission).toLocaleString()}
          </p>
          <p className="text-xs text-admin-muted-2 mt-1">총 {affiliate.booking_count}건 연결</p>
          <p className="text-xs text-blue-500 mt-2">
            기본 요율 + 보너스 +{(affiliate.bonus_rate * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* 정산 이력 */}
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-admin-border">
          <h2 className="font-semibold text-admin-text-2">정산 이력</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-admin-bg">
            <tr>
              {['기간', '건수', '발생 수수료', '이월', '합계(세전)', '원천세', '실지급액', '상태'].map(h => (
                <th key={h} className="text-left px-4 py-2 text-xs text-admin-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {settlements.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-6 text-admin-muted-2">정산 이력 없음</td></tr>
            ) : settlements.map(s => (
              <tr key={s.id} className="hover:bg-admin-bg">
                <td className="px-4 py-3 font-mono text-xs">{s.settlement_period}</td>
                <td className="px-4 py-3">{s.qualified_booking_count}건</td>
                <td className="px-4 py-3">₩{s.total_amount.toLocaleString()}</td>
                <td className="px-4 py-3 text-orange-600">
                  {s.carryover_balance > 0 ? `+₩${s.carryover_balance.toLocaleString()}` : '-'}
                </td>
                <td className="px-4 py-3 font-medium">₩{s.final_total.toLocaleString()}</td>
                <td className="px-4 py-3 text-red-500">
                  {s.tax_deduction > 0 ? `-₩${s.tax_deduction.toLocaleString()}` : '-'}
                </td>
                <td className="px-4 py-3 font-bold text-green-700">₩{s.final_payout.toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${STATUS_BADGES[s.status]}`}>
                    {STATUS_LABELS[s.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 파트너 포털 설정 */}
      <PortalSettingsSection affiliateId={affiliateId} affiliateName={affiliate.name} />

      {/* 카드뉴스 콘텐츠 현황 */}
      <ContentSection affiliateId={affiliateId} affiliateName={affiliate.name} />

      {/* AI 콘텐츠 인사이트 */}
      <ContentInsightSection affiliateId={affiliateId} affiliateName={affiliate.name} />

      {/* 프로모코드 성과 */}
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-admin-border">
          <h2 className="font-semibold text-admin-text-2">프로모코드 성과</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-admin-bg">
            <tr>
              {['코드', '할인', '사용', '예약', '매출', '커미션'].map(h => (
                <th key={h} className="text-left px-4 py-2 text-xs text-admin-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {promoRows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-6 text-admin-muted-2">프로모코드 성과 없음</td></tr>
            ) : promoRows.map((r, idx) => (
              <tr key={`${r.code}_${idx}`} className="hover:bg-admin-bg">
                <td className="px-4 py-3 font-mono text-xs font-semibold">{r.code}</td>
                <td className="px-4 py-3">
                  {r.discount_type === 'percent' ? `${r.discount_value}%` : `₩${Number(r.discount_value).toLocaleString()}`}
                </td>
                <td className="px-4 py-3">{r.uses_count}</td>
                <td className="px-4 py-3">{r.bookings}</td>
                <td className="px-4 py-3">₩{r.revenue.toLocaleString()}</td>
                <td className="px-4 py-3 font-semibold text-purple-700">₩{r.commission.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 어필리에이터 카드뉴스 콘텐츠 현황 섹션 */
function ContentSection({ affiliateId, affiliateName }: { affiliateId: string; affiliateName: string }) {
  const [cardNews, setCardNews] = useState<Array<{
    id: string; title: string; status: string;
    created_at: string; slide_image_urls?: string[] | null; branding_level?: string;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/affiliate/card-news?affiliate_id=${encodeURIComponent(affiliateId)}`);
        const json = await res.json();
        if (!cancelled) setCardNews(json.card_news || []);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [affiliateId]);

  const STATUS_LABELS: Record<string, string> = {
    DRAFT: '초안', RENDERING: '렌더 중', CONFIRMED: '확인 완료',
    PUBLISHED: '발행됨', ARCHIVED: '보관됨',
  };
  const STATUS_COLORS: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-600', RENDERING: 'bg-blue-100 text-blue-600',
    CONFIRMED: 'bg-green-100 text-green-600', PUBLISHED: 'bg-purple-100 text-purple-700',
    ARCHIVED: 'bg-yellow-100 text-yellow-700',
  };

  return (
    <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
      <div className="px-6 py-4 border-b border-admin-border flex items-center justify-between">
        <h2 className="font-semibold text-admin-text-2">카드뉴스 콘텐츠</h2>
        <span className="text-xs text-admin-muted">{loading ? '로딩 중...' : `${cardNews.length}개`}</span>
      </div>
      {loading ? (
        <div className="p-6 text-center text-sm text-admin-muted-2">로딩 중...</div>
      ) : cardNews.length === 0 ? (
        <div className="p-6 text-center text-sm text-admin-muted-2">아직 생성된 카드뉴스가 없습니다</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {cardNews.map((cn) => (
            <div key={cn.id} className="px-6 py-3 flex items-center gap-4 hover:bg-admin-bg">
              {cn.slide_image_urls?.[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cn.slide_image_urls[0]}
                  alt=""
                  className="w-12 h-12 rounded object-cover shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded bg-admin-surface-2 shrink-0 flex items-center justify-center text-xs text-admin-muted-2">
                  NO
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-admin-text truncate">{cn.title}</p>
                <p className="text-xs text-admin-muted-2">
                  {new Date(cn.created_at).toLocaleDateString('ko-KR')}
                  {cn.branding_level === 'white_label' ? ' · 화이트라벨' : cn.branding_level === 'powered_by' ? ' · 여소남 제공' : ''}
                </p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${STATUS_COLORS[cn.status] || 'bg-gray-100 text-gray-600'}`}>
                {STATUS_LABELS[cn.status] || cn.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** AI 콘텐츠 인사이트 섹션 */
function ContentInsightSection({
  affiliateId,
  affiliateName,
}: {
  affiliateId: string;
  affiliateName: string;
}) {
  const [insights, setInsights] = useState<
    Array<{
      id: string;
      insight_type: string;
      title: string;
      content: string;
      is_read: boolean;
      created_at: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const loadInsights = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/affiliate/insights?affiliate_id=${encodeURIComponent(affiliateId)}&limit=10`,
      );
      const json = await res.json();
      setInsights(json.insights || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [affiliateId]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/affiliate/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          affiliate_id: affiliateId,
          affiliate_name: affiliateName,
        }),
      });
      const json = await res.json();
      if (json.success) {
        await loadInsights();
      }
    } catch {
      // ignore
    } finally {
      setGenerating(false);
    }
  };

  const handleMarkRead = async (insightId: string) => {
    try {
      await fetch(`/api/affiliate/insights/${insightId}/read`, {
        method: 'PATCH',
      });
      setInsights((prev) =>
        prev.map((i) => (i.id === insightId ? { ...i, is_read: true } : i)),
      );
    } catch {
      // ignore
    }
  };

  const INSIGHT_ICONS: Record<string, string> = {
    performance_tip: '💡',
    template_recommendation: '🎨',
    topic_suggestion: '📌',
    timing_optimization: '⏰',
    summary_report: '📊',
  };

  const INSIGHT_COLORS: Record<string, string> = {
    performance_tip: 'border-l-amber-400',
    template_recommendation: 'border-l-purple-400',
    topic_suggestion: 'border-l-blue-400',
    timing_optimization: 'border-l-green-400',
    summary_report: 'border-l-indigo-400',
  };

  return (
    <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
      <div className="px-6 py-4 border-b border-admin-border flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-admin-text-2">AI 콘텐츠 인사이트</h2>
          <p className="text-xs text-admin-muted mt-0.5">
            카드뉴스 성과 데이터 기반 AI 분석
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs disabled:opacity-50 hover:bg-indigo-700 transition-colors"
        >
          {generating ? '분석 중...' : '인사이트 생성'}
        </button>
      </div>
      {loading ? (
        <div className="p-6 text-center text-sm text-admin-muted-2">
          로딩 중...
        </div>
      ) : insights.length === 0 ? (
        <div className="p-6 text-center text-sm text-admin-muted-2">
          아직 분석된 인사이트가 없습니다. &quot;인사이트 생성&quot; 버튼을 눌러 성과 데이터를 분석해보세요.
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {insights.map((ins) => (
            <div
              key={ins.id}
              className={`px-6 py-4 border-l-4 hover:bg-admin-bg transition-colors ${
                INSIGHT_COLORS[ins.insight_type] || 'border-l-gray-300'
              } ${ins.is_read ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-base">
                      {INSIGHT_ICONS[ins.insight_type] || '📋'}
                    </span>
                    <p className="text-sm font-medium text-admin-text truncate">
                      {ins.title}
                    </p>
                    {!ins.is_read && (
                      <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-admin-muted mt-1 leading-relaxed whitespace-pre-line">
                    {ins.content}
                  </p>
                  <p className="text-[10px] text-admin-muted-2 mt-1.5">
                    {new Date(ins.created_at).toLocaleDateString('ko-KR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                {!ins.is_read && (
                  <button
                    onClick={() => handleMarkRead(ins.id)}
                    className="text-xs text-indigo-600 hover:underline shrink-0 mt-0.5"
                  >
                    확인
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 파트너 포털 설정 섹션 */
function PortalSettingsSection({
  affiliateId,
  affiliateName,
}: {
  affiliateId: string;
  affiliateName: string;
}) {
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSavePin = async () => {
    if (!pin.trim() || pin.length < 4) {
      setMessage({ type: 'error', text: 'PIN은 4자리 이상 입력해주세요.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/affiliates/set-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ affiliate_id: affiliateId, pin }),
      });
      const json = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: 'PIN이 설정되었습니다.' });
        setPin('');
      } else {
        setMessage({ type: 'error', text: json.error || 'PIN 설정 실패' });
      }
    } catch {
      setMessage({ type: 'error', text: '네트워크 오류' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
      <div className="px-6 py-4 border-b border-admin-border">
        <h2 className="font-semibold text-admin-text-2">파트너 포털 설정</h2>
        <p className="text-xs text-admin-muted mt-0.5">
          {affiliateName}님이 전용 포털에 로그인할 때 사용합니다.
        </p>
      </div>
      <div className="p-6 space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">PIN 번호 설정</label>
            <input
              type="text"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="4-6자리 숫자 PIN"
              maxLength={6}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={handleSavePin}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50 transition-colors shrink-0"
          >
            {saving ? '저장 중...' : 'PIN 저장'}
          </button>
        </div>

        {message && (
          <div className={`text-xs rounded-lg p-3 ${
            message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {message.text}
          </div>
        )}

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs text-amber-800">
            <strong>포털 주소:</strong>{' '}
            <a
              href="/affiliate/login"
              target="_blank"
              className="underline hover:text-amber-900"
            >
              /affiliate/login
            </a>
          </p>
          <p className="text-[10px] text-amber-700 mt-1">
            파트너 코드(referral_code)와 위에서 설정한 PIN으로 로그인합니다.
          </p>
        </div>
      </div>
    </div>
  );
}
