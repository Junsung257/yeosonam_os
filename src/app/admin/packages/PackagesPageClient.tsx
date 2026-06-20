'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import useSWR from 'swr';
import { useToast } from '@/components/ui/Toast';
import nextDynamic from 'next/dynamic';
import type { MarketingCopy } from '@/lib/ai';
import { useVendors } from '@/hooks/useVendors';
import { useMarketingTracker, PLATFORMS, PlatformKey } from '@/hooks/useMarketingTracker';
import { usePosterStudio } from '@/hooks/usePosterStudio';
import {
  PACKAGE_STATUS_BADGE as STATUS_BADGE,
  PACKAGE_STATUS_LABEL as STATUS_LABEL,
  AUDIT_BADGE,
} from '@/lib/package-status';
import { getAttractionPreviewNamesFromItinerary } from '@/lib/itinerary-attraction-summary';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import { trackEngagement } from '@/lib/tracker';

// 무거운 컴포넌트 lazy load (recharts, html-to-image 등 포함)
const ApprovalModal = nextDynamic(() => import('@/components/admin/ApprovalModal'), { ssr: false });
const MarketingLogModal = nextDynamic(() => import('@/components/admin/MarketingLogModal'), { ssr: false });
const PosterStudio = nextDynamic(() => import('@/components/admin/PosterStudio'), { ssr: false });
const MarketingPromptGenerator = nextDynamic(() => import('@/components/admin/MarketingPromptGenerator'), { ssr: false });
const CardNewsStudio = nextDynamic(() => import('@/components/admin/CardNewsStudio'), { ssr: false });
const AdPerformanceDashboard = nextDynamic(() => import('@/components/admin/AdPerformanceDashboard'), { ssr: false });
const MetaAutoPublisher = nextDynamic(() => import('@/components/admin/MetaAutoPublisher'), { ssr: false });

// ── DB 구조화 필드 → 고객용 상품 원문 생성 (민감정보 0) ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateProductText(pkg: any): string {
  if (!pkg) return '[상품 데이터를 불러올 수 없습니다]';
  const lines: string[] = [];
  const title = pkg.display_title || pkg.title || '상품명';
  const dest = pkg.destination || '';
  const style = pkg.trip_style || `${pkg.nights || '?'}박${pkg.duration || '?'}일`;
  const airport = pkg.departure_airport || '';
  const airline = (pkg.airline || '').replace(/\(.*?\)/, '').trim();

  // ── 상품 기본 ──
  lines.push(`[상품명] ${title}`);
  lines.push(`[목적지] ${dest}`);
  lines.push(`[일정] ${style}`);
  if (airport) lines.push(`[출발] ${airport} | ${airline || ''}`);
  if (pkg.min_participants) lines.push(`[최소출발] ${pkg.min_participants}명`);
  lines.push('');

  // ── 핵심 특전 ──
  const highlights: string[] = pkg.product_highlights || [];
  if (highlights.length) {
    lines.push('[핵심 특전]');
    highlights.forEach((h: string) => lines.push(`• ${h}`));
    lines.push('');
  }

  // ── 요금표 ──
  const tiers: PriceTier[] = pkg.price_tiers || [];
  if (tiers.length) {
    lines.push('[요금표]');
    const sorted = [...tiers].sort((a, b) => (a.adult_price || 0) - (b.adult_price || 0));
    for (const t of sorted) {
      const price = t.adult_price ? `${t.adult_price.toLocaleString()}원` : '-';
      const dates = t.departure_dates?.length
        ? t.departure_dates.map((d: string) => { const [,m,day] = d.split('-'); return `${+m}/${+day}`; }).join(', ')
        : t.period_label || '';
      lines.push(`${dates}: ${price}`);
    }
    lines.push('');
  }

  // ── 일정 ──
  const days = pkg.itinerary_data?.days || [];
  if (days.length) {
    lines.push('[일정 안내]');
    for (const day of days) {
      const regions = (day.regions || []).join(' → ');
      lines.push(`${day.day}일차: ${regions}`);
      const schedule = day.schedule || [];
      for (const s of schedule) {
        if (s.type === 'optional') continue; // 옵션은 별도 섹션
        const time = s.time && s.time !== '전일' ? `${s.time} ` : '';
        lines.push(`  ${time}${s.activity}`);
      }
      // 식사
      const meals = day.meals || {};
      const mealParts: string[] = [];
      if (meals.breakfast) mealParts.push(`조: ${meals.breakfast_note || '호텔식'}`);
      if (meals.lunch) mealParts.push(`중: ${meals.lunch_note || '현지식'}`);
      if (meals.dinner) mealParts.push(`석: ${meals.dinner_note || '현지식'}`);
      if (mealParts.length) lines.push(`  [식사] ${mealParts.join(' / ')}`);
      // 호텔
      if (day.hotel?.name) lines.push(`  [숙소] ${day.hotel.name} (${day.hotel.grade || ''})`);
      lines.push('');
    }
  }

  // ── 포함 사항 ──
  const inc: string[] = pkg.inclusions || [];
  if (inc.length) {
    lines.push('[포함 사항]');
    inc.forEach((i: string) => lines.push(`✅ ${i}`));
    lines.push('');
  }

  // ── 불포함 사항 ──
  const exc: string[] = pkg.excludes || [];
  if (exc.length) {
    lines.push('[불포함 사항]');
    exc.forEach((x: string) => lines.push(`❌ ${x}`));
    lines.push('');
  }

  // ── 숙소 ──
  const accom: string[] = pkg.accommodations || [];
  if (accom.length) {
    lines.push('[숙소]');
    accom.forEach((a: string) => lines.push(`🏨 ${a}`));
    lines.push('');
  }

  // ── 선택관광 ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: any[] = pkg.optional_tours || [];
  if (opts.length) {
    lines.push('[선택관광]');
    for (const o of opts) {
      const price = o.price_usd ? `$${o.price_usd}` : o.price_krw ? `${o.price_krw.toLocaleString()}원` : '';
      const note = o.note ? ` (${o.note})` : '';
      lines.push(`• ${o.name} ${price}${note}`);
    }
    lines.push('');
  }

  // ── 유의사항 ──
  const notices: string[] = pkg.notices_parsed || [];
  if (notices.length) {
    lines.push('[유의사항]');
    notices.forEach((n: string) => lines.push(n.startsWith('-') || n.startsWith('▪') || n.startsWith('※') ? n : `• ${n}`));
    lines.push('');
  }

  // ── 가이드팁 (불포함에 없을 경우 별도 표기) ──
  if (pkg.guide_tip && pkg.guide_tip > 0) {
    lines.push(`[가이드/기사 팁] $${pkg.guide_tip}/인`);
  }
  if (pkg.single_supplement) {
    const sup = typeof pkg.single_supplement === 'number' && pkg.single_supplement > 1000
      ? `${pkg.single_supplement.toLocaleString()}원` : `$${pkg.single_supplement}`;
    lines.push(`[싱글차지] ${sup}/인`);
  }

  return lines.join('\n').trim();
}

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

export interface Package {
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
  audit_status?: string;
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
  attraction_preview_names?: string[];
  has_itinerary_data?: boolean;
  excluded_dates?: string[];
  confirmed_dates?: string[];
  marketing_copies?: MarketingCopy[];
  internal_code?: string;
  short_code?: string;
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
  // 2026-05-19 박제 (PR #139 P2-A): 같은 카탈로그 N 패키지 그룹 UUID
  catalog_id?: string | null;
}

const STATUS_OPTIONS = [
  { value: 'all',            label: '전체' },
  { value: 'selling',        label: '판매 중' },
  { value: 'pending',        label: '검토 대기' },
  { value: 'archived',       label: '아카이브' },
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

// 상태/감사 배지 매핑은 SSOT (src/lib/package-status.ts) 에서 import — 위 import 블록 참조

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
  return 'bg-admin-bg text-admin-muted border-admin-border';
}

/** margin_rate(소수) 기준 동적 색상 */
function marginColor(rate?: number): string {
  if (rate == null) return 'text-admin-muted-2';
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
    if (diff < 0) return { label: '만료', className: 'bg-admin-surface-2 text-admin-muted' };
    if (diff === 0) return { label: 'D-Day', className: 'bg-red-50 text-red-700 font-bold' };
    if (diff <= 3) return { label: `D-${diff}`, className: 'bg-red-50 text-red-700 font-bold' };
    if (diff <= 7) return { label: `D-${diff}`, className: 'bg-orange-50 text-orange-700' };
    return { label: `D-${diff}`, className: 'bg-green-50 text-green-700' };
  }
  return null;
}

// 등록 후 30일 자동 archive 정책 D-day (사장님 정책 2026-04-27)
// - D+0~D+22: 표시 안 함 (여유)
// - D+23~D+26 (archive D-7~D-4): 주황 경고
// - D+27~D+29 (archive D-3~D-1): 빨강 경고
// - D+30+: cron 이 자동 archive 하므로 표시 안 함 (목록에서 사라짐)
function getArchiveDDayInfo(pkg: Package): { label: string; className: string } | null {
  if (!pkg.created_at) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const created = new Date(pkg.created_at);
  const archiveDate = new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);
  archiveDate.setHours(0, 0, 0, 0);
  const diff = Math.round((archiveDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0 || diff > 7) return null;
  if (diff <= 3) return { label: `archive D-${diff}`, className: 'bg-red-50 text-red-700 font-bold' };
  return { label: `archive D-${diff}`, className: 'bg-orange-50 text-orange-700' };
}

function isExpired(pkg: Package): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (pkg.ticketing_deadline) {
    const deadline = new Date(pkg.ticketing_deadline);
    deadline.setHours(0, 0, 0, 0);
    if (deadline < today) return true;
  }
  if (pkg.created_at) {
    const created = new Date(pkg.created_at);
    const expiry = new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);
    expiry.setHours(0, 0, 0, 0);
    if (expiry < today) return true;
  }
  return false;
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

function getPackageNextOperationLabel(pkg: Package, expired: boolean): string {
  if (expired) return '연장';
  if (pkg.status === 'pending_review') return '검수';
  if (pkg.status === 'pending') return '승인/거부';
  if (pkg.status === 'approved') return '발행';
  return '수정';
}

function getPackageMissingCoreFields(pkg: Package): string[] {
  const hasPrice = Boolean(pkg.price) || Boolean(pkg.price_tiers?.length);
  const days = (pkg as { itinerary_data?: { days?: unknown[] } }).itinerary_data?.days;
  const hasItinerary = pkg.has_itinerary_data === true || (Array.isArray(days) && days.length > 0);

  return [
    !pkg.destination ? '목적지' : null,
    !hasPrice ? '가격' : null,
    !pkg.product_summary && !pkg.product_highlights?.length ? '요약' : null,
    !hasItinerary ? '일정' : null,
    !pkg.airline ? '항공' : null,
  ].filter(Boolean) as string[];
}

function getPackageNextOperationReason(pkg: Package, expired: boolean): string {
  const missingCoreFields = getPackageMissingCoreFields(pkg);

  if (expired) return '판매 기간이 만료되어 노출 전 기한 연장이 먼저 필요합니다.';
  if (pkg.status === 'pending_review') return '신규 등록 또는 자동 생성 상품이라 내용 검수가 우선입니다.';
  if (pkg.status === 'pending') return '승인 대기 상태라 운영자가 승인 또는 거부를 결정해야 합니다.';
  if (pkg.status === 'approved' && missingCoreFields.length > 0) {
    return `승인 상품이지만 ${missingCoreFields.slice(0, 2).join(', ')} 확인이 필요해 발행 전 점검합니다.`;
  }
  if (pkg.status === 'approved') return '승인된 상품이라 고객 상세 화면과 발행 자료를 확인합니다.';
  if (missingCoreFields.length > 0) {
    return `${missingCoreFields.slice(0, 2).join(', ')} 정보가 비어 있어 수정 후 고객 노출 품질을 맞춥니다.`;
  }
  if (isDeadlineSoon(pkg)) return '마감이 임박해 판매 상태와 잔여 가능일을 확인합니다.';
  return '상품 정보가 운영 기준을 유지하도록 최신 상태를 확인합니다.';
}

function getPackageActionImpactText(pkg: Package, expired: boolean): string {
  if (expired) return '처리 영향: 판매 연장 후 고객 노출 가능 여부와 마감 안내를 다시 확인합니다.';
  if (pkg.status === 'pending_review') return '처리 영향: 검수 완료 전까지 공개 노출과 상담 추천을 보류합니다.';
  if (pkg.status === 'pending') return '처리 영향: 승인 또는 거부 결정이 공개 전환과 운영 큐 정리에 반영됩니다.';
  if (pkg.status === 'approved') return '처리 영향: 발행 확인 후 공개 목록, 상세 CTA, 마케팅 자료에 고객이 접근합니다.';
  if (isDeadlineSoon(pkg)) return '처리 영향: 마감 임박 상품은 잔여 좌석과 노출 중단 판단을 먼저 맞춥니다.';
  return '처리 영향: 수정 내용이 가격, 일정, 이미지, 상담 문구 품질에 반영됩니다.';
}

function getPackageOperationRiskLabel(pkg: Package, expired: boolean): string {
  if (expired) return '판매 기한 만료';
  if (pkg.status === 'pending_review') return '고객 노출 전 검수';
  if (pkg.status === 'pending') return '승인 판단 대기';
  if (pkg.status === 'approved') return '채널 정리 누락';
  if (isDeadlineSoon(pkg)) return '마감 노출 오류';
  if (getPackageMissingCoreFields(pkg).length > 0) return '상세 전환 저하';
  return '운영 품질 유지';
}

function buildPackageActionDecisionMetadata(
  pkg: Package,
  options: { action?: string; source?: string; expired?: boolean } = {},
): Record<string, unknown> {
  const expired = options.expired ?? isExpired(pkg);
  const missingFields = getPackageMissingCoreFields(pkg);
  const nextAction = getPackageNextOperationLabel(pkg, expired);
  const nextActionReason = getPackageNextOperationReason(pkg, expired);
  const impactSummary = getPackageActionImpactText(pkg, expired);
  const hasPrice = Boolean(pkg.price) || Boolean(pkg.price_tiers?.length);
  const days = (pkg as { itinerary_data?: { days?: unknown[] } }).itinerary_data?.days;
  const hasItinerary = pkg.has_itinerary_data === true || (Array.isArray(days) && days.length > 0);

  return {
    packageId: pkg.id,
    status: pkg.status,
    destination: pkg.destination ?? null,
    action_intent: options.action ?? nextAction,
    source: options.source,
    operation_risk: getPackageOperationRiskLabel(pkg, expired),
    next_action: nextAction,
    next_action_reason: nextActionReason,
    impact_summary: impactSummary,
    decision_summary: `${nextAction}: ${nextActionReason}`,
    missing_fields: missingFields,
    missing_field_count: missingFields.length,
    ready_for_publish: pkg.status === 'approved' && missingFields.length === 0 && !expired,
    has_price: hasPrice,
    has_itinerary: hasItinerary,
    has_deadline_risk: expired || isDeadlineSoon(pkg),
    price_tier_count: pkg.price_tiers?.length ?? 0,
  };
}

