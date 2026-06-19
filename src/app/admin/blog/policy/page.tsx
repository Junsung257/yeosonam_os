'use client';

/**
 * /admin/blog/policy — 발행 정책 조절 (어드민)
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Activity, AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, ListChecks } from 'lucide-react';

interface Policy {
  id: number;
  scope: string;
  posts_per_day: number;
  per_destination_daily_cap: number;
  slot_times: string[];
  product_ratio: number;
  multi_angle_count: number;
  multi_angle_gap_days: number;
  enabled: boolean;
  auto_trigger_card_news: boolean;
  auto_trigger_orchestrator: boolean;
  auto_regenerate_underperformers: boolean;
  daily_summary_webhook: string | null;
}

interface OpsSummary {
  publish: {
    published_today: number;
    daily_target: number;
    remaining_today: number;
    per_destination_daily_cap: number | null;
    product_ratio: number | null;
    slot_times: string[];
  };
  queue: {
    active_count: number;
    counts: Record<string, number>;
    overdue_queued: number;
  };
  contract: { passed: boolean; failed_checks: string[] };
}

export default function PolicyPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [ops, setOps] = useState<OpsSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [loadErr, setLoadErr] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/publishing-policy?scope=global'),
      fetch('/api/admin/blog/ops-summary', { cache: 'no-store' }).catch(() => null),
    ])
      .then(async ([r, opsRes]) => {
        if (!r.ok) throw new Error('API ' + r.status);
        const policyJson = await r.json();
        if (opsRes?.ok) {
          const opsJson = await opsRes.json().catch(() => null);
          if (opsJson?.ok !== false) setOps(opsJson as OpsSummary);
        }
        return policyJson;
      })
      .then(d => {
        if (d.error) throw new Error(d.error);
        setPolicy(d.items?.[0] || null);
      })
      .catch(err => {
        console.error('Policy load error:', err);
        setLoadErr(err.message);
      });
  }, []);

  if (!policy && !loadErr) return <div className="text-admin-muted-2 text-admin-sm">로딩...</div>;
  if (!policy && loadErr) return (
    <div className="text-center py-16 max-w-md mx-auto space-y-3">
      <p className="text-admin-sm text-red-400">정책 로드 실패</p>
      <p className="text-[11px] text-admin-muted-2">{loadErr}</p>
      <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>다시 시도</Button>
    </div>
  );

  const update = (patch: Partial<Policy>) => {
    if (!policy) return;
    setPolicy({ ...policy, ...patch });
  };

  const dailyTotal = policy!.posts_per_day;
  const product = Math.round(dailyTotal * policy!.product_ratio);
  const info = dailyTotal - product;
  const queuePressure = ops ? Math.max(0, ops.queue.active_count - dailyTotal) : 0;

  const save = async () => {
    if (!policy) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/publishing-policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: policy.scope,
          posts_per_day: policy.posts_per_day,
          per_destination_daily_cap: policy.per_destination_daily_cap,
          slot_times: policy.slot_times,
          product_ratio: policy.product_ratio,
          multi_angle_count: policy.multi_angle_count,
          multi_angle_gap_days: policy.multi_angle_gap_days,
          enabled: policy.enabled,
          auto_trigger_card_news: policy.auto_trigger_card_news,
          auto_trigger_orchestrator: policy.auto_trigger_orchestrator,
          auto_regenerate_underperformers: policy.auto_regenerate_underperformers,
          daily_summary_webhook: policy.daily_summary_webhook,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg('X ' + data.error);
      } else {
        setMsg('O 저장 완료. 다음 스케줄러 실행부터 적용됩니다.');
      }
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 5000);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader
        title="발행 정책"
        subtitle="정보성/상품 발행 빈도, 목적지별 제한, 여러 각도 분산 발행 설정"
        actions={
          <Link href="/admin/blog/queue">
            <Button variant="secondary" size="sm">
              <ArrowLeft size={14} />
              발행 큐
            </Button>
          </Link>
        }
      />

      {ops && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['오늘 발행', `${ops.publish.published_today}/${ops.publish.daily_target}`, ops.publish.remaining_today ? `남은 ${ops.publish.remaining_today}편` : '목표 달성', Activity, ops.publish.remaining_today ? 'text-danger' : 'text-success'],
            ['큐 압력', queuePressure.toLocaleString('ko-KR'), queuePressure ? '현재 정책보다 큐가 많음' : '정책 범위 안', ListChecks, queuePressure ? 'text-warning' : 'text-success'],
            ['실패 큐', `${ops.queue.counts.failed || 0}`, `지연 ${ops.queue.overdue_queued}`, AlertTriangle, (ops.queue.counts.failed || 0) ? 'text-danger' : 'text-success'],
            ['계약 상태', ops.contract.passed ? '통과' : '점검', ops.contract.failed_checks.join(', ') || '정상', CheckCircle2, ops.contract.passed ? 'text-success' : 'text-danger'],
          ].map(([label, value, hint, Icon, tone]) => (
            <div key={String(label)} className="admin-card p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-admin-xs font-semibold uppercase tracking-wider text-admin-muted">{String(label)}</p>
                <Icon size={15} className="text-admin-muted-2" />
              </div>
              <p className={`mt-2 text-admin-display font-bold admin-num ${tone}`}>{String(value)}</p>
              <p className="mt-1 text-admin-xs leading-5 text-admin-muted">{String(hint)}</p>
            </div>
          ))}
        </section>
      )}

      <section className="admin-card p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">현재 정책 미리보기</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              다음 스케줄러 실행부터 하루 {dailyTotal}편, 정보성 {info}편, 상품 {product}편 기준으로 큐 슬롯을 잡습니다.
            </p>
          </div>
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">목적지 분산</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              목적지별 하루 최대 {policy!.per_destination_daily_cap}편입니다. 같은 여행지 반복 발행과 키워드 잠식을 줄이는 안전장치입니다.
            </p>
          </div>
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">운영 기준</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              정책 저장만으로 완료가 아닙니다. 블로그 OS 홈에서 발행 목표, 품질 계약, 색인 상태가 같이 통과해야 완료입니다.
            </p>
          </div>
        </div>
      </section>

      <div className="admin-card p-5 space-y-4">
        {/* posts_per_day */}
        <div>
          <label htmlFor="blog-policy-posts-per-day" className="text-admin-xs font-semibold text-admin-text-2">하루 발행 편수</label>
          <p className="text-[10px] text-admin-muted-2 mb-1">검색 안전선 8-12편/일. 12편 이상은 얇은 글이 늘어날 위험이 있습니다.</p>
          <input
            id="blog-policy-posts-per-day"
            type="number" min="1" max="20"
            value={policy!.posts_per_day}
            onChange={e => update({ posts_per_day: parseInt(e.target.value) })}
            className="w-24 h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
          <span className="ml-3 text-[11px] text-admin-muted">{'>'} 정보성 {info}편 + 상품 {product}편</span>
        </div>

        {/* product_ratio */}
        <div>
          <label htmlFor="blog-policy-product-ratio" className="text-admin-xs font-semibold text-admin-text-2">상품 블로그 비율</label>
          <p className="text-[10px] text-admin-muted-2 mb-1">전체 발행 중 상품 블로그 비중 (0.0 ~ 1.0)</p>
          <input
            id="blog-policy-product-ratio"
            type="number" step="0.05" min="0" max="1"
            value={policy!.product_ratio}
            onChange={e => update({ product_ratio: parseFloat(e.target.value) })}
            className="w-24 h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
        </div>

        {/* per_destination_daily_cap */}
        <div>
          <label htmlFor="blog-policy-destination-cap" className="text-admin-xs font-semibold text-admin-text-2">목적지별 1일 최대 편수</label>
          <p className="text-[10px] text-admin-muted-2 mb-1">같은 목적지 반복 노출 분산. 권장 2-3편</p>
          <input
            id="blog-policy-destination-cap"
            type="number" min="1" max="5"
            value={policy!.per_destination_daily_cap}
            onChange={e => update({ per_destination_daily_cap: parseInt(e.target.value) })}
            className="w-24 h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
        </div>

        {/* multi_angle */}
        <div className="border-t border-admin-border pt-4">
          <p className="text-admin-xs font-semibold text-admin-text-2 mb-2">신규 상품 여러 각도 분산 발행</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="blog-policy-angles-per-product" className="text-[11px] text-admin-muted">상품당 발행 각도 수</label>
              <p className="text-[10px] text-admin-muted-2 mb-1">1상품 {'>'} N개 각도(가성비/스토리/현지...) 자동 큐잉</p>
              <input
                id="blog-policy-angles-per-product"
                type="number" min="1" max="7"
                value={policy!.multi_angle_count}
                onChange={e => update({ multi_angle_count: parseInt(e.target.value) })}
                className="w-20 h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
              />
            </div>
            <div>
              <label htmlFor="blog-policy-angle-gap-days" className="text-[11px] text-admin-muted">각도별 발행 간격 (일)</label>
              <p className="text-[10px] text-admin-muted-2 mb-1">같은 상품을 다른 주제로 발행할 때의 최소 간격</p>
              <input
                id="blog-policy-angle-gap-days"
                type="number" min="1" max="14"
                value={policy!.multi_angle_gap_days}
                onChange={e => update({ multi_angle_gap_days: parseInt(e.target.value) })}
                className="w-20 h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
              />
            </div>
          </div>
        </div>

        {/* slot_times */}
        <div className="border-t border-admin-border pt-4">
          <label htmlFor="blog-policy-slot-times" className="text-admin-xs font-semibold text-admin-text-2">슬롯 시간 (KST)</label>
          <p className="text-[10px] text-admin-muted-2 mb-1">하루 안에 분산 발행할 시각. 콤마 구분, HH:MM 형식</p>
          <input
            id="blog-policy-slot-times"
            type="text"
            value={policy!.slot_times.join(', ')}
            onChange={e => update({ slot_times: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            className="w-full h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text font-mono focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
        </div>

        {/* 자동 트리거 (cost 발생) */}
        <div className="border-t border-admin-border pt-4 space-y-2">
          <p className="text-admin-xs font-semibold text-admin-text-2 mb-2">상품 승인 시 자동 실행 (비용 발생 가능)</p>

          <label className="flex items-start gap-2 cursor-pointer hover:bg-admin-bg p-1.5 rounded">
            <input type="checkbox"
              aria-label="카드뉴스 5변형 자동 생성"
              checked={policy!.auto_trigger_card_news}
              onChange={e => update({ auto_trigger_card_news: e.target.checked })}
              className="mt-0.5"
            />
            <div className="flex-1">
              <span className="text-admin-xs text-admin-text-2">카드뉴스 5변형 자동 생성</span>
              <p className="text-[10px] text-admin-muted-2">Claude Sonnet — 건당 ~$0.05 (월 50상품 = ~$2.5)</p>
            </div>
          </label>

          <label className="flex items-start gap-2 cursor-pointer hover:bg-admin-bg p-1.5 rounded">
            <input type="checkbox"
              aria-label="7플랫폼 콘텐츠 일괄 생성"
              checked={policy!.auto_trigger_orchestrator}
              onChange={e => update({ auto_trigger_orchestrator: e.target.checked })}
              className="mt-0.5"
            />
            <div className="flex-1">
              <span className="text-admin-xs text-admin-text-2">7플랫폼 콘텐츠 일괄 생성 (IG/Threads/Meta Ads/Google RSA/카카오/블로그)</span>
              <p className="text-[10px] text-admin-muted-2">Gemini + Claude — 건당 ~$0.02 (월 50상품 = ~$1)</p>
            </div>
          </label>

          <label className="flex items-start gap-2 cursor-pointer hover:bg-admin-bg p-1.5 rounded">
            <input type="checkbox"
              aria-label="성과 낮은 콘텐츠 자동 재생성"
              checked={policy!.auto_regenerate_underperformers}
              onChange={e => update({ auto_regenerate_underperformers: e.target.checked })}
              className="mt-0.5"
            />
            <div className="flex-1">
              <span className="text-admin-xs text-admin-text-2">저성과 글 자동 재생성 (7일 구글 클릭 0건)</span>
              <p className="text-[10px] text-admin-muted-2">매일 09 KST 최대 5건 — 무료 (Gemini)</p>
            </div>
          </label>
        </div>

        {/* Webhook */}
        <div className="border-t border-admin-border pt-4">
          <label htmlFor="blog-policy-notification-email" className="text-admin-xs font-semibold text-admin-text-2">일일 발행 요약 알림 주소</label>
          <p className="text-[10px] text-admin-muted-2 mb-1">Slack/Discord 알림 주소. 매일 09시(KST) 발송하며 비워두면 발송하지 않습니다.</p>
          <input
            id="blog-policy-notification-email"
            type="text"
            value={policy!.daily_summary_webhook || ''}
            onChange={e => update({ daily_summary_webhook: e.target.value || null })}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full h-9 px-3 text-admin-xs border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text font-mono focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
        </div>

        {/* enabled */}
        <div className="flex items-center gap-2 border-t border-admin-border pt-4">
          <input
            type="checkbox" id="enabled"
            checked={policy!.enabled}
            onChange={e => update({ enabled: e.target.checked })}
          />
          <label htmlFor="enabled" className="text-admin-xs text-admin-text-2">정책 활성</label>
        </div>

        <div className="flex justify-end items-center gap-3 border-t border-admin-border pt-4">
          {msg && <span className="text-admin-xs text-admin-muted">{msg}</span>}
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </Button>
        </div>
      </div>

      {/* 안내 */}
      <div className="bg-status-warningBg border border-warning/20 rounded-admin-md p-3 text-admin-xs text-status-warningFg">
        <p className="font-semibold mb-1.5 inline-flex items-center gap-1.5">
          <BookOpen size={12} />
          검색 안전선 가이드
        </p>
        <ul className="list-disc list-inside space-y-0.5 leading-relaxed opacity-90">
          <li>하루 <span className="admin-num">8-12</span>편 — 구글/네이버 모두 양보다 품질이 우선입니다.</li>
          <li>같은 목적지를 하루 <span className="admin-num">2-3</span>편 이상 발행하면 키워드 잠식 위험이 커집니다.</li>
          <li>여러 각도 <span className="admin-num">5</span>개 x <span className="admin-num">3</span>일 간격 = <span className="admin-num">12-15</span>일 분산 발행</li>
          <li>최대 발행 노렸다가 quality_gate 실패 누적되면 오히려 도메인 점수 하락</li>
        </ul>
      </div>
    </div>
  );
}
