'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ── 타입 정의 ────────────────────────────────────────────────────────────────
interface RfqDetail {
  id: string;
  rfq_code: string;
  destination: string;
  adult_count: number;
  child_count: number;
  budget_per_person: number;
  total_budget?: number;
  hotel_grade?: string;
  meal_plan?: string;
  transportation?: string;
  duration_nights?: number;
  special_requests?: string;
  status: string;
  bid_deadline?: string;
}

interface BidInfo {
  id: string;
  status: string;
  locked_at: string;
  submit_deadline: string;
  submitted_at?: string;
}

interface ChecklistItemInput {
  included: boolean;
  amount: number;
  note: string;
}

interface ProposalForm {
  proposal_title: string;
  itinerary_summary: string;
  total_cost: string;
  total_selling_price: string;
  checklist: {
    guide_fee: ChecklistItemInput;
    driver_tip: ChecklistItemInput;
    fuel_surcharge: ChecklistItemInput;
    local_tax: ChecklistItemInput;
    water_cost: ChecklistItemInput;
    inclusions: string;
    exclusions: string;
    hotel_grade: string;
    hotel_name: string;
    meal_plan: string;
    transportation: string;
  };
}

// ── 상수 ─────────────────────────────────────────────────────────────────────
const CHECKLIST_ITEMS: { key: keyof ProposalForm['checklist']; label: string; hint: string }[] = [
  { key: 'guide_fee',      label: '가이드비',     hint: '가이드 1인 전일 비용 포함 여부' },
  { key: 'driver_tip',     label: '기사 팁',      hint: '전세버스 기사 팁 포함 여부' },
  { key: 'fuel_surcharge', label: '유류 할증료',  hint: '항공·버스 유류 할증 포함 여부' },
  { key: 'local_tax',      label: '현지 세금',    hint: '숙박세·관광세 등 현지 세금 포함 여부' },
  { key: 'water_cost',     label: '생수 비용',    hint: '인당 생수 1일 1병 기준' },
];

const defaultChecklistItem = (): ChecklistItemInput => ({ included: true, amount: 0, note: '' });

const initialForm: ProposalForm = {
  proposal_title: '',
  itinerary_summary: '',
  total_cost: '',
  total_selling_price: '',
  checklist: {
    guide_fee:      defaultChecklistItem(),
    driver_tip:     defaultChecklistItem(),
    fuel_surcharge: defaultChecklistItem(),
    local_tax:      defaultChecklistItem(),
    water_cost:     defaultChecklistItem(),
    inclusions: '',
    exclusions: '',
    hotel_grade: '',
    hotel_name: '',
    meal_plan: '',
    transportation: '',
  },
};

const fmt = (n: number) => n.toLocaleString('ko-KR');