function buildBulkPackageActionDecisionMetadata(pkgs: Package[], action: string): Record<string, unknown> {
  const statusCounts = pkgs.reduce<Record<string, number>>((acc, pkg) => {
    acc[pkg.status] = (acc[pkg.status] ?? 0) + 1;
    return acc;
  }, {});
  const missingFieldCount = pkgs.reduce((sum, pkg) => sum + getPackageMissingCoreFields(pkg).length, 0);
  const deadlineRiskCount = pkgs.filter(pkg => isExpired(pkg) || isDeadlineSoon(pkg)).length;
  const readyForPublishCount = pkgs.filter(pkg => {
    const expired = isExpired(pkg);
    return pkg.status === 'approved' && getPackageMissingCoreFields(pkg).length === 0 && !expired;
  }).length;
  const actionLabel = action === 'bulk_approve' ? '일괄 승인'
    : action === 'bulk_archive' ? '일괄 아카이브'
      : action === 'bulk_restore' ? '일괄 복원'
        : '일괄 수정';

  return {
    selected_count: pkgs.length,
    status_counts: statusCounts,
    missing_field_count: missingFieldCount,
    deadline_risk_count: deadlineRiskCount,
    ready_for_publish_count: readyForPublishCount,
    operation_risk: deadlineRiskCount > 0 ? '마감 노출 오류'
      : missingFieldCount > 0 ? '상세 전환 저하'
        : '운영 큐 정리',
    next_action: actionLabel,
    next_action_reason: `${pkgs.length}개 선택 상품의 상태와 누락 필드를 한 번에 정리합니다.`,
    decision_summary: `${actionLabel}: ${pkgs.length}개 선택, 누락 필드 ${missingFieldCount}개, 마감 리스크 ${deadlineRiskCount}건`,
  };
}

function getPackagePriceRangeLabel(minPrice?: number | null, maxPrice?: number | null): string {
  if (!minPrice) return '-';
  if (!maxPrice || minPrice === maxPrice) return `${minPrice.toLocaleString()}원`;
  return `${minPrice.toLocaleString()}~${maxPrice.toLocaleString()}원`;
}

