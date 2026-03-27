'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ApprovalModal from '@/components/admin/ApprovalModal';
import MarketingLogModal from '@/components/admin/MarketingLogModal';
import PosterStudio from '@/components/admin/PosterStudio';
import MarketingPromptGenerator from '@/components/admin/MarketingPromptGenerator';
import CardNewsStudio from '@/components/admin/CardNewsStudio';
import AdPerformanceDashboard from '@/components/admin/AdPerformanceDashboard';
import MetaAutoPublisher from '@/components/admin/MetaAutoPublisher';
import type { MarketingCopy } from '@/lib/ai';
import { useVendors } from '@/hooks/useVendors';
import { useMarketingTracker, PLATFORMS, PlatformKey } from '@/hooks/useMarketingTracker';
import { usePosterStudio } from '@/hooks/usePosterStudio';

// ── PDF 원문 세탁 + 플랫폼 롤 프롬프트 ────────────────────────────────────────
function sanitizeRawText(text: string): string {
  return text
    // 수수료/커미션 % 포함 라인 → 치환
    .replace(/.*[수수료커미션].{0,20}\d+\.?\d*\s*%.*|.*\d+\.?\d*\s*%.*[수수료커미션].*/gim, '[여소남 공식 채널]')
    // 입금가/원가/랜드가 금액 포함 라인 → 치환
    .replace(/.*(?:입금가|원가|랜드가|net\s*price|기본가).{0,50}\d[\d,]+원?.*/gim, '[여소남 공식 채널]')
    // 전화번호 (지역번호 포함)
    .replace(/0(?:2|3[1-3]|4[1-4]|5[1-5]|6[1-4]|70)\s*[-.]?\s*\d{3,4}\s*[-.]?\s*\d{4}/g, '[여소남 공식 채널]')
    // 이메일
    .replace(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi, '[여소남 공식 채널]');
}

const THREADS_ROLE = `# 쓰레드 Role
너는 여행사 자동화 시스템 '여소남'의 퍼스널 브랜딩 마케터야. 복잡한 여행 상품 공지글을 분석해서, 스레드(Threads) 유저들이 혹할 만한 '친근한 반말 체'의 1페이지 포스트를 작성해줘.
# 시스템 규칙 (여소남 OS 마케팅 원칙)
1. 말투: 옆집 형이나 오빠처럼 친근한 [반말] 사용. (예: "떴어!", "가보자!", "진짜 대박이야")
2. 용어 통일: '성인 요금'은 반드시 [판매가]라는 용어로만 표현할 것.
3. 정보 필터링: 카드결제 불가, 취소 수수료, 예약금 규정 등 '문의를 주저하게 만드는 딱딱한 조건'은 과감히 생략하고 혜택 위주로 작성할 것.
4. 가공 방식:
   - 1단계: 감탄사나 여행지의 매력으로 시작 (Hook)
   - 2단계: 이 여행이 왜 좋은지 핵심 혜택 3~4가지만 요약
   - 3단계: [판매가] 정보와 일정 선택폭 제시
   - 4단계: 댓글 유도 (CTA)로 마무리
# 출력 양식 (고정 규격)
제목: [출발지] 목적지 관련 매력적인 제목
본문:
- 여행지의 풍경 묘사와 직항/전세기 강조
- 혜택 요약 (이모지 활용)
- [판매가] 최저가 기준 노출
- 마무리: 상세 일정 궁금하면 '여소남(지역명)' 댓글 달아달라는 문구 필수
---
`;

const INSTAGRAM_ROLE = `# 인스타그램 Role
너는 여행사 자동화 시스템 '여소남 OS'의 전문 여행 큐레이터야. 긴 상품 공지글을 분석해서 인스타그램 모바일 환경에 최적화된 '정보 요약형' 포스트를 작성해줘.
# 시스템 규칙 (여소남 OS 마케팅 원칙)
1. 말투: 정중하고 신뢰감 있는 [경어체]를 사용하되, 딱딱하지 않고 친근한 느낌을 줄 것. (~입니다, ~하세요, ~해 보세요)
2. 용어 통일: '성인 요금'은 반드시 [판매가]라는 용어로만 표현할 것.
3. 시각적 최적화:
   - 줄바꿈을 자주 사용하여 모바일 화면에서 가독성을 극대화할 것.
   - 각 문단 앞에 핵심 키워드를 배치하고 관련 이모지를 적절히 섞어줄 것.
4. 정보 구성:
   - [제목]: 지역명과 전세기/직항 등 핵심 가치를 담은 한 줄.
   - [특징]: 이 여행을 가야 하는 이유 3가지 요약.
   - [특전]: 포함 사항 및 여소남만의 특별 혜택 리스트.
   - [판매가]: 요일별/코스별 가격을 명확하게 구분.
5. 유도 문구(CTA): 상세 일정 문의를 위해 댓글(여소남+지역명) 또는 프로필 링크를 안내할 것.
# 출력 양식 (고정 규격)
[제목]
본문 내용:
- 상품 요약 및 지역 매력
- 핵심 특징 (• 활용)
- 포함 특전 (✅ 활용)
- [판매가] 정보 (요일별 구분)
- 예약 및 상세 문의 방법 안내
해시태그: (관련 키워드 15개)
---
`;

interface PriceTier {
  period_label: string;
  departure_dates?: string[];
  date_range?: { start: string; end: string };
  departure_day_of_week?: string;
  adult_price?: number;
  child_price?: number;
  status: string;
  note?: string;
}

/** products ERP 테이블에서 JOIN된 원가/마진 데이터 */
interface ProductErp {
  internal_code: string;
  departure_region: string;
  net_price: number;       // 원가
  selling_price: number;   // 판매가 (GENERATED)
  margin_rate: number;     // 마진율 소수점 (0.09 = 9%)
}

interface Package {
  id: string;
  title: string;
  destination?: string;
  category?: string;
  product_type?: string;
  trip_style?: string;
  departure_days?: string;
  departure_airport?: string;
  airline?: string;
  min_participants?: number;
  ticketing_deadline?: string;
  price?: number;
  price_tiers?: PriceTier[];
  status: string;
  confidence?: number;
  created_at: string;
  inclusions?: string[];
  excludes?: string[];
  guide_tip?: string;
  single_supplement?: string;
  small_group_surcharge?: string;
  optional_tours?: { name: string; price_usd?: number }[];
  itinerary?: string[];
  special_notes?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  notices_parsed?: any[];
  price_list?: unknown[];
  land_operator?: string;
  commission_rate?: number;
  product_tags?: string[];
  product_highlights?: string[];
  product_summary?: string;
  itinerary_data?: unknown;
  marketing_copies?: MarketingCopy[];
  internal_code?: string;
  land_operator_id?: string | null;
  // JOIN된 ERP 데이터
  products?: ProductErp | null;
  // poster 용
  display_name?: string;
  duration?: number;
  selling_price?: number;
  ai_tags?: string[];
  theme_tags?: string[];
  supplier_name?: string;
}

const STATUS_OPTIONS = [
  { value: 'all',            label: '전체' },
  { value: 'pending_review', label: '카피 검수 대기' },
  { value: 'pending',        label: '검토 대기' },
  { value: 'active',         label: '판매 중' },
  { value: 'approved',       label: '승인됨' },
  { value: 'rejected',       label: '거부됨' },
  { value: 'draft',          label: '초안' },
  { value: 'deadline',       label: '마감 임박' },
];

const SORT_OPTIONS = [
  { value: 'created_desc', label: '등록일 최신순' },
  { value: 'created_asc', label: '등록일 오래된순' },
  { value: 'title_asc', label: '이름순' },
  { value: 'price_asc', label: '가격 낮은순' },
  { value: 'price_desc', label: '가격 높은순' },
];

const CATEGORY_LABELS: Record<string, string> = {
  package: '패키지', golf: '골프', honeymoon: '허니문', cruise: '크루즈', theme: '테마',
};