// ── 카운트다운 ────────────────────────────────────────────────────────────────
function Countdown({ deadline, onExpire }: { deadline: string; onExpire?: () => void }) {
  const [remaining, setRemaining] = useState('');
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    function update() {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('시간 초과');
        setExpired(true);
        onExpire?.();
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${h > 0 ? `${h}시간 ` : ''}${m}분 ${s}초`);
    }
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [deadline, onExpire]);

  return (
    <span className={`font-mono font-bold ${expired ? 'text-red-500' : 'text-orange-600'}`}>
      {remaining}
    </span>
  );
}

// ── 체크리스트 항목 입력 ───────────────────────────────────────────────────────
function ChecklistRow({
  itemKey,
  label,
  hint,
  value,
  onChange,
}: {
  itemKey: string;
  label: string;
  hint: string;
  value: ChecklistItemInput;
  onChange: (v: ChecklistItemInput) => void;
}) {
  return (
    <div className="border rounded-lg p-3 bg-gray-50">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="font-medium text-gray-800 text-sm">{label}</span>
          <span className="text-gray-400 text-xs ml-2">({hint})</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange({ ...value, included: true })}
            className={`text-xs px-3 py-1 rounded-full border transition ${
              value.included
                ? 'bg-green-600 text-white border-green-600'
                : 'bg-white text-gray-500 border-gray-300 hover:border-green-400'
            }`}
          >
            포함
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...value, included: false })}
            className={`text-xs px-3 py-1 rounded-full border transition ${
              !value.included
                ? 'bg-red-500 text-white border-red-500'
                : 'bg-white text-gray-500 border-gray-300 hover:border-red-400'
            }`}
          >
            불포함
          </button>
        </div>
      </div>
      {!value.included && (
        <div className="flex gap-2 mt-1">
          <input
            type="number"
            placeholder="불포함 예상 비용 (원)"
            value={value.amount || ''}
            onChange={(e) => onChange({ ...value, amount: Number(e.target.value) })}
            className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-300"
          />
          <input
            type="text"
            placeholder="메모 (예: 개인 부담)"
            value={value.note}
            onChange={(e) => onChange({ ...value, note: e.target.value })}
            className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-gray-300"
          />
        </div>
      )}
      {value.included && (
        <input
          type="text"
          placeholder="메모 (선택사항)"
          value={value.note}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
          className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-300 mt-1"
        />
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function TenantRfqDetailPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const rfqId    = params.rfqId    as string;

  const [rfq,         setRfq]         = useState<RfqDetail | null>(null);
  const [bid,         setBid]         = useState<BidInfo | null>(null);
  const [isUnlocked,  setIsUnlocked]  = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [claiming,    setClaiming]    = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitted,   setSubmitted]   = useState(false);
  const [form,        setForm]        = useState<ProposalForm>(initialForm);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/tenant/rfqs/${rfqId}?tenant_id=${tenantId}`);
      if (!res.ok) throw new Error('데이터를 불러올 수 없습니다');
      const data = await res.json();
      setRfq(data.rfq ?? data);
      setIsUnlocked(data.is_unlocked ?? true);
      if (data.my_bid) {
        setBid(data.my_bid);
        if (data.my_bid.submitted_at) setSubmitted(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }, [rfqId, tenantId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 입찰 참여 (선착순 슬롯 확보)
  async function claimBid() {
    setClaiming(true);
    try {
      const res = await fetch(`/api/rfq/${rfqId}/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '입찰 참여에 실패했습니다.');
      setBid(data.bid);
    } catch (e) {
      setError(e instanceof Error ? e.message : '입찰 처리 중 오류가 발생했습니다.');
    } finally {
      setClaiming(false);
    }
  }

  // 원가 체크리스트 업데이트 헬퍼
  function updateChecklistItem(key: keyof ProposalForm['checklist'], value: ChecklistItemInput) {
    setForm(prev => ({
      ...prev,
      checklist: { ...prev.checklist, [key]: value },
    }));
  }

  // 실질 총액 (불포함 비용 합산 미리보기)
  const hiddenCostPreview = CHECKLIST_ITEMS.reduce((sum, { key }) => {
    const item = form.checklist[key as keyof typeof form.checklist] as ChecklistItemInput;
    if (!item?.included && item?.amount) {
      const totalPeople = (rfq?.adult_count ?? 0) + (rfq?.child_count ?? 0);
      return sum + item.amount * totalPeople;
    }
    return sum;
  }, 0);

  const sellingPrice = Number(form.total_selling_price.replace(/,/g, '')) || 0;
  const realTotalPreview = sellingPrice + hiddenCostPreview;

  // 제안서 제출
  async function submitProposal(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError('');

    if (!bid) return;

    const cost  = Number(form.total_cost.replace(/,/g, ''));
    const price = Number(form.total_selling_price.replace(/,/g, ''));

    if (!form.proposal_title.trim()) { setSubmitError('제안 제목을 입력하세요.'); return; }
    if (!form.itinerary_summary.trim()) { setSubmitError('일정 요약을 입력하세요.'); return; }
    if (!cost || cost <= 0) { setSubmitError('원가(내부용)를 입력하세요.'); return; }
    if (!price || price <= 0) { setSubmitError('판매가를 입력하세요.'); return; }

    const checklistPayload = {
      guide_fee:      form.checklist.guide_fee,
      driver_tip:     form.checklist.driver_tip,
      fuel_surcharge: form.checklist.fuel_surcharge,
      local_tax:      form.checklist.local_tax,
      water_cost:     form.checklist.water_cost,
      inclusions:     form.checklist.inclusions.split('\n').filter(Boolean),
      exclusions:     form.checklist.exclusions.split('\n').filter(Boolean),
      hotel_info: {
        grade: form.checklist.hotel_grade,
        name:  form.checklist.hotel_name,
        notes: '',
      },
      meal_plan:      form.checklist.meal_plan,
      transportation: form.checklist.transportation,
    };

    setSubmitting(true);
    try {
      const res = await fetch(`/api/rfq/${rfqId}/bid/${bid.id}/proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id:          tenantId,
          proposal_title:     form.proposal_title,
          itinerary_summary:  form.itinerary_summary,
          total_cost:         cost,
          total_selling_price: price,
          checklist:          checklistPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '제안서 제출에 실패했습니다.');
      setSubmitted(true);
      setBid(prev => prev ? { ...prev, submitted_at: new Date().toISOString() } : prev);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : '제출 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-8 text-center text-gray-400 text-sm">불러오는 중...</div>
    );
  }
  if (error || !rfq) {
    return (
      <div className="p-8 text-center text-red-500 text-sm">
        {error || 'RFQ를 찾을 수 없습니다'}
        <div className="mt-4">
          <Link href={`/tenant/${tenantId}/rfqs`} className="text-indigo-600 hover:underline text-sm">
            ← 목록으로
          </Link>
        </div>
      </div>
    );
  }

  const isPastDeadline = rfq.bid_deadline ? new Date(rfq.bid_deadline) < new Date() : false;

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6 pb-20">
      {/* 헤더 */}
      <div>
        <Link href={`/tenant/${tenantId}/rfqs`} className="text-sm text-indigo-600 hover:underline">
          ← 입찰 목록
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{rfq.destination}</h1>
        <p className="text-sm text-gray-500 font-mono mt-0.5">{rfq.rfq_code}</p>
      </div>

      {/* RFQ 요건 */}
      <div className="bg-white border shadow-sm rounded-xl p-5">
        <h2 className="font-semibold text-gray-900 mb-4">고객 여행 요건 (익명)</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          {[
            ['목적지',    rfq.destination],
            ['인원',      `성인 ${rfq.adult_count}명 / 아동 ${rfq.child_count}명`],
            ['예산 (1인)', rfq.budget_per_person ? `₩${fmt(rfq.budget_per_person)}` : '—'],
            ['총 예산',   rfq.total_budget ? `₩${fmt(rfq.total_budget)}` : '—'],
            ['호텔 등급', rfq.hotel_grade || '—'],
            ['식사',      rfq.meal_plan || '—'],
            ['교통',      rfq.transportation || '—'],
            ['기간',      rfq.duration_nights ? `${rfq.duration_nights}박` : '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <span className="text-gray-500">{label}: </span>
              <span className="font-medium text-gray-800">{value}</span>
            </div>
          ))}
          {rfq.special_requests && (
            <div className="col-span-2">
              <span className="text-gray-500">특별 요청: </span>
              <span className="font-medium text-gray-800">{rfq.special_requests}</span>
            </div>
          )}
        </div>
        {rfq.bid_deadline && (
          <div className="mt-3 text-xs text-gray-500">
            입찰 마감: {rfq.bid_deadline.slice(0, 16).replace('T', ' ')}
            {isPastDeadline && <span className="ml-2 text-red-500 font-medium">마감됨</span>}
          </div>
        )}
      </div>

      {/* 잠금 상태 */}
      {!isUnlocked && (
        <div className="bg-gray-100 border rounded-xl p-6 text-center">
          <p className="text-4xl mb-3">🔒</p>
          <p className="text-gray-700 font-medium">아직 이 공고에 접근할 수 없습니다</p>
          <p className="text-sm text-gray-500 mt-1">티어 등급에 따라 공고 노출이 순차적으로 진행됩니다.</p>
        </div>
      )}

      {/* 입찰 마감 */}
      {isUnlocked && isPastDeadline && !bid && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-center">
          <p className="text-red-700 font-medium">입찰이 마감되었습니다</p>
          <p className="text-sm text-red-500 mt-1">이 공고의 입찰 기간이 종료되었습니다.</p>
        </div>
      )}

      {/* 입찰 참여 버튼 */}
      {isUnlocked && !isPastDeadline && !bid && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5">
          <div className="flex items-start gap-4">
            <div className="text-3xl">🏁</div>
            <div className="flex-1">
              <h3 className="font-semibold text-indigo-800 mb-1">선착순 입찰 참여</h3>
              <p className="text-sm text-indigo-700 mb-3">
                참여 확정 즉시 <strong>3시간 제출 타이머</strong>가 시작됩니다.
                3시간 내 제안서를 제출하지 않으면 참여권이 자동 회수되며 신뢰도가 감점됩니다.
              </p>
              {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
              <button
                onClick={claimBid}
                disabled={claiming}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-sm font-medium transition-colors"
              >
                {claiming ? '처리 중...' : '🏆 선착순 입찰 참여하기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 입찰 참여 중 — 타이머 */}
      {bid && bid.status === 'locked' && !submitted && (
        <div className="bg-orange-50 border border-orange-300 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-orange-800">입찰 참여 확정 — 제출 타이머</h3>
              <p className="text-xs text-orange-600 mt-0.5">
                마감: {bid.submit_deadline.slice(0, 16).replace('T', ' ')}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-orange-600 mb-0.5">남은 시간</p>
              <Countdown deadline={bid.submit_deadline} />
            </div>
          </div>
        </div>
      )}

      {/* 제출 완료 */}
      {submitted && (
        <div className="bg-green-50 border border-green-300 rounded-xl p-5 text-center">
          <p className="text-3xl mb-2">✅</p>
          <h3 className="font-semibold text-green-800">제안서 제출 완료!</h3>
          <p className="text-sm text-green-600 mt-1">
            AI가 검수 후 팩트폭격 리포트에 포함됩니다.
            고객 선택 결과는 시스템 메시지로 안내드립니다.
          </p>
        </div>
      )}

      {/* 제안서 제출 폼 */}
      {bid && !submitted && bid.status !== 'timeout' && (
        <form onSubmit={submitProposal} className="space-y-5">
          <div className="bg-white border shadow-sm rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-4">제안서 작성</h2>

            {/* 제목 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                제안 제목 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.proposal_title}
                onChange={(e) => setForm(prev => ({ ...prev, proposal_title: e.target.value }))}
                placeholder="예: 일본 도쿄 4박 5일 알뜰 패키지"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>

            {/* 일정 요약 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                일정 요약 <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={form.itinerary_summary}
                onChange={(e) => setForm(prev => ({ ...prev, itinerary_summary: e.target.value }))}
                placeholder="예: 1일차: 인천출발→나리타→센소지 / 2일차: 도쿄스카이트리→시부야..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
              />
            </div>

            {/* 원가 / 판매가 */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  원가 (플랫폼 내부용) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-gray-400 text-sm">₩</span>
                  <input
                    type="text"
                    value={form.total_cost}
                    onChange={(e) => setForm(prev => ({ ...prev, total_cost: e.target.value }))}
                    placeholder="18,000,000"
                    className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-0.5">고객에게 노출되지 않습니다</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  판매가 (고객 노출) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-gray-400 text-sm">₩</span>
                  <input
                    type="text"
                    value={form.total_selling_price}
                    onChange={(e) => setForm(prev => ({ ...prev, total_selling_price: e.target.value }))}
                    placeholder="24,000,000"
                    className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
              </div>
            </div>

            {/* 실질 총액 미리보기 */}
            {sellingPrice > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-amber-700">판매가: ₩{fmt(sellingPrice)}</span>
                  {hiddenCostPreview > 0 && (
                    <span className="text-red-600">불포함 예상: +₩{fmt(hiddenCostPreview)}</span>
                  )}
                  <span className="font-bold text-amber-800">
                    실질 총액: ₩{fmt(realTotalPreview)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 원가 체크리스트 (필수) */}
          <div className="bg-white border shadow-sm rounded-xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="font-semibold text-gray-900">원가 체크리스트</h2>
              <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">필수 5항목</span>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              5개 항목 모두 입력 필수. 불포함 항목은 예상 비용을 반드시 입력하세요. AI가 실질 총액을 계산합니다.
            </p>
            <div className="space-y-3">
              {CHECKLIST_ITEMS.map(({ key, label, hint }) => (
                <ChecklistRow
                  key={key}
                  itemKey={key}
                  label={label}
                  hint={hint}
                  value={form.checklist[key as keyof ProposalForm['checklist']] as ChecklistItemInput}
                  onChange={(v) => updateChecklistItem(key as keyof ProposalForm['checklist'], v)}
                />
              ))}
            </div>
          </div>

          {/* 포함/불포함 내역 */}
          <div className="bg-white border shadow-sm rounded-xl p-5 space-y-4">
            <h2 className="font-semibold text-gray-900">포함·불포함 내역</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">포함 내역</label>
                <textarea
                  rows={3}
                  value={form.checklist.inclusions}
                  onChange={(e) => setForm(prev => ({
                    ...prev,
                    checklist: { ...prev.checklist, inclusions: e.target.value },
                  }))}
                  placeholder="항공&#10;숙박&#10;전 식사&#10;전세버스"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-green-300 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">불포함 내역</label>
                <textarea
                  rows={3}
                  value={form.checklist.exclusions}
                  onChange={(e) => setForm(prev => ({
                    ...prev,
                    checklist: { ...prev.checklist, exclusions: e.target.value },
                  }))}
                  placeholder="개인 음료&#10;쇼핑&#10;옵션 투어"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-red-300 resize-none"
                />
              </div>
            </div>

            {/* 숙박 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">호텔 등급</label>
                <select
                  value={form.checklist.hotel_grade}
                  onChange={(e) => setForm(prev => ({
                    ...prev,
                    checklist: { ...prev.checklist, hotel_grade: e.target.value },
                  }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300"
                >
                  <option value="">선택</option>
                  {['3성', '4성', '5성', '부티크'].map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">호텔명</label>
                <input
                  type="text"
                  value={form.checklist.hotel_name}
                  onChange={(e) => setForm(prev => ({
                    ...prev,
                    checklist: { ...prev.checklist, hotel_name: e.target.value },
                  }))}
                  placeholder="예: 시부야 엑셀 호텔"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">식사 플랜</label>
                <select
                  value={form.checklist.meal_plan}
                  onChange={(e) => setForm(prev => ({
                    ...prev,
                    checklist: { ...prev.checklist, meal_plan: e.target.value },
                  }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300"
                >
                  <option value="">선택</option>
                  {['전식포함', '조식포함', '불포함'].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이동 수단</label>
                <select
                  value={form.checklist.transportation}
                  onChange={(e) => setForm(prev => ({
                    ...prev,
                    checklist: { ...prev.checklist, transportation: e.target.value },
                  }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300"
                >
                  <option value="">선택</option>
                  {['전세버스', '기차', '자유이동', '혼합'].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* AI 검수 안내 */}
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-sm text-purple-700">
            <p className="font-semibold mb-1">🤖 AI 자동 검수</p>
            <p className="text-xs">
              제출 즉시 AI가 원가 체크리스트를 분석하여 <strong>불포함 비용 예측 합계</strong> 및
              <strong>실질 총액 판매가</strong>를 계산합니다.
              이 결과는 팩트폭격 비교 리포트에 사용됩니다.
            </p>
          </div>

          {/* 에러 */}
          {submitError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {submitError}
            </div>
          )}

          {/* 제출 버튼 */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl transition-colors text-sm"
          >
            {submitting ? '제출 중...' : '📤 제안서 제출 (AI 검수 시작)'}
          </button>
        </form>
      )}

      {/* 타임아웃 */}
      {bid?.status === 'timeout' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-center">
          <p className="text-3xl mb-2">⏰</p>
          <h3 className="font-semibold text-red-700">제출 시간이 초과되었습니다</h3>
          <p className="text-sm text-red-500 mt-1">
            3시간 내 미제출로 참여권이 회수되었습니다. 신뢰도 점수가 감점됩니다.
          </p>
        </div>
      )}
    </div>
  );
}