// ── MarketingToggle (React.memo) ─────────────────────────────────────────────
function PackageOpsQueue({
  activeQueue,
  pendingCount,
  reviewCount,
  readyCount,
  deadlineCount,
  gapCount,
  onQueueSelect,
}: {
  activeQueue?: 'review' | 'copy' | 'publish' | 'deadline' | null;
  pendingCount: number;
  reviewCount: number;
  readyCount: number;
  deadlineCount: number;
  gapCount: number;
  onQueueSelect: (queue: 'review' | 'copy' | 'publish' | 'deadline' | 'gaps') => void;
}) {
  type QueueTone = 'amber' | 'blue' | 'emerald' | 'red';
  const cards: Array<{ id: 'review' | 'copy' | 'publish' | 'deadline'; label: string; count: number; detail: string; target: string; reason: string; operationRisk: string; tone: QueueTone }> = [
    { id: 'review' as const, label: '검수', count: pendingCount, detail: '신규 등록 확인', target: '신규 등록 또는 검수 대기 상품만 보여줍니다.', reason: '신규 상품은 고객 노출 전 핵심 정보 확인이 먼저입니다.', operationRisk: '고객 노출 전 검수', tone: 'amber' },
    { id: 'copy' as const, label: '수정', count: reviewCount + gapCount, detail: '카피/필드 보완', target: '카피나 필드 보완이 필요한 상품만 보여줍니다.', reason: '누락 필드와 카피 품질이 상세 전환에 직접 영향을 줍니다.', operationRisk: '상세 전환 저하', tone: 'blue' },
    { id: 'publish' as const, label: '발행', count: readyCount, detail: '승인 상품 점검', target: '승인 후 고객 노출 전 점검이 필요한 상품만 보여줍니다.', reason: '승인된 상품은 미리보기와 판매 채널 정리가 다음 단계입니다.', operationRisk: '채널 정리 누락', tone: 'emerald' },
    { id: 'deadline' as const, label: '마감 대응', count: deadlineCount, detail: 'D-3 이내 상품', target: '마감 임박으로 판매 상태 확인이 필요한 상품만 보여줍니다.', reason: '마감 임박 상품은 예약 가능 상태와 노출 중단 판단이 급합니다.', operationRisk: '마감 노출 오류', tone: 'red' },
  ] as const;
  const total = cards.reduce((sum, card) => sum + card.count, 0);
  const activeCards = cards.filter(card => card.count > 0);
  const priorityCard = activeCards[0];
  const urgentCards = activeCards.filter(card => ['review', 'copy', 'deadline'].includes(card.id));
  const clearCardsCount = cards.length - activeCards.length;
  const packageQueueHealthItems = [
    { label: '활성 큐', value: `${activeCards.length}/${cards.length}`, tone: activeCards.length > 0 ? 'warn' : 'good' },
    { label: '긴급 큐', value: `${urgentCards.length}개`, tone: urgentCards.length > 0 ? 'danger' : 'good' },
    { label: '정리됨', value: `${clearCardsCount}개`, tone: clearCardsCount === cards.length ? 'good' : 'neutral' },
  ] as const;
  const selectedQueueCard = activeQueue ? cards.find(card => card.id === activeQueue) : undefined;
  const packageQueueSummaryId = 'admin-package-queue-summary';
  const packageQueueLeadId = 'admin-package-queue-lead';
  const selectedQueueSummary = selectedQueueCard
    ? `현재 선택: ${selectedQueueCard.label} ${selectedQueueCard.count}건. 운영 리스크: ${selectedQueueCard.operationRisk}. 이유: ${selectedQueueCard.reason}`
    : '큐를 선택하면 해당 상품만 필터링됩니다.';
  const packageQueueSummaryText = total > 0
    ? `상품 액션 큐에 처리할 작업이 ${total}건 있습니다. 활성 큐 ${activeCards.length}/${cards.length}, 긴급 큐 ${urgentCards.length}개입니다. ${activeCards.map(card => `${card.label} ${card.count}건, 운영 리스크 ${card.operationRisk}, 이유 ${card.reason}`).join(', ')}을 우선 확인하세요.`
    : '상품 액션 큐에 대기 중인 작업이 없습니다. 각 큐에서 최신 상품 상태를 확인할 수 있습니다.';
  const packageQueueLeadText = priorityCard
    ? `우선 처리: ${priorityCard.label} ${priorityCard.count}건. 운영 리스크: ${priorityCard.operationRisk}. 이유: ${priorityCard.reason} ${selectedQueueSummary}`
    : '대기 중인 상품 작업이 없습니다.';
  const toneClass: Record<QueueTone, string> = {
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    red: 'border-red-200 bg-red-50 text-red-700',
  };

  return (
    <section className="mb-3 rounded-admin-md border border-admin-border-mid bg-white p-4 shadow-admin-xs" aria-describedby={`${packageQueueSummaryId} ${packageQueueLeadId}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-admin-base font-bold text-admin-text-2">상품 액션 큐</h2>
          <p className="mt-0.5 text-[11px] text-admin-muted-2">검수, 수정, 발행, 마감 대응을 먼저 처리합니다.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-black tabular-nums ${total > 0 ? 'bg-slate-950 text-white' : 'bg-emerald-100 text-emerald-800'}`}>
          {total > 0 ? `${total}건 처리` : '대기 없음'}
        </span>
      </div>
      <p id={packageQueueSummaryId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {packageQueueSummaryText}
      </p>
      <p
        id={packageQueueLeadId}
        data-testid="admin-package-queue-lead"
        className={`mt-3 rounded-admin-sm border px-3 py-2 text-admin-xs font-semibold ${
          priorityCard ? 'border-admin-border-mid bg-admin-bg text-admin-text-2' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}
      >
        {packageQueueLeadText}
      </p>
      <div
        className="mb-3 grid grid-cols-3 gap-2"
        data-testid="admin-package-queue-health"
        aria-label={`상품 큐 상태: 활성 큐 ${activeCards.length}/${cards.length}, 긴급 큐 ${urgentCards.length}개, 정리됨 ${clearCardsCount}개`}
      >
        {packageQueueHealthItems.map(item => (
          <div
            key={item.label}
            data-testid="admin-package-queue-health-item"
            className={`rounded-admin-sm border px-2.5 py-2 ${
              item.tone === 'danger'
                ? 'border-red-200 bg-red-50 text-red-700'
                : item.tone === 'warn'
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : item.tone === 'good'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-admin-border-mid bg-admin-bg text-admin-text-2'
            }`}
          >
            <p className="text-[10px] font-semibold text-current/65">{item.label}</p>
            <p className="mt-0.5 text-[14px] font-black tabular-nums">{item.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {cards.map(card => {
          const cardDescriptionId = `admin-package-queue-${card.id}-description`;
          return (
            <button
              key={card.id}
              type="button"
              data-testid={`admin-package-queue-${card.id}`}
              onClick={() => onQueueSelect(card.id)}
              aria-pressed={activeQueue === card.id}
              aria-describedby={`${packageQueueSummaryId} ${cardDescriptionId}`}
              aria-label={`${card.label} 큐 열기, ${card.count}건`}
              className={`min-h-[86px] rounded-admin-md border p-3 text-left transition-all duration-160 hover:border-admin-border-strong hover:shadow-admin-sm ${
                activeQueue === card.id ? 'ring-2 ring-slate-900 ring-offset-1' : ''
              } ${
                card.count > 0 ? toneClass[card.tone] : 'border-admin-border-mid bg-admin-bg text-admin-muted'
              }`}
            >
              <span id={cardDescriptionId} className="sr-only">
                {card.target} 현재 {card.count}건입니다. 운영 리스크는 {card.operationRisk}, 처리 이유는 {card.reason}입니다.
              </span>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[12px] font-bold">{card.label}</p>
                  <p className="mt-0.5 text-[11px] text-current/60">{card.detail}</p>
                </div>
                <span className="text-[24px] font-black leading-none tabular-nums">{card.count}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span
                  data-testid="admin-package-queue-risk"
                  className="inline-flex max-w-full rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-black text-admin-text ring-1 ring-black/5"
                >
                  리스크: {card.operationRisk}
                </span>
                <span
                  data-testid="admin-package-queue-reason"
                  className="inline-flex max-w-full rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black text-admin-text-2 ring-1 ring-black/5"
                >
                  {card.reason}
                </span>
              </div>
              <p className="mt-3 text-[11px] font-semibold text-current/70">{card.count > 0 ? `${card.label} 화면 보기` : '확인'}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

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
          ? 'bg-blue-600 text-white'
          : 'bg-white border border-admin-border-mid text-admin-muted-2 hover:border-slate-400'
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
  onKakaoCopy,
  onBulkContentGen,
  contentStatus,
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
  onKakaoCopy: (pkg: Package) => void;
  onBulkContentGen: (pkg: Package) => void;
  contentStatus: Map<string, Set<string>>;
}) {
  const { isActive: isPlatformActive, getAuditInfo, togglePlatform, togglingKey, getCoverage } = marketingTracker;
  const copyMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const firstCopyMenuItemRef = useRef<HTMLButtonElement | null>(null);
  const copyMenuWasOpenRef = useRef(false);

  useEffect(() => {
    const isOpen = copyDropdownId === pkg.id;

    if (isOpen && !copyMenuWasOpenRef.current) {
      window.setTimeout(() => firstCopyMenuItemRef.current?.focus(), 0);
    }

    if (!isOpen && copyMenuWasOpenRef.current) {
      window.setTimeout(() => copyMenuTriggerRef.current?.focus(), 0);
    }

    copyMenuWasOpenRef.current = isOpen;
  }, [copyDropdownId, pkg.id]);

  const openCopyMenuFromTrigger = useCallback((trigger: HTMLButtonElement, action: string) => {
    copyMenuTriggerRef.current = trigger;
    const willOpen = copyDropdownId !== pkg.id;

    if (willOpen) {
      trackEngagement({
        event_type: ANALYTICS_EVENTS.adminActionCompleted,
        page_url: '/admin/packages',
        metadata: {
          surface: 'packages_row_action',
          action: action,
          ...buildPackageActionDecisionMetadata(pkg, { action, source: action === 'more_menu_opened' ? 'row_primary_action' : undefined }),
          source: action === 'more_menu_opened' ? 'row_primary_action' : undefined,
        },
      });
    }

    onSetCopyDropdownId(willOpen ? pkg.id : null);
  }, [copyDropdownId, onSetCopyDropdownId, pkg]);

  const handleRowClick = () => {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.adminActionCompleted,
      page_url: '/admin/packages',
      metadata: {
        surface: 'packages_row_action',
        action: 'row_clicked',
        ...buildPackageActionDecisionMetadata(pkg, {
          action: pkg.status === 'pending_review' ? 'review_opened' : 'detail_opened',
          source: 'row',
        }),
        nextAction: pkg.status === 'pending_review' ? 'review_opened' : 'detail_opened',
      },
    });
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
  const rowActionDescriptionId = `admin-package-row-actions-${pkg.id}`;
  const packageActionImpactId = `admin-package-row-action-impact-${pkg.id}`;
  const rowActionStatusDescriptionId = `${rowActionDescriptionId} ${packageActionImpactId} admin-package-bulk-status`;
  const attractionPreview = (pkg.attraction_preview_names && pkg.attraction_preview_names.length > 0)
    ? pkg.attraction_preview_names
    : getAttractionPreviewNamesFromItinerary(pkg.itinerary_data, 3);
  const nextOperationLabel = getPackageNextOperationLabel(pkg, expired);
  const nextOperationReason = getPackageNextOperationReason(pkg, expired);
  const packageActionImpactText = getPackageActionImpactText(pkg, expired);
  const copyMenuDescriptionId = `admin-package-copy-menu-description-${pkg.id}`;
  const copyMenuDecisionText = '채널별 복사 문구를 생성해 고객 안내, 광고, 상담 메시지에 바로 붙여넣을 수 있습니다.';

  return (
    <tr
      className={`group border-b border-admin-border-mid hover:bg-admin-bg ${expired ? 'opacity-60' : ''} ${isChecked ? 'bg-blue-50' : ''}`}
    >
      <td className="px-3 py-2 w-8" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => {}}
          onClick={e => onToggleCheck(pkg.id, idx, e as React.MouseEvent)}
          className="rounded cursor-pointer"
          aria-label={`${pkg.title} 선택`}
        />
      </td>
      <td className="px-3 py-2 cursor-pointer max-w-[280px]" onClick={handleRowClick}>
        {/* 상품명 + 출발지 배지 */}
        <div className="flex items-start gap-1.5 flex-wrap">
          <span className="font-semibold text-admin-text-2 leading-snug">{pkg.title}</span>
          {pkg.has_itinerary_data === false && (
            <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium border leading-tight bg-amber-50 text-amber-700 border-amber-100">
              일정표없음
            </span>
          )}
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
          <div className="text-[11px] text-admin-muted-2 mt-0.5">{pkg.product_type} · {pkg.trip_style}</div>
        )}
        {attractionPreview.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {attractionPreview.slice(0, 3).map((name, i) => (
              <span key={`${pkg.id}-ap-${i}`} className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 text-[10px]">
                {name}
              </span>
            ))}
          </div>
        )}
        {/* internal_code / short_code — 클릭 복사 + Toast */}
        {(pkg.products?.internal_code ?? pkg.internal_code ?? pkg.short_code) ? (
          <button
            type="button"
            className="mt-0.5 text-[11px] text-admin-muted-2 hover:text-blue-500 font-mono transition-colors group/code"
            onClick={e => {
              e.stopPropagation();
              const code = pkg.products?.internal_code ?? pkg.internal_code ?? pkg.short_code ?? '';
              navigator.clipboard.writeText(code).then(() => {
                onShowToast('success', `상품코드가 복사되었습니다: ${code}`);
              });
            }}
            title="클릭하여 상품코드 복사"
          >
            {pkg.products?.internal_code ?? pkg.internal_code ?? pkg.short_code}
            <span className="opacity-0 group-hover/code:opacity-100 ml-0.5 transition-opacity">📋</span>
          </button>
        ) : (
          <span className="text-[11px] text-admin-muted-2 font-mono">코드 미발급</span>
        )}
        {/* 2026-05-19 박제 (P2-A 3 / 전문가 판단):
            catalog_id 그룹 배지 — slate-indigo 토큰 (violet은 AI/추천에 박혀 있어 의미 충돌). */}
        {pkg.catalog_id && (
          <span
            className="ml-1.5 inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-medium"
            title={`같은 카탈로그에서 분리된 패키지 그룹 (catalog_id: ${pkg.catalog_id.slice(0, 8)})`}
          >
            📚 카탈로그 그룹
          </span>
        )}
      </td>
      <td className="px-3 py-2 min-w-[130px]" onClick={e => e.stopPropagation()}>
        {inlineEditPkgId === pkg.id ? (
          <select
            className="w-full border border-blue-400 rounded px-2 py-1 text-admin-sm text-admin-text-2"
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
              <span className="text-admin-sm text-blue-700 font-medium">{op.name}</span>
              {!op.is_active && (
                <span className="text-[10px] px-1 py-0.5 bg-red-50 text-red-600 rounded font-medium">비활성</span>
              )}
              <span className="opacity-0 group-hover/vendor:opacity-100 text-[10px] text-admin-muted-2 ml-auto">✎</span>
            </button>
          );
          return (
            <button
              className="text-[11px] text-admin-muted-2 hover:text-blue-500 hover:bg-blue-50 rounded px-1 py-0.5"
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
              <div className={`text-admin-sm ${color}`}>
                +{profit.toLocaleString()}원
              </div>
              <div className="text-[11px] text-admin-muted-2">
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
              <div className={`text-admin-sm ${color}`}>+{profit.toLocaleString()}원</div>
              <div className="text-[11px] text-admin-muted-2">({pkg.commission_rate}%)</div>
            </div>
          );
        })() : pkg.commission_rate != null ? (
          <span className={`text-admin-sm ${marginColor(pkg.commission_rate / 100)}`}>{pkg.commission_rate}%</span>
        ) : (
          <span className="text-[11px] text-admin-muted-2">-</span>
        )}
      </td>
      <td className="px-3 py-2 text-admin-muted cursor-pointer" onClick={handleRowClick}>{pkg.destination || '-'}</td>
      <td className="px-3 py-2 text-right text-admin-text-2 cursor-pointer" onClick={handleRowClick}>
        {minPrice ? (
          minPrice === maxPrice
            ? minPrice.toLocaleString() + '원'
            : `${minPrice.toLocaleString()}~${maxPrice.toLocaleString()}원`
        ) : '-'}
      </td>
      <td className="px-3 py-2 text-center cursor-pointer" onClick={handleRowClick}>
        <div className="flex flex-col items-center gap-0.5">
          {dday ? (
            <span className={`px-2 py-0.5 rounded text-[11px] ${dday.className}`}>{dday.label}</span>
          ) : pkg.ticketing_deadline ? (
            <span className="text-[11px] text-admin-muted-2">{pkg.ticketing_deadline}</span>
          ) : (
            <span className="text-[11px] text-admin-muted-2">-</span>
          )}
          {pkg.created_at && (
            <span className="text-[10px] text-admin-muted-2" title={`등록일: ${pkg.created_at.slice(0,10)}`}>
              등록 {pkg.created_at.slice(5,10)}
            </span>
          )}
          {(() => {
            const archiveDday = getArchiveDDayInfo(pkg);
            return archiveDday ? (
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${archiveDday.className}`} title="등록 후 30일 자동 archive">
                {archiveDday.label}
              </span>
            ) : null;
          })()}
        </div>
      </td>
      <td className="px-3 py-2 text-center cursor-pointer" onClick={handleRowClick}>
        <div className="flex flex-col items-center gap-1">
          <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${STATUS_BADGE[pkg.status] || 'bg-admin-surface-2 text-admin-muted'}`}>
            {STATUS_LABEL[pkg.status] ?? pkg.status}
          </span>
          {(pkg as { audit_status?: string }).audit_status && AUDIT_BADGE[(pkg as { audit_status: string }).audit_status] && (
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${AUDIT_BADGE[(pkg as { audit_status: string }).audit_status].cls}`}
              title={AUDIT_BADGE[(pkg as { audit_status: string }).audit_status].title}
            >
              {AUDIT_BADGE[(pkg as { audit_status: string }).audit_status].label}
            </span>
          )}
          {/* N1 박제 (2026-05-16): 누락 필드 빨간 배지 — 트립박스 ERP 표준 + 1-click 보완 이동 */}
          {(() => {
            const missing: string[] = [];
            if (!pkg.airline) missing.push('항공사');
            const days = (pkg as { has_itinerary_data?: boolean; itinerary_data?: { days?: unknown[] } }).itinerary_data?.days;
            if (!Array.isArray(days) || days.length === 0) missing.push('일정');
            if (!pkg.price && (!pkg.price_tiers || pkg.price_tiers.length === 0)) missing.push('가격');
            if (missing.length === 0) return null;
            return (
              <a
                href={`/admin/packages/${pkg.id}/review`}
                onClick={(e) => e.stopPropagation()}
                className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-300 hover:bg-red-200 cursor-pointer"
                title={`누락된 필드 — 사장님 1-click 보완 필요: ${missing.join(', ')}. 클릭 → review 페이지`}
              >
                ⚠ 누락 {missing.length}
              </a>
            );
          })()}
        </div>
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
          <div className="w-full bg-admin-surface-2 rounded-full h-1.5">
            <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${coverage}%` }} />
          </div>
          <span className="text-[10px] text-admin-muted-2">{PLATFORMS.filter(p => isPlatformActive(pkg.id, p.key)).length}/{PLATFORMS.length} ({coverage}%)</span>
        </div>
      </td>

      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
        <div className="flex flex-col gap-1.5">
          <div
            data-testid="admin-package-desktop-next-action-summary"
            aria-label={`다음 액션 ${nextOperationLabel}. ${nextOperationReason}`}
            className="rounded-admin-sm border border-admin-border bg-admin-bg px-2.5 py-1.5 text-left"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold text-admin-muted">다음 액션</span>
              <span className="text-[11px] font-black text-admin-text-2">{nextOperationLabel}</span>
            </div>
            <p className="mt-0.5 line-clamp-1 text-[10px] font-semibold text-admin-muted">
              {nextOperationReason}
            </p>
          </div>
          <p
            id={packageActionImpactId}
            data-testid="admin-package-desktop-action-impact-summary"
            aria-label={packageActionImpactText}
            className="rounded-admin-sm border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-[10px] font-black leading-snug text-blue-800"
          >
            {packageActionImpactText}
          </p>
          <p id={rowActionDescriptionId} className="sr-only">
            {pkg.title} 상품의 다음 운영 액션은 {nextOperationLabel}입니다. 근거는 {nextOperationReason}입니다. {packageActionImpactText} 검수, 수정, 발행, 더보기 순서로 처리할 수 있습니다.
          </p>
          <div role="group" aria-label={`${pkg.title} 핵심 상품 관리 액션`} className="grid grid-cols-4 gap-1">
            <button
              type="button"
              data-testid="admin-package-review-action"
              onClick={() => {
                if (pkg.status === 'pending_review') {
                  trackEngagement({
                    event_type: ANALYTICS_EVENTS.adminActionCompleted,
                    page_url: '/admin/packages',
                    metadata: {
                      surface: 'packages_row_action',
                      action: 'review_opened',
                      ...buildPackageActionDecisionMetadata(pkg, { action: 'review_opened', source: 'row_primary_action' }),
                    },
                  });
                  onSetApprovalTarget(pkg);
                  return;
                }
                if (pkg.status === 'pending' && !expired) {
                  onHandleAction(pkg.id, 'approve');
                  return;
                }
                onSetSelected(pkg);
              }}
              disabled={!!actionLoading}
              aria-busy={actionLoading?.startsWith(pkg.id)}
              aria-describedby={rowActionStatusDescriptionId}
              className="min-h-[34px] rounded-admin-sm border border-amber-200 bg-amber-50 px-2 text-[11px] font-black text-amber-700 transition hover:bg-amber-100 disabled:opacity-45"
              aria-label={`${pkg.title} 검수 액션`}
            >
              검수
            </button>
            <button
              type="button"
              data-testid="admin-package-edit-action"
              onClick={e => onOpenSingleEdit(pkg, e)}
              aria-describedby={rowActionStatusDescriptionId}
              className="min-h-[34px] rounded-admin-sm border border-blue-200 bg-blue-50 px-2 text-[11px] font-black text-blue-700 transition hover:bg-blue-100"
              aria-label={`${pkg.title} 수정 액션`}
            >
              수정
            </button>
            <button
              type="button"
              data-testid="admin-package-publish-action"
              onClick={() => {
                trackEngagement({
                  event_type: ANALYTICS_EVENTS.adminActionCompleted,
                  page_url: '/admin/packages',
                  metadata: {
                    surface: 'packages_row_action',
                    action: 'customer_preview_opened',
                    ...buildPackageActionDecisionMetadata(pkg, { action: 'customer_preview_opened', source: 'row_primary_action' }),
                  },
                });
                window.open(`/packages/${pkg.id}`, '_blank');
              }}
              aria-describedby={rowActionStatusDescriptionId}
              className="min-h-[34px] rounded-admin-sm border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-black text-emerald-700 transition hover:bg-emerald-100"
              aria-label={`${pkg.title} 발행 미리보기 액션`}
            >
              발행
            </button>
            <button
              type="button"
              data-testid="admin-package-more-action"
              aria-haspopup="menu"
              aria-expanded={copyDropdownId === pkg.id}
              aria-controls={`admin-package-copy-menu-${pkg.id}`}
              aria-describedby={rowActionStatusDescriptionId}
              onClick={e => {
                e.stopPropagation();
                openCopyMenuFromTrigger(e.currentTarget, 'more_menu_opened');
              }}
              className="min-h-[34px] rounded-admin-sm border border-admin-border-strong bg-white px-2 text-[11px] font-black text-admin-text-2 transition hover:bg-admin-bg"
              aria-label={`${pkg.title} 복사 메뉴 더보기`}
            >
              더보기
            </button>
          </div>
          {/* 포스터 버튼 */}
          <div role="group" aria-label={`${pkg.title} 발행 자료 작업`} className="flex flex-wrap items-center gap-1">
            <span className="mr-0.5 text-[10px] font-bold text-admin-muted-2">발행</span>
            <button
              type="button"
              onClick={() => onOpenPoster(pkg, 'A4')}
              className="px-1.5 py-1 border border-admin-border-strong text-admin-muted rounded text-[10px] hover:bg-admin-bg whitespace-nowrap"
              title="A4 포스터"
              aria-label={`${pkg.title} A4 포스터 열기`}
            >A4</button>
            <button
              type="button"
              onClick={() => {
                trackEngagement({
                  event_type: ANALYTICS_EVENTS.adminActionCompleted,
                  page_url: '/admin/packages',
                  metadata: {
                    surface: 'packages_row_action',
                    action: 'customer_preview_opened',
                    ...buildPackageActionDecisionMetadata(pkg, { action: 'customer_preview_opened', source: 'row_publish_group' }),
                  },
                });
                window.open(`/packages/${pkg.id}`, '_blank');
              }}
              className="px-1.5 py-1 border border-orange-300 text-orange-600 rounded text-[10px] hover:bg-orange-50 whitespace-nowrap"
              title="모바일 랜딩페이지 (고객용)"
              aria-label={`${pkg.title} 고객용 모바일 페이지 열기`}
            >모바일</button>
            <button
              type="button"
              onClick={() => window.open(`/admin/packages/${pkg.id}/reviews`, '_blank')}
              className="px-1.5 py-1 border border-amber-300 text-amber-600 rounded text-[10px] hover:bg-amber-50 whitespace-nowrap"
              title="고객 후기 관리 (카카오 피드백 등록)"
              aria-label={`${pkg.title} 고객 후기 관리 열기`}
            >후기</button>
            <button
              type="button"
              onClick={() => onPromptGen(pkg)}
              className="px-1.5 py-1 border border-blue-300 text-blue-600 rounded text-[10px] hover:bg-blue-50 whitespace-nowrap"
              title="마케팅 프롬프트 생성"
              aria-label={`${pkg.title} 마케팅 프롬프트 생성`}
            >AD</button>
            <button
              type="button"
              onClick={() => onStudioOpen()}
              className="px-1.5 py-1 border border-emerald-300 text-emerald-600 rounded text-[10px] hover:bg-emerald-50 whitespace-nowrap"
              title="카드뉴스 스튜디오"
              aria-label={`${pkg.title} 카드뉴스 스튜디오 열기`}
            >Studio</button>
            <button
              type="button"
              onClick={() => onKakaoCopy(pkg)}
              className="px-1.5 py-1 border border-pink-300 text-pink-600 rounded text-[10px] hover:bg-pink-50 whitespace-nowrap"
              title="카톡 마케팅 문구 생성"
              aria-label={`${pkg.title} 카톡 마케팅 문구 생성`}
            >문구</button>
            <button
              type="button"
              onClick={() => onBulkContentGen(pkg)}
              className="px-1.5 py-1 border border-violet-400 text-violet-700 rounded text-[10px] hover:bg-violet-50 whitespace-nowrap font-semibold"
              title="블로그+카드뉴스+광고카피 일괄 생성"
              aria-label={`${pkg.title} 전체 마케팅 콘텐츠 일괄 생성`}
            >전체</button>
            {/* 콘텐츠 현황 미니 배지 */}
            {(() => {
              const ch = contentStatus.get(pkg.id);
              if (!ch || ch.size === 0) return <span className="text-[9px] text-red-400" title="콘텐츠 없음">0/3</span>;
              return (
                <span className="text-[9px] text-admin-muted-2" title={`${[...ch].join(', ')}`}>
                  {ch.has('naver_blog') ? '블' : '·'}{ch.has('instagram_card') ? '카' : '·'}{ch.has('google_search') ? '광' : '·'}
                </span>
              );
            })()}
          </div>
          <div role="group" aria-label={`${pkg.title} 운영 처리 작업`} className="flex flex-wrap items-center gap-1">
            <span className="mr-0.5 text-[10px] font-bold text-admin-muted-2">운영</span>
            {/* 플랫폼별 마케팅 복사 드롭다운 */}
            <div className="relative">
            <button
              type="button"
              data-testid="admin-package-copy-action"
              aria-haspopup="menu"
              aria-expanded={copyDropdownId === pkg.id}
              aria-controls={`admin-package-copy-menu-${pkg.id}`}
              onClick={e => {
                e.stopPropagation();
                openCopyMenuFromTrigger(e.currentTarget, 'copy_menu_opened');
              }}
              className="px-2 py-1 border border-admin-border-strong text-admin-text-2 rounded text-[11px] hover:bg-admin-bg whitespace-nowrap"
              title="플랫폼별 AI 프롬프트 복사"
              aria-label={`${pkg.title} 플랫폼별 복사 메뉴 열기`}
            >복사</button>
            {copyDropdownId === pkg.id && (
              <div
                id={`admin-package-copy-menu-${pkg.id}`}
                role="menu"
                data-testid="admin-package-copy-menu"
                aria-describedby={copyMenuDescriptionId}
                className="absolute right-0 top-full mt-1 bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs z-50 py-1 min-w-[180px]"
              >
                <div
                  id={copyMenuDescriptionId}
                  role="none"
                  data-testid="admin-package-copy-menu-decision-summary"
                  className="mx-2 mb-1 rounded-admin-sm border border-admin-border bg-admin-bg px-2 py-1.5 text-[10px] font-semibold leading-snug text-admin-muted"
                >
                  <span className="font-black text-admin-text-2">복사 기준</span>
                  <span className="ml-1">{copyMenuDecisionText}</span>
                </div>
                {PLATFORMS.map((p, index) => (
                  <button key={p.key} type="button"
                    ref={index === 0 ? firstCopyMenuItemRef : undefined}
                    role="menuitem"
                    data-testid="admin-package-copy-menu-item"
                    className="w-full text-left px-3 py-2 text-[11px] text-admin-text-2 hover:bg-admin-bg flex items-center gap-2"
                    onClick={async e => {
                      e.stopPropagation();
                      onSetCopyDropdownId(null);
                      try {
                        const res = await fetch(`/api/packages?id=${pkg.id}`);
                        const json = await res.json();
                        const fullPkg = json.package;
                        const content = generateProductText(fullPkg);
                        await navigator.clipboard.writeText(content);
                        onShowToast('success', `${p.label} 텍스트 복사됨!`);
                      } catch (err) {
                        console.error('복사 실패:', err);
                        onShowToast('error', `복사 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
                      }
                    }}>
                    <span className="w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center bg-slate-700 text-white">{p.icon}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* 기록 남기기 버튼 */}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onSetLogModalTarget({ packageId: pkg.id, productId: pkg.products?.internal_code ?? pkg.internal_code }); }}
            className="px-2 py-1 border border-admin-border-strong text-admin-text-2 rounded text-[11px] hover:bg-admin-bg whitespace-nowrap"
            title="마케팅 발행 URL 기록"
            aria-label={`${pkg.title} 마케팅 발행 기록 남기기`}
          >기록</button>
          {/* 일정표 듀얼뷰 바로가기 */}
          <a
            href={`/itinerary/${pkg.id}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="px-2 py-1 border border-admin-border-strong text-admin-text-2 rounded text-[11px] hover:bg-admin-bg"
            title="일정표 보기"
          >일정</a>
          {/* 수정 버튼 (항상 표시) */}
          <button
            type="button"
            onClick={e => onOpenSingleEdit(pkg, e)}
            className="px-2 py-1 border border-admin-border-strong text-admin-text-2 rounded text-[11px] hover:bg-admin-bg"
            aria-label={`${pkg.title} 수정`}
          >수정</button>
          {expired && (
            <button
              type="button"
              onClick={() => onHandleAction(pkg.id, 'extend')}
              disabled={!!actionLoading}
              className="px-2 py-1 bg-blue-600 text-white rounded text-[11px] hover:bg-blue-700 disabled:opacity-50"
              aria-label={`${pkg.title} 판매 연장`}
            >연장</button>
          )}
          {pkg.status === 'pending_review' && !expired && (
            <button
              type="button"
              onClick={() => {
                trackEngagement({
                  event_type: ANALYTICS_EVENTS.adminActionCompleted,
                  page_url: '/admin/packages',
                  metadata: {
                    surface: 'packages_row_action',
                    action: 'review_opened',
                    ...buildPackageActionDecisionMetadata(pkg, { action: 'review_opened', source: 'row_button' }),
                  },
                });
                onSetApprovalTarget(pkg);
              }}
              className="px-2 py-1 bg-amber-500 text-white rounded text-[11px] hover:bg-amber-600"
              aria-label={`${pkg.title} 검수 시작`}
            >검수</button>
          )}
          {pkg.status === 'pending' && !expired && (
            <>
              <button
                type="button"
                onClick={() => onHandleAction(pkg.id, 'approve')}
                disabled={!!actionLoading}
                className="px-2 py-1 bg-green-600 text-white rounded text-[11px] hover:bg-green-700 disabled:opacity-50"
                aria-label={`${pkg.title} 승인`}
              >승인</button>
              <button
                type="button"
                onClick={() => onHandleAction(pkg.id, 'reject')}
                disabled={!!actionLoading}
                className="px-2 py-1 bg-red-500 text-white rounded text-[11px] hover:bg-red-600 disabled:opacity-50"
                aria-label={`${pkg.title} 거부`}
              >거부</button>
            </>
          )}
          {pkg.status === 'approved' && !expired && (
            <button
              type="button"
              onClick={() => onHandleAction(pkg.id, 'reject')}
              disabled={!!actionLoading}
              className="px-2 py-1 border border-admin-border-strong text-admin-muted rounded text-[11px] hover:bg-admin-bg disabled:opacity-50"
              aria-label={`${pkg.title} 비활성화`}
            >비활성화</button>
          )}
          {/* N5 박제 (2026-05-16 Lemax 표준 — 35% 수익↑): Template 재사용 1-click 복제 */}
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              const suffix = prompt('새 패키지 제목 접미사 (예: 4박6일 변형)', '(복제)');
              if (suffix === null) return;
              try {
                const res = await fetch(`/api/admin/packages/${pkg.id}/clone`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ titleSuffix: suffix }),
                });
                const data = await res.json();
                if (!res.ok) { alert(data.error || '복제 실패'); return; }
                if (confirm(`복제 완료: "${data.title}". 검수 페이지로 이동할까요?`)) {
                  window.open(data.edit_url, '_blank');
                }
              } catch (err) { alert(err instanceof Error ? err.message : '복제 실패'); }
            }}
            className="px-2 py-1 bg-purple-100 text-purple-700 border border-purple-300 rounded text-[11px] hover:bg-purple-200 font-medium"
            title="Lemax 표준 — 패키지 복제 (3x 빠른 등록)"
            aria-label={`${pkg.title} 패키지 복제`}
          >복제</button>
          </div>
        </div>
      </td>
    </tr>
  );
});

export default function PackagesPage({ initialPackages }: { initialPackages?: Package[] } = {}) {
  const [packages, setPackages] = useState<Package[]>(initialPackages ?? []);
  const [loading, setLoading] = useState(!initialPackages?.length);
  const _skipInitialLoad = useRef(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(initialPackages?.length ?? 0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('created_desc');
  const [activePackageQueue, setActivePackageQueue] = useState<'review' | 'copy' | 'publish' | 'deadline' | null>(null);
  const [showExpired, setShowExpired] = useState(false);
  const [selected, setSelected] = useState<Package | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkStatusMessage, setBulkStatusMessage] = useState('');
  const [imgGenerating, setImgGenerating] = useState(false);
  const [reextracting, setReextracting] = useState(false);
  const [sectionBackfilling, setSectionBackfilling] = useState(false);
  const [packageAlerts, setPackageAlerts] = useState<Array<{
    id: number; title: string; message: string | null; severity: string; category: string; created_at: string;
  }>>([]);

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
  const [kakaoCopyTarget, setKakaoCopyTarget] = useState<Package | null>(null);
  const [kakaoCopyText, setKakaoCopyText] = useState('');
  const [kakaoCopyLoading, setKakaoCopyLoading] = useState(false);
  const kakaoCopyModalRef = useRef<HTMLDivElement | null>(null);
  const kakaoCopyCloseRef = useRef<HTMLButtonElement | null>(null);
  const kakaoCopyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const kakaoCopyGenerateRef = useRef<HTMLButtonElement | null>(null);
  const [brainOpen, setBrainOpen] = useState(false);
  const [metaLiveOpen, setMetaLiveOpen] = useState(false);

  // 콘텐츠 현황 맵 (상품ID → 발행된 채널 Set)
  const [contentStatusMap, setContentStatusMap] = useState<Map<string, Set<string>>>(new Map());

  // 콘텐츠 현황 로드 — 감사(2026-05-11): limit 500 → 100 + SWR dedup 30s.
  const { data: contentHubData } = useSWR<{ creatives: { product_id: string; channel: string }[] }>(
    packages.length ? `/api/content-hub?status=published&limit=100` : null,
  );
  useEffect(() => {
    if (!contentHubData || !packages.length) return;
    const ids = new Set(packages.slice(0, 50).map((p: Package) => p.id));
    const m = new Map<string, Set<string>>();
    (contentHubData.creatives || []).forEach((c) => {
      if (!ids.has(c.product_id)) return;
      if (!m.has(c.product_id)) m.set(c.product_id, new Set());
      m.get(c.product_id)!.add(c.channel);
    });
    setContentStatusMap(m);
  }, [contentHubData, packages]);

  // handleBulkContentGen은 showToast 선언 뒤에 정의 (아래 참조)

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

  useEffect(() => {
    if (!copyDropdownId) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCopyDropdownId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copyDropdownId]);

  // Shift+Click 연속 선택
  const lastCheckedIndexRef = useRef<number>(-1);

  // Bulk Edit 모달
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkLandOperator, setBulkLandOperator] = useState('');
  const [bulkCommission, setBulkCommission] = useState('');
  const bulkEditPanelRef = useRef<HTMLDivElement | null>(null);
  const bulkEditCloseRef = useRef<HTMLButtonElement | null>(null);
  const bulkLandOperatorRef = useRef<HTMLSelectElement | null>(null);

  // ApprovalModal
  const [approvalTarget, setApprovalTarget] = useState<Package | null>(null);

  // Toast
  const { toast: _t } = useToast();
  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    _t(message, type);
  }, [_t]);

  const trackPackageActionCompleted = useCallback((
    action: string,
    pkg: Pick<Package, 'id' | 'title' | 'status' | 'destination'> & Partial<Package>,
    metadata: Record<string, unknown> = {},
  ) => {
    const decisionMetadata = 'created_at' in pkg
      ? buildPackageActionDecisionMetadata(pkg as Package, { action, source: 'admin_packages' })
      : { packageId: pkg.id };

    trackEngagement({
      event_type: ANALYTICS_EVENTS.adminActionCompleted,
      page_url: '/admin/packages',
      product_id: pkg.id,
      product_name: pkg.title,
      metadata: {
        surface: 'admin_packages',
        action: action,
        status: pkg.status,
        destination: pkg.destination ?? null,
        ...decisionMetadata,
        ...metadata,
      },
    });
  }, []);

  // 전체 콘텐츠 일괄 생성 (블로그 + 카드뉴스 + 광고카피)
  const handleBulkContentGen = useCallback(async (pkg: Package) => {
    showToast('success', `${pkg.title} 전 채널 콘텐츠 생성 시작...`);
    const channels = ['naver_blog', 'instagram_card', 'google_search'] as const;
    for (const channel of channels) {
      try {
        await fetch('/api/content-hub/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: pkg.id, angle: 'value', channel }),
        });
      } catch { /* 부분 실패 허용 */ }
      await new Promise(r => setTimeout(r, 300));
    }
    showToast('success', '블로그+카드뉴스+광고카피 생성 완료 → 검수 큐 확인');
    trackPackageActionCompleted('content_bulk_generated', pkg, { channels });
    setContentStatusMap(prev => {
      const next = new Map(prev);
      next.set(pkg.id, new Set(['naver_blog', 'instagram_card', 'google_search']));
      return next;
    });
  }, [showToast, trackPackageActionCompleted]);

  // 랜드사 전역 캐시 훅 (중복 fetch 방지)
  const { vendors: activeVendors, all: allVendors } = useVendors();
  // 인라인 에디트 중인 패키지 ID
  const [inlineEditPkgId, setInlineEditPkgId] = useState<string | null>(null);

  // Single Edit 모달
  const [editPkg, setEditPkg] = useState<Package | null>(null);
  const editPanelRef = useRef<HTMLDivElement | null>(null);
  const editCloseRef = useRef<HTMLButtonElement | null>(null);
  const editTitleInputRef = useRef<HTMLInputElement | null>(null);
  const [editForm, setEditForm] = useState<{
    title: string;
    destination: string;
    commission_rate: string;
    ticketing_deadline: string;
    land_operator_id: string;
  }>({ title: '', destination: '', commission_rate: '', ticketing_deadline: '', land_operator_id: '' });
  const [editSaving, setEditSaving] = useState(false);
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  const detailCloseRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const activePanel =
      bulkEditOpen ? bulkEditPanelRef.current :
        editPkg ? editPanelRef.current :
          selected ? detailPanelRef.current : null;
    if (!activePanel) return;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTarget =
      bulkEditOpen ? (bulkLandOperatorRef.current ?? bulkEditCloseRef.current) :
        editPkg ? (editTitleInputRef.current ?? editCloseRef.current) :
          detailCloseRef.current;
    const focusTimer = window.setTimeout(() => focusTarget?.focus(), 0);
    const getFocusableElements = () => Array.from(
      activePanel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(element => !element.getAttribute('aria-hidden'));
    const closeActivePanel = () => {
      if (bulkEditOpen) {
        if (!bulkLoading) setBulkEditOpen(false);
        return;
      }
      if (editPkg) {
        if (!editSaving) setEditPkg(null);
        return;
      }
      if (selected) setSelected(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeActivePanel();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (focusableElements.length === 1) {
        event.preventDefault();
        firstElement.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
      if (previousActiveElement && document.contains(previousActiveElement)) previousActiveElement.focus();
    };
  }, [bulkEditOpen, bulkLoading, editPkg, editSaving, selected]);

  useEffect(() => {
    if (!kakaoCopyTarget || !kakaoCopyModalRef.current) return;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTarget = kakaoCopyText
      ? (kakaoCopyTextareaRef.current ?? kakaoCopyCloseRef.current)
      : (kakaoCopyGenerateRef.current ?? kakaoCopyCloseRef.current);
    const focusTimer = window.setTimeout(() => focusTarget?.focus(), 0);
    const getFocusableElements = () => Array.from(
      kakaoCopyModalRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(element => !element.getAttribute('aria-hidden'));
    const closeModal = () => {
      if (kakaoCopyLoading) return;
      setKakaoCopyTarget(null);
      setKakaoCopyText('');
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (focusableElements.length === 1) {
        event.preventDefault();
        firstElement.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
      if (previousActiveElement && document.contains(previousActiveElement)) previousActiveElement.focus();
    };
  }, [kakaoCopyLoading, kakaoCopyTarget, kakaoCopyText]);

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
      const originalPkg = packages.find(p => p.id === id);
      trackPackageActionCompleted(
        'approval_approved',
        originalPkg ? { ...originalPkg, title, status: 'active', product_summary: summary } : { id, title, status: 'active', destination: undefined },
        { selectedCopyType: copyType },
      );
    } catch (err) {
      // 3. 실패 시 롤백
      setPackages(prevPackages);
      showToast('error', `배포 실패: ${err instanceof Error ? err.message : '다시 시도해주세요.'}`);
    }
  }, [packages, showToast, trackPackageActionCompleted]);

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
      const pkg = packages.find(p => p.id === id);
      trackPackageActionCompleted(
        'approval_rejected',
        pkg ? { ...pkg, status: 'draft' } : { id, title: id, status: 'draft', destination: undefined },
      );
    } catch (err) {
      setPackages(prevPackages);
      showToast('error', `반려 실패: ${err instanceof Error ? err.message : '다시 시도해주세요.'}`);
    }
  }, [packages, showToast, trackPackageActionCompleted]);

  const handleRegenerateCopies = useCallback(async (id: string): Promise<MarketingCopy[]> => {
    const res = await fetch(`/api/packages/${id}/regenerate-copies`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).error ?? '재생성 실패');
    const { marketing_copies } = await res.json();
    // 로컬 상태에도 반영
    setPackages(prev => prev.map(p => p.id === id ? { ...p, marketing_copies } : p));
    setApprovalTarget(prev => prev?.id === id ? { ...prev, marketing_copies } : prev);
    const pkg = packages.find(p => p.id === id);
    trackPackageActionCompleted('marketing_copies_regenerated', pkg ?? { id, title: id, status: 'unknown', destination: undefined }, {
      copyCount: Array.isArray(marketing_copies) ? marketing_copies.length : 0,
    });
    return marketing_copies as MarketingCopy[];
  }, [packages, trackPackageActionCompleted]);

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
      trackPackageActionCompleted('itinerary_image_generated', pkg, {
        mode,
        imageCount: Array.isArray(data.jpgs) ? data.jpgs.length : 0,
      });
    } catch (err) {
      alert('이미지 생성 실패: ' + (err instanceof Error ? err.message : '오류'));
    } finally {
      setImgGenerating(false);
    }
  };

  // 감사(2026-05-11): limit 500 → 100 (페이지네이션 의미 회복) + SWR (filter dedup + keepPreviousData).
  // load() 는 SWR mutate wrapper — mutation 후 호출되어 강제 재fetch.
  const listKey = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', '100');
    params.set('lite', '1');
    params.set('status', statusFilter || 'all');
    params.set('page', String(currentPage));
    params.set('sort', sortBy);
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    if (landOperatorFilter) params.set('land_operator', landOperatorFilter);
    return `/api/packages?${params.toString()}`;
  }, [statusFilter, searchQuery, landOperatorFilter, currentPage, sortBy]);

  const {
    data: listData,
    isLoading: swrLoading,
    mutate: mutateList,
  } = useSWR<{ data: Package[]; count: number; totalPages: number }>(
    // initialPackages 가 있으면 첫 마운트에서는 SWR fetch 안 함 (RSC 데이터로 대체).
    _skipInitialLoad.current ? null : listKey,
    { fallbackData: initialPackages?.length ? undefined : undefined },
  );

  useEffect(() => {
    if (!listData) return;
    const nextTotalPages = Math.max(1, listData.totalPages || 1);
    if (currentPage > nextTotalPages) {
      setCurrentPage(nextTotalPages);
      return;
    }
    setPackages(listData.data || []);
    setTotalPages(nextTotalPages);
    setTotalCount(listData.count || 0);
    setLoading(false);
  }, [listData, currentPage]);

  // 외부 호출용 (mutation 후 강제 재fetch).
  const load = useCallback(() => {
    if (_skipInitialLoad.current) { _skipInitialLoad.current = false; return; }
    mutateList();
  }, [mutateList]);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, searchQuery, landOperatorFilter]);

  // SWR 로딩과 첫 진입(initialPackages 없음) 시에만 loading=true.
  useEffect(() => {
    setLoading(swrLoading && !initialPackages?.length);
  }, [swrLoading, initialPackages?.length]);

  const openSelectedDetail = useCallback(async (pkg: Package) => {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.adminActionCompleted,
      page_url: '/admin/packages',
      metadata: {
        surface: 'packages_detail_drawer',
        action: 'detail_opened',
        ...buildPackageActionDecisionMetadata(pkg, { action: 'detail_opened', source: 'detail_drawer' }),
      },
    });
    // lite 응답에는 itinerary_data가 없을 수 있으므로 상세 조회 후 열기
    // 단, 일정표가 없는 상품(has_itinerary_data=false)은 가벼운 row 정보로 바로 열기
    if (pkg.itinerary_data === undefined && pkg.has_itinerary_data !== false) {
      try {
        const res = await fetch(`/api/packages?id=${pkg.id}`);
        const json = await res.json();
        if (res.ok && json.package) {
          const fullPkg = json.package as Package;
          setSelected(fullPkg);
          setPackages(prev => prev.map(p => p.id === fullPkg.id ? { ...p, ...fullPkg } : p));
          return;
        }
      } catch {
        // fallback 아래 setSelected(pkg)
      }
    }
    setSelected(pkg);
  }, []);

  useEffect(() => {
    if (!selected?.id) { setPackageAlerts([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/alerts?refId=${selected.id}&category=register-backfill&showAcked=true`);
        const json = await res.json();
        if (!cancelled && res.ok) setPackageAlerts(json.alerts ?? []);
      } catch {
        if (!cancelled) setPackageAlerts([]);
      }
    })();
    return () => { cancelled = true; };
  }, [selected?.id]);

  const handleSectionBackfill = useCallback(async (force: boolean) => {
    if (!selected) return;
    setSectionBackfilling(true);
    try {
      const res = await fetch(`/api/admin/packages/${selected.id}/backfill-sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.reason || data.error || `HTTP ${res.status}`);
      showToast('success', `Section 재추출 완료 (${force ? '강제' : '일반'})`);
      load();
      const refreshed = await fetch(`/api/packages?id=${selected.id}`).then(r => r.json());
      if (refreshed.package) setSelected(refreshed.package as Package);
      const alertRes = await fetch(`/api/admin/alerts?refId=${selected.id}&category=register-backfill&showAcked=true`);
      const alertJson = await alertRes.json();
      if (alertRes.ok) setPackageAlerts(alertJson.alerts ?? []);
    } catch (err) {
      showToast('error', 'Section 재추출 실패: ' + (err instanceof Error ? err.message : '오류'));
    } finally {
      setSectionBackfilling(false);
    }
  }, [selected, load, showToast]);

  // 감사(2026-05-11): debounce useEffect 제거 — SWR key 의존성이 자동 fetch.
  // SWR dedup 30s 가 빠른 키 변경(타이핑 등) 자체를 흡수.

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleAction = async (packageId: string, action: 'approve' | 'reject' | 'delete' | 'extend') => {
    const actionLabel = action === 'approve' ? '승인' : action === 'reject' ? '비활성/거부' : action === 'delete' ? '삭제' : '판매 연장';
    const targetPackage = packages.find(pkg => pkg.id === packageId);
    const packageTitle = targetPackage?.title ?? '선택한 상품';
    setActionLoading(packageId + action);
    setBulkStatusMessage(`${packageTitle} ${actionLabel} 처리 중입니다.`);
    try {
      let res: Response;
      if (action === 'delete') {
        res = await fetch(`/api/packages?id=${packageId}`, { method: 'DELETE' });
        setSelected(null);
      } else if (action === 'extend') {
        res = await fetch('/api/packages', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageId, ticketing_deadline: getExtendedDeadline() }),
        });
      } else {
        res = await fetch('/api/packages', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageId, action }),
        });
      }
      if (res.ok) {
        trackEngagement({
          event_type: ANALYTICS_EVENTS.adminActionCompleted,
          page_url: '/admin/packages',
          metadata: {
            surface: 'packages_row_action',
            action: action,
            ...(targetPackage
              ? buildPackageActionDecisionMetadata(targetPackage, { action, source: 'row_or_detail_action' })
              : { packageId }),
          },
        });
        setBulkStatusMessage(`${packageTitle} ${actionLabel}을 완료했습니다.`);
      } else {
        setBulkStatusMessage(`${packageTitle} ${actionLabel}에 실패했습니다.`);
      }
      if (action !== 'extend') setSelected(null);
      load();
    } catch (e) {
      console.error(e);
      setBulkStatusMessage(`${packageTitle} ${actionLabel}에 실패했습니다.`);
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = useMemo(() => {
    let list = [...packages];

    // 아카이브 탭이 아니면 아카이브/만료 상품 숨김
    if (statusFilter !== 'archived') {
      list = list.filter(p => p.status !== 'archived' && p.status !== 'INACTIVE');
      if (!showExpired) {
        list = list.filter(p => !isExpired(p));
      }
    }

    if (statusFilter === 'archived') {
      list = list.filter(p => p.status === 'archived' || p.status === 'INACTIVE');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p =>
        p.title.toLowerCase().includes(q) ||
        (p.destination || '').toLowerCase().includes(q) ||
        (p.land_operator || '').toLowerCase().includes(q) ||
        (p.internal_code || '').toLowerCase().includes(q) ||
        (p.short_code || '').toLowerCase().includes(q) ||
        (p.attraction_preview_names || []).some(name => name.toLowerCase().includes(q))
      );
    }

    // 서버 정렬이 기본. 가격 정렬만 로컬 보조(최저가 계산 필요)
    if (sortBy === 'price_asc' || sortBy === 'price_desc') {
      list.sort((a, b) => {
        const aMin = Math.min(...(a.price_tiers?.map(t => t.adult_price ?? Infinity) || [a.price ?? Infinity]));
        const bMin = Math.min(...(b.price_tiers?.map(t => t.adult_price ?? Infinity) || [b.price ?? Infinity]));
        return sortBy === 'price_asc' ? aMin - bMin : bMin - aMin;
      });
    }

    return list;
  }, [packages, statusFilter, searchQuery, sortBy, showExpired]);

  // Shift+Click 지원 체크박스 토글
  const selectedPackagesForBulk = useMemo(
    () => filtered.filter(pkg => checkedIds.has(pkg.id)),
    [checkedIds, filtered],
  );
  const bulkApprovableCount = selectedPackagesForBulk.filter(pkg => pkg.status === 'pending' || pkg.status === 'rejected').length;
  const bulkArchivableCount = selectedPackagesForBulk.filter(pkg => pkg.status !== 'archived' && pkg.status !== 'INACTIVE').length;
  const bulkRestorableCount = selectedPackagesForBulk.filter(pkg => pkg.status === 'archived' || pkg.status === 'INACTIVE').length;
  const bulkActionSummaryId = 'admin-package-bulk-action-summary';
  const bulkNextActionText = bulkRestorableCount > 0
    ? `복원 대상 ${bulkRestorableCount}건을 먼저 확인하세요.`
    : bulkApprovableCount > 0
      ? `승인 가능 ${bulkApprovableCount}건은 일괄 승인 전 검수 상태를 확인하세요.`
      : bulkArchivableCount > 0
        ? `운영 종료 상품은 아카이브로 정리할 수 있습니다.`
        : '랜드사와 커미션만 일괄 수정할 수 있습니다.';
  const bulkActionSummaryText = `선택 ${checkedIds.size}건. 승인 가능 ${bulkApprovableCount}건, 아카이브 가능 ${bulkArchivableCount}건, 복원 가능 ${bulkRestorableCount}건. ${bulkNextActionText} 랜드사와 커미션은 선택 상품에 일괄 적용됩니다.`;
  const bulkActionDescriptionIds = `${bulkActionSummaryId} admin-package-bulk-status`;

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

  const sortDirection = (field: string): 'ascending' | 'descending' | 'none' => {
    if (sortBy === `${field}_asc`) return 'ascending';
    if (sortBy === `${field}_desc`) return 'descending';
    return 'none';
  };

  const sortButtonLabel = (field: string, label: string) => {
    const direction = sortDirection(field);
    if (direction === 'ascending') return `${label} 오름차순 정렬됨, 내림차순으로 변경`;
    if (direction === 'descending') return `${label} 내림차순 정렬됨, 오름차순으로 변경`;
    return `${label} 오름차순 정렬`;
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

  const handleBulk = async (action: 'bulk_approve' | 'bulk_archive' | 'bulk_restore') => {
    if (checkedIds.size === 0) return;
    if (action === 'bulk_archive' && !confirm(`${checkedIds.size}개 상품을 아카이브하시겠습니까?`)) return;
    const count = checkedIds.size;
    const selectedPackages = packages.filter(pkg => checkedIds.has(pkg.id));
    const actionLabel = action === 'bulk_approve' ? '승인' : action === 'bulk_archive' ? '아카이브' : '복원';
    setBulkStatusMessage(`${count}개 상품 ${actionLabel} 처리 중입니다.`);
    setBulkLoading(true);
    try {
      const res = await fetch('/api/packages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, packageIds: Array.from(checkedIds) }),
      });
      if (res.ok) {
        trackEngagement({
          event_type: ANALYTICS_EVENTS.adminActionCompleted,
          page_url: '/admin/packages',
          metadata: {
            surface: 'packages_bulk_action',
            action: action,
            count: checkedIds.size,
            ...buildBulkPackageActionDecisionMetadata(selectedPackages, action),
          },
        });
      }
      setBulkStatusMessage(res.ok ? `${count}개 상품 ${actionLabel}을 완료했습니다.` : `${count}개 상품 ${actionLabel}에 실패했습니다.`);
      setCheckedIds(new Set());
      load();
    } catch (e) {
      console.error(e);
      setBulkStatusMessage(`${count}개 상품 ${actionLabel}에 실패했습니다.`);
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
    const count = checkedIds.size;
    const selectedPackages = packages.filter(pkg => checkedIds.has(pkg.id));
    setBulkStatusMessage(`${count}개 상품 일괄 수정 처리 중입니다.`);
    setBulkLoading(true);
    try {
      const res = await fetch('/api/packages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_update', packageIds: Array.from(checkedIds), fields }),
      });
      if (res.ok) {
      trackEngagement({
        event_type: ANALYTICS_EVENTS.adminActionCompleted,
        page_url: '/admin/packages',
        metadata: {
          surface: 'packages_bulk_edit',
          action: 'bulk_update',
          count: checkedIds.size,
          fields: Object.keys(fields),
          ...buildBulkPackageActionDecisionMetadata(selectedPackages, 'bulk_update'),
        },
      });
      }
      setBulkStatusMessage(res.ok ? `${count}개 상품 일괄 수정을 완료했습니다.` : `${count}개 상품 일괄 수정에 실패했습니다.`);
      setBulkEditOpen(false);
      setBulkLandOperator('');
      setBulkCommission('');
      setCheckedIds(new Set());
      load();
    } catch (e) {
      console.error(e);
      setBulkStatusMessage(`${count}개 상품 일괄 수정에 실패했습니다.`);
    } finally {
      setBulkLoading(false);
    }
  };

  const openSingleEdit = (pkg: Package, e: React.MouseEvent) => {
    e.stopPropagation();
    trackEngagement({
      event_type: ANALYTICS_EVENTS.adminActionCompleted,
      page_url: '/admin/packages',
      metadata: {
        surface: 'packages_row_action',
        action: 'edit_opened',
        ...buildPackageActionDecisionMetadata(pkg, { action: 'edit_opened', source: 'row_primary_action' }),
      },
    });
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
      trackEngagement({
        event_type: ANALYTICS_EVENTS.adminActionCompleted,
        page_url: '/admin/packages',
        metadata: {
          surface: 'packages_single_edit',
          action: 'update',
          fields: Object.keys(updateData),
          ...buildPackageActionDecisionMetadata(editPkg, { action: 'update', source: 'single_edit_modal' }),
        },
      });
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
  const readyCount = packages.filter(p => p.status === 'approved' && !isExpired(p)).length;
  const gapCount = packages.filter(p => {
    const days = (p as { itinerary_data?: { days?: unknown[] } }).itinerary_data?.days;
    const hasPrice = Boolean(p.price) || Boolean(p.price_tiers?.length);
    return !p.airline || !Array.isArray(days) || days.length === 0 || !hasPrice;
  }).length;
  const handleQueueSelect = (queue: 'review' | 'copy' | 'publish' | 'deadline' | 'gaps') => {
    const queueCounts = {
      review: pendingCount,
      copy: reviewCount + gapCount,
      publish: readyCount,
      deadline: deadlineCount,
      gaps: gapCount,
    };
    const queueDecisionContext = {
      review: { operationRisk: '고객 노출 전 검수', reason: '신규 상품은 고객 노출 전 핵심 정보 확인이 먼저입니다.' },
      copy: { operationRisk: '상세 전환 저하', reason: '누락 필드와 카피 품질이 상세 전환에 직접 영향을 줍니다.' },
      publish: { operationRisk: '채널 정리 누락', reason: '승인된 상품은 미리보기와 판매 채널 정리가 다음 단계입니다.' },
      deadline: { operationRisk: '마감 노출 오류', reason: '마감 임박 상품은 예약 가능 상태와 노출 중단 판단이 급합니다.' },
      gaps: { operationRisk: '상세 전환 저하', reason: '누락 필드와 카피 품질이 상세 전환에 직접 영향을 줍니다.' },
    };
    trackEngagement({
      event_type: ANALYTICS_EVENTS.adminActionCompleted,
      page_url: '/admin/packages',
      metadata: {
        surface: 'packages_action_queue',
        action: 'queue_opened',
        queue,
        count: queueCounts[queue],
        operation_risk: queueDecisionContext[queue].operationRisk,
        reason: queueDecisionContext[queue].reason,
        has_waiting_work: queueCounts[queue] > 0,
      },
    });
    setActivePackageQueue(queue === 'gaps' ? 'copy' : queue);
    setSearchQuery('');
    if (queue === 'review' || queue === 'copy') {
      setStatusFilter('pending');
      setSortBy('created_desc');
    } else if (queue === 'publish') {
      setStatusFilter('selling');
      setSortBy('created_desc');
    } else if (queue === 'deadline') {
      setStatusFilter('all');
      setSortBy('deadline_asc');
      setShowExpired(true);
    } else {
      setStatusFilter('all');
      setSortBy('created_desc');
    }
  };

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-admin-lg font-bold text-admin-text-2">상품 관리</h1>
          <p className="text-admin-sm text-admin-muted mt-0.5">업로드된 여행 상품 검토 및 승인</p>
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
            type="button"
            onClick={() => { window.location.href = '/admin/upload'; }}
            className="ml-2 px-4 py-1.5 bg-blue-600 text-white text-admin-sm font-medium rounded-lg hover:bg-blue-700 transition"
          >
            + 문서 업로드로 상품 등록
          </button>
        </div>
      </div>

      {/* 검색 + 정렬 */}
      <PackageOpsQueue
        activeQueue={activePackageQueue}
        pendingCount={pendingCount}
        reviewCount={reviewCount}
        readyCount={readyCount}
        deadlineCount={deadlineCount}
        gapCount={gapCount}
        onQueueSelect={handleQueueSelect}
      />

      <div className="flex flex-col gap-2 mb-3 md:flex-row">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          aria-label="상품 검색"
          placeholder="상품명, 목적지, 랜드사 검색..."
          className="flex-1 px-3 py-2 border-2 border-admin-border rounded-lg text-admin-sm text-admin-text focus:outline-none focus:border-admin-accent focus:ring-2 focus:ring-blue-200 bg-admin-surface transition-colors"
        />
        <select
          value={landOperatorFilter}
          onChange={e => setLandOperatorFilter(e.target.value)}
          aria-label="랜드사 필터"
          className="px-3 py-2 border border-admin-border-mid rounded-lg text-admin-sm focus:outline-none bg-white text-admin-muted min-w-[110px]"
        >
          <option value="">전체 랜드사</option>
          {LAND_OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
        </select>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          aria-label="상품 정렬"
          className="px-3 py-2 border border-admin-border-mid rounded-lg text-admin-sm focus:outline-none bg-white text-admin-muted"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={showExpired}
          onClick={() => setShowExpired(v => !v)}
          className={`px-3 py-2 rounded-lg text-admin-sm font-medium border transition ${
            showExpired
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-admin-muted border-admin-border-mid hover:bg-admin-bg'
          }`}
        >
          {showExpired ? `만료 숨김` : `만료 포함 (${expiredCount})`}
        </button>
        <button
          type="button"
          onClick={() => setBrainOpen(true)}
          className="px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-admin-sm font-medium hover:bg-emerald-100 transition"
        >
          Ad-Brain
        </button>
        <button
          type="button"
          onClick={() => setMetaLiveOpen(true)}
          className="px-3 py-2 bg-blue-600 text-white border border-blue-600 rounded-lg text-admin-sm font-medium hover:bg-blue-700 transition"
        >
          Meta Live
        </button>
      </div>

      {/* 일괄 처리 액션 바 */}
      <p
        id="admin-package-bulk-status"
        data-testid="admin-package-bulk-status"
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {bulkStatusMessage}
      </p>
      {checkedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="min-w-[180px] flex-1">
            <span className="text-admin-sm font-medium text-blue-700">{checkedIds.size}개 선택됨</span>
            <p
              id={bulkActionSummaryId}
              data-testid="admin-package-bulk-action-summary"
              className="mt-0.5 text-[11px] font-semibold text-blue-700/80"
            >
              {bulkActionSummaryText}
            </p>
            <p
              data-testid="admin-package-bulk-next-action"
              className="mt-1 text-[11px] font-black text-blue-800"
            >
              {bulkNextActionText}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setBulkLandOperator(''); setBulkCommission(''); setBulkEditOpen(true); }}
            disabled={bulkLoading}
            aria-busy={bulkLoading}
            aria-describedby={bulkActionDescriptionIds}
            className="px-2.5 py-1 bg-blue-600 text-white rounded-lg text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
          >일괄 수정</button>
          <button
            type="button"
            onClick={() => handleBulk('bulk_approve')}
            disabled={bulkLoading}
            aria-busy={bulkLoading}
            aria-describedby={bulkActionDescriptionIds}
            className="px-2.5 py-1 bg-green-600 text-white rounded-lg text-[11px] font-medium hover:bg-green-700 disabled:opacity-50"
          >일괄 승인</button>
          <button
            type="button"
            onClick={() => handleBulk('bulk_archive')}
            disabled={bulkLoading}
            aria-busy={bulkLoading}
            aria-describedby={bulkActionDescriptionIds}
            className="px-2.5 py-1 bg-slate-500 text-white rounded-lg text-[11px] font-medium hover:bg-slate-600 disabled:opacity-50"
          >아카이브</button>
          {statusFilter === 'archived' && (
            <button
              type="button"
              onClick={() => handleBulk('bulk_restore')}
              disabled={bulkLoading}
              aria-busy={bulkLoading}
              aria-describedby={bulkActionDescriptionIds}
              className="px-2.5 py-1 bg-blue-500 text-white rounded-lg text-[11px] font-medium hover:bg-blue-600 disabled:opacity-50"
            >복원</button>
          )}
          <button
            type="button"
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
            type="button"
            aria-pressed={statusFilter === opt.value}
            onClick={() => setStatusFilter(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-admin-sm font-medium transition ${
              statusFilter === opt.value
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-admin-border-strong text-admin-text-2 hover:bg-admin-bg'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between mb-2 text-admin-xs text-admin-muted">
        <span>총 {totalCount.toLocaleString()}건 · {currentPage}/{totalPages} 페이지</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1 || loading}
            aria-label="이전 페이지"
            className="px-2 py-1 rounded border border-admin-border-mid disabled:opacity-40"
          >이전</button>
          <button
            type="button"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages || loading}
            aria-label="다음 페이지"
            className="px-2 py-1 rounded border border-admin-border-mid disabled:opacity-40"
          >다음</button>
        </div>
      </div>

      {/* 목록 */}
      <div className="bg-white rounded-admin-md border border-admin-border-mid overflow-hidden">
        {loading ? (
          <div className="divide-y divide-slate-50">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="w-4 h-4 bg-admin-surface-2 rounded animate-pulse shrink-0" />
                <div className="w-8 h-8 bg-admin-surface-2 rounded-lg animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-admin-surface-2 rounded animate-pulse w-48" />
                  <div className="h-2.5 bg-admin-surface-2 rounded animate-pulse w-32" />
                </div>
                <div className="h-3 bg-admin-surface-2 rounded animate-pulse w-16" />
                <div className="h-5 bg-admin-surface-2 rounded-full animate-pulse w-14" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-14 flex flex-col items-center gap-3">
            <svg className="w-10 h-10 text-admin-border-mid" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
            <p className="text-admin-sm font-medium text-admin-muted">상품이 없습니다.</p>
            <p className="text-admin-xs text-admin-muted-2">{searchQuery ? '검색 조건을 바꿔보세요.' : '문서 업로드 후 AI가 자동으로 등록합니다.'}</p>
          </div>
        ) : (
          <>
          <div className="divide-y divide-admin-border-mid md:hidden">
            {filtered.map((pkg, idx) => {
              const prices = pkg.price_tiers?.map(t => t.adult_price).filter(Boolean) as number[] || [];
              const minPrice = prices.length > 0 ? Math.min(...prices) : pkg.price;
              const maxPrice = prices.length > 0 ? Math.max(...prices) : (pkg.price ?? 0);
              const dday = getDDayInfo(pkg);
              const expired = isExpired(pkg);
              const nextOperationLabel = getPackageNextOperationLabel(pkg, expired);
              const mobilePackageActionReason = getPackageNextOperationReason(pkg, expired);
              const mobilePackageStatusLabel = STATUS_LABEL[pkg.status] ?? pkg.status;
              const mobilePackagePriceLabel = getPackagePriceRangeLabel(minPrice, maxPrice);
              const mobilePackageOperationRiskLabel = expired
                ? '기간 만료'
                : !minPrice && !maxPrice
                  ? '가격 누락'
                  : pkg.status === 'pending_review'
                    ? '검수 대기'
                    : pkg.status === 'pending'
                      ? '승인 대기'
                      : pkg.status === 'approved'
                        ? '발행 가능'
                        : '상세 확인';
              const mobileCardSummaryId = `admin-package-mobile-card-summary-${pkg.id}`;
              const mobileDecisionSummaryId = `admin-package-mobile-decision-summary-${pkg.id}`;
              const mobileActionDescriptionId = `admin-package-mobile-actions-${pkg.id}`;
              const mobileCardDescriptionIds = `${mobileCardSummaryId} ${mobileDecisionSummaryId}`;
              const mobileActionStatusDescriptionId = `${mobileCardDescriptionIds} ${mobileActionDescriptionId} admin-package-bulk-status`;
              const region = pkg.products?.departure_region
                ?? (pkg.departure_airport ? pkg.departure_airport.replace(/\(.*\)/, '').trim() : undefined);
              const mobileCardSummaryText = [
                `${pkg.title} 상품`,
                `현재 상태는 ${mobilePackageStatusLabel}`,
                `가격은 ${mobilePackagePriceLabel}`,
                pkg.commission_rate != null ? `마진은 ${pkg.commission_rate}%` : null,
                region ? `출발 지역은 ${region}` : null,
                expired ? '판매 기간이 만료되었습니다' : dday ? `출발 또는 마감 상태는 ${dday.label}` : null,
                `운영 사유는 ${mobilePackageOperationRiskLabel}`,
                `다음 액션은 ${nextOperationLabel}`,
                `다음 액션 근거는 ${mobilePackageActionReason}`,
              ].filter(Boolean).join(', ');

              return (
                <article
                  key={`mobile-${pkg.id}`}
                  className={`p-4 ${expired ? 'opacity-65' : ''} ${checkedIds.has(pkg.id) ? 'bg-blue-50' : 'bg-white'}`}
                  aria-describedby={mobileCardDescriptionIds}
                >
                  <p id={mobileCardSummaryId} className="sr-only">
                    {mobileCardSummaryText}
                  </p>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checkedIds.has(pkg.id)}
                      onChange={() => {}}
                      onClick={e => {
                        e.stopPropagation();
                        toggleCheck(pkg.id, idx, e as React.MouseEvent);
                      }}
                      className="mt-1 rounded cursor-pointer"
                      aria-label={`${pkg.title} 선택`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${STATUS_BADGE[pkg.status] || 'bg-admin-surface-2 text-admin-muted'}`}>
                          {STATUS_LABEL[pkg.status] ?? pkg.status}
                        </span>
                        {dday && <span className={`px-2 py-0.5 rounded text-[11px] ${dday.className}`}>{dday.label}</span>}
                        {region && (
                          <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${regionBadgeClass(region)}`}>
                            {region}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-2 line-clamp-2 text-admin-sm font-bold leading-snug text-admin-text-2">
                        {pkg.title}
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-admin-muted-2">
                        <span>{pkg.destination || '목적지 미정'}</span>
                        {pkg.product_type && <span>{pkg.product_type}</span>}
                        {(pkg.products?.internal_code ?? pkg.internal_code ?? pkg.short_code) && (
                          <span className="font-mono">{pkg.products?.internal_code ?? pkg.internal_code ?? pkg.short_code}</span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-admin-sm font-black text-admin-text-2">
                        {mobilePackagePriceLabel}
                      </p>
                      {pkg.commission_rate != null && (
                        <p className={`mt-1 text-[11px] ${marginColor(pkg.commission_rate / 100)}`}>
                          {pkg.commission_rate}% 마진
                        </p>
                      )}
                    </div>
                  </div>

                  <div
                    id={mobileDecisionSummaryId}
                    data-testid="admin-package-mobile-decision-summary"
                    aria-label={`상품 결정 요약: 상태 ${mobilePackageStatusLabel}, 가격 ${mobilePackagePriceLabel}, 다음 액션 ${nextOperationLabel}`}
                    className="mt-3 grid grid-cols-3 gap-2 rounded-admin-sm border border-admin-border bg-white p-2"
                  >
                    <div className="rounded-admin-sm bg-admin-bg px-2 py-1.5">
                      <p className="text-[10px] font-bold text-admin-muted-2">상태</p>
                      <p className="mt-0.5 truncate text-[11px] font-black text-admin-text-2">{mobilePackageStatusLabel}</p>
                    </div>
                    <div className="rounded-admin-sm bg-admin-bg px-2 py-1.5">
                      <p className="text-[10px] font-bold text-admin-muted-2">가격</p>
                      <p className="mt-0.5 truncate text-[11px] font-black text-admin-text-2">{mobilePackagePriceLabel}</p>
                    </div>
                    <div className="rounded-admin-sm bg-admin-bg px-2 py-1.5">
                      <p className="text-[10px] font-bold text-admin-muted-2">다음</p>
                      <p className="mt-0.5 truncate text-[11px] font-black text-admin-text-2">{nextOperationLabel}</p>
                    </div>
                  </div>

                  <div
                    data-testid="admin-package-mobile-next-action-summary"
                    aria-label={`다음 액션 ${nextOperationLabel}. 운영 사유 ${mobilePackageOperationRiskLabel}. ${mobilePackageActionReason}`}
                    className="mt-3 rounded-admin-sm border border-admin-border bg-admin-bg px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-admin-muted">다음 액션</span>
                      <span className="text-[12px] font-black text-admin-text-2">{nextOperationLabel}</span>
                    </div>
                    <p
                      data-testid="admin-package-mobile-risk-summary"
                      className="mt-1 inline-flex rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-admin-text-2 ring-1 ring-black/5"
                    >
                      운영 사유: {mobilePackageOperationRiskLabel}
                    </p>
                    <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-admin-muted">
                      {mobilePackageActionReason}
                    </p>
                  </div>

                  <p id={mobileActionDescriptionId} className="sr-only">
                    {pkg.title}의 다음 액션은 {nextOperationLabel}입니다. 운영 사유는 {mobilePackageOperationRiskLabel}이고 근거는 {mobilePackageActionReason} 상태는 {STATUS_LABEL[pkg.status] ?? pkg.status}이며 모바일 버튼에서 검수, 수정, 발행 또는 더보기를 실행할 수 있습니다.
                  </p>

                  <div role="group" aria-label={`${pkg.title} 모바일 처리 작업`} aria-describedby={mobileActionStatusDescriptionId} className="mt-3 grid grid-cols-4 gap-2">
                    {expired ? (
                      <button
                        type="button"
                        data-testid="admin-package-mobile-extend-action"
                        aria-label={`${pkg.title} 상품 기간 연장`}
                        aria-describedby={mobileActionStatusDescriptionId}
                        aria-busy={actionLoading?.startsWith(pkg.id)}
                        onClick={e => { e.stopPropagation(); handleAction(pkg.id, 'extend'); }}
                        disabled={!!actionLoading}
                        className="rounded-admin-sm bg-blue-600 px-2 py-2 text-[11px] font-bold text-white disabled:opacity-50"
                      >
                        연장
                      </button>
                    ) : pkg.status === 'pending_review' ? (
                      <button
                        type="button"
                        data-testid="admin-package-mobile-review-action"
                        aria-label={`${pkg.title} 모바일 검수 열기`}
                        aria-describedby={mobileActionStatusDescriptionId}
                        onClick={e => {
                          e.stopPropagation();
                          trackEngagement({
                            event_type: ANALYTICS_EVENTS.adminActionCompleted,
                            page_url: '/admin/packages',
                            metadata: {
                              surface: 'packages_row_action',
                              action: 'review_opened',
                              ...buildPackageActionDecisionMetadata(pkg, { action: 'review_opened', source: 'mobile_card' }),
                            },
                          });
                          setApprovalTarget(pkg);
                        }}
                        className="rounded-admin-sm bg-amber-500 px-2 py-2 text-[11px] font-bold text-white"
                      >
                        검수
                      </button>
                    ) : pkg.status === 'pending' ? (
                      <button
                        type="button"
                        data-testid="admin-package-mobile-approve-action"
                        aria-label={`${pkg.title} 모바일 승인`}
                        aria-describedby={mobileActionStatusDescriptionId}
                        aria-busy={actionLoading?.startsWith(pkg.id)}
                        onClick={e => { e.stopPropagation(); handleAction(pkg.id, 'approve'); }}
                        disabled={!!actionLoading}
                        className="rounded-admin-sm bg-green-600 px-2 py-2 text-[11px] font-bold text-white disabled:opacity-50"
                      >
                        승인
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid="admin-package-mobile-publish-action"
                        aria-label={`${pkg.title} 모바일 발행 미리보기`}
                        aria-describedby={mobileActionStatusDescriptionId}
                        onClick={e => {
                          e.stopPropagation();
                          trackEngagement({
                            event_type: ANALYTICS_EVENTS.adminActionCompleted,
                            page_url: '/admin/packages',
                            metadata: {
                              surface: 'packages_row_action',
                              action: 'customer_preview_opened',
                              ...buildPackageActionDecisionMetadata(pkg, { action: 'customer_preview_opened', source: 'mobile_card' }),
                            },
                          });
                          window.open(`/packages/${pkg.id}`, '_blank');
                        }}
                        className="rounded-admin-sm bg-admin-text-2 px-2 py-2 text-[11px] font-bold text-white"
                      >
                        발행
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="admin-package-mobile-edit-action"
                      aria-label={`${pkg.title} 모바일 수정`}
                      aria-describedby={mobileActionStatusDescriptionId}
                      onClick={e => openSingleEdit(pkg, e)}
                      className="rounded-admin-sm border border-admin-border-strong px-2 py-2 text-[11px] font-bold text-admin-text-2"
                    >
                      수정
                    </button>
                    {pkg.status === 'pending' && !expired ? (
                      <button
                        type="button"
                        data-testid="admin-package-mobile-reject-action"
                        aria-label={`${pkg.title} 모바일 거부`}
                        aria-describedby={mobileActionStatusDescriptionId}
                        aria-busy={actionLoading?.startsWith(pkg.id)}
                        onClick={e => { e.stopPropagation(); handleAction(pkg.id, 'reject'); }}
                        disabled={!!actionLoading}
                        className="rounded-admin-sm border border-red-300 px-2 py-2 text-[11px] font-bold text-red-600 disabled:opacity-50"
                      >
                        거부
                      </button>
                    ) : pkg.status === 'approved' && !expired ? (
                      <button
                        type="button"
                        data-testid="admin-package-mobile-deactivate-action"
                        aria-label={`${pkg.title} 모바일 비활성`}
                        aria-describedby={mobileActionStatusDescriptionId}
                        aria-busy={actionLoading?.startsWith(pkg.id)}
                        onClick={e => { e.stopPropagation(); handleAction(pkg.id, 'reject'); }}
                        disabled={!!actionLoading}
                        className="rounded-admin-sm border border-admin-border-strong px-2 py-2 text-[11px] font-bold text-admin-muted disabled:opacity-50"
                      >
                        비활성
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid="admin-package-mobile-publish-action"
                        aria-label={`${pkg.title} 모바일 발행 미리보기`}
                        aria-describedby={mobileActionStatusDescriptionId}
                        onClick={e => {
                          e.stopPropagation();
                          trackEngagement({
                            event_type: ANALYTICS_EVENTS.adminActionCompleted,
                            page_url: '/admin/packages',
                            metadata: {
                              surface: 'packages_row_action',
                              action: 'customer_preview_opened',
                              ...buildPackageActionDecisionMetadata(pkg, { action: 'customer_preview_opened', source: 'mobile_card_secondary' }),
                            },
                          });
                          window.open(`/packages/${pkg.id}`, '_blank');
                        }}
                        className="rounded-admin-sm border border-orange-300 px-2 py-2 text-[11px] font-bold text-orange-600"
                      >
                        발행
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="admin-package-mobile-more-action"
                      onClick={e => { e.stopPropagation(); openSelectedDetail(pkg); }}
                      aria-label={`${pkg.title} 상세 더보기`}
                      aria-describedby={mobileActionStatusDescriptionId}
                      className="rounded-admin-sm border border-admin-border-strong px-2 py-2 text-[11px] font-bold text-admin-muted"
                    >
                      더보기
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
          <table className="min-w-[1180px] w-full text-admin-sm">
            <thead className="bg-admin-bg border-b border-admin-border-mid">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && checkedIds.size === filtered.length}
                    onChange={toggleAll}
                    className="rounded"
                    aria-label="현재 필터 상품 전체 선택"
                  />
                </th>
                {([
                  { field: 'title', label: '상품명', align: 'justify-start text-left' },
                  { field: 'land_operator', label: '랜드사', align: 'justify-start text-left' },
                  { field: 'commission_rate', label: '커미션', align: 'justify-end text-right' },
                  { field: 'destination', label: '목적지', align: 'justify-start text-left' },
                  { field: 'price', label: '가격범위', align: 'justify-end text-right' },
                  { field: 'deadline', label: '발권기한', align: 'justify-center text-center' },
                  { field: 'status', label: '상태', align: 'justify-center text-center' },
                ] as const).map(column => (
                  <th key={column.field} className={`px-3 py-2 text-admin-muted font-medium ${column.align.includes('text-right') ? 'text-right' : column.align.includes('text-center') ? 'text-center' : 'text-left'}`} aria-sort={sortDirection(column.field)}>
                    <button
                      type="button"
                      onClick={() => handleHeaderSort(column.field)}
                      aria-label={sortButtonLabel(column.field, column.label)}
                      className={`inline-flex w-full items-center gap-1 rounded px-1 py-0.5 text-admin-muted transition hover:bg-admin-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 ${column.align}`}
                    >
                      <span>{column.label}</span>
                      <span className="text-admin-muted-2 text-[11px]" aria-hidden="true">{sortIcon(column.field)}</span>
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2 text-admin-muted font-medium text-center">마케팅 커버리지</th>
                <th className="px-3 py-2 text-right text-admin-muted font-medium">다음 액션</th>
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
                    onSetSelected={openSelectedDetail}
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
                    onKakaoCopy={(pkg) => setKakaoCopyTarget(pkg)}
                    onBulkContentGen={handleBulkContentGen}
                    contentStatus={contentStatusMap}
                  />
                );
              })}
            </tbody>
          </table>
          </div>
          </>
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
        <button
          type="button"
          aria-label="복사 드롭다운 닫기"
          className="fixed inset-0 z-40 cursor-default"
          onClick={() => setCopyDropdownId(null)}
        />
      )}

      {/* Bulk Edit 슬라이드 패널 */}
      {bulkEditOpen && (
        <>
          <button
            type="button"
            aria-label="일괄 수정 패널 닫기"
            className="fixed inset-0 bg-black/40 z-50 cursor-default"
            onClick={() => setBulkEditOpen(false)}
          />
          <div
            ref={bulkEditPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="packages-bulk-edit-title"
            aria-describedby={bulkActionSummaryId}
            className="fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-white border-l border-admin-border-mid flex flex-col"
          >
            <div className="p-6 border-b border-admin-border-mid">
              <div className="flex items-center justify-between">
                <h3 id="packages-bulk-edit-title" className="text-admin-lg font-bold text-admin-text-2">선택된 {checkedIds.size}개 상품 일괄 수정</h3>
                <button type="button" ref={bulkEditCloseRef} onClick={() => setBulkEditOpen(false)} className="text-admin-muted-2 hover:text-admin-muted text-xl leading-none" aria-label="일괄 수정 패널 닫기">×</button>
              </div>
              <p className="text-admin-sm text-admin-muted mt-1">변경할 항목만 선택하세요. 비워두면 해당 필드는 유지됩니다.</p>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label htmlFor="bulk-land-operator" className="block text-admin-sm font-medium text-admin-text-2 mb-1">랜드사</label>
                <select
                  ref={bulkLandOperatorRef}
                  id="bulk-land-operator"
                  value={bulkLandOperator}
                  onChange={e => setBulkLandOperator(e.target.value)}
                  className="w-full border border-admin-border-mid rounded-lg px-3 py-2 text-admin-sm text-admin-text-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- 변경 안 함 --</option>
                  {LAND_OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="bulk-commission-rate" className="block text-admin-sm font-medium text-admin-text-2 mb-1">커미션 (%)</label>
                <input
                  id="bulk-commission-rate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={bulkCommission}
                  onChange={e => setBulkCommission(e.target.value)}
                  placeholder="변경 안 함"
                  className="w-full border border-admin-border-mid rounded-lg px-3 py-2 text-admin-sm text-admin-text-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="p-6 border-t border-admin-border-mid flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setBulkEditOpen(false)}
                className="px-4 py-2 bg-white border border-admin-border-strong rounded-lg text-admin-sm text-admin-text-2 hover:bg-admin-bg"
              >취소</button>
              <button
                type="button"
                onClick={handleBulkEdit}
                disabled={bulkLoading || (!bulkLandOperator && bulkCommission === '')}
                aria-busy={bulkLoading}
                aria-describedby={bulkActionDescriptionIds}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-admin-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >{bulkLoading ? '저장 중...' : '일괄 저장'}</button>
            </div>
          </div>
        </>
      )}

      {/* Single Edit 슬라이드 패널 */}
      {editPkg && (
        <>
          <button
            type="button"
            aria-label="상품 수정 패널 닫기"
            className="fixed inset-0 bg-black/40 z-50 cursor-default"
            onClick={() => setEditPkg(null)}
          />
          <div
            ref={editPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="packages-single-edit-title"
            className="fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-white border-l border-admin-border-mid flex flex-col"
          >
            <div className="p-6 border-b border-admin-border-mid">
              <div className="flex items-center justify-between">
                <h3 id="packages-single-edit-title" className="text-admin-lg font-bold text-admin-text-2">상품 수정</h3>
                <button type="button" ref={editCloseRef} onClick={() => setEditPkg(null)} className="text-admin-muted-2 hover:text-admin-muted text-xl leading-none" aria-label="상품 수정 패널 닫기">×</button>
              </div>
              <p className="text-admin-sm text-admin-muted truncate mt-0.5">{editPkg.title}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label htmlFor="single-package-title" className="block text-admin-sm font-medium text-admin-text-2 mb-1">상품명</label>
                <input
                  ref={editTitleInputRef}
                  id="single-package-title"
                  type="text"
                  value={editForm.title}
                  onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full border border-admin-border-mid rounded-lg px-3 py-2 text-admin-sm text-admin-text-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="single-package-destination" className="block text-admin-sm font-medium text-admin-text-2 mb-1">목적지</label>
                <input
                  id="single-package-destination"
                  type="text"
                  value={editForm.destination}
                  onChange={e => setEditForm(f => ({ ...f, destination: e.target.value }))}
                  placeholder="예: 베트남 다낭"
                  className="w-full border border-admin-border-mid rounded-lg px-3 py-2 text-admin-sm text-admin-text-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="single-land-operator" className="block text-admin-sm font-medium text-admin-text-2 mb-1">랜드사</label>
                <select
                  id="single-land-operator"
                  value={editForm.land_operator_id}
                  onChange={e => setEditForm(f => ({ ...f, land_operator_id: e.target.value }))}
                  className="w-full border border-admin-border-mid rounded-lg px-3 py-2 text-admin-sm text-admin-text-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- 선택 안 함 --</option>
                  {activeVendors.map(op => (
                    <option key={op.id} value={op.id}>{op.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="single-commission-rate" className="block text-admin-sm font-medium text-admin-text-2 mb-1">커미션 (%)</label>
                <input
                  id="single-commission-rate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={editForm.commission_rate}
                  onChange={e => setEditForm(f => ({ ...f, commission_rate: e.target.value }))}
                  placeholder="예: 10"
                  className="w-full border border-admin-border-mid rounded-lg px-3 py-2 text-admin-sm text-admin-text-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="single-ticketing-deadline" className="block text-admin-sm font-medium text-admin-text-2 mb-1">발권기한</label>
                <input
                  id="single-ticketing-deadline"
                  type="date"
                  value={editForm.ticketing_deadline}
                  onChange={e => setEditForm(f => ({ ...f, ticketing_deadline: e.target.value }))}
                  className="w-full border border-admin-border-mid rounded-lg px-3 py-2 text-admin-sm text-admin-text-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="p-6 border-t border-admin-border-mid flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setEditPkg(null)}
                className="px-4 py-2 bg-white border border-admin-border-strong rounded-lg text-admin-sm text-admin-text-2 hover:bg-admin-bg"
              >취소</button>
              <button
                type="button"
                onClick={handleSingleEdit}
                disabled={editSaving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-admin-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >{editSaving ? '저장 중...' : '저장'}</button>
            </div>
          </div>
        </>
      )}

      {/* 상세 슬라이드 패널 */}
      {selected && (
        <>
          <button
            type="button"
            aria-label="상품 상세 패널 닫기"
            className="fixed inset-0 bg-black/40 z-50 cursor-default"
            onClick={() => setSelected(null)}
          />
          <div
            ref={detailPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="packages-detail-panel-title"
            className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white border-l border-admin-border-mid flex flex-col"
          >
            {(() => {
              const selectedExpired = isExpired(selected);
              const selectedNextOperationLabel = getPackageNextOperationLabel(selected, selectedExpired);
              const selectedNextOperationReason = getPackageNextOperationReason(selected, selectedExpired);
              const selectedPackageStatusLabel = STATUS_LABEL[selected.status] ?? selected.status;
              const selectedPackagePriceLabel = selected.price ? `${selected.price.toLocaleString()}원` : '가격 미정';
              const detailActionSummaryId = `admin-package-detail-action-summary-${selected.id}`;
              const detailActionSummaryText = `상세 결정 요약: 상태 ${selectedPackageStatusLabel}, 가격 ${selectedPackagePriceLabel}, 다음 액션 ${selectedNextOperationLabel}. 근거는 ${selectedNextOperationReason}`;
              return (
                <>
            <div className="p-6 border-b border-admin-border-mid flex items-start justify-between">
              <div>
                <h2 id="packages-detail-panel-title" className="text-admin-lg font-bold text-admin-text-2">{selected.title}</h2>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${STATUS_BADGE[selected.status] || 'bg-admin-surface-2 text-admin-muted'}`}>
                    {STATUS_LABEL[selected.status] ?? selected.status}
                  </span>
                  {(selected as { audit_status?: string }).audit_status && AUDIT_BADGE[(selected as { audit_status: string }).audit_status] && (
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] ${AUDIT_BADGE[(selected as { audit_status: string }).audit_status].cls}`}
                      title={AUDIT_BADGE[(selected as { audit_status: string }).audit_status].title}
                    >
                      {AUDIT_BADGE[(selected as { audit_status: string }).audit_status].label}
                    </span>
                  )}
                  {selected.category && <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-[11px]">{CATEGORY_LABELS[selected.category]}</span>}
                  {selected.product_type && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[11px]">{selected.product_type}</span>}
                  {(() => {
                    const dday = getDDayInfo(selected);
                    return dday ? <span className={`px-2 py-0.5 rounded text-[11px] ${dday.className}`}>{dday.label}</span> : null;
                  })()}
                </div>
              </div>
              <button type="button" ref={detailCloseRef} onClick={() => setSelected(null)} className="text-admin-muted-2 hover:text-admin-muted text-xl leading-none" aria-label="상품 상세 패널 닫기">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-admin-sm">
              {packageAlerts.length > 0 && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 space-y-1">
                  <p className="text-[11px] font-semibold text-orange-800">등록 백필 알림 (register-backfill)</p>
                  {packageAlerts.slice(0, 3).map(a => (
                    <div key={a.id} className="text-[11px] text-orange-900">
                      <span className="font-medium">{a.title}</span>
                      {a.message ? ` — ${a.message}` : ''}
                    </div>
                  ))}
                </div>
              )}

              {selected.product_summary && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-admin-sm text-blue-800">
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

              <div className="grid grid-cols-2 gap-2 text-admin-sm">
                {selected.land_operator && (
                  <div className="col-span-2 flex items-center gap-4">
                    <div><span className="text-admin-muted">랜드사:</span> <span className="font-medium text-blue-700">{selected.land_operator}</span></div>
                    {selected.commission_rate != null && (
                      <div><span className="text-admin-muted">커미션:</span> <span className="font-medium text-green-600">{selected.commission_rate}%</span></div>
                    )}
                  </div>
                )}
                {selected.destination && <div><span className="text-admin-muted">목적지:</span> {selected.destination}</div>}
                {selected.trip_style && <div><span className="text-admin-muted">기간:</span> {selected.trip_style}</div>}
                {selected.departure_days && <div><span className="text-admin-muted">출발요일:</span> {selected.departure_days}</div>}
                {selected.airline && <div><span className="text-admin-muted">항공:</span> {selected.airline}</div>}
                {selected.min_participants && <div><span className="text-admin-muted">최소인원:</span> {selected.min_participants}명</div>}
                {selected.ticketing_deadline && (
                  <div>
                    <span className="text-admin-muted">발권마감:</span>{' '}
                    <span className={`font-medium ${isDeadlineSoon(selected) ? 'text-red-600' : ''}`}>
                      {selected.ticketing_deadline}
                    </span>
                    {(() => { const d = getDDayInfo(selected); return d ? <span className={`ml-1 px-1.5 py-0.5 rounded text-[11px] ${d.className}`}>{d.label}</span> : null; })()}
                  </div>
                )}
                {selected.guide_tip && <div className="col-span-2"><span className="text-admin-muted">가이드팁:</span> {selected.guide_tip}</div>}
                {selected.single_supplement && <div className="col-span-2"><span className="text-admin-muted">싱글차지:</span> {selected.single_supplement}</div>}
                {selected.small_group_surcharge && <div className="col-span-2"><span className="text-admin-muted">소규모할증:</span> {selected.small_group_surcharge}</div>}
              </div>

              {selected.price_tiers && selected.price_tiers.length > 0 && (
                <div>
                  <p className="font-semibold text-admin-text-2 mb-2">날짜별 가격표</p>
                  <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-admin-bg">
                        <th className="border border-admin-border-mid px-2 py-1.5 text-left text-admin-muted">날짜/기간</th>
                        <th className="border border-admin-border-mid px-2 py-1.5 text-right text-admin-muted">성인</th>
                        <th className="border border-admin-border-mid px-2 py-1.5 text-right text-admin-muted">아동</th>
                        <th className="border border-admin-border-mid px-2 py-1.5 text-center text-admin-muted">상태/비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.price_tiers.map((tier, i) => (
                        <tr key={i} className="hover:bg-admin-bg">
                          <td className="border border-admin-border-mid px-2 py-1.5 text-admin-text-2">
                            {tier.period_label}
                            {tier.departure_day_of_week && <span className="ml-1 text-admin-muted-2">({tier.departure_day_of_week})</span>}
                          </td>
                          <td className="border border-admin-border-mid px-2 py-1.5 text-right font-medium text-admin-text-2">{tier.adult_price ? tier.adult_price.toLocaleString() : '-'}</td>
                          <td className="border border-admin-border-mid px-2 py-1.5 text-right text-admin-text-2">{tier.child_price ? tier.child_price.toLocaleString() : '-'}</td>
                          <td className="border border-admin-border-mid px-2 py-1.5 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[11px] ${
                              tier.status === 'confirmed' ? 'bg-green-50 text-green-700' :
                              tier.status === 'soldout' ? 'bg-red-50 text-red-700' :
                              'bg-admin-surface-2 text-admin-muted'
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
                  <p className="font-semibold text-admin-text-2 mb-1">포함사항</p>
                  <p className="text-admin-muted text-admin-sm">{selected.inclusions.join(', ')}</p>
                </div>
              )}
              {selected.excludes && selected.excludes.length > 0 && (
                <div>
                  <p className="font-semibold text-admin-text-2 mb-1">불포함사항</p>
                  <p className="text-admin-muted text-admin-sm">{selected.excludes.join(', ')}</p>
                </div>
              )}

              {selected.optional_tours && selected.optional_tours.length > 0 && (
                <div>
                  <p className="font-semibold text-admin-text-2 mb-1">선택관광</p>
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

            <div className="p-4 border-t border-admin-border-mid">
              <p
                id={detailActionSummaryId}
                data-testid="admin-package-detail-action-summary"
                className="mb-3 rounded-admin-md border border-admin-border-mid bg-admin-bg px-3 py-2 text-admin-xs font-semibold text-admin-text-2"
              >
                {detailActionSummaryText}
              </p>
              <div className="flex gap-2 justify-end flex-wrap">
              <button
                type="button"
                onClick={() => handleSectionBackfill(false)}
                disabled={sectionBackfilling}
                className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-admin-sm hover:bg-amber-600 disabled:opacity-50"
                title="hero / price_dates / inclusions / excludes / notices LLM·L1 backfill"
              >{sectionBackfilling ? 'Section 추출 중...' : 'Section 재추출'}</button>
              <button
                type="button"
                onClick={() => handleSectionBackfill(true)}
                disabled={sectionBackfilling}
                className="px-3 py-1.5 bg-amber-700 text-white rounded-lg text-admin-sm hover:bg-amber-800 disabled:opacity-50"
                title="깨진 inclusions/excludes 포함 강제 덮어쓰기"
              >강제 Section 재추출</button>
              {!!selected.itinerary_data ? (
                <button
                  onClick={() => handleGenerateImage(selected, 'detail')}
                  disabled={imgGenerating}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-admin-sm hover:bg-blue-700 disabled:opacity-50"
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
                      trackPackageActionCompleted('itinerary_reextracted', selected, { days: data.days ?? null });
                      load();
                      setSelected(null);
                    } catch (err) {
                      alert('재추출 실패: ' + (err instanceof Error ? err.message : '오류'));
                    } finally {
                      setReextracting(false);
                    }
                  }}
                  disabled={reextracting}
                  className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-admin-sm hover:bg-orange-600 disabled:opacity-50"
                >{reextracting ? 'AI 추출 중...' : '일정표 재추출'}</button>
              )}
              <a
                href={`/itinerary/${selected.id}`}
                target="_blank"
                className="px-3 py-1.5 bg-white border border-admin-border-strong text-admin-text-2 rounded-lg text-admin-sm hover:bg-admin-bg"
              >듀얼뷰</a>
              <a
                href={`/itinerary/${selected.id}/print?mode=detail`}
                target="_blank"
                className="px-3 py-1.5 bg-white border border-admin-border-strong text-admin-text-2 rounded-lg text-admin-sm hover:bg-admin-bg"
              >A4 인쇄</a>
              <button
                onClick={e => { setSelected(null); openSingleEdit(selected, e); }}
                aria-describedby={detailActionSummaryId}
                className="px-3 py-1.5 bg-white border border-admin-border-strong text-admin-text-2 rounded-lg text-admin-sm hover:bg-admin-bg"
              >수정</button>
              <button
                onClick={() => handleAction(selected.id, 'delete')}
                disabled={!!actionLoading}
                aria-describedby={detailActionSummaryId}
                className="px-3 py-1.5 text-red-500 border border-red-200 rounded-lg text-admin-sm hover:bg-red-50 disabled:opacity-50"
              >삭제</button>
              {isExpired(selected) && (
                <button
                  onClick={() => handleAction(selected.id, 'extend')}
                  disabled={!!actionLoading}
                  aria-describedby={detailActionSummaryId}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-admin-sm hover:bg-blue-700 disabled:opacity-50"
                >판매 연장 (+30일)</button>
              )}
              {selected.status === 'pending' && (
                <>
                  <button
                    onClick={() => handleAction(selected.id, 'reject')}
                    disabled={!!actionLoading}
                    aria-describedby={detailActionSummaryId}
                    className="px-3 py-1.5 bg-white border border-admin-border-strong text-admin-text-2 rounded-lg text-admin-sm hover:bg-admin-bg disabled:opacity-50"
                  >거부</button>
                  <button
                    onClick={() => handleAction(selected.id, 'approve')}
                    disabled={!!actionLoading}
                    aria-describedby={detailActionSummaryId}
                    className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-admin-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >승인</button>
                </>
              )}
              {selected.status === 'approved' && (
                <button
                  onClick={() => handleAction(selected.id, 'reject')}
                  disabled={!!actionLoading}
                  aria-describedby={detailActionSummaryId}
                  className="px-3 py-1.5 bg-white border border-admin-border-strong text-admin-text-2 rounded-lg text-admin-sm hover:bg-admin-bg disabled:opacity-50"
                >비활성화</button>
              )}
              {selected.status === 'rejected' && (
                <button
                  onClick={() => handleAction(selected.id, 'approve')}
                  disabled={!!actionLoading}
                  aria-describedby={detailActionSummaryId}
                  className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-admin-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >다시 승인</button>
              )}
              </div>
            </div>
                </>
              );
            })()}
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

      {/* ── 카톡 마케팅 문구 모달 ───────────────────────────────────── */}
      {kakaoCopyTarget && (
        <>
          <button
            type="button"
            aria-label="카톡 마케팅 문구 모달 닫기"
            className="fixed inset-0 bg-black/50 z-50 cursor-default"
            onClick={() => { setKakaoCopyTarget(null); setKakaoCopyText(''); }}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
          <div
            ref={kakaoCopyModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="kakao-copy-modal-title"
            className="pointer-events-auto bg-white rounded-admin-lg w-full max-w-xl max-h-[90vh] overflow-y-auto"
          >
            <div className="p-5 border-b flex justify-between items-start">
              <div>
                <h3 id="kakao-copy-modal-title" className="font-bold text-lg">카톡 마케팅 문구</h3>
                <p className="text-xs text-admin-muted-2 mt-1">{kakaoCopyTarget.title}</p>
              </div>
              <button type="button" ref={kakaoCopyCloseRef} onClick={() => { setKakaoCopyTarget(null); setKakaoCopyText(''); }} className="text-admin-muted-2 hover:text-admin-muted text-xl" aria-label="카톡 마케팅 문구 모달 닫기">×</button>
            </div>

            {/* 생성 버튼 */}
            {!kakaoCopyText && !kakaoCopyLoading && (
              <div className="p-6 text-center">
                <p className="text-sm text-admin-muted mb-4">AI가 상품 데이터를 분석하여<br/>카톡방 발송용 마케팅 문구를 생성합니다.</p>
                <button type="button" ref={kakaoCopyGenerateRef} onClick={async () => {
                  setKakaoCopyLoading(true);
                  try {
                    const pkg = kakaoCopyTarget;
                    const res = await fetch('/api/packages/kakao-copy', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        title: pkg.title,
                        destination: pkg.destination || '',
                        duration: pkg.duration || 0,
                        price: pkg.products?.selling_price || pkg.price || 0,
                        priceTiers: pkg.price_tiers || [],
                        highlights: pkg.product_highlights || [],
                        inclusions: pkg.inclusions || [],
                        excludes: pkg.excludes || [],
                        airline: pkg.airline || '',
                        departureAirport: pkg.departure_airport || '',
                        ticketingDeadline: pkg.ticketing_deadline || '',
                        productType: pkg.product_type || '',
                        specialNotes: pkg.special_notes || '',
                      }),
                    });
                    const data = await res.json();
                    setKakaoCopyText(data.copy || '문구 생성 실패');
                    if (data.copy) trackPackageActionCompleted('kakao_copy_generated', pkg, { source: 'initial' });
                  } catch { setKakaoCopyText('문구 생성 중 오류 발생'); }
                  finally { setKakaoCopyLoading(false); }
                }} className="px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-600 text-white font-bold rounded-admin-md hover:opacity-90 text-sm">
                  문구 생성하기
                </button>
              </div>
            )}

            {/* 로딩 */}
            {kakaoCopyLoading && (
              <div className="p-10 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-pink-300 border-t-pink-600 rounded-full mx-auto mb-3" />
                <p className="text-sm text-admin-muted">AI가 문구를 생성하고 있습니다...</p>
              </div>
            )}

            {/* 결과 */}
            {kakaoCopyText && !kakaoCopyLoading && (
              <div className="p-4">
                <textarea ref={kakaoCopyTextareaRef} value={kakaoCopyText} onChange={e => setKakaoCopyText(e.target.value)}
                  aria-label="카톡 마케팅 문구"
                  rows={18} className="w-full border rounded-admin-md px-4 py-3 text-sm leading-relaxed resize-none focus:ring-2 focus:ring-pink-300 focus:outline-none" />
                <div className="flex gap-2 mt-3">
                  <button type="button" onClick={() => {
                    void navigator.clipboard.writeText(kakaoCopyText);
                    trackPackageActionCompleted('kakao_copy_copied', kakaoCopyTarget, { textLength: kakaoCopyText.length });
                  }}
                    className="flex-1 py-2.5 bg-blue-600 text-white font-bold text-sm rounded-admin-md hover:bg-blue-700">
                    문구 복사
                  </button>
                  <button type="button" onClick={async () => {
                    setKakaoCopyLoading(true); setKakaoCopyText('');
                    try {
                      const pkg = kakaoCopyTarget;
                      const res = await fetch('/api/packages/kakao-copy', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          title: pkg.title, destination: pkg.destination || '', duration: pkg.duration || 0,
                          price: pkg.products?.selling_price || pkg.price || 0, priceTiers: pkg.price_tiers || [],
                          highlights: pkg.product_highlights || [], inclusions: pkg.inclusions || [],
                          excludes: pkg.excludes || [], airline: pkg.airline || '',
                          departureAirport: pkg.departure_airport || '', ticketingDeadline: pkg.ticketing_deadline || '',
                          productType: pkg.product_type || '', specialNotes: pkg.special_notes || '',
                        }),
                      });
                      const data = await res.json();
                      setKakaoCopyText(data.copy || '문구 생성 실패');
                      if (data.copy) trackPackageActionCompleted('kakao_copy_generated', pkg, { source: 'regenerate' });
                    } catch { setKakaoCopyText('문구 생성 중 오류 발생'); }
                    finally { setKakaoCopyLoading(false); }
                  }} className="py-2.5 px-4 bg-admin-surface-2 text-admin-text-2 text-sm rounded-admin-md hover:bg-slate-200">
                    재생성
                  </button>
                </div>
              </div>
            )}
          </div>
          </div>
        </>
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

    </div>
  );
}
