'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Heart, ShieldCheck, Zap, CheckCircle2 } from 'lucide-react';
import type { MarketingCopy } from '@/lib/ai';

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface PackageSummary {
  id: string;
  title: string;
  destination?: string;
  price?: number;
  product_summary?: string;
  marketing_copies?: MarketingCopy[];
}

interface Props {
  pkg: PackageSummary | null;
  open: boolean;
  onClose: () => void;
  /** Optimistic 승인 — UI는 즉시 변경, 백그라운드 API 호출은 부모가 담당 */
  onApprove: (id: string, title: string, summary: string, copyType: string) => void;
  /** 반려 — status → draft */
  onReject: (id: string) => void;
  /** AI 카피 재생성 요청 */
  onRegenerate: (id: string) => Promise<MarketingCopy[]>;
}

// ─── 컨셉별 아이콘/색상 ───────────────────────────────────────────────────────

const COPY_META: Record<string, {
  icon: React.ReactNode;
  badge: string;
  cardHover: string;
  cardSelected: string;
}> = {
  '감성형': {
    icon: <Heart size={16} className="text-rose-500" />,
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    cardHover: 'hover:border-rose-300 hover:bg-rose-50/40',
    cardSelected: 'border-rose-400 bg-rose-50 ring-2 ring-rose-300',
  },
  '신뢰형': {
    icon: <ShieldCheck size={16} className="text-blue-500" />,
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    cardHover: 'hover:border-blue-300 hover:bg-blue-50/40',
    cardSelected: 'border-blue-400 bg-blue-50 ring-2 ring-blue-300',
  },
  '희소성형': {
    icon: <Zap size={16} className="text-amber-500" />,
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    cardHover: 'hover:border-amber-300 hover:bg-amber-50/40',
    cardSelected: 'border-amber-400 bg-amber-50 ring-2 ring-amber-300',
  },
};

// ─── 상수 ────────────────────────────────────────────────────────────────────

