'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

// ── 타입 ────────────────────────────────────────────────────────────

interface PassengerRow {
  id: string;
  name: string;
  phone: string;
  birth_date: string;
  gender: 'male' | 'female' | 'unknown';
  ageGroup: 'adult' | 'child' | 'infant';  // 성인/소아/유아
  isRep: boolean;                           // 대표자 여부 (라디오 체크)
  passport_no: string;
  passport_expiry: string;
  confidence: number;
}

interface Triple {
  entity_name: string;
  entity_type: string;
  aspect: string | null;
  sentiment_score: number;
  sentiment_label: string;
  demographic: string | null;
  phase: string | null;
  snippet: string;
  confidence: number;
}

interface BookingDraft {
  destination: string | null;
  departure_region: string | null;
  departure_date: string | null;
  duration_nights: number | null;
  adult_count: number | null;
  child_count: number | null;
  unit_price_krw: number | null;
  total_price_krw: number | null;
  deposit_krw: number | null;
  balance_krw: number | null;
  status: string | null;
  land_operator_hint: string | null;
  product_title_hint: string | null;
  passenger_names_count: number | null;
  notes: string | null;
}

interface PreviewResponse {
  preview?: boolean;
  message_count?: number;
  triple_count?: number;
  redaction_report?: {
    phones_masked?: number;
    names_masked?: number;
    passports_masked?: number;
    accounts_masked?: number;
    emails_masked?: number;
  };
  booking_draft?: BookingDraft | null;
  detected_demographic?: string | null;
  conversation_phase?: string | null;
  summary?: string;
  triples?: Triple[];
}

interface SaveResult {
  bronzeId: string;
  bookingId?: string;
  bookingNo?: string;
  customerCount?: number;
}

// ── 상수 ────────────────────────────────────────────────────────────

const SENTIMENT_COLOR: Record<string, string> = {
  positive: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  negative: 'bg-rose-50 text-rose-700 border-rose-200',
  neutral: 'bg-gray-50 text-gray-600 border-gray-200',
  mixed: 'bg-amber-50 text-amber-700 border-amber-200',
  concern: 'bg-orange-50 text-orange-700 border-orange-200',
};

const PHASE_LABEL: Record<string, string> = {
  pre_inquiry: '문의', objection: '거절요인', decision_driver: '결정요인',
  booking: '예약확정', decided: '입금완료', mid_trip: '여행중',
  post_trip: '후기', failure: '실패경험', praise: '칭찬',
  price_negotiation: '가격조정', cancellation: '취소', follow_up: '사후문의',
};

const DEMO_LABEL: Record<string, string> = {
  honeymoon: '신혼', family_with_toddler: '가족(영유아)',
  family_with_kids: '가족(아동)', family_with_teens: '가족(청소년)',
  senior: '시니어', friend_group: '친구그룹',
  solo: '혼행', business: '비즈니스', three_generation: '3대가족',
};

const CONV_PHASE_LABEL: Record<string, string> = {
  inquiry_only: '문의만', negotiation: '협상·고민',
  booking_in_progress: '예약진행중', booked: '예약완료',
  post_trip: '여행후', cancelled: '취소',
};

const AGE_GROUP_LABEL: Record<string, string> = {
  adult: '성인', child: '소아', infant: '유아',
};

const GENDER_LABEL: Record<string, string> = {
  male: '남', female: '여', unknown: '미상',
};

// ── 유틸 ────────────────────────────────────────────────────────────

let _uidSeq = 0;
function uid() { return `p-${++_uidSeq}`; }

function candidateToRow(
  c: {
    name: string | null; phone: string | null; birth_date: string | null;
    gender: string; role: string; passport_no: string | null;
    passport_expiry: string | null; confidence: number;
  },
  isFirst: boolean,
): PassengerRow {
  const isRep = c.role === 'representative' || isFirst;
  const ageGroup: PassengerRow['ageGroup'] =
    c.role === 'infant' ? 'infant' : c.role === 'child' ? 'child' : 'adult';
  return {
    id: uid(),
    name: c.name ?? '',
    phone: c.phone ?? '',
    birth_date: c.birth_date ?? '',
    gender: (c.gender as PassengerRow['gender']) ?? 'unknown',
    ageGroup,
    isRep,
    passport_no: c.passport_no ?? '',
    passport_expiry: c.passport_expiry ?? '',
    confidence: c.confidence,
  };
}

