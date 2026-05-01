'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { trackLead } from '@/components/MetaPixel';

// ─── 폼 선택지 정의 ────────────────────────────────────────
const PURPOSE_OPTIONS = [
  '기업 워크샵 · 포상',
  '협회 · 기관 · 연수',
  '치목 · 골프 · 동문',
  '패밀리 · 가족',
  '기타',
] as const;

const PAX_OPTIONS = [
  '10명',
  '15명',
  '20명',
  '30명',
  '40명',
  '50명',
  '60명',
  '70명',
  '80명',
  '100명 이상',
] as const;

const BUDGET_OPTIONS = [
  '~50만원',
  '50~80만원',
  '80~120만원',
  '120만원 이상',
  '미정',
] as const;

const HOTEL_OPTIONS = ['3성', '4성', '5성', '미정'] as const;
const SHOPPING_OPTIONS = ['쇼핑 희망', '노쇼핑'] as const;

// ─── 예산 라벨 → 숫자 변환 (budget_per_person 저장용) ─────
function parseBudgetLabel(label: string): number | undefined {
  switch (label) {
    case '~50만원':
      return 400_000;
    case '50~80만원':
      return 650_000;
    case '80~120만원':
      return 1_000_000;
    case '120만원 이상':
      return 1_500_000;
    default:
      return undefined;
  }
}