const STATUS_BADGE: Record<string, string> = {
  pending:        'bg-yellow-50 text-yellow-700',
  pending_review: 'bg-amber-50 text-amber-700',
  approved:       'bg-green-50 text-green-700',
  active:         'bg-emerald-50 text-emerald-700',
  rejected:       'bg-red-50 text-red-700',
  draft:          'bg-slate-100 text-slate-500',
};

const STATUS_LABEL: Record<string, string> = {
  pending:        '검토 대기',
  pending_review: '카피 검수 대기',
  approved:       '승인됨',
  active:         '판매 중',
  rejected:       '거부됨',
  draft:          '초안',
};

const LAND_OPERATORS = [
  '투어비', '여소남', '하나투어', '모두투어', '롯데JTB', '노랑풍선',
  '참좋은여행', '온라인투어', '기타',
];

/** 출발 지역별 배지 색상 */
const REGION_BADGE: Record<string, string> = {
  '부산': 'bg-blue-50 text-blue-600 border-blue-100',
  '인천': 'bg-purple-50 text-purple-600 border-purple-100',
  '서울': 'bg-purple-50 text-purple-600 border-purple-100',
  '김포': 'bg-indigo-50 text-indigo-600 border-indigo-100',
  '대구': 'bg-orange-50 text-orange-600 border-orange-100',
  '청주': 'bg-teal-50 text-teal-600 border-teal-100',
  '광주': 'bg-green-50 text-green-600 border-green-100',
  '제주': 'bg-cyan-50 text-cyan-600 border-cyan-100',
};
function regionBadgeClass(region?: string): string {
  if (!region) return '';
  for (const [key, cls] of Object.entries(REGION_BADGE)) {
    if (region.includes(key)) return cls;
  }
  return 'bg-slate-50 text-slate-500 border-slate-100';
}

/** margin_rate(소수) 기준 동적 색상 */
function marginColor(rate?: number): string {
  if (rate == null) return 'text-slate-400';
  if (rate >= 0.10) return 'text-emerald-600 font-bold';
  if (rate >= 0.05) return 'text-blue-600';
  return 'text-orange-500';
}

function getDDayInfo(pkg: Package): { label: string; className: string } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (pkg.ticketing_deadline) {
    const deadline = new Date(pkg.ticketing_deadline);
    deadline.setHours(0, 0, 0, 0);
    const diff = Math.round((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return { label: '만료', className: 'bg-slate-100 text-slate-500' };
    if (diff === 0) return { label: 'D-Day', className: 'bg-red-50 text-red-700 font-bold' };
    if (diff <= 3) return { label: `D-${diff}`, className: 'bg-red-50 text-red-700 font-bold' };
    if (diff <= 7) return { label: `D-${diff}`, className: 'bg-orange-50 text-orange-700' };
    return { label: `D-${diff}`, className: 'bg-green-50 text-green-700' };
  }
  return null;
}

function isExpired(pkg: Package): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (pkg.ticketing_deadline) {
    const deadline = new Date(pkg.ticketing_deadline);
    deadline.setHours(0, 0, 0, 0);
    return deadline < today;
  }
  const created = new Date(pkg.created_at);
  const expiry = new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);
  expiry.setHours(0, 0, 0, 0);
  return expiry < today;
}

