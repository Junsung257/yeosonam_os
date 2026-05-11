'use client';

import { useMemo, useState, useTransition, useId } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { ArrowLeft, BookOpen, Save, AlertTriangle } from 'lucide-react';

export interface Policy {
  scope: string;
  enabled: boolean;
  posts_per_day: number;
  per_destination_daily_cap: number;
  slot_times: string[];
  product_ratio: number;
  multi_angle_count: number;
  multi_angle_gap_days: number;
  auto_trigger_card_news: boolean;
  auto_trigger_orchestrator: boolean;
  auto_regenerate_underperformers: boolean;
  daily_summary_webhook: string | null;
  meta?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

interface Props {
  initial: Policy[];
  configured: boolean;
}

const SLOT_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const SOFT_LIMIT_PER_DAY = 12; // SEO 안전선
const HARD_LIMIT_PER_DAY = 20;

function clampNumber(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampFloat(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export default function PoliciesClient({ initial, configured }: Props) {
  const [policies, setPolicies] = useState<Policy[]>(initial);
  const [activeScope, setActiveScope] = useState<string>(initial[0]?.scope ?? 'global');
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [slotTimesRaw, setSlotTimesRaw] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.map((p) => [p.scope, p.slot_times.join(', ')])),
  );

  const policy = useMemo(
    () => policies.find((p) => p.scope === activeScope) ?? null,
    [policies, activeScope],
  );

  // KPI 산식 (admin-dashboard-review §A — 단일 SSOT, 포함 결산 산식 명시)
  const kpi = useMemo(() => {
    if (!policy) return null;
    const total = policy.posts_per_day;
    const productCount = Math.round(total * policy.product_ratio);
    const infoCount = Math.max(0, total - productCount);
    const weeklyTotal = total * 7;
    const slotsCount = policy.slot_times.length;
    const overSoftLimit = total > SOFT_LIMIT_PER_DAY;
    const slotMismatch = slotsCount !== total;
    return { total, productCount, infoCount, weeklyTotal, slotsCount, overSoftLimit, slotMismatch };
  }, [policy]);

  // 입력 핸들러: scope-immutable 패치
  const patch = (next: Partial<Policy>) => {
    if (!policy) return;
    setPolicies((prev) =>
      prev.map((p) => (p.scope === policy.scope ? { ...p, ...next } : p)),
    );
  };

  const handleSlotTimesChange = (raw: string) => {
    if (!policy) return;
    setSlotTimesRaw((prev) => ({ ...prev, [policy.scope]: raw }));
    const parsed = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    patch({ slot_times: parsed });
  };

  const slotTimesValid = useMemo(() => {
    if (!policy) return true;
    if (policy.slot_times.length === 0) return false;
    return policy.slot_times.every((s) => SLOT_TIME_REGEX.test(s));
  }, [policy]);

  const webhookValid = useMemo(() => {
    if (!policy) return true;
    const w = policy.daily_summary_webhook;
    if (!w) return true;
    return /^https:\/\//.test(w);
  }, [policy]);

  const canSave = !!policy && slotTimesValid && webhookValid && !pending;

  const save = () => {
    if (!policy || !canSave) return;
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/publishing-policies', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope: policy.scope,
            enabled: policy.enabled,
            posts_per_day: policy.posts_per_day,
            per_destination_daily_cap: policy.per_destination_daily_cap,
            slot_times: policy.slot_times,
            product_ratio: policy.product_ratio,
            multi_angle_count: policy.multi_angle_count,
            multi_angle_gap_days: policy.multi_angle_gap_days,
            auto_trigger_card_news: policy.auto_trigger_card_news,
            auto_trigger_orchestrator: policy.auto_trigger_orchestrator,
            auto_regenerate_underperformers: policy.auto_regenerate_underperformers,
            daily_summary_webhook: policy.daily_summary_webhook,
          }),
        });
        const data = (await res.json()) as { item?: Policy; error?: string; actor?: string };
        if (!res.ok || data.error) {
          setMsg({ kind: 'err', text: data.error ?? `HTTP ${res.status}` });
          return;
        }
        if (data.item) {
          setPolicies((prev) => prev.map((p) => (p.scope === data.item!.scope ? data.item! : p)));
        }
        setMsg({ kind: 'ok', text: `저장 완료 (by ${data.actor ?? 'admin'})` });
      } catch (err) {
        setMsg({ kind: 'err', text: err instanceof Error ? err.message : '네트워크 오류' });
      }
    });
  };

  const ppdId = useId();
  const ratioId = useId();
  const capId = useId();
  const angleCountId = useId();
  const angleGapId = useId();
  const slotsId = useId();
  const slotsHelpId = useId();
  const webhookId = useId();
  const webhookHelpId = useId();
  const enabledId = useId();
  const cardNewsId = useId();
  const orchestratorId = useId();
  const regenId = useId();

  if (!configured) {
    return (
      <div className="space-y-4">
        <PageHeader title="발행 정책" subtitle="Supabase 미설정 — 환경 변수 점검 필요" />
        <div
          role="alert"
          className="admin-card p-4 text-admin-sm text-status-warningFg bg-status-warningBg border border-warning/30"
        >
          데이터 소스가 연결되어 있지 않습니다. <code>SUPABASE_URL</code> / <code>SUPABASE_SERVICE_ROLE_KEY</code> 확인.
        </div>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="space-y-4">
        <PageHeader title="발행 정책" subtitle="등록된 정책 없음" />
        <div className="admin-card p-4 text-admin-sm text-admin-text-2">
          <p className="mb-2">아직 publishing_policies 행이 없습니다.</p>
          <p className="text-admin-muted">
            <code>INSERT INTO publishing_policies (scope) VALUES (&apos;global&apos;);</code> 실행 후 재진입하세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader
        title="발행 정책 관리"
        subtitle="블로그/카드뉴스 자동 발행 빈도·분산·자동 트리거 (admin-guarded)"
        actions={
          <Link href="/admin/blog/queue">
            <Button variant="secondary" size="sm">
              <ArrowLeft size={14} aria-hidden="true" />
              발행 큐
            </Button>
          </Link>
        }
      />

      {/* Scope selector — 다중 scope 대비 (현재는 global 1개) */}
      {policies.length > 1 && (
        <nav aria-label="정책 scope 전환" className="flex gap-2">
          {policies.map((p) => (
            <button
              key={p.scope}
              type="button"
              onClick={() => setActiveScope(p.scope)}
              aria-pressed={p.scope === activeScope}
              className={`h-8 px-3 text-admin-xs rounded-admin-sm border transition-colors ${
                p.scope === activeScope
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-admin-border-mid text-admin-text-2 hover:bg-admin-bg'
              }`}
            >
              {p.scope}
            </button>
          ))}
        </nav>
      )}

      {/* KPI 산식 카드 — admin-dashboard-review §A·§D 준수 (Few/Tufte: 데이터-잉크 비율 최대) */}
      {kpi && (
        <section
          aria-label="현재 정책 KPI 산식"
          className="admin-card p-4 grid grid-cols-2 sm:grid-cols-4 gap-3"
        >
          <KpiCell label="하루 발행" value={`${kpi.total} 편`} sub={`주 ${kpi.weeklyTotal}편`} />
          <KpiCell label="정보성" value={`${kpi.infoCount} 편`} sub={`= total − product`} />
          <KpiCell label="상품" value={`${kpi.productCount} 편`} sub={`= total × ratio`} />
          <KpiCell
            label="슬롯 시각"
            value={`${kpi.slotsCount} 개`}
            sub={kpi.slotMismatch ? `≠ posts_per_day(${kpi.total})` : '= posts_per_day'}
            warn={kpi.slotMismatch}
          />
        </section>
      )}

      {kpi?.overSoftLimit && (
        <div
          role="status"
          className="flex items-start gap-2 text-admin-xs text-status-warningFg bg-status-warningBg border border-warning/30 rounded-admin-sm p-2.5"
        >
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            하루 {kpi.total}편은 SEO 안전선({SOFT_LIMIT_PER_DAY}편/일)을 초과합니다. thin-content 위험 — quality_gate 실패 누적 시
            도메인 점수 하락 가능.
          </span>
        </div>
      )}

      <form
        className="admin-card p-5 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {/* posts_per_day */}
        <Field
          id={ppdId}
          label="하루 발행 편수"
          help={`SEO 안전선 8-12편/일. soft cap=${SOFT_LIMIT_PER_DAY}, hard cap=${HARD_LIMIT_PER_DAY}.`}
        >
          <input
            id={ppdId}
            type="number"
            min={1}
            max={HARD_LIMIT_PER_DAY}
            value={policy.posts_per_day}
            onChange={(e) => patch({ posts_per_day: clampNumber(e.target.value, 1, HARD_LIMIT_PER_DAY, policy.posts_per_day) })}
            className="w-24 h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
        </Field>

        {/* product_ratio */}
        <Field
          id={ratioId}
          label="상품 블로그 비율"
          help="전체 발행 중 상품 콘텐츠 비중 (0.00 ~ 1.00). 상품 대비 정보성 분산 조절."
        >
          <input
            id={ratioId}
            type="number"
            step={0.05}
            min={0}
            max={1}
            value={policy.product_ratio}
            onChange={(e) => patch({ product_ratio: clampFloat(e.target.value, 0, 1, policy.product_ratio) })}
            className="w-24 h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
        </Field>

        {/* per_destination_daily_cap */}
        <Field
          id={capId}
          label="목적지별 1일 최대 편수"
          help="같은 destination 노출 분산 (cannibalization 방지). 권장 2-3."
        >
          <input
            id={capId}
            type="number"
            min={1}
            max={20}
            value={policy.per_destination_daily_cap}
            onChange={(e) =>
              patch({ per_destination_daily_cap: clampNumber(e.target.value, 1, 20, policy.per_destination_daily_cap) })
            }
            className="w-24 h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
        </Field>

        {/* multi_angle */}
        <fieldset className="border-t border-admin-border pt-4">
          <legend className="text-admin-xs font-semibold text-admin-text-2 mb-2 px-1">
            신규 상품 Multi-Angle Drip
          </legend>
          <div className="grid grid-cols-2 gap-4">
            <Field
              id={angleCountId}
              label="상품당 angle 개수"
              help="1상품 → N개 각도(가성비/스토리/현지...) 자동 큐잉."
            >
              <input
                id={angleCountId}
                type="number"
                min={1}
                max={10}
                value={policy.multi_angle_count}
                onChange={(e) =>
                  patch({ multi_angle_count: clampNumber(e.target.value, 1, 10, policy.multi_angle_count) })
                }
                className="w-20 h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
              />
            </Field>
            <Field
              id={angleGapId}
              label="angle 간 간격 (일)"
              help="같은 상품 다른 각도 발행 간격 (SEO dedup 윈도와 정합)."
            >
              <input
                id={angleGapId}
                type="number"
                min={1}
                max={30}
                value={policy.multi_angle_gap_days}
                onChange={(e) =>
                  patch({ multi_angle_gap_days: clampNumber(e.target.value, 1, 30, policy.multi_angle_gap_days) })
                }
                className="w-20 h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
              />
            </Field>
          </div>
        </fieldset>

        {/* slot_times */}
        <Field
          id={slotsId}
          label="슬롯 시간 (KST)"
          help="하루 안에 분산 발행할 시각. 콤마 구분, HH:MM 24h 형식."
          helpId={slotsHelpId}
          error={!slotTimesValid ? '모든 항목이 HH:MM 형식이어야 하며 1개 이상 필요합니다.' : undefined}
        >
          <input
            id={slotsId}
            type="text"
            inputMode="text"
            aria-describedby={slotsHelpId}
            aria-invalid={!slotTimesValid}
            value={slotTimesRaw[policy.scope] ?? policy.slot_times.join(', ')}
            onChange={(e) => handleSlotTimesChange(e.target.value)}
            className={`w-full h-9 px-3 text-admin-sm border rounded-admin-sm bg-admin-surface text-admin-text font-mono focus:outline-none focus:shadow-admin-focus transition-colors ${
              slotTimesValid ? 'border-admin-border-mid focus:border-brand' : 'border-danger focus:border-danger'
            }`}
          />
        </Field>

        {/* 자동 트리거 (cost 발생) */}
        <fieldset className="border-t border-admin-border pt-4 space-y-2">
          <legend className="text-admin-xs font-semibold text-admin-text-2 mb-1 px-1">
            상품 승인 시 자동 트리거 (cost 발생)
          </legend>

          <Toggle
            id={cardNewsId}
            checked={policy.auto_trigger_card_news}
            onChange={(v) => patch({ auto_trigger_card_news: v })}
            label="카드뉴스 5변형 자동 생성"
            sub="DeepSeek V4 Flash — llm-gateway task='card-news'"
          />
          <Toggle
            id={orchestratorId}
            checked={policy.auto_trigger_orchestrator}
            onChange={(v) => patch({ auto_trigger_orchestrator: v })}
            label="7플랫폼 콘텐츠 일괄 생성"
            sub="IG/Threads/Meta Ads/Google RSA/카카오/블로그 fan-out"
          />
          <Toggle
            id={regenId}
            checked={policy.auto_regenerate_underperformers}
            onChange={(v) => patch({ auto_regenerate_underperformers: v })}
            label="저성과 글 자동 재생성 (7일 GSC 클릭 0건)"
            sub="매일 09 KST 최대 5건 — Gemini fallback 시 무료"
          />
        </fieldset>

        {/* Webhook */}
        <Field
          id={webhookId}
          label="일일 발행 요약 Webhook"
          help="Slack/Discord webhook URL — 매일 09 KST 발송. 비워두면 발송 X."
          helpId={webhookHelpId}
          error={!webhookValid ? 'https:// 로 시작하는 URL 만 허용됩니다.' : undefined}
        >
          <input
            id={webhookId}
            type="url"
            aria-describedby={webhookHelpId}
            aria-invalid={!webhookValid}
            value={policy.daily_summary_webhook ?? ''}
            onChange={(e) => patch({ daily_summary_webhook: e.target.value || null })}
            placeholder="https://hooks.slack.com/services/..."
            className={`w-full h-9 px-3 text-admin-xs border rounded-admin-sm bg-admin-surface text-admin-text font-mono focus:outline-none focus:shadow-admin-focus transition-colors ${
              webhookValid ? 'border-admin-border-mid focus:border-brand' : 'border-danger focus:border-danger'
            }`}
          />
        </Field>

        {/* enabled */}
        <div className="flex items-center gap-2 border-t border-admin-border pt-4">
          <input
            id={enabledId}
            type="checkbox"
            checked={policy.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          <label htmlFor={enabledId} className="text-admin-xs text-admin-text-2">
            정책 활성 (off 시 publisher cron 이 이 scope를 무시)
          </label>
        </div>

        <div className="flex justify-end items-center gap-3 border-t border-admin-border pt-4">
          {msg && (
            <span
              role={msg.kind === 'err' ? 'alert' : 'status'}
              className={`text-admin-xs ${msg.kind === 'err' ? 'text-danger' : 'text-status-successFg'}`}
            >
              {msg.kind === 'err' ? '❌ ' : '✅ '}
              {msg.text}
            </span>
          )}
          <Button type="submit" variant="primary" disabled={!canSave}>
            <Save size={14} aria-hidden="true" />
            {pending ? '저장 중…' : '저장'}
          </Button>
        </div>
      </form>

      {/* SEO 안전선 가이드 — 강조 색상은 화면당 1곳 (Few §B) */}
      <aside
        aria-labelledby="seo-guide-heading"
        className="bg-admin-bg border border-admin-border rounded-admin-md p-3 text-admin-xs text-admin-text-2"
      >
        <p id="seo-guide-heading" className="font-semibold mb-1.5 inline-flex items-center gap-1.5">
          <BookOpen size={12} aria-hidden="true" />
          SEO 안전선 가이드
        </p>
        <ul className="list-disc list-inside space-y-0.5 leading-relaxed">
          <li>
            하루 <span className="admin-num">8-12</span>편 — Google·Naver 모두 안전.
          </li>
          <li>
            같은 destination 1일 <span className="admin-num">2-3</span>편 이상 발행 시 카니발리제이션 위험.
          </li>
          <li>
            multi-angle <span className="admin-num">5</span>각도 × <span className="admin-num">3</span>일 간격 = <span className="admin-num">12-15</span>일 분산 (14일 dedup 윈도와 정합).
          </li>
          <li>quality_gate 실패 누적 시 오히려 도메인 점수 하락.</li>
        </ul>
      </aside>
    </div>
  );
}

// ─── 작은 UI 헬퍼 ────────────────────────────────────────────

function Field({
  id,
  label,
  help,
  helpId,
  error,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  helpId?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const autoHelpId = useId();
  const resolvedHelpId = helpId ?? autoHelpId;
  return (
    <div>
      <label htmlFor={id} className="text-admin-xs font-semibold text-admin-text-2 block">
        {label}
      </label>
      {help && (
        <p id={resolvedHelpId} className="text-[10px] text-admin-muted-2 mb-1">
          {help}
        </p>
      )}
      {children}
      {error && (
        <p role="alert" className="text-[11px] text-danger mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

function KpiCell({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-admin-muted-2">{label}</p>
      <p className={`text-admin-lg font-semibold admin-num ${warn ? 'text-status-warningFg' : 'text-admin-text'}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-admin-muted">{sub}</p>}
    </div>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  label,
  sub,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
}) {
  const subId = useId();
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-2 cursor-pointer hover:bg-admin-bg p-1.5 rounded transition-colors"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={sub ? subId : undefined}
        className="mt-0.5"
      />
      <div className="flex-1">
        <span className="text-admin-xs text-admin-text-2">{label}</span>
        {sub && (
          <p id={subId} className="text-[10px] text-admin-muted-2">
            {sub}
          </p>
        )}
      </div>
    </label>
  );
}
