'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Affiliate {
  id: string; name: string; phone?: string; email?: string;
  referral_code: string; grade: number; grade_label: string;
  bonus_rate: number; payout_type: 'PERSONAL' | 'BUSINESS';
  booking_count: number; total_commission: number; memo?: string;
  bank_info?: string; // 마스킹된 계좌
  landing_intro?: string | null;
  landing_pick_package_ids?: string[] | null;
  landing_video_url?: string | null;
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
  1: 'bg-amber-100 text-amber-800', 2: 'bg-gray-200 text-gray-700',
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
  PENDING: 'bg-gray-100 text-gray-600',
  READY: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  VOID: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: '이월 대기', READY: '지급 대기', COMPLETED: '지급 완료', VOID: '취소됨',
};

export default function AffiliateDetailPage() {
  const params = useParams<{ id: string }>();
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
    setLoading(true);
    try {
      const [aRes, sRes, pRes] = await Promise.all([
        fetch(`/api/affiliates?id=${params.id}&showBankInfo=false`),
        fetch(`/api/settlements?affiliateId=${params.id}`),
        fetch(`/api/admin/affiliate-promo-report?affiliateId=${params.id}`),
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
  }, [params.id]);

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
    const res = await fetch(`/api/affiliates?id=${params.id}&showBankInfo=true`);
    const json = await res.json();
    setAffiliate(prev => prev ? { ...prev, bank_info: json.affiliate?.bank_info } : prev);
    setShowBankInfo(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/affiliates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: params.id, ...form }),
      });
      setEditMode(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleSaveLanding = async () => {
    setSavingLanding(true);
    try {
      const res = await fetch('/api/affiliates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: params.id,
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

  if (loading) return <div className="p-6 text-gray-400">불러오는 중...</div>;
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
      <Link href="/admin/affiliates" className="text-sm text-gray-500 hover:text-gray-700">
        ← 파트너 목록
      </Link>

      {/* 파트너 기본 정보 */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">{affiliate.name}</h1>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${GRADE_COLORS[affiliate.grade]}`}>
                {affiliate.grade_label}
              </span>
            </div>
            <p className="text-sm text-gray-500 font-mono mt-1">코드: {affiliate.referral_code}</p>
            {affiliate.phone && <p className="text-sm text-gray-500">{affiliate.phone}</p>}
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
                <label className="w-16 text-xs text-gray-500">{f.label}</label>
                <input
                  type={f.type}
                  value={(form as any)[f.key]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <label className="w-16 text-xs text-gray-500">정산유형</label>
              <select
                value={form.payout_type}
                onChange={e => setForm(prev => ({ ...prev, payout_type: e.target.value as 'PERSONAL'|'BUSINESS' }))}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="PERSONAL">개인 (3.3%)</option>
                <option value="BUSINESS">사업자</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <label className="w-16 text-xs text-gray-500">커미션율</label>
              <input type="number" step="0.01" min={0} max={0.5}
                value={form.commission_rate}
                onChange={e => setForm(prev => ({ ...prev, commission_rate: +e.target.value }))}
                className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              <span className="text-xs text-gray-400">({(form.commission_rate * 100).toFixed(1)}%)</span>
            </div>
            {form.payout_type === 'BUSINESS' && (
              <div className="flex items-center gap-3">
                <label className="w-16 text-xs text-gray-500">사업자번호</label>
                <input type="text" value={form.business_number}
                  onChange={e => setForm(prev => ({ ...prev, business_number: e.target.value }))}
                  placeholder="000-00-00000"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
            )}
            <div className="flex items-start gap-3">
              <label className="w-16 text-xs text-gray-500 shrink-0 pt-2">메모</label>
              <textarea
                value={form.memo}
                onChange={e => setForm(prev => ({ ...prev, memo: e.target.value }))}
                rows={3}
                placeholder="내부 메모 (고객에게 노출되지 않음)"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="w-16 text-xs text-gray-500">활성상태</label>
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
            <div><span className="text-gray-400">이메일 </span>{affiliate.email || '-'}</div>
            <div><span className="text-gray-400">정산유형 </span>
              {affiliate.payout_type === 'PERSONAL' ? '개인 (원천세 3.3%)' : '사업자'}
            </div>
            <div><span className="text-gray-400">커미션율 </span>{((affiliate as any).commission_rate * 100 || 9).toFixed(1)}%</div>
            <div><span className="text-gray-400">상태 </span>
              {(affiliate as any).is_active !== false
                ? <span className="text-green-600">활성</span>
                : <span className="text-red-500">비활성</span>}
            </div>
            <div>
              <span className="text-gray-400">계좌 </span>
              {showBankInfo
                ? <span className="font-mono text-red-600">{affiliate.bank_info || '등록 없음'}</span>
                : <button onClick={toggleBankInfo} className="text-blue-500 hover:underline text-xs">
                    {affiliate.bank_info || '클릭하여 확인'}
                  </button>
              }
            </div>
            {affiliate.memo && <div className="col-span-2 text-gray-500">{affiliate.memo}</div>}
          </div>
        )}
      </div>

      {/* 코브랜딩 랜딩 /with/[추천코드] */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900">코브랜딩 랜딩</h2>
            <p className="text-xs text-gray-500 mt-1">
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
        <p className="text-xs font-mono text-gray-600 break-all bg-gray-50 rounded-lg px-3 py-2">
          {(siteOrigin || (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '') || '(배포 도메인)')}/with/{affiliate.referral_code}
        </p>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">상단 영상 URL (YouTube)</label>
          <input
            type="url"
            value={landingVideoUrl}
            onChange={e => setLandingVideoUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            입력하면 /with 랜딩 상단에 자동 임베드됩니다. 비우면 영상 없이 텍스트만 노출됩니다.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">랜딩 인사말 · 소개</label>
          <textarea
            value={landingIntro}
            onChange={e => setLandingIntro(e.target.value)}
            rows={5}
            maxLength={4000}
            placeholder={`예: 안녕하세요, ${affiliate.name}입니다. 제가 다녀온 여행지를 여소남과 함께 엄선했습니다.`}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-gray-400 mt-1">비워 두면 랜딩 페이지에 기본 문구가 표시됩니다. HTML 대신 줄바꿈만 사용하세요.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Pick 상품 (순서대로 최대 12개)</label>
          {pickPackageIds.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">선택된 상품 없음 — 아래 검색에서 추가하면 랜딩 상단에만 노출됩니다. 비우면 최신 상품 자동.</p>
          ) : (
            <ul className="space-y-2 mb-3">
              {pickPackageIds.map((id, idx) => (
                <li key={id} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  <span className="text-gray-400 w-6 text-center">{idx + 1}</span>
                  <span className="flex-1 truncate" title={pickTitles[id] || id}>
                    {pickTitles[id] || id}
                  </span>
                  <button type="button" className="text-xs text-gray-500 hover:text-gray-800 px-1" onClick={() => movePick(idx, -1)} disabled={idx === 0}>
                    ↑
                  </button>
                  <button type="button" className="text-xs text-gray-500 hover:text-gray-800 px-1" onClick={() => movePick(idx, 1)} disabled={idx === pickPackageIds.length - 1}>
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
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
          />
          {pkgResults.length > 0 && (
            <ul className="max-h-52 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {pkgResults.map(p => {
                const title = p.display_title || p.title || p.id;
                const on = pickPackageIds.includes(p.id);
                return (
                  <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
                    <span className="flex-1 truncate" title={title}>{title}</span>
                    <span className="text-[10px] text-gray-400 shrink-0">{p.destination || ''}</span>
                    <button
                      type="button"
                      disabled={on || pickPackageIds.length >= 12}
                      onClick={() => addPick(p.id)}
                      className="text-xs text-blue-600 hover:underline disabled:text-gray-300 disabled:no-underline shrink-0"
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
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs text-gray-500 mb-2">등급 진행률</p>
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2 py-0.5 rounded-full text-sm font-bold ${GRADE_COLORS[affiliate.grade]}`}>
              {affiliate.grade_label}
            </span>
            {affiliate.grade < 5 && (
              <span className="text-xs text-gray-400">→ {gradeInfo.label}</span>
            )}
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3 mb-2">
            <div
              className="bg-purple-500 h-3 rounded-full transition-all"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">
            {affiliate.grade < 5
              ? `${affiliate.booking_count}건 완료 · ${gradeInfo.label}까지 ${remaining}건 남음`
              : '최고 등급 달성!'}
          </p>
        </div>

        {/* 이번 달 정산 예정 */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs text-gray-500 mb-2">이번 달 정산 예정</p>
          {thisMonthSettlement ? (
            <>
              <p className="text-xl font-bold text-gray-900">
                ₩{thisMonthSettlement.final_total.toLocaleString()}
              </p>
              <p className="text-xs text-gray-400 mt-1">
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
            <p className="text-gray-400 text-sm">정산 데이터 없음</p>
          )}
        </div>

        {/* 누적 수수료 */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs text-gray-500 mb-2">누적 수수료 수익</p>
          <p className="text-xl font-bold text-purple-700">
            ₩{Number(affiliate.total_commission).toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-1">총 {affiliate.booking_count}건 연결</p>
          <p className="text-xs text-blue-500 mt-2">
            기본 요율 + 보너스 +{(affiliate.bonus_rate * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* 정산 이력 */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">정산 이력</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['기간', '건수', '발생 수수료', '이월', '합계(세전)', '원천세', '실지급액', '상태'].map(h => (
                <th key={h} className="text-left px-4 py-2 text-xs text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {settlements.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-6 text-gray-400">정산 이력 없음</td></tr>
            ) : settlements.map(s => (
              <tr key={s.id} className="hover:bg-gray-50">
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

      {/* 프로모코드 성과 */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">프로모코드 성과</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['코드', '할인', '사용', '예약', '매출', '커미션'].map(h => (
                <th key={h} className="text-left px-4 py-2 text-xs text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {promoRows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-6 text-gray-400">프로모코드 성과 없음</td></tr>
            ) : promoRows.map((r, idx) => (
              <tr key={`${r.code}_${idx}`} className="hover:bg-gray-50">
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
