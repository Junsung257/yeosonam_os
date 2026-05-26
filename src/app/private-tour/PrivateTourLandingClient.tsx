'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { trackLead } from '@/components/MetaPixel';

// ─── 공유 섹션 컴포넌트 ──────────────────────────
function ShareSection({ shareUrl }: { shareUrl: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShareKakao = () => {
    if (typeof window.Kakao !== 'undefined' && window.Kakao.isInitialized()) {
      window.Kakao.Share.sendDefault({
        objectType: 'feed',
        content: {
          title: '✈️ 단독맞춤여행 견적이 도착했습니다!',
          description: '여소남 단독맞춤여행 — 나만을 위한 프라이빗 여행 견적을 확인해보세요.',
          imageUrl: `${window.location.origin}/og-private-tour.png`,
          link: { mobileWebUrl: shareUrl, webUrl: shareUrl },
        },
        buttons: [{
          title: '견적 확인하기',
          link: { mobileWebUrl: shareUrl, webUrl: shareUrl },
        }],
      });
    } else {
      // fallback: 모바일 카카오톡 앱 스킴
      const kakaoUrl = `kakaotalk://sendurl?url=${encodeURIComponent(shareUrl)}`;
      window.open(kakaoUrl, '_blank');
    }
  };

  return (
    <div className="border-t pt-5 mt-5">
      <p className="text-xs font-semibold text-slate-500 mb-3">📤 일행에게 이 견적을 공유해보세요!</p>
      <div className="flex gap-2">
        <button
          onClick={handleCopyLink}
          className="flex-1 bg-gray-100 text-gray-800 py-3 rounded-xl text-sm font-semibold hover:bg-gray-200 transition"
        >
          {copied ? '✅ 링크 복사됨!' : '🔗 링크 복사'}
        </button>
        <button
          onClick={handleShareKakao}
          className="flex-1 bg-[#FEE500] text-[#191919] py-3 rounded-xl text-sm font-semibold hover:bg-[#FDD800] transition"
        >
          💬 카카오톡 공유
        </button>
      </div>
    </div>
  );
}

// ─── 타입 ──────────────────────────────────────────────
type GroupType = '가족여행' | '친구·모임' | '회사 단체' | '동호회·동문' | '특별한 날' | '혼자 여행' | '';

type FormState = {
  // Step 1: 기본 정보
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  // Step 2: 여행 정보
  group_type: GroupType;
  pax: string;
  destination: string;
  departure_date: string;
  duration_days: string;
  // Step 3: 상세 조건 (유형별)
  has_elderly: string;           // 가족
  has_infant: string;            // 가족
  vibes: string[];               // 친구모임
  activity_preference: string;    // 친구·회사
  needs_seminar: string;          // 회사
  corporate_card: string;         // 회사
  hobby_type: string;             // 동호회
  anniversary_type: string;       // 특별한 날
  solo_guide: string;             // 혼자 여행
  // Step 4: 예산 및 요청사항
  budget_label: string;
  hotel_grade: string;
  notes: string;
};

const INITIAL_FORM: FormState = {
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  group_type: '',
  pax: '',
  destination: '',
  departure_date: '',
  duration_days: '',
  has_elderly: '',
  has_infant: '',
  vibes: [],
  activity_preference: '',
  needs_seminar: '',
  corporate_card: '',
  hobby_type: '',
  anniversary_type: '',
  solo_guide: '',
  budget_label: '',
  hotel_grade: '',
  notes: '',
};

// ─── 선택지 ────────────────────────────────────────────
const BUDGET_OPTIONS = [
  { label: '예산 1인 50만원 미만', value: '~50만원' },
  { label: '1인 50~80만원', value: '50~80만원' },
  { label: '1인 80~120만원', value: '80~120만원' },
  { label: '1인 120~200만원', value: '120~200만원' },
  { label: '1인 200만원 이상', value: '200만원 이상' },
  { label: '예산 미정 (제안 요청)', value: '미정' },
] as const;

const HOTEL_OPTIONS = ['3성급 (합리적)', '4성급 (보통)', '5성급 (럭셔리)', '상관없음'] as const;
const PAX_OPTIONS = ['1명', '2명', '3~4명', '5~8명', '9~15명', '16~30명', '30명 이상'] as const;
const DURATION_OPTIONS = ['1박2일', '2박3일', '3박4일', '4박5일', '5박6일 이상', '미정'] as const;

const VIBE_OPTIONS = ['🍷 감성·힐링', '🎉 파티·술', '🏞️ 자연·관광', '🛍️ 쇼핑·미식', '⚡ 액티비티'] as const;
const ACTIVITY_OPTIONS = ['관광 위주', '휴식 중심', '골프', '워터스포츠', '트레킹', '자유로운 시간'] as const;
const SOLO_GUIDE_OPTIONS = ['현지 가이드 동반 선호', '자유롭게 혼자 다닐게요', '상황 봐서 결정'] as const;
const ANNIVERSARY_OPTIONS = ['허니문', '환갑/칠순', '은퇴 기념', '생일', '기타'] as const;
const HOBBY_OPTIONS = ['골프', '등산·트레킹', '스포츠 관람', '사진', '낚시', '기타'] as const;

// ─── 도우미 함수 ──────────────────────────────────────
function parseBudgetLabel(label: string): number | undefined {
  switch (label) {
    case '~50만원': return 400_000;
    case '50~80만원': return 650_000;
    case '80~120만원': return 1_000_000;
    case '120~200만원': return 1_600_000;
    case '200만원 이상': return 2_500_000;
    default: return undefined;
  }
}

function parsePaxBound(label: string): number {
  if (label === '1명') return 1;
  if (label === '2명') return 2;
  if (label === '3~4명') return 4;
  if (label === '5~8명') return 7;
  if (label === '9~15명') return 12;
  if (label === '16~30명') return 23;
  if (label === '30명 이상') return 35;
  return 0;
}

function getGroupTypeFold(form: FormState): Record<string, unknown> {
  switch (form.group_type) {
    case '가족여행':
      return {
        has_elderly: form.has_elderly || undefined,
        has_infant: form.has_infant || undefined,
      };
    case '친구·모임':
      return { vibes: form.vibes, activity_preference: form.activity_preference || undefined };
    case '회사 단체':
      return {
        needs_seminar: form.needs_seminar || undefined,
        corporate_card: form.corporate_card || undefined,
        activity_preference: form.activity_preference || undefined,
      };
    case '동호회·동문':
      return { hobby_type: form.hobby_type || undefined };
    case '특별한 날':
      return { anniversary_type: form.anniversary_type || undefined };
    case '혼자 여행':
      return { solo_guide: form.solo_guide || undefined };
    default:
      return {};
  }
}

export default function PrivateTourLandingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneData, setDoneData] = useState<{ rfqId: string; shareUrl: string | null } | null>(null);

  // URL searchParams preset 오토필 (예: /private-tour?preset=가족여행)
  useEffect(() => {
    const preset = searchParams.get('preset');
    if (preset) {
      const validTypes: GroupType[] = ['가족여행', '친구·모임', '회사 단체', '동호회·동문', '특별한 날', '혼자 여행'];
      if (validTypes.includes(preset as GroupType)) {
        setForm((f) => ({ ...f, group_type: preset as GroupType }));
      }
    }
  }, [searchParams]);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const toggleVibe = useCallback((vibe: string) => {
    setForm((f) => ({
      ...f,
      vibes: f.vibes.includes(vibe) ? f.vibes.filter((v) => v !== vibe) : [...f.vibes, vibe],
    }));
  }, []);

  // Step 1 제출
  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.contact_name || !form.contact_phone) {
      setError('이름과 연락처를 입력해주세요.');
      return;
    }
    const phoneDigits = form.contact_phone.replace(/\D/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      setError('올바른 연락처(휴대폰 번호)를 입력해주세요. 예: 01012345678');
      return;
    }
    // 이메일 포맷 검증 (입력된 경우에만)
    if (form.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email)) {
      setError('이메일 형식이 올바르지 않습니다.');
      return;
    }
    setError(null);
    setStep(2);
  };

  // Step 2 제출
  const handleStep2 = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.group_type || !form.pax || !form.destination) {
      setError('유형·인원·목적지를 입력해주세요.');
      return;
    }
    setError(null);
    setStep(3);
  };

  // Step 3 제출
  const handleStep3 = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStep(4);
  };

  // 최종 제출
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.budget_label) {
      setError('예산 구간을 선택해주세요.');
      return;
    }

    setSubmitting(true);

    try {
      const utm = {
        source: searchParams.get('utm_source'),
        medium: searchParams.get('utm_medium'),
        campaign: searchParams.get('utm_campaign'),
        n_keyword: searchParams.get('n_keyword'),
      };

      const payload = {
        customer_name: form.contact_name,
        customer_phone: form.contact_phone,
        destination: form.destination,
        departure_date_from: form.departure_date,
        adult_count: parsePaxBound(form.pax),
        child_count: 0,
        budget_per_person: parseBudgetLabel(form.budget_label),
        hotel_grade: form.hotel_grade?.replace(/급.*/, '') || undefined,
        special_requests: form.notes || undefined,
        custom_requirements: {
          source: 'private_tour_landing',
          group_type: form.group_type,
          duration_range: form.duration_days,
          pax_range: form.pax,
          budget_range_label: form.budget_label,
          customer_email: form.contact_email || undefined,
          type_details: getGroupTypeFold(form),
          utm,
          submitted_at: new Date().toISOString(),
        },
      };

      const res = await fetch('/api/rfq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.rfq) {
        throw new Error(data.error || '견적 요청에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }

      trackLead({ content_name: '단독맞춤여행 견적', value: 0 });

      // share_url이 있으면 완료 화면 표시, 없으면 기존 RFQ 페이지로 이동
      if (data.share_url) {
        setDoneData({ rfqId: data.rfq.id, shareUrl: data.share_url });
        setSubmitting(false);
      } else {
        router.push(`/rfq/${data.rfq.id}`);
      }
    } catch (err) {
      console.error('견적 요청 실패:', err);
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
      setSubmitting(false);
    }
  }

  // ─── Step Indicator ─────────────────────────────────
  const totalSteps = 4;
  const currentStep = step;

  return (
    <section id="private-tour-form" className="bg-white py-16 md:py-20 px-4">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-2">
          무료 맞춤 견적 의뢰
        </h2>
        <p className="text-center text-slate-600 mb-8 text-sm">
          3분만 입력하세요. 접수 즉시 24시간 내 제안해드립니다.
        </p>

        {/* 진행률 표시줄 */}
        <div className="mb-10">
          <div className="flex items-center justify-center gap-1 mb-3">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div key={i} className="flex items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition ${
                    i + 1 <= currentStep
                      ? 'bg-brand text-white'
                      : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  {i + 1}
                </div>
                {i < totalSteps - 1 && (
                  <div
                    className={`w-8 h-0.5 transition ${
                      i + 1 < currentStep ? 'bg-brand' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="text-center text-xs text-slate-500">
            {step === 1 && '기본 정보'}
            {step === 2 && '여행 정보'}
            {step === 3 && '상세 조건'}
            {step === 4 && '예산 및 요청사항'}
          </div>
        </div>

        {/* ── Step 1: 기본 정보 ────────────────────────── */}
        {step === 1 && (
          <form onSubmit={handleStep1} className="bg-gray-50 rounded-3xl p-6 md:p-10 border border-gray-100 shadow-sm space-y-5">
            <p className="text-xs text-slate-500 mb-2">
              연락처 정보를 알려주세요. 입력 즉시 담당자가 확인합니다.
            </p>

            <div>
              <label className="block text-sm font-semibold mb-2">
                이름 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.contact_name}
                onChange={(e) => update('contact_name', e.target.value)}
                placeholder="홍길동"
                className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">
                연락처 <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                value={form.contact_phone}
                onChange={(e) => update('contact_phone', e.target.value)}
                placeholder="010-0000-0000"
                className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
                required
              />
              <p className="text-xs text-slate-400 mt-1">
                견적 진행 상황을 SMS로 안내해드립니다.
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">
                이메일 (선택)
              </label>
              <input
                type="email"
                value={form.contact_email}
                onChange={(e) => update('contact_email', e.target.value)}
                placeholder="example@email.com"
                className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
              />
            </div>

            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-brand hover:bg-[#1B64DA] text-white font-bold py-4 rounded-2xl text-lg transition"
            >
              다음 →
            </button>
          </form>
        )}

        {/* ── Step 2: 여행 정보 ────────────────────────── */}
        {step === 2 && (
          <form onSubmit={handleStep2} className="bg-gray-50 rounded-3xl p-6 md:p-10 border border-gray-100 shadow-sm space-y-5">
            <p className="text-xs text-slate-500 mb-2">
              어떤 여행을 계획 중이신가요? 기본 정보를 알려주세요.
            </p>

            <div>
              <label className="block text-sm font-semibold mb-2">
                여행 유형 <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['가족여행', '친구·모임', '회사 단체', '동호회·동문', '특별한 날', '혼자 여행'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => update('group_type', form.group_type === t ? '' : t)}
                    className={`py-3 rounded-xl text-sm font-semibold transition border ${
                      form.group_type === t
                        ? 'bg-brand text-white border-brand'
                        : 'bg-white text-slate-700 border-gray-200 hover:border-brand/40'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">
                예상 인원 <span className="text-red-500">*</span>
              </label>
              <select
                value={form.pax}
                onChange={(e) => update('pax', e.target.value)}
                className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
                required
                aria-label="예상 인원"
              >
                <option value="">선택해주세요</option>
                {PAX_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">
                희망 목적지 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.destination}
                onChange={(e) => update('destination', e.target.value)}
                placeholder="다낭, 세부, 오사카, 방콕, 괌 등"
                className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold mb-2">희망 출발일</label>
                <input
                  type="date"
                  value={form.departure_date}
                  onChange={(e) => update('departure_date', e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">여행 기간</label>
                <select
                  value={form.duration_days}
                  onChange={(e) => update('duration_days', e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
                  aria-label="여행 기간"
                >
                  <option value="">선택</option>
                  {DURATION_OPTIONS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>

            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setStep(1); setError(null); }}
                className="flex-1 bg-white text-slate-700 border border-gray-200 font-bold py-4 rounded-2xl text-lg hover:bg-gray-50 transition"
              >
                ← 이전
              </button>
              <button
                type="submit"
                className="flex-1 bg-brand hover:bg-[#1B64DA] text-white font-bold py-4 rounded-2xl text-lg transition"
              >
                다음 →
              </button>
            </div>
          </form>
        )}

        {/* ── Step 3: 상세 조건 (유형별 조건부) ─────────── */}
        {step === 3 && (
          <form onSubmit={handleStep3} className="bg-gray-50 rounded-3xl p-6 md:p-10 border border-gray-100 shadow-sm space-y-5">
            <p className="text-xs text-slate-500 mb-2">
              {form.group_type}에 맞춰 추가 정보를 알려주세요.
            </p>

            {/* 가족여행 */}
            {form.group_type === '가족여행' && (
              <>
                <div>
                  <label className="block text-sm font-semibold mb-2">어르신(65세 이상) 동행</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['있음', '없음'].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => update('has_elderly', form.has_elderly === opt ? '' : opt)}
                        className={`py-3 rounded-xl text-sm font-semibold transition border ${
                          form.has_elderly === opt
                            ? 'bg-brand text-white border-brand'
                            : 'bg-white text-slate-700 border-gray-200 hover:border-brand/40'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2">유아(만 2세 미만) 동반</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['있음', '없음'].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => update('has_infant', form.has_infant === opt ? '' : opt)}
                        className={`py-3 rounded-xl text-sm font-semibold transition border ${
                          form.has_infant === opt
                            ? 'bg-brand text-white border-brand'
                            : 'bg-white text-slate-700 border-gray-200 hover:border-brand/40'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* 친구·모임 */}
            {form.group_type === '친구·모임' && (
              <>
                <div>
                  <label className="block text-sm font-semibold mb-2">원하는 분위기 (중복 선택)</label>
                  <div className="flex flex-wrap gap-2">
                    {VIBE_OPTIONS.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => toggleVibe(v)}
                        className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition border ${
                          form.vibes.includes(v)
                            ? 'bg-brand text-white border-brand'
                            : 'bg-white text-slate-700 border-gray-200 hover:border-brand/40'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2">액티비티 선호도</label>
                  <select
                    value={form.activity_preference}
                    onChange={(e) => update('activity_preference', e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
                    aria-label="액티비티 선호도"
                  >
                    <option value="">선택해주세요</option>
                    {ACTIVITY_OPTIONS.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {/* 회사 단체 */}
            {form.group_type === '회사 단체' && (
              <>
                <div>
                  <label className="block text-sm font-semibold mb-2">세미나·회의 필요</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['필요', '불필요'].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => update('needs_seminar', form.needs_seminar === opt ? '' : opt)}
                        className={`py-3 rounded-xl text-sm font-semibold transition border ${
                          form.needs_seminar === opt
                            ? 'bg-brand text-white border-brand'
                            : 'bg-white text-slate-700 border-gray-200 hover:border-brand/40'
                        }`}
                      >
                        {opt === '필요' ? '세미나룸 필요' : '순수 여행'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2">법인카드 결제</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['법인카드 가능', '개인 결제'].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => update('corporate_card', form.corporate_card === opt ? '' : opt)}
                        className={`py-3 rounded-xl text-sm font-semibold transition border ${
                          form.corporate_card === opt
                            ? 'bg-brand text-white border-brand'
                            : 'bg-white text-slate-700 border-gray-200 hover:border-brand/40'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2">액티비티 선호도</label>
                  <select
                    value={form.activity_preference}
                    onChange={(e) => update('activity_preference', e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
                    aria-label="액티비티 선호도"
                  >
                    <option value="">선택해주세요</option>
                    {ACTIVITY_OPTIONS.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {/* 동호회·동문 */}
            {form.group_type === '동호회·동문' && (
              <div>
                <label className="block text-sm font-semibold mb-2">취미/관심 분야</label>
                <select
                  value={form.hobby_type}
                  onChange={(e) => update('hobby_type', e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
                  aria-label="취미/관심 분야"
                >
                  <option value="">선택해주세요</option>
                  {HOBBY_OPTIONS.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            )}

            {/* 특별한 날 */}
            {form.group_type === '특별한 날' && (
              <div>
                <label className="block text-sm font-semibold mb-2">기념일 유형</label>
                <select
                  value={form.anniversary_type}
                  onChange={(e) => update('anniversary_type', e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
                  aria-label="기념일 유형"
                >
                  <option value="">선택해주세요</option>
                  {ANNIVERSARY_OPTIONS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
            )}

            {/* 혼자 여행 */}
            {form.group_type === '혼자 여행' && (
              <div>
                <label className="block text-sm font-semibold mb-2">가이드 동행 여부</label>
                <div className="grid grid-cols-1 gap-2">
                  {SOLO_GUIDE_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => update('solo_guide', form.solo_guide === opt ? '' : opt)}
                      className={`py-3 rounded-xl text-sm font-semibold transition border ${
                        form.solo_guide === opt
                          ? 'bg-brand text-white border-brand'
                          : 'bg-white text-slate-700 border-gray-200 hover:border-brand/40'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setStep(2); setError(null); }}
                className="flex-1 bg-white text-slate-700 border border-gray-200 font-bold py-4 rounded-2xl text-lg hover:bg-gray-50 transition"
              >
                ← 이전
              </button>
              <button
                type="submit"
                className="flex-1 bg-brand hover:bg-[#1B64DA] text-white font-bold py-4 rounded-2xl text-lg transition"
              >
                다음 →
              </button>
            </div>
          </form>
        )}

        {/* ── Step 4: 예산 및 요청사항 ──────────────────── */}
        {step === 4 && (
          <form onSubmit={handleSubmit} className="bg-gray-50 rounded-3xl p-6 md:p-10 border border-gray-100 shadow-sm space-y-5">
            <p className="text-xs text-slate-500 mb-2">
              마지막 단계입니다. 예산과 요청사항을 알려주세요.
            </p>

            <div>
              <label className="block text-sm font-semibold mb-2">
                1인당 예산 (대략적인 구간) <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {BUDGET_OPTIONS.map((b) => (
                  <button
                    key={b.value}
                    type="button"
                    onClick={() => update('budget_label', form.budget_label === b.value ? '' : b.value)}
                    className={`py-3 rounded-xl text-sm font-semibold transition border ${
                      form.budget_label === b.value
                        ? 'bg-brand text-white border-brand'
                        : 'bg-white text-slate-700 border-gray-200 hover:border-brand/40'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">호텔 등급</label>
              <div className="grid grid-cols-2 gap-2">
                {HOTEL_OPTIONS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => update('hotel_grade', form.hotel_grade === h ? '' : h)}
                    className={`py-3 rounded-xl text-sm font-semibold transition border ${
                      form.hotel_grade === h
                        ? 'bg-brand text-white border-brand'
                        : 'bg-white text-slate-700 border-gray-200 hover:border-brand/40'
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">
                요청사항
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
                placeholder="이런 여행이었으면 좋겠어요! (예: '부모님 모시고 가는 효도여행이라 천천히 둘러볼 수 있는 일정이면 좋겠어요', '계모임 친구들과 신나는 파티 분위기 여행을 원해요')"
                rows={4}
                className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition resize-none"
              />
            </div>

            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setStep(3); setError(null); }}
                className="flex-1 bg-white text-slate-700 border border-gray-200 font-bold py-4 rounded-2xl text-lg hover:bg-gray-50 transition"
              >
                ← 이전
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 bg-brand hover:bg-[#1B64DA] disabled:bg-slate-400 text-white font-bold py-4 rounded-2xl text-lg transition"
              >
                {submitting ? '전송 중...' : '견적 요청 완료'}
              </button>
            </div>

            <p className="text-center text-xs text-slate-500">
              제출 후 전용 진행 링크로 자동 이동됩니다. 그곳에서 실시간 진행 상황을 확인하세요.
            </p>
          </form>
        )}
      </div>

      {/* ── 완료 화면 (견적 제출 후) ───────────────────── */}
      {doneData && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 text-center space-y-5 animate-in fade-in zoom-in duration-300">
            <div className="text-5xl">🎉</div>
            <h2 className="text-2xl font-bold text-gray-900">견적 요청 완료!</h2>
            <p className="text-sm text-slate-600">
              24시간 이내에 맞춤 제안을 보내드립니다.
              {doneData.shareUrl ? (
                <>
                  <br />
                  지금 바로 일행에게 견적 링크를 공유해보세요!
                </>
              ) : (
                <>
                  <br />
                  진행 상황은 아래 버튼에서 확인하세요.
                </>
              )}
            </p>

            <a
              href={`/rfq/${doneData.rfqId}`}
              className="block w-full bg-brand text-white py-3 rounded-xl font-semibold hover:bg-[#1B64DA] transition"
            >
              📋 견적 진행 상황 보기
            </a>

            {doneData.shareUrl && <ShareSection shareUrl={doneData.shareUrl} />}

            <button
              onClick={() => router.push('/')}
              className="w-full text-sm text-slate-500 py-2 hover:text-slate-700 transition"
            >
              홈으로 돌아가기
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