const TITLE_MAX   = 30;
const SUMMARY_MAX = 150;

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function ApprovalModal({ pkg, open, onClose, onApprove, onReject, onRegenerate }: Props) {
  const [copies, setCopies]             = useState<MarketingCopy[]>([]);
  const [selectedType, setSelectedType] = useState<string>('');
  const [editTitle, setEditTitle]       = useState('');
  const [editSummary, setEditSummary]   = useState('');
  const [regenerating, setRegenerating] = useState(false);

  // 모달 열릴 때 초기화
  useEffect(() => {
    if (!open || !pkg) return;
    const initial = pkg.marketing_copies ?? [];
    setCopies(initial);
    setSelectedType('');
    setEditTitle(pkg.title ?? '');
    setEditSummary(pkg.product_summary ?? '');
    setRegenerating(false);
  }, [open, pkg]);

  // ESC 닫기
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // 카드 선택 → input 자동 채워짐
  const selectCopy = useCallback((copy: MarketingCopy) => {
    setSelectedType(copy.type);
    setEditTitle(copy.title);
    setEditSummary(copy.summary);
  }, []);

  // AI 재생성
  const handleRegenerate = async () => {
    if (!pkg || regenerating) return;
    setRegenerating(true);
    try {
      const fresh = await onRegenerate(pkg.id);
      setCopies(fresh);
      setSelectedType('');
      setEditTitle(pkg.title ?? '');
      setEditSummary('');
    } finally {
      setRegenerating(false);
    }
  };

  // 최종 배포
  const handleApprove = () => {
    if (!pkg) return;
    onApprove(pkg.id, editTitle.trim() || pkg.title, editSummary.trim(), selectedType);
  };

  const titleLen   = editTitle.length;
  const summaryLen = editSummary.length;
  const canPublish = titleLen > 0 && titleLen <= TITLE_MAX && summaryLen <= SUMMARY_MAX;

  if (!open || !pkg) return null;

  const noCopies = copies.length === 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">

          {/* ── 헤더 ──────────────────────────────────────────────────── */}
          <div className="flex items-start justify-between px-7 py-5 border-b border-gray-100 shrink-0">
            <div>
              <h2 className="text-xl font-bold text-gray-900">마케팅 카피 검수 및 배포</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {pkg.destination ?? ''}
                {pkg.price ? ` · ${pkg.price.toLocaleString('ko-KR')}원~/인` : ''}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
            >
              <X size={20} />
            </button>
          </div>

          {/* ── 스크롤 컨텐츠 ─────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-7 py-6 space-y-6">

            {/* ── 섹션 1: AI 카피 카드 ──────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">
                  AI 제안 카피 · 3종
                </h3>
                <button
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50 transition"
                >
                  <RefreshCw size={13} className={regenerating ? 'animate-spin' : ''} />
                  {regenerating ? '재생성 중...' : 'AI 다시 생성'}
                </button>
              </div>

              {noCopies ? (
                <div className="rounded-xl border-2 border-dashed border-gray-200 py-10 text-center text-gray-400">
                  <p className="text-sm">AI 카피가 없습니다.</p>
                  <p className="text-xs mt-1">위 "AI 다시 생성" 버튼을 눌러 생성하세요.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {copies.map(copy => {
                    const meta = COPY_META[copy.type] ?? COPY_META['신뢰형'];
                    const isSelected = selectedType === copy.type;
                    return (
                      <button
                        key={copy.type}
                        onClick={() => selectCopy(copy)}
                        className={`relative text-left p-4 rounded-xl border-2 transition-all duration-150 cursor-pointer ${
                          isSelected ? meta.cardSelected : `border-gray-200 bg-white ${meta.cardHover}`
                        }`}
                      >
                        {isSelected && (
                          <CheckCircle2
                            size={16}
                            className="absolute top-3 right-3 text-current opacity-70"
                          />
                        )}
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border mb-2 ${meta.badge}`}>
                          {meta.icon}
                          {copy.type}
                        </span>
                        <p className="text-sm font-bold text-gray-900 leading-snug mb-1.5 line-clamp-2">
                          {copy.title}
                        </p>
                        <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">
                          {copy.summary}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── 섹션 2: 직접 편집 ─────────────────────────────────── */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">
                최종 편집 {selectedType && (
                  <span className="ml-1.5 text-xs font-normal text-gray-400 normal-case">
                    — {selectedType} 기반
                  </span>
                )}
              </h3>

              {/* 상품명 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  상품명 (고객 노출용)
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  maxLength={TITLE_MAX + 5}
                  className={`w-full border-2 rounded-xl px-4 py-3 text-base focus:outline-none transition ${
                    titleLen > TITLE_MAX
                      ? 'border-red-400 focus:border-red-500 bg-red-50'
                      : 'border-gray-200 focus:border-blue-500'
                  }`}
                />
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-gray-400">고객에게 노출되는 상품 헤드라인</span>
                  <span className={`text-xs tabular-nums font-medium ${titleLen > TITLE_MAX ? 'text-red-500' : 'text-gray-400'}`}>
                    {titleLen}/{TITLE_MAX}자
                  </span>
                </div>
              </div>

              {/* 요약 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  상품 요약 (B2C 노출용)
                </label>
                <textarea
                  value={editSummary}
                  onChange={e => setEditSummary(e.target.value)}
                  maxLength={SUMMARY_MAX + 10}
                  rows={3}
                  className={`w-full border-2 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none transition leading-relaxed ${
                    summaryLen > SUMMARY_MAX
                      ? 'border-red-400 focus:border-red-500 bg-red-50'
                      : 'border-gray-200 focus:border-blue-500'
                  }`}
                />
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-gray-400">랜딩페이지 및 카드뉴스 서브카피</span>
                  <span className={`text-xs tabular-nums font-medium ${summaryLen > SUMMARY_MAX ? 'text-red-500' : 'text-gray-400'}`}>
                    {summaryLen}/{SUMMARY_MAX}자
                  </span>
                </div>
              </div>
            </div>

            {/* 브랜드 안전 알림 */}
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800 leading-relaxed">
              <span className="font-semibold">⚠️ 브랜드 안전 체크리스트:</span>{' '}
              배포 전 카피에 랜드사명·공급사명·'원가' 단어가 없는지 확인하세요.
              여소남 브랜드로 고정되어야 합니다.
            </div>
          </div>

          {/* ── 하단 버튼 ────────────────────────────────────────────── */}
          <div className="px-7 py-4 border-t border-gray-100 flex items-center justify-between gap-3 shrink-0 bg-gray-50/50">
            <button
              onClick={() => pkg && onReject(pkg.id)}
              className="px-5 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 text-sm font-semibold hover:border-gray-300 hover:bg-gray-100 transition"
            >
              반려 (Draft)
            </button>

            <div className="flex items-center gap-2">
              {!canPublish && (
                <span className="text-xs text-red-500">
                  {titleLen === 0 ? '상품명을 입력하세요' : titleLen > TITLE_MAX ? `제목 ${TITLE_MAX}자 초과` : `요약 ${SUMMARY_MAX}자 초과`}
                </span>
              )}
              <button
                onClick={handleApprove}
                disabled={!canPublish}
                className="px-6 py-2.5 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition flex items-center gap-2"
              >
                <CheckCircle2 size={16} />
                최종 승인 및 배포
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
