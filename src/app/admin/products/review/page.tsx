'use client';

/**
 * @file /admin/products/review/page.tsx
 * @description Phase 3 — 상품 검수 관제탑
 *
 * 좌측: DRAFT/REVIEW_NEEDED 상품 리스트 (신뢰도 낮은 순 정렬)
 * 우측: 3탭 — [검수] [FAQ 지식베이스] [마케팅 미리보기]
 * 최종 승인 시: status→ACTIVE + thumbnail + ai_training_logs 플라이휠
 */

import { useState, useEffect, useCallback } from 'react';

// ─── 타입 ──────────────────────────────────────────────────────────────────────

interface ProductPrice {
  id: string;
  target_date?: string | null;
  day_of_week?: string | null;
  net_price: number;
  adult_selling_price?: number | null;
  child_price?: number | null;
  note?: string | null;
}

interface ReviewProduct {
  internal_code: string;
  display_name: string;
  destination?: string | null;
  duration_days: number;
  net_price: number;
  status: string;
  source_filename?: string | null;
  ai_confidence_score?: number | null;
  theme_tags?: string[];
  selling_points?: { hotel?: string; airline?: string; unique?: string[] } | null;
  flight_info?: { airline?: string; flight_no?: string; depart?: string; arrive?: string; return_depart?: string; return_arrive?: string } | null;
  raw_extracted_text?: string | null;
  thumbnail_urls?: string[];
  highlights?: string[] | null;
  product_prices?: ProductPrice[];
  supplier_code?: string | null;
  supplier_name?: string | null;
  land_operator_id?: string | null;
}

interface PexelsPhoto {
  id: number;
  src: { medium: string; large: string };
  alt: string;
  photographer: string;
}

interface LandOperator {
  id: string;
  name: string;
  is_active?: boolean;
}

const CLIENT_SUPPLIER_MAP: Record<string, string> = {
  '투어비': 'TB', '투어폰': 'TP', '하나투어': 'HN', '모두투어': 'MD',
  '노랑풍선': 'NY', '롯데관광': 'LO', '참좋은여행': 'CJ', '온라인투어': 'OL',
  '베스트아시아': 'BA', '교원투어': 'KW', '인터파크': 'IP', '여행박사': 'YB',
  '자유투어': 'JY', '세중나모': 'SJ',
};

function deriveSupplierCode(name: string): string {
  for (const [key, code] of Object.entries(CLIENT_SUPPLIER_MAP)) {
    if (name.includes(key)) return code;
  }
  return 'ETC';
}

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────────