// ─── 인원 라벨 → 숫자 변환 (adult_count 저장용) ────────────
function parsePaxLabel(label: string): number {
  const n = parseInt(label.replace(/[^0-9]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

type FormState = {
  contact_name: string;
  contact_phone: string;
  group_name: string;
  purpose: string;
  destination: string;
  departure_date: string;
  pax_label: string;
  budget_label: string;
  hotel_grade: string;
  shopping: string;
  notes: string;
};

const INITIAL_FORM: FormState = {
  contact_name: '',
  contact_phone: '',
  group_name: '',
  purpose: '',
  destination: '',
  departure_date: '',
  pax_label: '',
  budget_label: '',
  hotel_grade: '',
  shopping: '',
  notes: '',
};

export default function GroupLandingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // URL hash 에 preset 쿼리(?preset=...)가 있으면 단체 유형 자동 선택
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    const match = hash.match(/preset=([^&]+)/);
    if (match) {
      const preset = decodeURIComponent(match[1]);
      const mapped = PURPOSE_OPTIONS.find((p) => p.includes(preset.split(' ')[0]));
      if (mapped) setForm((f) => ({ ...f, purpose: mapped }));
    }
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // ── 필수 필드 검증 ────────────────────────────────────
    if (
      !form.contact_name ||
      !form.contact_phone ||
      !form.group_name ||
      !form.purpose ||
      !form.destination ||
      !form.departure_date ||
      !form.pax_label ||
      !form.budget_label
    ) {
      setError('필수 항목을 모두 입력해주세요.');
      return;
    }

    const adultCount = parsePaxLabel(form.pax_label);
    if (adultCount === 0) {
      setError('인원수를 다시 확인해주세요.');
      return;
    }

    setSubmitting(true);

    try {
      // ── UTM / 네이버 키워드 수집 ─────────────────────────
      const utm = {
        source: searchParams.get('utm_source'),
        medium: searchParams.get('utm_medium'),
        campaign: searchParams.get('utm_campaign'),
        n_keyword: searchParams.get('n_keyword'),
      };

      // ── /api/rfq 로 POST (기존 엔드포인트 재사용) ─────────
      const payload = {
        // 정규 컬럼
        customer_name: form.contact_name,
        customer_phone: form.contact_phone,
        destination: form.destination,
        departure_date_from: form.departure_date,
        adult_count: adultCount,
        child_count: 0,
        budget_per_person: parseBudgetLabel(form.budget_label),
        hotel_grade: form.hotel_grade || undefined,
        special_requests: form.notes || undefined,
        // 랜딩 전용 메타데이터는 JSONB 에 집어넣어 보존
        custom_requirements: {
          source: 'group_landing',
          group_name: form.group_name,
          purpose: form.purpose,
          shopping_preference: form.shopping || undefined,
          budget_range_label: form.budget_label,
          pax_label: form.pax_label,
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

      // ── Meta Pixel Lead 이벤트 ───────────────────────────
      trackLead({ content_name: '단체여행 견적', value: 0 });

      // ── 성공: 고객 전용 진행 링크로 이동 ──────────────────
      router.push(`/rfq/${data.rfq.id}`);
    } catch (err) {
      console.error('견적 요청 실패:', err);
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
      setSubmitting(false);
    }
  }

  return (
    <section id="group-inquiry-form" className="bg-white py-16 md:py-20 px-4">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-3">견적 요청하기</h2>
        <p className="text-center text-slate-600 mb-10 text-sm">
          접수 즉시 담당자가 확인하고 당일 내 회신드립니다
        </p>

        <form
          onSubmit={handleSubmit}
          className="bg-gray-50 rounded-3xl p-6 md:p-10 border border-gray-100 shadow-sm space-y-5"
        >
          {/* 신청자 성함 */}
          <div>
            <label className="block text-sm font-semibold mb-2">
              신청자 성함 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.contact_name}
              onChange={(e) => update('contact_name', e.target.value)}
              placeholder="홍길동"
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6] focus:border-transparent transition"
              required
            />
          </div>

          {/* 연락처 */}
          <div>
            <label className="block text-sm font-semibold mb-2">
              연락처 <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={form.contact_phone}
              onChange={(e) => update('contact_phone', e.target.value)}
              placeholder="010-0000-0000"
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6] focus:border-transparent transition"
              required
            />
          </div>

          {/* 단체명 */}
          <div>
            <label className="block text-sm font-semibold mb-2">
              단체명 (회사·모임명) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.group_name}
              onChange={(e) => update('group_name', e.target.value)}
              placeholder="OO 연수원"
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6] focus:border-transparent transition"
              required
            />
          </div>

          {/* 단체 성격 */}
          <div>
            <label className="block text-sm font-semibold mb-2">
              단체 성격 <span className="text-red-500">*</span>
            </label>
            <select
              value={form.purpose}
              onChange={(e) => update('purpose', e.target.value)}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6] focus:border-transparent transition"
              required
            >
              <option value="">선택해주세요</option>
              {PURPOSE_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* 희망 여행지 */}
          <div>
            <label className="block text-sm font-semibold mb-2">
              희망 여행지 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.destination}
              onChange={(e) => update('destination', e.target.value)}
              placeholder="다낭, 세부, 장가계 등"
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6] focus:border-transparent transition"
              required
            />
          </div>

          {/* 희망 출발일 */}
          <div>
            <label className="block text-sm font-semibold mb-2">
              희망 출발일 <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={form.departure_date}
              onChange={(e) => update('departure_date', e.target.value)}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6] focus:border-transparent transition"
              required
            />
          </div>

          {/* 예상 인원 */}
          <div>
            <label className="block text-sm font-semibold mb-2">
              예상 인원 <span className="text-red-500">*</span>
            </label>
            <select
              value={form.pax_label}
              onChange={(e) => update('pax_label', e.target.value)}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6] focus:border-transparent transition"
              required
            >
              <option value="">선택해주세요</option>
              {PAX_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* 1인 예산 */}
          <div>
            <label className="block text-sm font-semibold mb-2">
              1인 예산 <span className="text-red-500">*</span>
            </label>
            <select
              value={form.budget_label}
              onChange={(e) => update('budget_label', e.target.value)}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6] focus:border-transparent transition"
              required
            >
              <option value="">선택해주세요</option>
              {BUDGET_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          {/* 구분선: 선택 항목 */}
          <div className="pt-4 border-t border-gray-200">
            <p className="text-xs text-slate-500 mb-4">선택 항목 (아래는 비워두셔도 됩니다)</p>
          </div>

          {/* 호텔 등급 */}
          <div>
            <label className="block text-sm font-semibold mb-2">호텔 등급</label>
            <div className="grid grid-cols-4 gap-2">
              {HOTEL_OPTIONS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => update('hotel_grade', form.hotel_grade === h ? '' : h)}
                  className={`py-2.5 rounded-xl text-sm font-semibold transition border ${
                    form.hotel_grade === h
                      ? 'bg-[#3182F6] text-white border-[#3182F6]'
                      : 'bg-white text-slate-700 border-gray-200 hover:border-[#3182F6]/40'
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>

          {/* 쇼핑 포함 */}
          <div>
            <label className="block text-sm font-semibold mb-2">쇼핑 포함</label>
            <div className="grid grid-cols-2 gap-2">
              {SHOPPING_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => update('shopping', form.shopping === s ? '' : s)}
                  className={`py-2.5 rounded-xl text-sm font-semibold transition border ${
                    form.shopping === s
                      ? 'bg-[#3182F6] text-white border-[#3182F6]'
                      : 'bg-white text-slate-700 border-gray-200 hover:border-[#3182F6]/40'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* 요청사항 */}
          <div>
            <label className="block text-sm font-semibold mb-2">요청사항</label>
            <textarea
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="특별히 요청하실 사항이 있으시면 자유롭게 입력해주세요"
              rows={4}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6] focus:border-transparent transition resize-none"
            />
          </div>

          {/* 에러 표시 */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
              {error}
            </div>
          )}

          {/* 제출 버튼 */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-[#3182F6] hover:bg-[#1B64DA] disabled:bg-slate-400 text-white font-bold py-4 rounded-2xl text-lg transition"
          >
            {submitting ? '전송 중...' : '견적 요청하기'}
          </button>

          <p className="text-center text-xs text-slate-500">
            제출 후 전용 진행 링크로 자동 이동되며, 그곳에서 실시간 진행 상황을 확인하실 수 있습니다.
          </p>
        </form>
      </div>
    </section>
  );
}