function emptyRow(ageGroup: PassengerRow['ageGroup'] = 'adult', isRep = false): PassengerRow {
  return { id: uid(), name: '', phone: '', birth_date: '', gender: 'unknown', ageGroup, isRep, passport_no: '', passport_expiry: '', confidence: 1 };
}

// 카톡 추출 상태 → 예약 초기 상태 변환.
// 입금 확인은 반드시 은행 거래 매칭으로만 — 대화 내용만으로 결제 상태 자동 진행 금지.
function draftStatusToBookingStatus(draftStatus: string | null, convPhase: string | null): string {
  if (draftStatus === 'cancelled' || convPhase === 'cancelled') return 'cancelled';
  // 입금 관련 상태는 'waiting_deposit' 이하로만 — 실제 입금 확인은 은행 매칭에서
  if (draftStatus === 'fully_paid' || draftStatus === 'deposit_paid' || draftStatus === 'waiting_balance') return 'waiting_deposit';
  if (draftStatus === 'waiting_deposit') return 'waiting_deposit';
  if (convPhase === 'booked' || convPhase === 'booking_in_progress') return 'waiting_deposit';
  return 'pending';
}

// ── 컴포넌트 ─────────────────────────────────────────────────────────

export default function KakaoImportPage() {
  const [rawText, setRawText] = useState('');
  const [consentForPool, setConsentForPool] = useState(true);
  const [autoExtracting, setAutoExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [passengers, setPassengers] = useState<PassengerRow[]>([]);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const autoExtract = useCallback(async (text: string, consent: boolean) => {
    setAutoExtracting(true);
    setError(null);
    try {
      const res = await fetch('/api/kakao/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: text, consent_for_pool: consent, preview_only: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ? `${data.error ?? '요청 실패'} — ${data.detail}` : (data.error ?? '요청 실패'));
        return;
      }
      setPreview({
        preview: true,
        message_count: data.messages?.length ?? 0,
        triple_count: data.extraction?.triples?.length ?? 0,
        redaction_report: data.redaction_report ?? {},
        booking_draft: data.extraction?.booking_draft ?? null,
        detected_demographic: data.extraction?.detected_demographic ?? null,
        conversation_phase: data.extraction?.conversation_phase ?? null,
        summary: data.extraction?.summary ?? '',
        triples: data.extraction?.triples ?? [],
      });

      const candidates = (data.passenger_candidates ?? []) as Array<{
        name: string | null; phone: string | null; birth_date: string | null;
        gender: string; role: string; passport_no: string | null;
        passport_expiry: string | null; confidence: number;
      }>;

      if (candidates.length > 0) {
        // LLM이 이미 representative를 식별했으면 그대로, 아니면 첫 번째가 대표자
        const hasRep = candidates.some(c => c.role === 'representative');
        const rows = candidates.map((c, i) =>
          candidateToRow(c, !hasRep && i === 0)
        );
        // 대표자가 여럿이면 첫 번째만 유지
        const firstRepIdx = rows.findIndex(r => r.isRep);
        if (firstRepIdx >= 0) {
          rows.forEach((r, i) => { if (i !== firstRepIdx) r.isRep = false; });
        }
        setPassengers(rows);
      } else {
        // 후보 없으면 대표자 빈 행 하나
        setPassengers([emptyRow('adult', true)]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '네트워크 오류');
    } finally {
      setAutoExtracting(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (rawText.trim().length < 10) { setPreview(null); setPassengers([]); return; }
    debounceRef.current = setTimeout(() => autoExtract(rawText, consentForPool), 3000);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [rawText, consentForPool, autoExtract]);

  // 대표자 지정 — 라디오 버튼 동작 (하나만)
  const setRep = (id: string) => {
    setPassengers(ps => ps.map(p => ({ ...p, isRep: p.id === id })));
  };

  // 문자열 필드 편집
  const updateRow = (id: string, field: keyof Omit<PassengerRow, 'id' | 'isRep' | 'confidence'>, value: string) => {
    setPassengers(ps => ps.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const addRow = (ageGroup: PassengerRow['ageGroup'] = 'adult') =>
    setPassengers(ps => [...ps, emptyRow(ageGroup, ps.length === 0)]);

  const removeRow = (id: string) =>
    setPassengers(ps => {
      const next = ps.filter(p => p.id !== id);
      // 대표자를 지웠으면 첫 번째 행을 자동으로 대표자로
      if (ps.find(p => p.id === id)?.isRep && next.length > 0) {
        next[0].isRep = true;
      }
      return next;
    });

  const repRow = passengers.find(p => p.isRep);
  const canSave = rawText.trim().length >= 10 && !!preview && !autoExtracting;
  const hasPassengers = passengers.some(p => p.name.trim() || p.phone.trim());

  const handleSaveConfirm = async () => {
    setShowModal(false);
    setSaving(true);
    setError(null);
    setSaveResult(null);

    let bronzeId = '';
    try {
      // 1. Bronze 저장
      const ingestRes = await fetch('/api/kakao/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText, consent_for_pool: consentForPool, preview_only: false }),
      });
      const ingestData = await ingestRes.json();
      if (!ingestRes.ok) {
        setError(ingestData.detail ? `${ingestData.error} — ${ingestData.detail}` : (ingestData.error ?? 'Bronze 저장 실패'));
        return;
      }
      bronzeId = ingestData.bronze_event_id;

      // 일행 없으면 Bronze만
      if (!hasPassengers || !repRow?.name.trim()) {
        setSaveResult({ bronzeId });
        return;
      }

      // 2. 모든 일행을 customers에 병렬 등록
      const passengersToRegister = passengers.filter(p => p.name.trim() || p.phone.trim());
      const customerResults = await Promise.allSettled(
        passengersToRegister.map(p =>
          fetch('/api/customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: p.name.trim() || '미확인',
              phone: p.phone.trim() || undefined,
              birth_date: p.birth_date || undefined,
              passport_no: p.passport_no || undefined,
              passport_expiry: p.passport_expiry || undefined,
            }),
          }).then(r => r.json())
        )
      );

      // 대표자 customer ID 추출
      const repIdx = passengersToRegister.findIndex(p => p.isRep);
      const repResult = repIdx >= 0 ? customerResults[repIdx] : null;
      if (!repResult || repResult.status === 'rejected') {
        setError('대표자 고객 등록 실패');
        setSaveResult({ bronzeId });
        return;
      }
      const leadCustomerId: string = repResult.value?.customer?.id ?? repResult.value?.id;
      if (!leadCustomerId) {
        setError(`대표자 고객 등록 응답 이상: ${JSON.stringify(repResult.value)}`);
        setSaveResult({ bronzeId });
        return;
      }

      // 등록 성공한 고객 수
      const registeredCount = customerResults.filter(r => r.status === 'fulfilled').length;

      // 3. 동행자(대표자 제외) companions 배열 구성
      const companions = passengersToRegister
        .filter((_, i) => i !== repIdx)
        .map(p => ({
          name: p.name.trim() || '미확인',
          phone: p.phone.trim() || undefined,
          passport_no: p.passport_no.trim() || undefined,
          passport_expiry: p.passport_expiry.trim() || undefined,
        }));

      // 4. 예약 생성
      const draft = preview?.booking_draft;
      const adultCount = draft?.adult_count ?? (passengersToRegister.filter(p => p.ageGroup === 'adult').length || 1);
      const childCount = draft?.child_count ?? passengersToRegister.filter(p => p.ageGroup === 'child').length;
      const infantCount = passengersToRegister.filter(p => p.ageGroup === 'infant').length;
      const adultPrice = draft?.unit_price_krw ?? 0;
      const childPrice = childCount > 0 && draft?.total_price_krw
        ? Math.round((draft.total_price_krw - adultCount * adultPrice) / childCount)
        : 0;

      const bkgRes = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadCustomerId,
          packageTitle: draft?.product_title_hint ?? draft?.destination ?? '미확인 상품',
          adultCount,
          childCount,
          infantCount,
          adultPrice,
          adultCost: adultPrice,
          childPrice,
          childCost: childPrice,
          infantCost: 0,
          fuelSurcharge: 0,
          departureDate: draft?.departure_date ?? undefined,
          departureRegion: draft?.departure_region ?? undefined,
          landOperator: draft?.land_operator_hint ?? undefined,
          status: draftStatusToBookingStatus(draft?.status ?? null, preview?.conversation_phase ?? null),
          paidAmount: 0,  // 입금 확인은 은행 거래 매칭에서만 — 카톡 내용 기반 자동 입금처리 금지
          notes: draft?.notes ?? undefined,
          companions,
          idempotencyKey: bronzeId,
        }),
      });
      const bkgData = await bkgRes.json();
      if (!bkgRes.ok) {
        setError(`예약 생성 실패: ${bkgData.error ?? '알 수 없는 오류'}`);
        setSaveResult({ bronzeId, customerCount: registeredCount });
        return;
      }
      setSaveResult({
        bronzeId,
        bookingId: bkgData.booking?.id ?? bkgData.id,
        bookingNo: bkgData.booking?.booking_no ?? bkgData.booking_no ?? '',
        customerCount: registeredCount,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '네트워크 오류');
      if (bronzeId) setSaveResult({ bronzeId });
    } finally {
      setSaving(false);
    }
  };

  const fmtKRW = (n: number | null | undefined) => (n != null && n > 0) ? `${n.toLocaleString()}원` : '—';
  const piiTotal = (preview?.redaction_report?.phones_masked ?? 0)
    + (preview?.redaction_report?.names_masked ?? 0)
    + (preview?.redaction_report?.passports_masked ?? 0)
    + (preview?.redaction_report?.accounts_masked ?? 0)
    + (preview?.redaction_report?.emails_masked ?? 0);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">카카오톡 대화 → 일괄 등록</h1>
            <p className="text-sm text-gray-500 mt-1">
              붙여넣기 → 자동 추출 → 일행 확인 → 1클릭으로 Bronze + 고객 등록 + 예약 생성
            </p>
          </div>
          <Link href="/admin" className="text-sm text-blue-600 hover:underline">← 어드민 홈</Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── 좌측: 입력 + 일행 테이블 ── */}
          <div className="space-y-4">
            {/* 텍스트 입력 */}
            <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">카카오톡 전문 붙여넣기</h2>
                {autoExtracting && (
                  <span className="text-xs text-blue-600 flex items-center gap-1.5">
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                    추출 중…
                  </span>
                )}
              </div>
              <textarea
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                placeholder="카카오톡 채팅 export 텍스트를 붙여넣으세요. 3초 후 일행 + KTKG 자동 추출이 시작됩니다."
                rows={12}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <div className="text-xs text-gray-500 flex items-center justify-between">
                <span>{rawText.length.toLocaleString()}자</span>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consentForPool}
                    onChange={e => setConsentForPool(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <span>산업 풀 기여</span>
                </label>
              </div>
            </div>

            {/* 일행 편집 테이블 */}
            {(passengers.length > 0 || autoExtracting) && (
              <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-gray-900">일행 확인 · 수정</h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                      별표(★) 클릭으로 대표자 지정 · 모든 일행이 고객으로 등록됩니다
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => addRow('adult')} className="text-xs text-blue-600 hover:underline">+ 성인</button>
                    <button onClick={() => addRow('child')} className="text-xs text-blue-600 hover:underline">+ 소아</button>
                    <button onClick={() => addRow('infant')} className="text-xs text-blue-600 hover:underline">+ 유아</button>
                  </div>
                </div>

                {autoExtracting && passengers.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-4">일행 정보 추출 중…</p>
                )}

                <div className="space-y-2">
                  {passengers.map((p) => (
                    <div
                      key={p.id}
                      className={`border rounded-lg p-3 space-y-2 text-xs transition-colors ${
                        p.isRep
                          ? 'border-amber-300 bg-amber-50/50'
                          : 'border-gray-200'
                      }`}
                    >
                      {/* 헤더 행: 대표자 라디오 + 성인/소아/유아 + 성별 + 삭제 */}
                      <div className="flex items-center gap-2">
                        {/* 대표자 라디오 버튼 */}
                        <button
                          onClick={() => setRep(p.id)}
                          title="대표자로 지정"
                          className={`text-base leading-none transition-colors ${
                            p.isRep ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'
                          }`}
                        >
                          ★
                        </button>
                        {p.isRep && (
                          <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                            대표자
                          </span>
                        )}
                        <select
                          value={p.ageGroup}
                          onChange={e => updateRow(p.id, 'ageGroup', e.target.value)}
                          className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white"
                        >
                          {Object.entries(AGE_GROUP_LABEL).map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                        <select
                          value={p.gender}
                          onChange={e => updateRow(p.id, 'gender', e.target.value)}
                          className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white w-16"
                        >
                          {Object.entries(GENDER_LABEL).map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                        {p.confidence < 0.5 && (
                          <span className="text-amber-600 text-[10px]">⚠ 확인 필요</span>
                        )}
                        <button
                          onClick={() => removeRow(p.id)}
                          className="ml-auto text-gray-400 hover:text-rose-500 text-[11px]"
                        >
                          삭제
                        </button>
                      </div>

                      {/* 정보 입력 필드 */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-0.5">이름</label>
                          <input
                            type="text"
                            value={p.name}
                            onChange={e => updateRow(p.id, 'name', e.target.value)}
                            placeholder="홍길동"
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-0.5">전화번호</label>
                          <input
                            type="tel"
                            value={p.phone}
                            onChange={e => updateRow(p.id, 'phone', e.target.value)}
                            placeholder="010-1234-5678"
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-0.5">생년월일</label>
                          <input
                            type="text"
                            value={p.birth_date}
                            onChange={e => updateRow(p.id, 'birth_date', e.target.value)}
                            placeholder="YYYY-MM-DD"
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-0.5">여권번호</label>
                          <input
                            type="text"
                            value={p.passport_no}
                            onChange={e => updateRow(p.id, 'passport_no', e.target.value)}
                            placeholder="M12345678"
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                        </div>
                        {p.passport_no && (
                          <div className="col-span-2">
                            <label className="block text-[10px] text-gray-500 mb-0.5">여권만료일</label>
                            <input
                              type="text"
                              value={p.passport_expiry}
                              onChange={e => updateRow(p.id, 'passport_expiry', e.target.value)}
                              placeholder="YYYY-MM-DD"
                              className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {passengers.length > 0 && !repRow && (
                  <p className="text-xs text-amber-600">★ 클릭으로 대표자를 지정해주세요.</p>
                )}
              </div>
            )}

            {/* 저장 버튼 */}
            <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
              <button
                onClick={() => setShowModal(true)}
                disabled={saving || autoExtracting || !canSave}
                className="w-full bg-emerald-600 text-white py-3 rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {saving
                  ? '저장 중…'
                  : hasPassengers && repRow?.name.trim()
                    ? `Bronze 저장 + 고객 ${passengers.filter(p => p.name.trim() || p.phone.trim()).length}명 + 예약 생성`
                    : 'Bronze 저장'}
              </button>
              {!canSave && rawText.trim().length >= 10 && !autoExtracting && (
                <p className="text-xs text-gray-400 text-center">추출 완료 후 활성화됩니다.</p>
              )}
              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-700">{error}</div>
              )}
              {saveResult && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded space-y-1 text-sm text-emerald-700">
                  <div>✓ Bronze 저장 완료</div>
                  {saveResult.customerCount != null && (
                    <div>✓ 고객 {saveResult.customerCount}명 등록 완료</div>
                  )}
                  {saveResult.bookingNo && (
                    <div>
                      ✓ 예약 생성 —{' '}
                      <Link
                        href={`/admin/bookings/${saveResult.bookingId}`}
                        className="font-semibold underline hover:text-emerald-900"
                      >
                        {saveResult.bookingNo}
                      </Link>
                      <span className="text-xs text-emerald-600 ml-1">(클릭 후 일행 확인)</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── 우측: KTKG 추출 결과 ── */}
          <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
            <h2 className="font-semibold text-gray-900">추출 결과 (자동 미리보기)</h2>

            {!preview && !autoExtracting && (
              <p className="text-sm text-gray-400 py-12 text-center">
                대화를 붙여넣으면 3초 후 결과가 표시됩니다.
              </p>
            )}
            {!preview && autoExtracting && (
              <div className="py-12 flex flex-col items-center gap-3 text-gray-400">
                <svg className="animate-spin h-6 w-6 text-blue-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                <span className="text-sm">PII 제거 + KTKG 추출 + 일행 분석 중…</span>
              </div>
            )}

            {preview && (
              <>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-gray-50 rounded p-2">
                    <div className="text-gray-500">메시지</div>
                    <div className="text-lg font-bold text-gray-900">{preview.message_count ?? 0}</div>
                  </div>
                  <div className="bg-gray-50 rounded p-2">
                    <div className="text-gray-500">KTKG 트리플</div>
                    <div className="text-lg font-bold text-gray-900">{preview.triple_count ?? 0}</div>
                  </div>
                  <div className="bg-gray-50 rounded p-2">
                    <div className="text-gray-500">PII 마스킹</div>
                    <div className="text-lg font-bold text-gray-900">{piiTotal}</div>
                  </div>
                </div>

                {(preview.conversation_phase || preview.detected_demographic) && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {preview.conversation_phase && (
                      <span className="text-xs font-medium px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                        {CONV_PHASE_LABEL[preview.conversation_phase] ?? preview.conversation_phase}
                      </span>
                    )}
                    {preview.detected_demographic && (
                      <span className="text-xs font-medium px-2 py-0.5 bg-purple-100 text-purple-800 rounded-full">
                        {DEMO_LABEL[preview.detected_demographic] ?? preview.detected_demographic}
                      </span>
                    )}
                  </div>
                )}

                {preview.summary && (
                  <div className="bg-blue-50 border border-blue-100 rounded p-3 text-sm text-blue-900">
                    <div className="text-xs font-semibold text-blue-700 mb-1">요약</div>
                    {preview.summary}
                  </div>
                )}

                {preview.booking_draft && (
                  <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                    <h3 className="text-sm font-semibold text-gray-900">예약 Draft</h3>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <div><span className="text-gray-500">목적지:</span> {preview.booking_draft.destination ?? '—'}</div>
                      <div><span className="text-gray-500">출발지:</span> {preview.booking_draft.departure_region ?? '—'}</div>
                      <div><span className="text-gray-500">출발일:</span> {preview.booking_draft.departure_date ?? '—'}</div>
                      <div><span className="text-gray-500">기간:</span> {preview.booking_draft.duration_nights ? `${preview.booking_draft.duration_nights}박` : '—'}</div>
                      <div><span className="text-gray-500">성인/소아:</span> {preview.booking_draft.adult_count ?? 0}/{preview.booking_draft.child_count ?? 0}</div>
                      <div><span className="text-gray-500">상태:</span> {preview.booking_draft.status ?? '—'}</div>
                      <div><span className="text-gray-500">단가:</span> {fmtKRW(preview.booking_draft.unit_price_krw)}</div>
                      <div><span className="text-gray-500">총액:</span> {fmtKRW(preview.booking_draft.total_price_krw)}</div>
                      <div><span className="text-gray-500">계약금:</span> {fmtKRW(preview.booking_draft.deposit_krw)}</div>
                      <div><span className="text-gray-500">잔금:</span> {fmtKRW(preview.booking_draft.balance_krw)}</div>
                    </div>
                    {preview.booking_draft.product_title_hint && (
                      <div className="text-xs pt-1 border-t border-gray-100">
                        <span className="text-gray-500">상품 hint:</span> {preview.booking_draft.product_title_hint}
                      </div>
                    )}
                    {preview.booking_draft.notes && (
                      <div className="text-xs text-gray-600 pt-1 border-t border-gray-100">{preview.booking_draft.notes}</div>
                    )}
                  </div>
                )}

                {(preview.triples?.length ?? 0) > 0 && (
                  <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                    <h3 className="text-sm font-semibold text-gray-900 sticky top-0 bg-white py-1">
                      KTKG 트리플 ({preview.triples?.length ?? 0})
                    </h3>
                    {(preview.triples ?? []).map((t, i) => (
                      <div key={i} className={`border rounded p-2 text-xs ${SENTIMENT_COLOR[t.sentiment_label] ?? 'bg-gray-50 border-gray-200'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">
                            {t.entity_name}
                            <span className="ml-1 text-[10px] font-normal opacity-60">{t.entity_type}</span>
                          </span>
                          <span className="text-[10px] tabular-nums">
                            {t.sentiment_score > 0 ? '+' : ''}{t.sentiment_score.toFixed(1)}
                          </span>
                        </div>
                        {t.aspect && <div className="text-[10px] mt-0.5 opacity-80">aspect: {t.aspect}</div>}
                        {(t.demographic || t.phase) && (
                          <div className="text-[10px] mt-0.5 flex gap-1.5">
                            {t.demographic && <span>👥 {DEMO_LABEL[t.demographic] ?? t.demographic}</span>}
                            {t.phase && <span>🎯 {PHASE_LABEL[t.phase] ?? t.phase}</span>}
                          </div>
                        )}
                        <div className="text-[11px] mt-1 italic opacity-90">"{t.snippet}"</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* 확인 모달 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">일괄 등록 확인</h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex gap-2">
                <span className="text-blue-500 font-bold shrink-0">①</span>
                <div>
                  <span className="font-medium">Bronze 저장</span>
                  <div className="text-xs text-gray-500">{preview?.triple_count ?? 0}개 KTKG 트리플 + PII 제거 원문 (불가역)</div>
                </div>
              </div>
              {hasPassengers && repRow?.name.trim() && (
                <>
                  <div className="flex gap-2">
                    <span className="text-emerald-500 font-bold shrink-0">②</span>
                    <div>
                      <span className="font-medium">고객 등록</span>
                      <span className="text-xs text-gray-500 ml-1">{passengers.filter(p => p.name.trim() || p.phone.trim()).length}명</span>
                      <div className="text-xs text-gray-500 mt-0.5 space-y-0.5">
                        {passengers.filter(p => p.name.trim() || p.phone.trim()).map(p => (
                          <div key={p.id} className="flex items-center gap-1">
                            {p.isRep && <span className="text-amber-500 text-[10px]">★</span>}
                            <span>{p.name || '이름미상'}</span>
                            <span className="text-gray-400">({AGE_GROUP_LABEL[p.ageGroup]})</span>
                            {p.phone && <span className="text-gray-400">{p.phone}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-emerald-500 font-bold shrink-0">③</span>
                    <div>
                      <span className="font-medium">예약 생성</span>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {preview?.booking_draft?.destination ?? '목적지미상'}
                        {preview?.booking_draft?.departure_date ? ` · ${preview.booking_draft.departure_date}` : ''}
                        {preview?.booking_draft?.total_price_krw ? ` · ${preview.booking_draft.total_price_krw.toLocaleString()}원` : ''}
                      </div>
                    </div>
                  </div>
                </>
              )}
              {(!hasPassengers || !repRow?.name.trim()) && (
                <div className="text-xs text-amber-600 bg-amber-50 rounded p-2">
                  대표자 이름 미입력 — Bronze만 저장됩니다. 예약은 나중에 /admin/bookings에서 수동 생성하세요.
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleSaveConfirm}
                className="flex-1 bg-emerald-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700"
              >
                확정 저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
