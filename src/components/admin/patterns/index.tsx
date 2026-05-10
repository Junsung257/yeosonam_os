/**
 * 어드민 패턴 라이브러리 — Linear/Stripe 톤 ERP 빌딩 블록
 *
 * Phase 3 산출물. 이 파일의 컴포넌트만 조립해도 일관된 어드민 페이지를 만들 수 있다.
 *
 * 사용:
 *   import { PageHeader, SectionCard, KpiCard, FilterBar, EmptyState, DetailDrawer }
 *     from '@/components/admin/patterns';
 */

'use client';

import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, X as CloseIcon, type LucideIcon } from 'lucide-react';

/* ──────────────────────────────────────────────────────────
 * PageHeader — 페이지 상단 (제목 + breadcrumb + 액션)
 * ────────────────────────────────────────────────────────── */
interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  breadcrumb?: { label: string; href?: string }[];
  actions?: ReactNode;
  badge?: ReactNode;
}

export function PageHeader({ title, subtitle, breadcrumb, actions, badge }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0 flex-1">
        {breadcrumb && breadcrumb.length > 0 && (
          <div className="flex items-center gap-1 text-admin-xs text-admin-muted mb-1.5">
            {breadcrumb.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {b.href ? (
                  <a href={b.href} className="hover:text-admin-text transition-colors">
                    {b.label}
                  </a>
                ) : (
                  <span>{b.label}</span>
                )}
                {i < breadcrumb.length - 1 && <ChevronRight size={12} className="opacity-50" />}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3">
          <h1 className="text-admin-h1 text-admin-text truncate">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="mt-1 text-admin-sm text-admin-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
 * SectionCard — 본문 섹션 카드 (제목 + 액션 + body)
 * ────────────────────────────────────────────────────────── */
interface SectionCardProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** 본문 패딩 제거 (표·리스트 풀폭 렌더용) */
  flush?: boolean;
  className?: string;
}

export function SectionCard({ title, description, actions, children, flush = false, className = '' }: SectionCardProps) {
  return (
    <section className={`bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-admin-border">
          <div className="min-w-0">
            {title && <h2 className="text-admin-h3 text-admin-text">{title}</h2>}
            {description && <p className="text-admin-xs text-admin-muted mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────
 * KpiCard — KPI 단일 지표 카드 (display 숫자 + 보조 정보)
 * ────────────────────────────────────────────────────────── */
type KpiTone = 'neutral' | 'positive' | 'negative';

interface KpiCardProps {
  label: string;
  value: ReactNode;
  /** 부가 보조 라벨 (예: 단위, 기간) */
  unit?: string;
  /** 변화량 (예: '+12%'). 색은 tone 으로 결정 */
  delta?: string;
  tone?: KpiTone;
  /** 좌측 아이콘 */
  icon?: LucideIcon;
  /** 클릭 시 이동 (있으면 카드가 hover 가능해짐) */
  href?: string;
  hint?: string;
}

const TONE_DELTA: Record<KpiTone, string> = {
  neutral: 'text-admin-muted',
  positive: 'text-success',
  negative: 'text-danger',
};

export function KpiCard({ label, value, unit, delta, tone = 'neutral', icon: Icon, href, hint }: KpiCardProps) {
  const Wrapper: any = href ? 'a' : 'div';
  return (
    <Wrapper
      href={href}
      className={`block bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4 ${
        href ? 'hover:border-admin-border-strong hover:shadow-admin-sm transition-all duration-160' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-admin-xs font-medium text-admin-muted uppercase tracking-wider">{label}</span>
        {Icon && (
          <span className="text-admin-muted-2 shrink-0">
            <Icon size={14} strokeWidth={2} />
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-admin-display font-bold text-admin-text admin-num">{value}</span>
        {unit && <span className="text-admin-sm text-admin-muted">{unit}</span>}
      </div>
      {(delta || hint) && (
        <div className="mt-1.5 flex items-center gap-2 text-admin-xs">
          {delta && <span className={`${TONE_DELTA[tone]} font-semibold admin-num`}>{delta}</span>}
          {hint && <span className="text-admin-muted-2">{hint}</span>}
        </div>
      )}
    </Wrapper>
  );
}

/* ──────────────────────────────────────────────────────────
 * FilterBar — 표 위 필터/검색바
 * ────────────────────────────────────────────────────────── */
interface FilterBarProps {
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}

export function FilterBar({ children, right, className = '' }: FilterBarProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 px-4 py-3 bg-admin-surface border border-admin-border-mid rounded-admin-md mb-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">{children}</div>
      {right && <div className="flex items-center gap-2 shrink-0 ml-auto">{right}</div>}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
 * EmptyState — 빈 상태
 * ────────────────────────────────────────────────────────── */
interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {Icon && (
        <div className="mb-4 w-12 h-12 rounded-full bg-admin-surface-2 flex items-center justify-center text-admin-muted">
          <Icon size={20} strokeWidth={1.75} />
        </div>
      )}
      <h3 className="text-admin-base font-semibold text-admin-text">{title}</h3>
      {description && (
        <p className="mt-1 text-admin-sm text-admin-muted max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
 * DetailDrawer — 우측에서 슬라이드 인. 표 → 상세 패턴.
 * ────────────────────────────────────────────────────────── */
interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  width?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  width = 'w-full sm:w-[480px] lg:w-[560px]',
  actions,
  children,
}: DetailDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="admin-scope">
      <div
        className="fixed inset-0 bg-slate-900/30 z-40 animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={`fixed top-0 right-0 h-full ${width} bg-admin-surface border-l border-admin-border-mid shadow-admin-xl z-50 flex flex-col animate-in slide-in-from-right duration-200`}
      >
        <header className="h-14 px-5 flex items-center justify-between border-b border-admin-border shrink-0">
          <div className="min-w-0">
            <h2 className="text-admin-h3 text-admin-text truncate">{title}</h2>
            {subtitle && <p className="text-admin-xs text-admin-muted truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-admin-sm text-admin-muted hover:text-admin-text hover:bg-admin-surface-2 transition-colors duration-160 shrink-0"
            aria-label="닫기"
          >
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {actions && (
          <footer className="px-5 py-3 border-t border-admin-border bg-admin-surface-2 shrink-0">
            <div className="flex items-center justify-end gap-2">{actions}</div>
          </footer>
        )}
      </aside>
    </div>,
    document.body,
  );
}

/* ──────────────────────────────────────────────────────────
 * FormRow — 라벨 + 입력 + 힌트의 표준 폼 row
 * ────────────────────────────────────────────────────────── */
interface FormRowProps {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  /** horizontal: 라벨 좌측 / vertical: 라벨 위 */
  layout?: 'horizontal' | 'vertical';
}

export function FormRow({ label, required, hint, error, children, layout = 'vertical' }: FormRowProps) {
  if (layout === 'horizontal') {
    return (
      <div className="grid grid-cols-12 gap-4 items-start py-3 border-b border-admin-border last:border-0">
        <label className="col-span-4 pt-2 text-admin-sm text-admin-text-2 font-medium">
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
        <div className="col-span-8">
          {children}
          {hint && !error && <p className="mt-1 text-admin-xs text-admin-muted">{hint}</p>}
          {error && <p className="mt-1 text-admin-xs text-danger">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-admin-xs text-admin-text-2 font-medium">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-admin-xs text-admin-muted">{hint}</p>}
      {error && <p className="text-admin-xs text-danger">{error}</p>}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
 * StatNumber — 표 안에서 숫자/금액을 monospace + tabular 정렬.
 * ────────────────────────────────────────────────────────── */
interface StatNumberProps {
  value: number | string;
  /** 'currency' = 통화 (₩), 'count' = 개수, 'percent' = 퍼센트 */
  format?: 'currency' | 'count' | 'percent' | 'plain';
  tone?: 'neutral' | 'positive' | 'negative';
  className?: string;
}

const STAT_TONE: Record<NonNullable<StatNumberProps['tone']>, string> = {
  neutral: 'text-admin-text',
  positive: 'text-admin-profit', // 한국 주식 관행: 양수 = 빨강
  negative: 'text-admin-loss',
};

export function StatNumber({ value, format = 'plain', tone = 'neutral', className = '' }: StatNumberProps) {
  let display: string;
  if (typeof value === 'number') {
    if (format === 'currency') display = `₩${value.toLocaleString('ko-KR')}`;
    else if (format === 'percent') display = `${value.toFixed(1)}%`;
    else if (format === 'count') display = value.toLocaleString('ko-KR');
    else display = String(value);
  } else {
    display = value;
  }
  return (
    <span className={`admin-num font-medium ${STAT_TONE[tone]} ${className}`}>{display}</span>
  );
}