function isDeadlineSoon(pkg: Package): boolean {
  if (!pkg.ticketing_deadline) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(pkg.ticketing_deadline);
  deadline.setHours(0, 0, 0, 0);
  const diff = Math.round((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return diff >= 0 && diff <= 3;
}

function getExtendedDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().split('T')[0];
}

// ── MarketingToggle (React.memo) ─────────────────────────────────────────────
const MarketingToggle = React.memo(function MarketingToggle({
  pkgId,
  platform,
  isActive,
  auditInfo,
  onToggle,
  isToggling,
}: {
  pkgId: string;
  platform: { key: PlatformKey; icon: string; label: string };
  isActive: boolean;
  auditInfo: string | null;
  onToggle: (pkgId: string, platformKey: PlatformKey) => void;
  isToggling: boolean;
}) {
  return (
    <button
      type="button"
      disabled={isToggling}
      onClick={() => onToggle(pkgId, platform.key)}
      className={`relative w-7 h-7 rounded text-[10px] font-bold flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50 ${
        isActive
          ? 'bg-[#001f3f] text-white'
          : 'bg-white border border-slate-200 text-slate-400 hover:border-slate-400'
      }`}
      title={auditInfo || `${platform.label} 토글`}
    >
      {platform.icon}
    </button>
  );
});

// ── PackageRow (React.memo) ──────────────────────────────────────────────────
const PackageRow = React.memo(function PackageRow({
  pkg,
  idx,
  isChecked,
  expired,
  dday,
  minPrice,
  maxPrice,
  inlineEditPkgId,
  activeVendors,
  allVendors,
  copyDropdownId,
  actionLoading,
  marketingTracker,
  onToggleCheck,
  onSetSelected,
  onSetApprovalTarget,
  onSetInlineEditPkgId,
  onHandleInlineLandOperator,
  onSetCopyDropdownId,
  onSetLogModalTarget,
  onOpenSingleEdit,
  onHandleAction,
  onShowToast,
  onOpenPoster,
  onPromptGen,
  onStudioOpen,
}: {
  pkg: Package;
  idx: number;
  isChecked: boolean;
  expired: boolean;
  dday: { label: string; className: string } | null;
  minPrice: number | undefined;
  maxPrice: number;
  inlineEditPkgId: string | null;
  activeVendors: { id: string; name: string; is_active: boolean }[];
  allVendors: { id: string; name: string; is_active: boolean }[];
  copyDropdownId: string | null;
  actionLoading: string | null;
  marketingTracker: ReturnType<typeof useMarketingTracker>;
  onToggleCheck: (id: string, idx: number, e: React.MouseEvent) => void;
  onSetSelected: (pkg: Package) => void;
  onSetApprovalTarget: (pkg: Package) => void;
  onSetInlineEditPkgId: (id: string | null) => void;
  onHandleInlineLandOperator: (pkgId: string, newId: string) => void;
  onSetCopyDropdownId: (id: string | null) => void;
  onSetLogModalTarget: (target: { packageId: string; productId?: string }) => void;
  onOpenSingleEdit: (pkg: Package, e: React.MouseEvent) => void;
  onHandleAction: (packageId: string, action: 'approve' | 'reject' | 'delete' | 'extend') => void;
  onShowToast: (type: 'success' | 'error', message: string) => void;
  onOpenPoster: (pkg: Package, format: 'A4' | 'MOBILE') => void;
  onPromptGen: (pkg: Package) => void;
  onStudioOpen: () => void;
}) {
  const { isActive: isPlatformActive, getAuditInfo, togglePlatform, togglingKey, getCoverage } = marketingTracker;

  const handleRowClick = () => {
    if (pkg.status === 'pending_review') onSetApprovalTarget(pkg);
    else onSetSelected(pkg);
  };

  const handleTogglePlatform = useCallback(async (pkgId: string, platformKey: PlatformKey) => {
    const result = await togglePlatform(pkgId, platformKey);
    if (!result.success && result.error) {
      onShowToast('error', result.error);
    }
  }, [togglePlatform, onShowToast]);

  const coverage = getCoverage(pkg.id);

  return (
    <tr
      className={`group border-b border-slate-200 hover:bg-slate-50 ${expired ? 'opacity-60' : ''} ${isChecked ? 'bg-blue-50' : ''}`}
    >
      <td className="px-3 py-2 w-8" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => {}}
          onClick={e => onToggleCheck(pkg.id, idx, e as React.MouseEvent)}
          className="rounded cursor-pointer"
        />
      </td>
      <td className="px-3 py-2 cursor-pointer max-w-[280px]" onClick={handleRowClick}>
        {/* 상품명 + 출발지 배지 */}
        <div className="flex items-start gap-1.5 flex-wrap">
          <span className="font-semibold text-slate-800 leading-snug">{pkg.title}</span>
          {(() => {
            const region = pkg.products?.departure_region
              ?? (pkg.departure_airport ? pkg.departure_airport.replace(/\(.*\)/, '').trim() : undefined);
            return region ? (
              <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium border leading-tight ${regionBadgeClass(region)}`}>
                {region}
              </span>
            ) : null;
          })()}
        </div>
        {/* product_type · trip_style */}
        {pkg.product_type && (
          <div className="text-[11px] text-slate-400 mt-0.5">{pkg.product_type} · {pkg.trip_style}</div>
        )}
        {/* internal_code — 클릭 복사 + Toast */}
        {(pkg.products?.internal_code ?? pkg.internal_code) ? (
          <button
            type="button"
            className="mt-0.5 text-[11px] text-slate-400 hover:text-blue-500 font-mono transition-colors group/code"
            onClick={e => {
              e.stopPropagation();
              const code = pkg.products?.internal_code ?? pkg.internal_code ?? '';
              navigator.clipboard.writeText(code).then(() => {
                onShowToast('success', `상품코드가 복사되었습니다: ${code}`);
              });
            }}
            title="클릭하여 상품코드 복사"
          >
            {pkg.products?.internal_code ?? pkg.internal_code}
            <span className="opacity-0 group-hover/code:opacity-100 ml-0.5 transition-opacity">📋</span>
          </button>
        ) : (
          <span className="text-[11px] text-slate-300 font-mono">코드 미발급</span>
        )}
      </td>
      <td className="px-3 py-2 min-w-[130px]" onClick={e => e.stopPropagation()}>
        {inlineEditPkgId === pkg.id ? (
          <select
            autoFocus
            className="w-full border border-blue-400 rounded px-2 py-1 text-[13px] text-slate-800"
            defaultValue={pkg.land_operator_id ?? ''}
            onChange={e => onHandleInlineLandOperator(pkg.id, e.target.value)}
            onBlur={() => onSetInlineEditPkgId(null)}
          >
            <option value="">-- 선택 안 함 --</option>
            {activeVendors.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        ) : (() => {
          const op = allVendors.find(v => v.id === pkg.land_operator_id);
          if (op) return (
            <button
              className="flex items-center gap-1 text-left hover:bg-blue-50 rounded px-1 py-0.5 w-full group/vendor"
              onClick={() => onSetInlineEditPkgId(pkg.id)}
            >
              <span className="text-[13px] text-blue-700 font-medium">{op.name}</span>
              {!op.is_active && (
                <span className="text-[10px] px-1 py-0.5 bg-red-50 text-red-600 rounded font-medium">비활성</span>
              )}
              <span className="opacity-0 group-hover/vendor:opacity-100 text-[10px] text-slate-400 ml-auto">✎</span>
            </button>
          );
          return (
            <button
              className="text-[11px] text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded px-1 py-0.5"
              onClick={() => onSetInlineEditPkgId(pkg.id)}
            >+ 랜드사 연결</button>
          );
        })()}
      </td>
      <td className="px-3 py-2 text-right cursor-pointer" onClick={handleRowClick}>
        {pkg.products?.net_price && pkg.products?.selling_price ? (() => {
          const profit = pkg.products.selling_price - pkg.products.net_price;
          const rate   = pkg.products.margin_rate;
          const color  = marginColor(rate);
          return (
            <div className="text-right">
              <div className={`text-[13px] ${color}`}>
                +{profit.toLocaleString()}원
              </div>
              <div className="text-[11px] text-slate-400">
                ({Math.round((rate ?? 0) * 100)}%)
              </div>
            </div>
          );
        })() : pkg.commission_rate != null && minPrice ? (() => {
          const profit = Math.round(minPrice * pkg.commission_rate! / 100);
          const rate   = pkg.commission_rate! / 100;
          const color  = marginColor(rate);
          return (
            <div className="text-right">
              <div className={`text-[13px] ${color}`}>+{profit.toLocaleString()}원</div>
              <div className="text-[11px] text-slate-400">({pkg.commission_rate}%)</div>
            </div>
          );
        })() : pkg.commission_rate != null ? (
          <span className={`text-[13px] ${marginColor(pkg.commission_rate / 100)}`}>{pkg.commission_rate}%</span>
        ) : (
          <span className="text-[11px] text-slate-300">-</span>
        )}
      </td>
      <td className="px-3 py-2 text-slate-500 cursor-pointer" onClick={handleRowClick}>{pkg.destination || '-'}</td>
      <td className="px-3 py-2 text-right text-slate-800 cursor-pointer" onClick={handleRowClick}>
        {minPrice ? (
          minPrice === maxPrice
            ? minPrice.toLocaleString() + '원'
            : `${minPrice.toLocaleString()}~${maxPrice.toLocaleString()}원`
        ) : '-'}
      </td>
      <td className="px-3 py-2 text-center cursor-pointer" onClick={handleRowClick}>
        {dday ? (
          <span className={`px-2 py-0.5 rounded text-[11px] ${dday.className}`}>{dday.label}</span>
        ) : pkg.ticketing_deadline ? (
          <span className="text-[11px] text-slate-400">{pkg.ticketing_deadline}</span>
        ) : (
          <span className="text-[11px] text-slate-300">-</span>
        )}
      </td>
      <td className="px-3 py-2 text-center cursor-pointer" onClick={handleRowClick}>
        <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${STATUS_BADGE[pkg.status] || 'bg-slate-100 text-slate-500'}`}>
          {STATUS_LABEL[pkg.status] ?? pkg.status}
        </span>
      </td>
      {/* 마케팅 커버리지 + 토글 */}
      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
        <div className="flex flex-col gap-1.5 min-w-[120px]">
          {/* 플랫폼 토글 버튼 B/I/C/T */}
          <div className="flex items-center gap-1">
            {PLATFORMS.map(p => (
              <MarketingToggle
                key={p.key}
                pkgId={pkg.id}
                platform={p}
                isActive={isPlatformActive(pkg.id, p.key)}
                auditInfo={getAuditInfo(pkg.id, p.key)}
                onToggle={handleTogglePlatform}
                isToggling={togglingKey === `${pkg.id}-${p.key}`}
              />
            ))}
          </div>
          {/* 진행률 바 */}
          <div className="w-full bg-slate-100 rounded-full h-1.5">
            <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${coverage}%` }} />
          </div>
          <span className="text-[10px] text-slate-400">{PLATFORMS.filter(p => isPlatformActive(pkg.id, p.key)).length}/{PLATFORMS.length} ({coverage}%)</span>
        </div>
      </td>

      <td className="px-3 py-2">
        <div className="flex gap-1 flex-wrap items-center" onClick={e => e.stopPropagation()}>
          {/* 포스터 버튼 */}
          <button
            onClick={() => onOpenPoster(pkg, 'A4')}
            className="px-1.5 py-1 border border-slate-300 text-slate-500 rounded text-[10px] hover:bg-slate-50 whitespace-nowrap"
            title="A4 포스터"
          >A4</button>
          <button
            onClick={() => window.open(`/packages/${pkg.id}`, '_blank')}
            className="px-1.5 py-1 border border-orange-300 text-orange-600 rounded text-[10px] hover:bg-orange-50 whitespace-nowrap"
            title="모바일 랜딩페이지 (고객용)"
          >모바일</button>
          <button
            onClick={() => onPromptGen(pkg)}
            className="px-1.5 py-1 border border-blue-300 text-blue-600 rounded text-[10px] hover:bg-blue-50 whitespace-nowrap"
            title="마케팅 프롬프트 생성"
          >AD</button>
          <button
            onClick={() => onStudioOpen()}
            className="px-1.5 py-1 border border-emerald-300 text-emerald-600 rounded text-[10px] hover:bg-emerald-50 whitespace-nowrap"
            title="카드뉴스 스튜디오"
          >Studio</button>
          {/* 플랫폼별 마케팅 복사 드롭다운 */}
          <div className="relative">
            <button
              onClick={e => { e.stopPropagation(); onSetCopyDropdownId(copyDropdownId === pkg.id ? null : pkg.id); }}
              className="px-2 py-1 border border-slate-300 text-slate-700 rounded text-[11px] hover:bg-slate-50 whitespace-nowrap"
              title="플랫폼별 AI 프롬프트 복사"
            >복사</button>
            {copyDropdownId === pkg.id && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg z-50 py-1 min-w-[120px]">
                {PLATFORMS.map(p => (
                  <button key={p.key} type="button"
                    className="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                    onClick={async e => {
                      e.stopPropagation();
                      onSetCopyDropdownId(null);
                      try {
                        const res = await fetch(`/api/packages?id=${pkg.id}`);
                        const json = await res.json();
                        const rawText: string = (json.package as Record<string, unknown>)?.raw_text as string || '';
                        const sanitized = rawText
                          ? sanitizeRawText(rawText)
                          : `[상품명] ${pkg.title}\n[목적지] ${pkg.destination || '-'}`;
                        let content = sanitized;
                        if (p.key === 'threads')   content = THREADS_ROLE   + sanitized;
                        if (p.key === 'instagram') content = INSTAGRAM_ROLE + sanitized;
                        await navigator.clipboard.writeText(content);
                        onShowToast('success', `${p.label} 텍스트 복사됨!`);
                      } catch {
                        onShowToast('error', '복사 실패 — 다시 시도해주세요.');
                      }
                    }}>
                    <span className="w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center bg-[#001f3f] text-white">{p.icon}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* 기록 남기기 버튼 */}
          <button
            onClick={e => { e.stopPropagation(); onSetLogModalTarget({ packageId: pkg.id, productId: pkg.products?.internal_code ?? pkg.internal_code }); }}
            className="px-2 py-1 border border-slate-300 text-slate-700 rounded text-[11px] hover:bg-slate-50 whitespace-nowrap"
            title="마케팅 발행 URL 기록"
          >기록</button>
          {/* 일정표 듀얼뷰 바로가기 */}
          <a
            href={`/itinerary/${pkg.id}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="px-2 py-1 border border-slate-300 text-slate-700 rounded text-[11px] hover:bg-slate-50"
            title="일정표 보기"
          >일정</a>
          {/* 수정 버튼 (항상 표시) */}
          <button
            onClick={e => onOpenSingleEdit(pkg, e)}
            className="px-2 py-1 border border-slate-300 text-slate-700 rounded text-[11px] hover:bg-slate-50"
          >수정</button>
          {expired && (
            <button
              onClick={() => onHandleAction(pkg.id, 'extend')}
              disabled={!!actionLoading}
              className="px-2 py-1 bg-[#001f3f] text-white rounded text-[11px] hover:bg-blue-900 disabled:opacity-50"
            >연장</button>
          )}
          {pkg.status === 'pending_review' && !expired && (
            <button
              onClick={() => onSetApprovalTarget(pkg)}
              className="px-2 py-1 bg-amber-500 text-white rounded text-[11px] hover:bg-amber-600"
            >검수</button>
          )}
          {pkg.status === 'pending' && !expired && (
            <>
              <button
                onClick={() => onHandleAction(pkg.id, 'approve')}
                disabled={!!actionLoading}
                className="px-2 py-1 bg-green-600 text-white rounded text-[11px] hover:bg-green-700 disabled:opacity-50"
              >승인</button>
              <button
                onClick={() => onHandleAction(pkg.id, 'reject')}
                disabled={!!actionLoading}
                className="px-2 py-1 bg-red-500 text-white rounded text-[11px] hover:bg-red-600 disabled:opacity-50"
              >거부</button>
            </>
          )}
          {pkg.status === 'approved' && !expired && (
            <button
              onClick={() => onHandleAction(pkg.id, 'reject')}
              disabled={!!actionLoading}
              className="px-2 py-1 border border-slate-300 text-slate-500 rounded text-[11px] hover:bg-slate-50 disabled:opacity-50"
            >비활성화</button>
          )}
        </div>
      </td>
    </tr>
  );
});

export default function PackagesPage() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('created_desc');
  const [showExpired, setShowExpired] = useState(false);
  const [selected, setSelected] = useState<Package | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [imgGenerating, setImgGenerating] = useState(false);
  const [reextracting, setReextracting] = useState(false);

  // 랜드사 필터
  const [landOperatorFilter, setLandOperatorFilter] = useState('');

  // 마케팅 트래커 훅
  const marketingTracker = useMarketingTracker();
  const { loadLogs } = marketingTracker;

  // 포스터 스튜디오 훅
  const {
    posterOpen,
    posterFormat,
    posterData,
    downloading,
    openPoster,
    closePoster,
    updateField,
    downloadPoster,
    posterPkg,
  } = usePosterStudio();

  // 포스터에 전달할 pkgId 추적
  const [posterPkgId, setPosterPkgId] = useState<string | undefined>(undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [promptTarget, setPromptTarget] = useState<any>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [brainOpen, setBrainOpen] = useState(false);
  const [metaLiveOpen, setMetaLiveOpen] = useState(false);

  // openPoster 래퍼: pkgId도 함께 저장
  const handleOpenPoster = useCallback((pkg: Package, format: 'A4' | 'MOBILE') => {
    setPosterPkgId(pkg.id);
    openPoster(pkg, format);
  }, [openPoster]);

  // closePoster 래퍼: pkgId 초기화
  const handleClosePoster = useCallback(() => {
    setPosterPkgId(undefined);
    closePoster();
  }, [closePoster]);

  const [logModalTarget, setLogModalTarget] = useState<{ packageId: string; productId?: string } | null>(null);
  const [copyDropdownId, setCopyDropdownId] = useState<string | null>(null); // 열린 복사 드롭다운 ID

  // Shift+Click 연속 선택
  const lastCheckedIndexRef = useRef<number>(-1);

  // Bulk Edit 모달
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkLandOperator, setBulkLandOperator] = useState('');
  const [bulkCommission, setBulkCommission] = useState('');

  // ApprovalModal
  const [approvalTarget, setApprovalTarget] = useState<Package | null>(null);

  // Toast
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // 랜드사 전역 캐시 훅 (중복 fetch 방지)
  const { vendors: activeVendors, all: allVendors } = useVendors();
  // 인라인 에디트 중인 패키지 ID
  const [inlineEditPkgId, setInlineEditPkgId] = useState<string | null>(null);

  // Single Edit 모달
  const [editPkg, setEditPkg] = useState<Package | null>(null);
  const [editForm, setEditForm] = useState<{
    title: string;
    destination: string;
    commission_rate: string;
    ticketing_deadline: string;
    land_operator_id: string;
  }>({ title: '', destination: '', commission_rate: '', ticketing_deadline: '', land_operator_id: '' });
  const [editSaving, setEditSaving] = useState(false);

  // ── Optimistic 승인 (Human-in-the-loop) ──────────────────────────────────
  const handleApproveOptimistic = useCallback(async (
    id: string, title: string, summary: string, copyType: string,
  ) => {
    const prevPackages = packages;

    // 1. 즉시 UI 업데이트
    setPackages(prev => prev.map(p =>
      p.id === id ? { ...p, status: 'active', title, product_summary: summary } : p,
    ));
    setApprovalTarget(null);

    try {
      // 2. 백그라운드 API 호출
      const res = await fetch(`/api/packages/${id}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', title, summary, selectedCopyType: copyType }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? '알 수 없는 오류');
      showToast('success', '성공적으로 배포되었습니다!');
    } catch (err) {
      // 3. 실패 시 롤백
      setPackages(prevPackages);
      showToast('error', `배포 실패: ${err instanceof Error ? err.message : '다시 시도해주세요.'}`);
    }
  }, [packages, showToast]);

  const handleRejectOptimistic = useCallback(async (id: string) => {
    const prevPackages = packages;
    setPackages(prev => prev.map(p => p.id === id ? { ...p, status: 'draft' } : p));
    setApprovalTarget(null);
    try {
      const res = await fetch(`/api/packages/${id}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      showToast('success', '반려 처리되었습니다.');
    } catch (err) {
      setPackages(prevPackages);
      showToast('error', `반려 실패: ${err instanceof Error ? err.message : '다시 시도해주세요.'}`);
    }
  }, [packages, showToast]);

  const handleRegenerateCopies = useCallback(async (id: string): Promise<MarketingCopy[]> => {
    const res = await fetch(`/api/packages/${id}/regenerate-copies`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).error ?? '재생성 실패');
    const { marketing_copies } = await res.json();
    // 로컬 상태에도 반영
    setPackages(prev => prev.map(p => p.id === id ? { ...p, marketing_copies } : p));
    setApprovalTarget(prev => prev?.id === id ? { ...prev, marketing_copies } : prev);
    return marketing_copies as MarketingCopy[];
  }, []);

  const handleGenerateImage = async (pkg: Package, mode: 'summary' | 'detail') => {
    setImgGenerating(true);
    try {
      const res = await fetch(`/api/itinerary/${pkg.id}/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      (data.jpgs as string[]).forEach((base64: string, idx: number) => {
        const link = document.createElement('a');
        link.href = `data:image/jpeg;base64,${base64}`;
        link.download = `${pkg.title}_${mode === 'summary' ? '요약' : idx === 0 ? '요금표' : '일정표'}.jpg`;
        link.click();
      });
    } catch (err) {
      alert('이미지 생성 실패: ' + (err instanceof Error ? err.message : '오류'));
    } finally {
      setImgGenerating(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/packages?limit=100');
      const json = await res.json();
      setPackages(json.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadLogs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, loadLogs]);

  const handleAction = async (packageId: string, action: 'approve' | 'reject' | 'delete' | 'extend') => {
    setActionLoading(packageId + action);
    try {
      if (action === 'delete') {
        await fetch(`/api/packages?id=${packageId}`, { method: 'DELETE' });
        setSelected(null);
      } else if (action === 'extend') {
        await fetch('/api/packages', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageId, ticketing_deadline: getExtendedDeadline() }),
        });
      } else {
        await fetch('/api/packages', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageId, action }),
        });
      }
      if (action !== 'extend') setSelected(null);
      load();
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = useMemo(() => {
    let list = [...packages];

    if (!showExpired) {
      list = list.filter(p => !isExpired(p) && p.status !== 'INACTIVE');
    }

    if (statusFilter === 'deadline') {
      list = list.filter(isDeadlineSoon);
    } else if (statusFilter !== 'all') {
      list = list.filter(p => p.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p =>
        p.title.toLowerCase().includes(q) ||
        (p.destination || '').toLowerCase().includes(q) ||
        (p.land_operator || '').toLowerCase().includes(q)
      );
    }

    if (landOperatorFilter) {
      list = list.filter(p => p.land_operator === landOperatorFilter);
    }

    list.sort((a, b) => {
      switch (sortBy) {
        case 'created_asc': return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'title_asc': return a.title.localeCompare(b.title, 'ko');
        case 'title_desc': return b.title.localeCompare(a.title, 'ko');
        case 'land_operator_asc': return (a.land_operator || 'zzz').localeCompare(b.land_operator || 'zzz', 'ko');
        case 'land_operator_desc': return (b.land_operator || '').localeCompare(a.land_operator || '', 'ko');
        case 'commission_rate_asc': return (a.commission_rate ?? -1) - (b.commission_rate ?? -1);
        case 'commission_rate_desc': return (b.commission_rate ?? -1) - (a.commission_rate ?? -1);
        case 'destination_asc': return (a.destination || 'zzz').localeCompare(b.destination || 'zzz', 'ko');
        case 'destination_desc': return (b.destination || '').localeCompare(a.destination || '', 'ko');
        case 'deadline_asc': return (a.ticketing_deadline || '9999').localeCompare(b.ticketing_deadline || '9999');
        case 'deadline_desc': return (b.ticketing_deadline || '').localeCompare(a.ticketing_deadline || '');
        case 'status_asc': return (a.status || '').localeCompare(b.status || '');
        case 'status_desc': return (b.status || '').localeCompare(a.status || '');
        case 'price_asc': {
          const aMin = Math.min(...(a.price_tiers?.map(t => t.adult_price ?? Infinity) || [a.price ?? Infinity]));
          const bMin = Math.min(...(b.price_tiers?.map(t => t.adult_price ?? Infinity) || [b.price ?? Infinity]));
          return aMin - bMin;
        }
        case 'price_desc': {
          const aMin = Math.min(...(a.price_tiers?.map(t => t.adult_price ?? 0) || [a.price ?? 0]));
          const bMin = Math.min(...(b.price_tiers?.map(t => t.adult_price ?? 0) || [b.price ?? 0]));
          return bMin - aMin;
        }
        default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

    return list;
  }, [packages, statusFilter, searchQuery, sortBy, showExpired, landOperatorFilter]);

  // Shift+Click 지원 체크박스 토글
  const handleHeaderSort = (field: string) => {
    setSortBy(prev => {
      if (prev === `${field}_asc`) return `${field}_desc`;
      if (prev === `${field}_desc`) return `${field}_asc`;
      return `${field}_asc`;
    });
  };

  const sortIcon = (field: string) => {
    if (sortBy === `${field}_asc`) return ' ↑';
    if (sortBy === `${field}_desc`) return ' ↓';
    return ' ↕';
  };

  // Shift+Click 지원 체크박스 토글
  const toggleCheck = (id: string, idx: number, e: React.MouseEvent) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (e.shiftKey && lastCheckedIndexRef.current >= 0) {
        const from = Math.min(lastCheckedIndexRef.current, idx);
        const to = Math.max(lastCheckedIndexRef.current, idx);
        const rangeIds = filtered.slice(from, to + 1).map(p => p.id);
        const allChecked = rangeIds.every(rid => next.has(rid));
        rangeIds.forEach(rid => allChecked ? next.delete(rid) : next.add(rid));
      } else {
        next.has(id) ? next.delete(id) : next.add(id);
      }
      return next;
    });
    lastCheckedIndexRef.current = idx;
  };

  const toggleAll = () => {
    if (checkedIds.size === filtered.length) {
      setCheckedIds(new Set());
      lastCheckedIndexRef.current = -1;
    } else {
      setCheckedIds(new Set(filtered.map(p => p.id)));
    }
  };

  const handleBulk = async (action: 'bulk_approve' | 'bulk_delete' | 'bulk_inactive' | 'bulk_active') => {
    if (checkedIds.size === 0) return;
    if (action === 'bulk_delete' && !confirm(`${checkedIds.size}개 상품을 삭제하시겠습니까?`)) return;
    setBulkLoading(true);
    try {
      await fetch('/api/packages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, packageIds: Array.from(checkedIds) }),
      });
      setCheckedIds(new Set());
      load();
    } catch (e) {
      console.error(e);
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkEdit = async () => {
    if (checkedIds.size === 0) return;
    const fields: Record<string, unknown> = {};
    if (bulkLandOperator) fields.land_operator = bulkLandOperator;
    if (bulkCommission !== '') fields.commission_rate = Number(bulkCommission);
    if (Object.keys(fields).length === 0) return;
    setBulkLoading(true);
    try {
      await fetch('/api/packages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_update', packageIds: Array.from(checkedIds), fields }),
      });
      setBulkEditOpen(false);
      setBulkLandOperator('');
      setBulkCommission('');
      setCheckedIds(new Set());
      load();
    } catch (e) {
      console.error(e);
    } finally {
      setBulkLoading(false);
    }
  };

  const openSingleEdit = (pkg: Package, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditPkg(pkg);
    setEditForm({
      title: pkg.title || '',
      destination: pkg.destination || '',
      commission_rate: String(pkg.commission_rate ?? ''),
      ticketing_deadline: pkg.ticketing_deadline || '',
      land_operator_id: pkg.land_operator_id ?? '',
    });
  };

  const handleSingleEdit = async () => {
    if (!editPkg) return;
    setEditSaving(true);
    try {
      const updateData: Record<string, unknown> = {};
      if (editForm.title.trim()) updateData.title = editForm.title.trim();
      if (editForm.destination.trim()) updateData.destination = editForm.destination.trim();
      if (editForm.commission_rate !== '') updateData.commission_rate = Number(editForm.commission_rate);
      if (editForm.ticketing_deadline !== '') updateData.ticketing_deadline = editForm.ticketing_deadline;
      updateData.land_operator_id = editForm.land_operator_id || null;
      const res = await fetch('/api/packages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: editPkg.id, ...updateData }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast('error', `저장 실패: ${(err as { error?: string }).error ?? '서버 오류'}`);
        return;
      }
      setEditPkg(null);
      load();
      showToast('success', '수정 사항이 저장되었습니다.');
    } catch (e) {
      console.error(e);
    } finally {
      setEditSaving(false);
    }
  };

  // 인라인 랜드사 변경 — Optimistic UI
  const handleInlineLandOperator = useCallback(async (pkgId: string, newId: string) => {
    const prev = packages.find(p => p.id === pkgId)?.land_operator_id ?? null;
    setPackages(ps => ps.map(p => p.id === pkgId ? { ...p, land_operator_id: newId || null } : p));
    setInlineEditPkgId(null);
    const res = await fetch('/api/packages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: pkgId, land_operator_id: newId || null }),
    });
    if (!res.ok) {
      setPackages(ps => ps.map(p => p.id === pkgId ? { ...p, land_operator_id: prev } : p));
      showToast('error', '랜드사 저장 실패 — 롤백됨');
    }
  }, [packages, showToast]);

  const pendingCount = packages.filter(
    p => (p.status === 'pending' || p.status === 'pending_review') && !isExpired(p),
  ).length;
  const reviewCount = packages.filter(p => p.status === 'pending_review' && !isExpired(p)).length;
  const deadlineCount = packages.filter(isDeadlineSoon).length;
  const expiredCount = packages.filter(isExpired).length;

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[16px] font-bold text-slate-800">상품 관리</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">업로드된 여행 상품 검토 및 승인</p>
        </div>
        <div className="flex items-center gap-2">
          {reviewCount > 0 && (
            <span className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full text-[11px] font-medium">
              카피 검수 대기 {reviewCount}건
            </span>
          )}
          {pendingCount > 0 && (
            <span className="px-2.5 py-1 bg-yellow-50 text-yellow-700 rounded-full text-[11px] font-medium">
              검토 대기 {pendingCount}건
            </span>
          )}
          {deadlineCount > 0 && (
            <span className="px-2.5 py-1 bg-red-50 text-red-700 rounded-full text-[11px] font-medium">
              마감 임박 {deadlineCount}건
            </span>
          )}
          <button
            onClick={() => { window.location.href = '/admin/upload'; }}
            className="ml-2 px-4 py-1.5 bg-[#001f3f] text-white text-[13px] font-medium rounded-lg hover:bg-blue-900 transition"
          >
            + 문서 업로드로 상품 등록
          </button>
        </div>
      </div>

      {/* 검색 + 정렬 */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="상품명, 목적지, 랜드사 검색..."
          className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
        <select
          value={landOperatorFilter}
          onChange={e => setLandOperatorFilter(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none bg-white text-slate-500 min-w-[110px]"
        >
          <option value="">전체 랜드사</option>
          {LAND_OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
        </select>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none bg-white text-slate-500"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={() => setShowExpired(v => !v)}
          className={`px-3 py-2 rounded-lg text-[13px] font-medium border transition ${
            showExpired
              ? 'bg-[#001f3f] text-white border-[#001f3f]'
              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
          }`}
        >
          {showExpired ? `만료 숨김` : `만료 포함 (${expiredCount})`}
        </button>
        <button
          onClick={() => setBrainOpen(true)}
          className="px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[13px] font-medium hover:bg-emerald-100 transition"
        >
          Ad-Brain
        </button>
        <button
          onClick={() => setMetaLiveOpen(true)}
          className="px-3 py-2 bg-[#001f3f] text-white border border-[#001f3f] rounded-lg text-[13px] font-medium hover:bg-blue-900 transition"
        >
          Meta Live
        </button>
      </div>

      {/* 일괄 처리 액션 바 */}
      {checkedIds.size > 0 && (
        <div className="flex items-center gap-2 mb-3 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-[13px] font-medium text-blue-700">{checkedIds.size}개 선택됨</span>
          <button
            onClick={() => { setBulkLandOperator(''); setBulkCommission(''); setBulkEditOpen(true); }}
            disabled={bulkLoading}
            className="px-2.5 py-1 bg-[#001f3f] text-white rounded-lg text-[11px] font-medium hover:bg-blue-900 disabled:opacity-50"
          >일괄 수정</button>
          <button
            onClick={() => handleBulk('bulk_approve')}
            disabled={bulkLoading}
            className="px-2.5 py-1 bg-green-600 text-white rounded-lg text-[11px] font-medium hover:bg-green-700 disabled:opacity-50"
          >일괄 승인</button>
          <button
            onClick={() => handleBulk('bulk_delete')}
            disabled={bulkLoading}
            className="px-2.5 py-1 bg-red-500 text-white rounded-lg text-[11px] font-medium hover:bg-red-600 disabled:opacity-50"
          >일괄 삭제</button>
          <button
            onClick={() => handleBulk('bulk_inactive')}
            disabled={bulkLoading}
            className="px-2.5 py-1 bg-slate-500 text-white rounded-lg text-[11px] font-medium hover:bg-slate-600 disabled:opacity-50"
          >비활성화</button>
          <button
            onClick={() => handleBulk('bulk_active')}
            disabled={bulkLoading}
            className="px-2.5 py-1 bg-blue-500 text-white rounded-lg text-[11px] font-medium hover:bg-blue-600 disabled:opacity-50"
          >활성화</button>
          <button
            onClick={() => { setCheckedIds(new Set()); lastCheckedIndexRef.current = -1; }}
            className="ml-auto text-[11px] text-blue-500 hover:text-blue-700"
          >선택 해제</button>
        </div>
      )}

      {/* 상태 필터 */}
      <div className="flex gap-2 mb-4">
        {STATUS_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setStatusFilter(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition ${
              statusFilter === opt.value
                ? 'bg-[#001f3f] text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-[14px]">로딩 중...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <p className="text-[14px]">상품이 없습니다</p>
            <p className="text-[13px] mt-1">
              {searchQuery ? '검색 조건을 바꿔보세요' : '문서 업로드 후 AI가 자동으로 등록합니다'}
            </p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && checkedIds.size === filtered.length}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                <th className="text-left px-3 py-2 text-slate-500 font-medium cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleHeaderSort('title')}>상품명<span className="text-slate-400 text-[11px]">{sortIcon('title')}</span></th>
                <th className="text-left px-3 py-2 text-slate-500 font-medium cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleHeaderSort('land_operator')}>랜드사<span className="text-slate-400 text-[11px]">{sortIcon('land_operator')}</span></th>
                <th className="text-right px-3 py-2 text-slate-500 font-medium cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleHeaderSort('commission_rate')}>커미션<span className="text-slate-400 text-[11px]">{sortIcon('commission_rate')}</span></th>
                <th className="text-left px-3 py-2 text-slate-500 font-medium cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleHeaderSort('destination')}>목적지<span className="text-slate-400 text-[11px]">{sortIcon('destination')}</span></th>
                <th className="text-right px-3 py-2 text-slate-500 font-medium cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleHeaderSort('price')}>가격범위<span className="text-slate-400 text-[11px]">{sortIcon('price')}</span></th>
                <th className="text-center px-3 py-2 text-slate-500 font-medium cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleHeaderSort('deadline')}>발권기한<span className="text-slate-400 text-[11px]">{sortIcon('deadline')}</span></th>
                <th className="text-center px-3 py-2 text-slate-500 font-medium cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleHeaderSort('status')}>상태<span className="text-slate-400 text-[11px]">{sortIcon('status')}</span></th>
                <th className="px-3 py-2 text-slate-500 font-medium text-center">마케팅 커버리지</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((pkg, idx) => {
                const prices = pkg.price_tiers?.map(t => t.adult_price).filter(Boolean) as number[] || [];
                const minPrice = prices.length > 0 ? Math.min(...prices) : pkg.price;
                const maxPrice = prices.length > 0 ? Math.max(...prices) : (pkg.price ?? 0);
                const dday = getDDayInfo(pkg);
                const expired = isExpired(pkg);

                return (
                  <PackageRow
                    key={pkg.id}
                    pkg={pkg}
                    idx={idx}
                    isChecked={checkedIds.has(pkg.id)}
                    expired={expired}
                    dday={dday}
                    minPrice={minPrice}
                    maxPrice={maxPrice}
                    inlineEditPkgId={inlineEditPkgId}
                    activeVendors={activeVendors}
                    allVendors={allVendors}
                    copyDropdownId={copyDropdownId}
                    actionLoading={actionLoading}
                    marketingTracker={marketingTracker}
                    onToggleCheck={toggleCheck}
                    onSetSelected={setSelected}
                    onSetApprovalTarget={setApprovalTarget}
                    onSetInlineEditPkgId={setInlineEditPkgId}
                    onHandleInlineLandOperator={handleInlineLandOperator}
                    onSetCopyDropdownId={setCopyDropdownId}
                    onSetLogModalTarget={setLogModalTarget}
                    onOpenSingleEdit={openSingleEdit}
                    onHandleAction={handleAction}
                    onShowToast={showToast}
                    onOpenPoster={handleOpenPoster}
                    onPromptGen={setPromptTarget}
                    onStudioOpen={() => setStudioOpen(true)}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 마케팅 발행 기록 모달 */}
      {logModalTarget && (
        <MarketingLogModal
          travelPackageId={logModalTarget.packageId}
          productId={logModalTarget.productId}
          onClose={() => setLogModalTarget(null)}
          onSaved={() => { setLogModalTarget(null); loadLogs(); showToast('success', '발행 기록이 저장됐습니다!'); }}
        />
      )}

      {/* 복사 드롭다운 외부 클릭 닫기 */}
      {copyDropdownId && (
        <div className="fixed inset-0 z-40" onClick={() => setCopyDropdownId(null)} />
      )}

      {/* Bulk Edit 슬라이드 패널 */}
      {bulkEditOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setBulkEditOpen(false)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-white border-l border-slate-200 flex flex-col">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-bold text-slate-800">선택된 {checkedIds.size}개 상품 일괄 수정</h3>
                <button onClick={() => setBulkEditOpen(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
              </div>
              <p className="text-[13px] text-slate-500 mt-1">변경할 항목만 선택하세요. 비워두면 해당 필드는 유지됩니다.</p>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-slate-800 mb-1">랜드사</label>
                <select
                  value={bulkLandOperator}
                  onChange={e => setBulkLandOperator(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- 변경 안 함 --</option>
                  {LAND_OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-800 mb-1">커미션 (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={bulkCommission}
                  onChange={e => setBulkCommission(e.target.value)}
                  placeholder="변경 안 함"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="p-6 border-t border-slate-200 flex gap-2 justify-end">
              <button
                onClick={() => setBulkEditOpen(false)}
                className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-[13px] text-slate-700 hover:bg-slate-50"
              >취소</button>
              <button
                onClick={handleBulkEdit}
                disabled={bulkLoading || (!bulkLandOperator && bulkCommission === '')}
                className="px-4 py-2 bg-[#001f3f] text-white rounded-lg text-[13px] font-medium hover:bg-blue-900 disabled:opacity-50"
              >{bulkLoading ? '저장 중...' : '일괄 저장'}</button>
            </div>
          </div>
        </>
      )}

      {/* Single Edit 슬라이드 패널 */}
      {editPkg && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setEditPkg(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-white border-l border-slate-200 flex flex-col">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-bold text-slate-800">상품 수정</h3>
                <button onClick={() => setEditPkg(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
              </div>
              <p className="text-[13px] text-slate-500 truncate mt-0.5">{editPkg.title}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-slate-800 mb-1">상품명</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-800 mb-1">목적지</label>
                <input
                  type="text"
                  value={editForm.destination}
                  onChange={e => setEditForm(f => ({ ...f, destination: e.target.value }))}
                  placeholder="예: 베트남 다낭"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-800 mb-1">랜드사</label>
                <select
                  value={editForm.land_operator_id}
                  onChange={e => setEditForm(f => ({ ...f, land_operator_id: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- 선택 안 함 --</option>
                  {activeVendors.map(op => (
                    <option key={op.id} value={op.id}>{op.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-800 mb-1">커미션 (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={editForm.commission_rate}
                  onChange={e => setEditForm(f => ({ ...f, commission_rate: e.target.value }))}
                  placeholder="예: 10"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-800 mb-1">발권기한</label>
                <input
                  type="date"
                  value={editForm.ticketing_deadline}
                  onChange={e => setEditForm(f => ({ ...f, ticketing_deadline: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="p-6 border-t border-slate-200 flex gap-2 justify-end">
              <button
                onClick={() => setEditPkg(null)}
                className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-[13px] text-slate-700 hover:bg-slate-50"
              >취소</button>
              <button
                onClick={handleSingleEdit}
                disabled={editSaving}
                className="px-4 py-2 bg-[#001f3f] text-white rounded-lg text-[13px] font-medium hover:bg-blue-900 disabled:opacity-50"
              >{editSaving ? '저장 중...' : '저장'}</button>
            </div>
          </div>
        </>
      )}

      {/* 상세 슬라이드 패널 */}
      {selected && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setSelected(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white border-l border-slate-200 flex flex-col">
            <div className="p-6 border-b border-slate-200 flex items-start justify-between">
              <div>
                <h2 className="text-[16px] font-bold text-slate-800">{selected.title}</h2>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${STATUS_BADGE[selected.status] || 'bg-slate-100 text-slate-500'}`}>
                    {STATUS_LABEL[selected.status] ?? selected.status}
                  </span>
                  {selected.category && <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-[11px]">{CATEGORY_LABELS[selected.category]}</span>}
                  {selected.product_type && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[11px]">{selected.product_type}</span>}
                  {(() => {
                    const dday = getDDayInfo(selected);
                    return dday ? <span className={`px-2 py-0.5 rounded text-[11px] ${dday.className}`}>{dday.label}</span> : null;
                  })()}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-[13px]">
              {selected.product_summary && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-[13px] text-blue-800">
                  {selected.product_summary}
                </div>
              )}

              {((selected.product_tags && selected.product_tags.length > 0) || (selected.product_highlights && selected.product_highlights.length > 0)) && (
                <div className="flex flex-wrap gap-1.5">
                  {selected.product_tags?.map((tag, i) => (
                    <span key={i} className="px-2 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-full text-[11px]">{tag}</span>
                  ))}
                  {selected.product_highlights?.map((h, i) => (
                    <span key={i} className="px-2 py-0.5 bg-green-50 border border-green-200 text-green-700 rounded-full text-[11px]">{h}</span>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-[13px]">
                {selected.land_operator && (
                  <div className="col-span-2 flex items-center gap-4">
                    <div><span className="text-slate-500">랜드사:</span> <span className="font-medium text-blue-700">{selected.land_operator}</span></div>
                    {selected.commission_rate != null && (
                      <div><span className="text-slate-500">커미션:</span> <span className="font-medium text-green-600">{selected.commission_rate}%</span></div>
                    )}
                  </div>
                )}
                {selected.destination && <div><span className="text-slate-500">목적지:</span> {selected.destination}</div>}
                {selected.trip_style && <div><span className="text-slate-500">기간:</span> {selected.trip_style}</div>}
                {selected.departure_days && <div><span className="text-slate-500">출발요일:</span> {selected.departure_days}</div>}
                {selected.airline && <div><span className="text-slate-500">항공:</span> {selected.airline}</div>}
                {selected.min_participants && <div><span className="text-slate-500">최소인원:</span> {selected.min_participants}명</div>}
                {selected.ticketing_deadline && (
                  <div>
                    <span className="text-slate-500">발권마감:</span>{' '}
                    <span className={`font-medium ${isDeadlineSoon(selected) ? 'text-red-600' : ''}`}>
                      {selected.ticketing_deadline}
                    </span>
                    {(() => { const d = getDDayInfo(selected); return d ? <span className={`ml-1 px-1.5 py-0.5 rounded text-[11px] ${d.className}`}>{d.label}</span> : null; })()}
                  </div>
                )}
                {selected.guide_tip && <div className="col-span-2"><span className="text-slate-500">가이드팁:</span> {selected.guide_tip}</div>}
                {selected.single_supplement && <div className="col-span-2"><span className="text-slate-500">싱글차지:</span> {selected.single_supplement}</div>}
                {selected.small_group_surcharge && <div className="col-span-2"><span className="text-slate-500">소규모할증:</span> {selected.small_group_surcharge}</div>}
              </div>

              {selected.price_tiers && selected.price_tiers.length > 0 && (
                <div>
                  <p className="font-semibold text-slate-800 mb-2">날짜별 가격표</p>
                  <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="border border-slate-200 px-2 py-1.5 text-left text-slate-500">날짜/기간</th>
                        <th className="border border-slate-200 px-2 py-1.5 text-right text-slate-500">성인</th>
                        <th className="border border-slate-200 px-2 py-1.5 text-right text-slate-500">아동</th>
                        <th className="border border-slate-200 px-2 py-1.5 text-center text-slate-500">상태/비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.price_tiers.map((tier, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="border border-slate-200 px-2 py-1.5 text-slate-800">
                            {tier.period_label}
                            {tier.departure_day_of_week && <span className="ml-1 text-slate-400">({tier.departure_day_of_week})</span>}
                          </td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right font-medium text-slate-800">{tier.adult_price ? tier.adult_price.toLocaleString() : '-'}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right text-slate-800">{tier.child_price ? tier.child_price.toLocaleString() : '-'}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[11px] ${
                              tier.status === 'confirmed' ? 'bg-green-50 text-green-700' :
                              tier.status === 'soldout' ? 'bg-red-50 text-red-700' :
                              'bg-slate-100 text-slate-500'
                            }`}>{tier.note || tier.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {selected.inclusions && selected.inclusions.length > 0 && (
                <div>
                  <p className="font-semibold text-slate-800 mb-1">포함사항</p>
                  <p className="text-slate-500 text-[13px]">{selected.inclusions.join(', ')}</p>
                </div>
              )}
              {selected.excludes && selected.excludes.length > 0 && (
                <div>
                  <p className="font-semibold text-slate-800 mb-1">불포함사항</p>
                  <p className="text-slate-500 text-[13px]">{selected.excludes.join(', ')}</p>
                </div>
              )}

              {selected.optional_tours && selected.optional_tours.length > 0 && (
                <div>
                  <p className="font-semibold text-slate-800 mb-1">선택관광</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.optional_tours.map((t, i) => (
                      <span key={i} className="px-2 py-0.5 bg-orange-50 border border-orange-200 text-orange-700 rounded text-[11px]">
                        {t.name}{t.price_usd ? ` $${t.price_usd}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-200 flex gap-2 justify-end flex-wrap">
              {!!selected.itinerary_data ? (
                <button
                  onClick={() => handleGenerateImage(selected, 'detail')}
                  disabled={imgGenerating}
                  className="px-3 py-1.5 bg-[#001f3f] text-white rounded-lg text-[13px] hover:bg-blue-900 disabled:opacity-50"
                >{imgGenerating ? '생성 중...' : 'A4 이미지'}</button>
              ) : (
                <button
                  onClick={async () => {
                    setReextracting(true);
                    try {
                      const res = await fetch('/api/packages/reextract', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ packageId: selected.id }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error);
                      alert(`일정표 재추출 완료! (${data.days}일차)`);
                      load();
                      setSelected(null);
                    } catch (err) {
                      alert('재추출 실패: ' + (err instanceof Error ? err.message : '오류'));
                    } finally {
                      setReextracting(false);
                    }
                  }}
                  disabled={reextracting}
                  className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-[13px] hover:bg-orange-600 disabled:opacity-50"
                >{reextracting ? 'AI 추출 중...' : '일정표 재추출'}</button>
              )}
              <a
                href={`/itinerary/${selected.id}`}
                target="_blank"
                className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-[13px] hover:bg-slate-50"
              >듀얼뷰</a>
              <a
                href={`/itinerary/${selected.id}/print?mode=detail`}
                target="_blank"
                className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-[13px] hover:bg-slate-50"
              >A4 인쇄</a>
              <button
                onClick={e => { setSelected(null); openSingleEdit(selected, e); }}
                className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-[13px] hover:bg-slate-50"
              >수정</button>
              <button
                onClick={() => handleAction(selected.id, 'delete')}
                disabled={!!actionLoading}
                className="px-3 py-1.5 text-red-500 border border-red-200 rounded-lg text-[13px] hover:bg-red-50 disabled:opacity-50"
              >삭제</button>
              {isExpired(selected) && (
                <button
                  onClick={() => handleAction(selected.id, 'extend')}
                  disabled={!!actionLoading}
                  className="px-3 py-1.5 bg-[#001f3f] text-white rounded-lg text-[13px] hover:bg-blue-900 disabled:opacity-50"
                >판매 연장 (+30일)</button>
              )}
              {selected.status === 'pending' && (
                <>
                  <button
                    onClick={() => handleAction(selected.id, 'reject')}
                    disabled={!!actionLoading}
                    className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-[13px] hover:bg-slate-50 disabled:opacity-50"
                  >거부</button>
                  <button
                    onClick={() => handleAction(selected.id, 'approve')}
                    disabled={!!actionLoading}
                    className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-[13px] font-medium hover:bg-green-700 disabled:opacity-50"
                  >승인</button>
                </>
              )}
              {selected.status === 'approved' && (
                <button
                  onClick={() => handleAction(selected.id, 'reject')}
                  disabled={!!actionLoading}
                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-[13px] hover:bg-slate-50 disabled:opacity-50"
                >비활성화</button>
              )}
              {selected.status === 'rejected' && (
                <button
                  onClick={() => handleAction(selected.id, 'approve')}
                  disabled={!!actionLoading}
                  className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-[13px] font-medium hover:bg-green-700 disabled:opacity-50"
                >다시 승인</button>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── ApprovalModal ─────────────────────────────────────────────── */}
      <ApprovalModal
        open={!!approvalTarget}
        pkg={approvalTarget}
        onClose={() => setApprovalTarget(null)}
        onApprove={handleApproveOptimistic}
        onReject={handleRejectOptimistic}
        onRegenerate={handleRegenerateCopies}
      />

      {/* ── PosterStudio ─────────────────────────────────────────────── */}
      <PosterStudio
        open={posterOpen}
        format={posterFormat}
        data={posterData}
        pkg={posterPkg}
        downloading={downloading}
        pkgId={posterPkgId}
        onClose={handleClosePoster}
        onUpdateField={updateField}
        onDownload={downloadPoster}
      />

      {/* ── MarketingPromptGenerator ──────────────────────────────────── */}
      {promptTarget && (
        <MarketingPromptGenerator pkg={promptTarget} onClose={() => setPromptTarget(null)} />
      )}

      {/* ── CardNewsStudio ───────────────────────────────────────────── */}
      {studioOpen && (
        <CardNewsStudio onClose={() => setStudioOpen(false)} />
      )}

      {/* ── AdPerformanceDashboard ───────────────────────────────────── */}
      {brainOpen && (
        <AdPerformanceDashboard onClose={() => setBrainOpen(false)} />
      )}

      {/* ── MetaAutoPublisher ────────────────────────────────────────── */}
      {metaLiveOpen && (
        <MetaAutoPublisher onClose={() => setMetaLiveOpen(false)} />
      )}

      {/* ── Toast ─────────────────────────────────────────────────────── */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-5 py-3 rounded-xl text-[13px] font-medium transition-all animate-in slide-in-from-bottom-4 ${
            toast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
