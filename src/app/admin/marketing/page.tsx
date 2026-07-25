'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type {
  MarketingChannelState,
  MarketingMetric,
  MarketingOperationsDashboard,
} from '@/lib/marketing';

type DashboardResponse =
  | { ok: true; data: MarketingOperationsDashboard }
  | { ok: false; error?: { message?: string } };

const PERIODS = [7, 30, 90] as const;

const STATUS_STYLE: Record<MarketingChannelState, string> = {
  operating: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  draft_only: 'border-blue-200 bg-blue-50 text-blue-700',
  setup_needed: 'border-amber-200 bg-amber-50 text-amber-800',
  blocked: 'border-red-200 bg-red-50 text-red-700',
  stale: 'border-slate-300 bg-slate-100 text-slate-700',
};

function formatWon(value: number | null): string {
  if (value === null) return '수집 안 됨';
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function formatNumber(value: number | null): string {
  if (value === null) return '수집 안 됨';
  return Math.round(value).toLocaleString('ko-KR');
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '기록 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function campaignStatusLabel(value: string | null): string {
  const normalized = value?.toLowerCase();
  if (normalized === 'active') return '운영 중';
  if (normalized === 'draft') return '초안';
  if (normalized === 'paused') return '일시 중지';
  if (normalized === 'archived') return '종료';
  return '미지정';
}

function campaignChannelLabel(value: string | null): string {
  const normalized = value?.toLowerCase();
  if (normalized === 'google') return '구글 광고';
  if (normalized === 'naver') return '네이버 광고';
  if (normalized === 'meta' || normalized === 'facebook') return '메타 광고';
  if (normalized === 'kakao') return '카카오 광고';
  return value || '미지정';
}

function MetricCard({
  metric,
  href,
  format = 'number',
}: {
  metric: MarketingMetric;
  href: string;
  format?: 'number' | 'won' | 'percent';
}) {
  const display = metric.value === null
    ? '수집 안 됨'
    : format === 'won'
      ? formatWon(metric.value)
      : format === 'percent'
        ? `${metric.value.toFixed(1)}%`
        : formatNumber(metric.value);
  return (
    <Link
      href={href}
      className="block rounded-admin-md border border-admin-border-mid bg-white p-4 shadow-admin-xs transition hover:border-blue-300 hover:shadow-admin-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-admin-sm font-semibold text-admin-muted">{metric.label}</p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          metric.state === 'collected'
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-amber-50 text-amber-800'
        }`}>
          {metric.state === 'collected' ? '확인됨' : '연결 필요'}
        </span>
      </div>
      <p className={`mt-3 text-2xl font-bold ${
        metric.value === null ? 'text-admin-muted' : 'text-admin-text-2'
      }`}>
        {display}
      </p>
      <p className="mt-2 text-admin-xs leading-5 text-admin-muted">{metric.description}</p>
    </Link>
  );
}

export default function MarketingDashboardPage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [data, setData] = useState<MarketingOperationsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/marketing/dashboard?days=${days}`, {
        cache: 'no-store',
      });
      const payload = await response.json() as DashboardResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(!payload.ok ? payload.error?.message : `HTTP ${response.status}`);
      }
      setData(payload.data);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error
        ? loadError.message
        : '마케팅 현황을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-admin-lg font-bold text-admin-text-2">마케팅 운영</h1>
            {data && (
              <span className={`rounded-full border px-2.5 py-1 text-admin-xs font-semibold ${
                data.state === 'ready'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}>
                {data.state === 'ready' ? '자료 정상' : '확인할 항목 있음'}
              </span>
            )}
          </div>
          <p className="mt-1 text-admin-sm text-admin-muted">
            광고비, 문의, 예약, 채널 연결 상태를 한 화면에서 확인합니다.
          </p>
          {data && (
            <p className="mt-2 text-admin-xs text-admin-muted">
              화면 갱신 {formatDateTime(data.freshness.collectedAt)}
              {' · '}최근 방문 기록 {formatDateTime(data.freshness.latestTrackingAt)}
              {' · '}최근 광고사 자료 {formatDateTime(data.freshness.latestProviderAt)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/marketing/campaigns"
            className="rounded-admin-sm bg-blue-600 px-4 py-2 text-admin-sm font-semibold text-white hover:bg-blue-700"
          >
            캠페인 관리
          </Link>
          <Link
            href="/admin/marketing/creatives"
            className="rounded-admin-sm border border-admin-border-strong bg-white px-4 py-2 text-admin-sm font-semibold text-admin-text-2 hover:bg-admin-bg"
          >
            콘텐츠 만들기
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-admin-sm border border-admin-border-strong bg-white px-4 py-2 text-admin-sm font-semibold text-admin-text-2 hover:bg-admin-bg disabled:opacity-50"
          >
            {loading ? '새로 확인 중' : '새로 확인'}
          </button>
        </div>
      </header>

      <nav aria-label="조회 기간" className="inline-flex rounded-admin-sm border border-admin-border-mid bg-white p-1">
        {PERIODS.map((period) => (
          <button
            key={period}
            type="button"
            onClick={() => setDays(period)}
            aria-pressed={days === period}
            className={`rounded px-4 py-2 text-admin-sm font-semibold ${
              days === period
                ? 'bg-admin-text-2 text-white'
                : 'text-admin-muted hover:bg-admin-bg hover:text-admin-text-2'
            }`}
          >
            {period}일
          </button>
        ))}
      </nav>

      {error && (
        <section role="alert" className="rounded-admin-md border border-red-200 bg-red-50 p-5">
          <h2 className="font-semibold text-red-800">마케팅 현황을 불러오지 못했습니다.</h2>
          <p className="mt-1 text-admin-sm text-red-700">{error}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-admin-sm bg-red-700 px-4 py-2 text-admin-sm font-semibold text-white hover:bg-red-800"
            >
              다시 시도
            </button>
            <Link
              href="/admin/marketing/system-health"
              className="rounded-admin-sm border border-red-300 bg-white px-4 py-2 text-admin-sm font-semibold text-red-800"
            >
              시스템 상태 확인
            </Link>
          </div>
        </section>
      )}

      {loading && !data && !error && (
        <section aria-live="polite" className="rounded-admin-md border border-admin-border-mid bg-white p-8 text-center text-admin-sm text-admin-muted">
          실제 마케팅 자료를 확인하고 있습니다.
        </section>
      )}

      {data && (
        <>
          <section aria-labelledby="today-actions-title" className="rounded-admin-md border border-admin-border-mid bg-white p-5 shadow-admin-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 id="today-actions-title" className="text-admin-base font-bold text-admin-text-2">지금 할 일</h2>
                <p className="mt-1 text-admin-xs text-admin-muted">가장 먼저 처리할 항목만 최대 3개 보여줍니다.</p>
              </div>
              <Link href="/admin/marketing/system-health" className="text-admin-sm font-semibold text-blue-700 hover:underline">
                전체 상태 보기
              </Link>
            </div>
            {data.issues.length === 0 ? (
              <p className="mt-4 rounded-admin-sm bg-emerald-50 p-4 text-admin-sm text-emerald-800">
                지금 바로 처리할 긴급 항목이 없습니다.
              </p>
            ) : (
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {data.issues.map((issue) => (
                  <article key={issue.id} className="rounded-admin-sm border border-amber-200 bg-amber-50 p-4">
                    <p className="text-admin-xs font-bold text-amber-800">{issue.priority}</p>
                    <h3 className="mt-2 text-admin-sm font-bold text-admin-text-2">{issue.title}</h3>
                    <p className="mt-1 text-admin-xs leading-5 text-admin-muted">{issue.detail}</p>
                    <Link href={issue.actionHref} className="mt-3 inline-flex text-admin-sm font-semibold text-blue-700 hover:underline">
                      {issue.actionLabel}
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="performance-title">
            <div className="mb-3">
              <h2 id="performance-title" className="text-admin-base font-bold text-admin-text-2">성과 요약</h2>
              <p className="mt-1 text-admin-xs text-admin-muted">
                값이 없으면 0으로 채우지 않고 ‘수집 안 됨’으로 표시합니다.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <MetricCard metric={data.kpis.spend} href="/admin/marketing/campaigns" format="won" />
              <MetricCard metric={data.kpis.inquiries} href="/admin/leads" />
              <MetricCard metric={data.kpis.bookings} href="/admin/bookings" />
              <MetricCard metric={data.kpis.confirmedMargin} href="/admin/settlements" format="won" />
              <MetricCard metric={data.kpis.costPerBooking} href="/admin/marketing/campaigns" format="won" />
            </div>
          </section>

          <section aria-labelledby="channel-title" className="rounded-admin-md border border-admin-border-mid bg-white shadow-admin-xs">
            <div className="border-b border-admin-border p-5">
              <h2 id="channel-title" className="text-admin-base font-bold text-admin-text-2">채널별 운영 상태</h2>
              <p className="mt-1 text-admin-xs text-admin-muted">
                ‘운영 중’은 외부 계정, 발행 권한, 실제 발행 가능 상태가 모두 확인된 경우에만 표시합니다.
              </p>
            </div>
            <div className="grid gap-3 p-5 lg:grid-cols-2">
              {data.channels.map((channel) => (
                <article key={channel.channel} className="rounded-admin-sm border border-admin-border bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-admin-text-2">{channel.channelLabel}</h3>
                      <p className="mt-1 text-admin-xs text-admin-muted">
                        최근 점검 {formatDateTime(channel.lastCheckedAt)}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-admin-xs font-semibold ${STATUS_STYLE[channel.status]}`}>
                      {channel.statusLabel}
                    </span>
                  </div>
                  <p className="mt-3 text-admin-xs leading-5 text-admin-muted">{channel.reason}</p>
                  <dl className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-admin-sm bg-admin-bg p-3">
                      <dt className="text-[11px] font-semibold text-admin-muted">광고비</dt>
                      <dd className="mt-1 text-admin-sm font-bold text-admin-text-2">{formatWon(channel.spend)}</dd>
                    </div>
                    <div className="rounded-admin-sm bg-admin-bg p-3">
                      <dt className="text-[11px] font-semibold text-admin-muted">문의</dt>
                      <dd className="mt-1 text-admin-sm font-bold text-admin-text-2">{formatNumber(channel.inquiries)}</dd>
                    </div>
                    <div className="rounded-admin-sm bg-admin-bg p-3">
                      <dt className="text-[11px] font-semibold text-admin-muted">예약</dt>
                      <dd className="mt-1 text-admin-sm font-bold text-admin-text-2">{formatNumber(channel.conversions)}</dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-admin-xs leading-5 text-admin-muted">{channel.nextAction}</p>
                  <Link href={channel.settingsHref} className="mt-2 inline-flex text-admin-sm font-semibold text-blue-700 hover:underline">
                    설정 열기
                  </Link>
                </article>
              ))}
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <section aria-labelledby="funnel-title" className="rounded-admin-md border border-admin-border-mid bg-white p-5 shadow-admin-xs">
              <h2 id="funnel-title" className="text-admin-base font-bold text-admin-text-2">고객 흐름</h2>
              <p className="mt-1 text-admin-xs text-admin-muted">실제 기록된 단계만 표시합니다.</p>
              <ol className="mt-4 divide-y divide-admin-border">
                {data.funnel.map((step, index) => (
                  <li key={step.label} className="flex items-center justify-between gap-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-admin-bg text-admin-xs font-bold text-admin-muted">
                        {index + 1}
                      </span>
                      <span className="font-semibold text-admin-text-2">{step.label}</span>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-admin-text-2">{formatNumber(step.count)}</p>
                      {index > 0 && <p className="text-admin-xs text-admin-muted">앞 단계 대비 {step.rate.toFixed(1)}%</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section aria-labelledby="content-title" className="rounded-admin-md border border-admin-border-mid bg-white p-5 shadow-admin-xs">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="content-title" className="text-admin-base font-bold text-admin-text-2">콘텐츠와 발행</h2>
                  <p className="mt-1 text-admin-xs text-admin-muted">선택 기간에 만든 콘텐츠 기준입니다.</p>
                </div>
                <Link href="/admin/marketing/published" className="text-admin-sm font-semibold text-blue-700 hover:underline">
                  발행 내역
                </Link>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3">
                {[
                  ['만든 콘텐츠', data.content.total],
                  ['발행 완료', data.content.published],
                  ['발행 예약', data.content.scheduled],
                  ['발행 실패', data.content.failed],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-admin-sm border border-admin-border bg-admin-bg p-4">
                    <dt className="text-admin-xs font-semibold text-admin-muted">{label}</dt>
                    <dd className="mt-2 text-2xl font-bold text-admin-text-2">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/admin/marketing/creatives" className="rounded-admin-sm bg-blue-600 px-4 py-2 text-admin-sm font-semibold text-white hover:bg-blue-700">
                  콘텐츠 만들기
                </Link>
                <Link href="/admin/marketing/auto-publish" className="rounded-admin-sm border border-admin-border-strong bg-white px-4 py-2 text-admin-sm font-semibold text-admin-text-2 hover:bg-admin-bg">
                  발행 예약 관리
                </Link>
              </div>
            </section>
          </div>

          <section aria-labelledby="campaign-title" className="rounded-admin-md border border-admin-border-mid bg-white p-5 shadow-admin-xs">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="campaign-title" className="text-admin-base font-bold text-admin-text-2">캠페인</h2>
                <p className="mt-1 text-admin-xs text-admin-muted">
                  전체 {data.campaigns.total}개 · 운영 {data.campaigns.active}개 · 초안 {data.campaigns.draft}개
                </p>
              </div>
              <Link href="/admin/marketing/campaigns" className="text-admin-sm font-semibold text-blue-700 hover:underline">
                전체 캠페인 관리
              </Link>
            </div>
            {data.campaigns.rows.length === 0 ? (
              <p className="mt-4 rounded-admin-sm bg-admin-bg p-4 text-admin-sm text-admin-muted">
                등록된 캠페인이 없습니다. 채널 연결 후 첫 캠페인을 만드세요.
              </p>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {data.campaigns.rows.map((campaign) => (
                  <article key={campaign.id} className="rounded-admin-sm border border-admin-border bg-admin-bg p-4">
                    <h3 className="break-words text-admin-sm font-bold text-admin-text-2">{campaign.name}</h3>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-admin-xs">
                      <div>
                        <dt className="font-semibold text-admin-muted">채널</dt>
                        <dd className="mt-1 text-admin-text-2">{campaignChannelLabel(campaign.channel)}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-admin-muted">상태</dt>
                        <dd className="mt-1 text-admin-text-2">{campaignStatusLabel(campaign.status)}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-admin-muted">하루 예산</dt>
                        <dd className="mt-1 text-admin-text-2">{formatWon(campaign.daily_budget_krw)}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-admin-muted">최근 수정</dt>
                        <dd className="mt-1 text-admin-text-2">{formatDateTime(campaign.updated_at)}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </section>

          {data.recommendations.length > 0 && (
            <section aria-labelledby="recommendation-title" className="rounded-admin-md border border-admin-border-mid bg-white p-5 shadow-admin-xs">
              <h2 id="recommendation-title" className="text-admin-base font-bold text-admin-text-2">검토할 제안</h2>
              <p className="mt-1 text-admin-xs text-admin-muted">자동 적용하지 않고, 근거를 확인한 뒤 실행합니다.</p>
              <div className="mt-4 divide-y divide-admin-border">
                {data.recommendations.map((item) => (
                  <article key={item.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="font-semibold text-admin-text-2">{item.title}</h3>
                      <p className="mt-1 text-admin-xs leading-5 text-admin-muted">{item.reason}</p>
                    </div>
                    <Link href={item.action_url} className="shrink-0 text-admin-sm font-semibold text-blue-700 hover:underline">
                      {item.action_label || '검토하기'}
                    </Link>
                  </article>
                ))}
              </div>
            </section>
          )}

          <details className="rounded-admin-md border border-admin-border-mid bg-white p-5">
            <summary className="cursor-pointer text-admin-sm font-semibold text-admin-text-2">
              전문가용 상세 도구
            </summary>
            <p className="mt-2 text-admin-xs text-admin-muted">
              일반 운영에는 필요하지 않은 연결 검사, 자동화 제어, 상세 분석 화면입니다.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                ['/admin/marketing/system-health', '시스템 상태'],
                ['/admin/marketing/command-center', '승인과 실행 기록'],
                ['/admin/ad-os', '광고 자동화 상세'],
                ['/admin/marketing/content-hub', '콘텐츠 상세'],
                ['/admin/marketing/social-configs', '소셜 계정 연결'],
              ].map(([href, label]) => (
                <Link key={href} href={href} className="rounded-admin-sm border border-admin-border-strong bg-white px-4 py-2 text-admin-sm font-semibold text-admin-text-2 hover:bg-admin-bg">
                  {label}
                </Link>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