function ConfidenceBar({ score }: { score: number | null | undefined }) {
  const val = score ?? 0;
  const color = val >= 80 ? 'bg-emerald-500' : val >= 60 ? 'bg-amber-400' : 'bg-red-500';
  const label = val >= 80 ? '높음' : val >= 60 ? '보통' : '낮음';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-slate-500">AI 신뢰도</span>
        <span className={`font-bold ${val >= 80 ? 'text-emerald-600' : val >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
          {val}% / {label}
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${val}%` }} />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    DRAFT:          'bg-blue-50 text-blue-700',
    REVIEW_NEEDED:  'bg-amber-50 text-amber-700',
    draft:          'bg-slate-100 text-slate-600',
  };
  const label: Record<string, string> = {
    DRAFT: '초안', REVIEW_NEEDED: '검토필요', draft: '레거시',
  };
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${cfg[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {label[status] ?? status}
    </span>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function ProductReviewPage() {
  const [products, setProducts] = useState<ReviewProduct[]>([]);
  const [selected, setSelected] = useState<ReviewProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'review' | 'faq' | 'marketing'>('review');

  // 탭별 상태
  const [images, setImages] = useState<PexelsPhoto[]>([]);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [loadingImages, setLoadingImages] = useState(false);

  const [faq, setFaq] = useState<{ q: string; a: string }[]>([]);
  const [loadingFaq, setLoadingFaq] = useState(false);

  const [marketing, setMarketing] = useState<{ type: string; content: string } | null>(null);
  const [loadingMarketing, setLoadingMarketing] = useState(false);

  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  // 랜드사 목록 + 수동 지정
  const [landOperators, setLandOperators] = useState<LandOperator[]>([]);
  const [resolvedLandOperator, setResolvedLandOperator] = useState<LandOperator | null>(null);

  // 편집 가능한 theme_tags
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // 랜드사 목록 로드
  useEffect(() => {
    fetch('/api/land-operators')
      .then(r => r.json())
      .then(d => setLandOperators((d.operators ?? []).filter((o: LandOperator) => o.is_active !== false)))
      .catch(() => {});
  }, []);

  // 상품 목록 로드 — ETC 미상 상품 최상단
  useEffect(() => {
    setLoading(true);
    fetch('/api/products/review')
      .then(r => r.json())
      .then(d => {
        const list: ReviewProduct[] = d.products ?? [];
        list.sort((a, b) => {
          const aEtc = (!a.supplier_code || a.supplier_code === 'ETC') ? 0 : 1;
          const bEtc = (!b.supplier_code || b.supplier_code === 'ETC') ? 0 : 1;
          if (aEtc !== bEtc) return aEtc - bEtc;
          return (a.ai_confidence_score ?? 0) - (b.ai_confidence_score ?? 0);
        });
        setProducts(list);
      })
      .catch(() => showToast('목록 로드 실패', 'err'))
      .finally(() => setLoading(false));
  }, [showToast]);

  // 상품 선택 시 상태 초기화
  const selectProduct = useCallback((p: ReviewProduct) => {
    setSelected(p);
    setTags(p.theme_tags ?? []);
    setTagInput('');
    setImages([]);
    setSelectedImageUrl(null);
    setFaq([]);
    setMarketing(null);
    setTab('review');
    setResolvedLandOperator(null);
  }, []);

  // ── 이미지 불러오기 ────────────────────────────────────────────────────────

  const loadImages = async () => {
    if (!selected) return;
    setLoadingImages(true);
    try {
      const res = await fetch('/api/products/review?action=images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: selected.internal_code }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setImages(d.photos ?? []);
    } catch (e) {
      showToast(String(e), 'err');
    } finally {
      setLoadingImages(false);
    }
  };

  // ── FAQ 생성 ────────────────────────────────────────────────────────────────

  const generateFaq = async () => {
    if (!selected) return;
    setLoadingFaq(true);
    try {
      const res = await fetch('/api/products/review?action=faq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: selected.internal_code }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setFaq(d.faq ?? []);
    } catch (e) {
      showToast(String(e), 'err');
    } finally {
      setLoadingFaq(false);
    }
  };

  // ── 마케팅 생성 ────────────────────────────────────────────────────────────

  const generateMarketing = async (type: 'blog' | 'instagram' | 'itinerary') => {
    if (!selected) return;
    setLoadingMarketing(true);
    try {
      const res = await fetch('/api/products/review?action=marketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: selected.internal_code, type }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      if (type === 'itinerary') {
        setMarketing({ type, content: JSON.stringify(d.data, null, 2) });
      } else {
        setMarketing({ type, content: d.content ?? '' });
      }
    } catch (e) {
      showToast(String(e), 'err');
    } finally {
      setLoadingMarketing(false);
    }
  };

  // ── 최종 승인 ─────────────────────────────────────────────────────────────

  const approve = async () => {
    if (!selected) return;
    setApproving(true);
    // Optimistic: 목록에서 즉시 제거
    setProducts(ps => ps.filter(p => p.internal_code !== selected.internal_code));
    const removed = selected;
    setSelected(null);

    try {
      const res = await fetch('/api/products/review?action=approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: removed.internal_code,
          selected_image_url: selectedImageUrl,
          faq: faq.length ? faq : null,
          confidence_before: removed.ai_confidence_score,
          ...(resolvedLandOperator && (!removed.supplier_code || removed.supplier_code === 'ETC') && {
            resolved_supplier_id:   resolvedLandOperator.id,
            resolved_supplier_name: resolvedLandOperator.name,
            resolved_supplier_code: deriveSupplierCode(resolvedLandOperator.name),
          }),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      showToast(`승인 완료! 랜딩페이지 활성화: ${removed.display_name}`);
    } catch (e) {
      // 롤백
      setProducts(ps => [removed, ...ps]);
      setSelected(removed);
      showToast(String(e), 'err');
    } finally {
      setApproving(false);
    }
  };

  // ── 반려 ────────────────────────────────────────────────────────────────────

  const reject = async () => {
    if (!selected) return;
    const reason = window.prompt('반려 사유를 입력하세요 (선택)', '');
    if (reason === null) return; // 취소

    setRejecting(true);
    const removed = selected;
    setProducts(ps => ps.filter(p => p.internal_code !== removed.internal_code));
    setSelected(null);

    try {
      const res = await fetch('/api/products/review?action=reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: removed.internal_code, reason: reason || '검수 반려' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      showToast(`반려 처리: ${removed.display_name}`);
    } catch (e) {
      setProducts(ps => [removed, ...ps]);
      setSelected(removed);
      showToast(String(e), 'err');
    } finally {
      setRejecting(false);
    }
  };

  // ── tag 편집 헬퍼 ─────────────────────────────────────────────────────────

  const addTag = () => {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) return;
    setTags(ts => [...ts, t]);
    setTagInput('');
  };

  const removeTag = (tag: string) => setTags(ts => ts.filter(t => t !== tag));

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex h-[calc(100vh-56px)] overflow-hidden">

        {/* ── 좌측: 상품 리스트 ─────────────────────────────────────────────── */}
        <aside className="w-[260px] flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-[13px] font-bold text-slate-800">검수 대기</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">{products.length}건 / 신뢰도 낮은 순</p>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center text-[13px] text-slate-400">로딩 중...</div>
          ) : products.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400">
              <p className="text-[13px]">검수 대기 상품 없음</p>
            </div>
          ) : (
            <ul className="flex-1 overflow-y-auto">
              {products.map(p => (
                <li key={p.internal_code} className="border-b border-slate-200">
                  <button
                    onClick={() => selectProduct(p)}
                    className={`w-full text-left px-4 py-3 transition-colors hover:bg-slate-50 ${selected?.internal_code === p.internal_code ? 'bg-blue-50 border-l-2 border-l-blue-600' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <StatusBadge status={p.status} />
                      <span className={`text-[11px] font-bold ${(p.ai_confidence_score ?? 0) >= 80 ? 'text-emerald-600' : (p.ai_confidence_score ?? 0) >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                        {p.ai_confidence_score ?? 0}%
                      </span>
                    </div>
                    {(!p.supplier_code || p.supplier_code === 'ETC') && (
                      <span className="inline-block text-[11px] px-2 py-0.5 rounded-full font-semibold bg-red-50 text-red-600 mb-1">
                        랜드사 미상
                      </span>
                    )}
                    <p className="text-[13px] font-semibold text-slate-800 truncate leading-tight">{p.display_name}</p>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">{p.source_filename ?? p.internal_code}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ── 우측: 메인 영역 ───────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
              <p className="text-[14px]">좌측에서 상품을 선택하세요</p>
            </div>
          ) : (
            <>
              {/* 헤더 */}
              <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h1 className="text-[16px] font-bold text-slate-800 truncate">{selected.display_name}</h1>
                    <span className="text-[11px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded flex-shrink-0">
                      {selected.internal_code}
                    </span>
                  </div>
                  <p className="text-[13px] text-slate-500">
                    {selected.destination ?? '-'} / {selected.duration_days}일 / {selected.net_price?.toLocaleString()}원
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={reject}
                    disabled={approving || rejecting}
                    className="px-4 py-2 text-[13px] font-semibold rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors bg-white"
                  >
                    반려
                  </button>
                  <button
                    onClick={approve}
                    disabled={approving || rejecting}
                    className="px-5 py-2 text-[13px] font-bold rounded-lg bg-[#001f3f] text-white hover:bg-blue-900 disabled:opacity-40 transition-colors"
                  >
                    {approving ? '처리 중...' : '최종 승인'}
                  </button>
                </div>
              </div>

              {/* 탭 */}
              <div className="bg-white border-b border-slate-200 px-6">
                <div className="flex gap-6">
                  {(['review', 'faq', 'marketing'] as const).map(t => {
                    const labels = { review: '검수', faq: 'FAQ 지식베이스', marketing: '마케팅 미리보기' };
                    return (
                      <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={`py-3 text-[13px] font-semibold border-b-2 transition-colors ${tab === t ? 'border-[#001f3f] text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                      >
                        {labels[t]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 탭 콘텐츠 */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5">

                {/* ── 탭 1: 검수 ────────────────────────────────────────────── */}
                {tab === 'review' && (
                  <>
                    {/* 랜드사 미상 — 수동 지정 카드 */}
                    {(!selected.supplier_code || selected.supplier_code === 'ETC') && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-5">
                        <h3 className="text-[13px] font-bold text-red-700 mb-2">랜드사 미상 -- 수동 지정 필요</h3>
                        <p className="text-[13px] text-red-500 mb-3">
                          파일명/본문에서 랜드사를 자동 식별하지 못했습니다. 아래에서 랜드사를 선택하면 승인 시 영구 학습됩니다.
                        </p>
                        <select
                          value={resolvedLandOperator?.id ?? ''}
                          onChange={e => {
                            const op = landOperators.find(o => o.id === e.target.value) ?? null;
                            setResolvedLandOperator(op);
                          }}
                          className="w-full border border-red-200 rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-red-300"
                        >
                          <option value="">-- 랜드사 선택 --</option>
                          {landOperators.map(op => (
                            <option key={op.id} value={op.id}>{op.name}</option>
                          ))}
                        </select>
                        {resolvedLandOperator && (
                          <p className="mt-2 text-[13px] text-emerald-700 font-medium">
                            {resolvedLandOperator.name} 선택됨 -- 승인 시 영구 학습됩니다
                          </p>
                        )}
                      </div>
                    )}

                    {/* AI 신뢰도 바 */}
                    <div className="bg-white rounded-lg border border-slate-200 p-5">
                      <ConfidenceBar score={selected.ai_confidence_score} />
                    </div>

                    {/* selling_points */}
                    {selected.selling_points && (
                      <div className="bg-white rounded-lg border border-slate-200 p-5">
                        <h3 className="text-[13px] font-bold text-slate-800 mb-3">핵심 셀링포인트</h3>
                        <div className="grid grid-cols-3 gap-3">
                          {selected.selling_points.hotel && (
                            <div className="bg-blue-50 rounded-lg p-3">
                              <p className="text-[11px] text-blue-600 font-medium">호텔</p>
                              <p className="text-[13px] font-semibold text-slate-800 mt-1">{selected.selling_points.hotel}</p>
                            </div>
                          )}
                          {selected.selling_points.airline && (
                            <div className="bg-sky-50 rounded-lg p-3">
                              <p className="text-[11px] text-sky-600 font-medium">항공</p>
                              <p className="text-[13px] font-semibold text-slate-800 mt-1">{selected.selling_points.airline}</p>
                            </div>
                          )}
                          {(selected.selling_points.unique ?? []).length > 0 && (
                            <div className="bg-emerald-50 rounded-lg p-3 col-span-1">
                              <p className="text-[11px] text-emerald-600 font-medium">특전</p>
                              <ul className="mt-1 space-y-0.5">
                                {selected.selling_points.unique!.map((u, i) => (
                                  <li key={i} className="text-[13px] text-slate-800">- {u}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* theme_tags 편집 */}
                    <div className="bg-white rounded-lg border border-slate-200 p-5">
                      <h3 className="text-[13px] font-bold text-slate-800 mb-3">테마 태그</h3>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {tags.map(tag => (
                          <span key={tag} className="flex items-center gap-1 bg-blue-50 text-blue-700 text-[11px] px-2.5 py-1 rounded-full">
                            {tag}
                            <button onClick={() => removeTag(tag)} className="text-blue-400 hover:text-blue-700 leading-none">x</button>
                          </span>
                        ))}
                        {tags.length === 0 && <span className="text-[13px] text-slate-400">태그 없음</span>}
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={tagInput}
                          onChange={e => setTagInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') addTag(); }}
                          placeholder="태그 추가..."
                          className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                        <button onClick={addTag} className="px-3 py-1.5 bg-[#001f3f] text-white text-[13px] rounded-lg hover:bg-blue-900">추가</button>
                      </div>
                    </div>

                    {/* flight_info */}
                    {selected.flight_info && (
                      <div className="bg-white rounded-lg border border-slate-200 p-5">
                        <h3 className="text-[13px] font-bold text-slate-800 mb-3">항공 정보</h3>
                        <div className="flex items-center gap-4 text-[13px]">
                          <span className="font-semibold text-blue-700">{selected.flight_info.airline ?? '-'}</span>
                          {selected.flight_info.flight_no && <span className="text-slate-500">{selected.flight_info.flight_no}</span>}
                          <div className="flex items-center gap-2">
                            <span className="font-mono">{selected.flight_info.depart ?? '??:??'}</span>
                            <span className="text-slate-400">-&gt;</span>
                            <span className="font-mono">{selected.flight_info.arrive ?? '??:??'}</span>
                          </div>
                          {selected.flight_info.return_depart && (
                            <>
                              <span className="text-slate-300">|</span>
                              <span className="text-[13px] text-slate-500">귀국 {selected.flight_info.return_depart}</span>
                              {selected.flight_info.return_arrive && <span className="text-[13px] text-slate-500">-&gt; {selected.flight_info.return_arrive}</span>}
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 가격 테이블 */}
                    {(selected.product_prices?.length ?? 0) > 0 && (
                      <div className="bg-white rounded-lg border border-slate-200 p-5">
                        <h3 className="text-[13px] font-bold text-slate-800 mb-3">가격 테이블 ({selected.product_prices!.length}행)</h3>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[13px]">
                            <thead>
                              <tr className="border-b border-slate-200">
                                <th className="text-left py-2 pr-4 text-[11px] text-slate-500 font-medium">날짜/요일</th>
                                <th className="text-right py-2 pr-4 text-[11px] text-slate-500 font-medium">원가</th>
                                <th className="text-right py-2 pr-4 text-[11px] text-slate-500 font-medium">소아</th>
                                <th className="text-left py-2 text-[11px] text-slate-500 font-medium">비고</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selected.product_prices!.slice(0, 20).map(row => (
                                <tr key={row.id} className="border-b border-slate-200">
                                  <td className="py-2 pr-4 font-mono text-[11px] text-slate-800">
                                    {row.target_date ?? row.day_of_week ?? '-'}
                                  </td>
                                  <td className="py-2 pr-4 text-right font-semibold text-slate-800">{row.net_price?.toLocaleString()}원</td>
                                  <td className="py-2 pr-4 text-right text-slate-500">{row.child_price != null ? `${row.child_price.toLocaleString()}원` : '-'}</td>
                                  <td className="py-2 text-slate-400 truncate max-w-[200px]">{row.note ?? '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {selected.product_prices!.length > 20 && (
                            <p className="text-[11px] text-slate-400 mt-2">... 외 {selected.product_prices!.length - 20}행 생략</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 이미지 매칭 */}
                    <div className="bg-white rounded-lg border border-slate-200 p-5">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-[13px] font-bold text-slate-800">대표 이미지 선택</h3>
                        <button
                          onClick={loadImages}
                          disabled={loadingImages}
                          className="px-3 py-1.5 text-[13px] font-semibold bg-[#001f3f] text-white rounded-lg hover:bg-blue-900 disabled:opacity-40 transition-colors"
                        >
                          {loadingImages ? '검색 중...' : '이미지 불러오기'}
                        </button>
                      </div>
                      {images.length > 0 ? (
                        <div className="grid grid-cols-3 gap-3">
                          {images.map(img => (
                            <button
                              key={img.id}
                              onClick={() => setSelectedImageUrl(img.src.large)}
                              className={`relative rounded-lg overflow-hidden aspect-video border-2 transition-all ${selectedImageUrl === img.src.large ? 'border-blue-600' : 'border-transparent hover:border-slate-300'}`}
                            >
                              <img src={img.src.medium} alt={img.alt} className="w-full h-full object-cover" />
                              {selectedImageUrl === img.src.large && (
                                <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                                  <span className="text-[13px] font-bold text-white bg-blue-600 px-2 py-0.5 rounded">선택됨</span>
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="h-24 flex items-center justify-center text-[13px] text-slate-400 border border-dashed border-slate-200 rounded-lg">
                          이미지 불러오기 버튼을 클릭하세요
                        </div>
                      )}
                      {selectedImageUrl && (
                        <p className="text-[11px] text-blue-600 mt-2">선택됨 -- 승인 시 대표 이미지로 저장됩니다</p>
                      )}
                    </div>
                  </>
                )}

                {/* ── 탭 2: FAQ ──────────────────────────────────────────────── */}
                {tab === 'faq' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[14px] font-bold text-slate-800">FAQ 지식 베이스</h3>
                      <button
                        onClick={generateFaq}
                        disabled={loadingFaq}
                        className="px-4 py-2 text-[13px] font-bold bg-[#001f3f] text-white rounded-lg hover:bg-blue-900 disabled:opacity-40 transition-colors"
                      >
                        {loadingFaq ? '생성 중...' : 'FAQ 자동 생성'}
                      </button>
                    </div>

                    {faq.length === 0 ? (
                      <div className="bg-white rounded-lg border border-slate-200 p-10 text-center text-slate-400">
                        <p className="text-[13px]">FAQ 자동 생성 버튼을 클릭하세요</p>
                        <p className="text-[11px] mt-1">상품 원문을 분석해 Q&A 10개를 생성합니다</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {faq.map((item, i) => (
                          <div key={i} className="bg-white rounded-lg border border-slate-200 p-4">
                            <div className="mb-2">
                              <label className="text-[11px] text-blue-600 font-medium">Q{i + 1}</label>
                              <textarea
                                value={item.q}
                                onChange={e => setFaq(fs => fs.map((f, j) => j === i ? { ...f, q: e.target.value } : f))}
                                rows={1}
                                className="w-full text-[13px] font-semibold text-slate-800 mt-0.5 resize-none border-none outline-none focus:ring-0 bg-transparent"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] text-slate-400 font-medium">A</label>
                              <textarea
                                value={item.a}
                                onChange={e => setFaq(fs => fs.map((f, j) => j === i ? { ...f, a: e.target.value } : f))}
                                rows={2}
                                className="w-full text-[13px] text-slate-600 mt-0.5 resize-none border-none outline-none focus:ring-0 bg-transparent"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── 탭 3: 마케팅 미리보기 ─────────────────────────────────── */}
                {tab === 'marketing' && (
                  <div className="space-y-4">
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => generateMarketing('blog')}
                        disabled={loadingMarketing}
                        className="px-4 py-2 text-[13px] font-semibold bg-[#001f3f] text-white rounded-lg hover:bg-blue-900 disabled:opacity-40 transition-colors"
                      >
                        네이버 블로그 초안
                      </button>
                      <button
                        onClick={() => generateMarketing('instagram')}
                        disabled={loadingMarketing}
                        className="px-4 py-2 text-[13px] font-semibold bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors"
                      >
                        인스타 광고 문구
                      </button>
                      <button
                        onClick={() => generateMarketing('itinerary')}
                        disabled={loadingMarketing}
                        className="px-4 py-2 text-[13px] font-semibold bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors"
                      >
                        A4 일정표 데이터
                      </button>
                    </div>

                    {loadingMarketing && (
                      <div className="bg-white rounded-lg border border-slate-200 p-10 text-center text-slate-400 text-[13px]">생성 중...</div>
                    )}

                    {!loadingMarketing && marketing && (
                      <div className="bg-white rounded-lg border border-slate-200 p-5">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[13px] font-bold text-slate-500 uppercase">{marketing.type}</span>
                          <button
                            onClick={() => navigator.clipboard.writeText(marketing.content).then(() => showToast('복사됨!'))}
                            className="text-[13px] text-blue-700 hover:underline"
                          >
                            복사
                          </button>
                        </div>
                        <pre className="text-[13px] text-slate-800 whitespace-pre-wrap leading-relaxed font-sans">
                          {marketing.content}
                        </pre>
                      </div>
                    )}

                    {!loadingMarketing && !marketing && (
                      <div className="bg-white rounded-lg border border-slate-200 p-10 text-center text-slate-400">
                        <p className="text-[13px]">위 버튼을 클릭해 마케팅 콘텐츠를 생성하세요</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {/* ── 토스트 ────────────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg border text-[13px] font-semibold text-white z-50 ${toast.type === 'err' ? 'bg-red-600 border-red-700' : 'bg-slate-800 border-slate-700'}`}>
          {toast.msg}
        </div>
      )}
    </>
  );
}
