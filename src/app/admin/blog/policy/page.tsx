'use client';

/**
 * /admin/blog/policy — 발행 정책 조절 (어드민)
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';

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

export default function PolicyPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/admin/publishing-policy?scope=global')
      .then(r => r.json())
      .then(d => setPolicy(d.items?.[0] || null));
  }, []);

  const update = (patch: Partial<Policy>) => {
    if (!policy) return;
    setPolicy({ ...policy, ...patch });
  };

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
        setMsg('❌ ' + data.error);
      } else {
        setMsg('✅ 저장 완료. 다음 스케줄러 실행부터 적용됩니다.');
      }
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 5000);
    }
  };

  if (!policy) return <div className="text-slate-400 text-[13px]">로딩...</div>;

  const dailyTotal = policy.posts_per_day;
  const product = Math.round(dailyTotal * policy.product_ratio);
  const info = dailyTotal - product;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-slate-800">발행 정책 (Global)</h1>
          <p className="text-[12px] text-slate-400 mt-0.5">
            정보성/상품 발행 빈도, destination 제한, multi-angle 분산 설정
          </p>
        </div>
        <Link href="/admin/blog/queue" className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-[12px] rounded-lg hover:bg-slate-50">
          ← 큐
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
        {/* posts_per_day */}
        <div>
          <label className="text-[12px] font-semibold text-slate-700">하루 발행 편수</label>
          <p className="text-[10px] text-slate-400 mb-1">SEO 안전선 8-12편/일. 12편 이상은 thin content 위험</p>
          <input
            type="number" min="1" max="20"
            value={policy.posts_per_day}
            onChange={e => update({ posts_per_day: parseInt(e.target.value) })}
            className="w-24 px-3 py-2 text-[13px] border border-slate-300 rounded"
          />
          <span className="ml-3 text-[11px] text-slate-500">→ 정보성 {info}편 + 상품 {product}편</span>
        </div>

        {/* product_ratio */}
        <div>
          <label className="text-[12px] font-semibold text-slate-700">상품 블로그 비율</label>
          <p className="text-[10px] text-slate-400 mb-1">전체 발행 중 상품 블로그 비중 (0.0 ~ 1.0)</p>
          <input
            type="number" step="0.05" min="0" max="1"
            value={policy.product_ratio}
            onChange={e => update({ product_ratio: parseFloat(e.target.value) })}
            className="w-24 px-3 py-2 text-[13px] border border-slate-300 rounded"
          />
        </div>

        {/* per_destination_daily_cap */}
        <div>
          <label className="text-[12px] font-semibold text-slate-700">목적지별 1일 최대 편수</label>
          <p className="text-[10px] text-slate-400 mb-1">같은 destination 노출 분산 (카니발리제이션 방지). 권장 2-3</p>
          <input
            type="number" min="1" max="5"
            value={policy.per_destination_daily_cap}
            onChange={e => update({ per_destination_daily_cap: parseInt(e.target.value) })}
            className="w-24 px-3 py-2 text-[13px] border border-slate-300 rounded"
          />
        </div>

        {/* multi_angle */}
        <div className="border-t border-slate-100 pt-4">
          <p className="text-[12px] font-semibold text-slate-700 mb-2">신규 상품 Multi-Angle Drip</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-600">상품당 angle 개수</label>
              <p className="text-[10px] text-slate-400 mb-1">1상품 → N개 각도(가성비/스토리/현지...) 자동 큐잉</p>
              <input
                type="number" min="1" max="7"
                value={policy.multi_angle_count}
                onChange={e => update({ multi_angle_count: parseInt(e.target.value) })}
                className="w-20 px-3 py-2 text-[13px] border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-600">angle 간 간격 (일)</label>
              <p className="text-[10px] text-slate-400 mb-1">같은 상품 다른 각도 발행 간격 (SEO dedup 안전)</p>
              <input
                type="number" min="1" max="14"
                value={policy.multi_angle_gap_days}
                onChange={e => update({ multi_angle_gap_days: parseInt(e.target.value) })}
                className="w-20 px-3 py-2 text-[13px] border border-slate-300 rounded"
              />
            </div>
          </div>
        </div>

        {/* slot_times */}
        <div className="border-t border-slate-100 pt-4">
          <label className="text-[12px] font-semibold text-slate-700">슬롯 시간 (KST)</label>
          <p className="text-[10px] text-slate-400 mb-1">하루 안에 분산 발행할 시각. 콤마 구분, HH:MM 형식</p>
          <input
            type="text"
            value={policy.slot_times.join(', ')}
            onChange={e => update({ slot_times: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            className="w-full px-3 py-2 text-[13px] border border-slate-300 rounded font-mono"
          />
        </div>

        {/* 자동 트리거 (cost 발생) */}
        <div className="border-t border-slate-100 pt-4 space-y-2">
          <p className="text-[12px] font-semibold text-slate-700 mb-2">상품 승인 시 자동 트리거 (cost 발생)</p>

          <label className="flex items-start gap-2 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
            <input type="checkbox"
              checked={policy.auto_trigger_card_news}
              onChange={e => update({ auto_trigger_card_news: e.target.checked })}
              className="mt-0.5"
            />
            <div className="flex-1">
              <span className="text-[12px] text-slate-700">🎴 카드뉴스 5변형 자동 생성</span>
              <p className="text-[10px] text-slate-400">Claude Sonnet — 건당 ~$0.05 (월 50상품 = ~$2.5)</p>
            </div>
          </label>

          <label className="flex items-start gap-2 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
            <input type="checkbox"
              checked={policy.auto_trigger_orchestrator}
              onChange={e => update({ auto_trigger_orchestrator: e.target.checked })}
              className="mt-0.5"
            />
            <div className="flex-1">
              <span className="text-[12px] text-slate-700">🚀 7플랫폼 콘텐츠 일괄 생성 (IG/Threads/Meta Ads/Google RSA/카카오/블로그)</span>
              <p className="text-[10px] text-slate-400">Gemini + Claude — 건당 ~$0.02 (월 50상품 = ~$1)</p>
            </div>
          </label>

          <label className="flex items-start gap-2 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
            <input type="checkbox"
              checked={policy.auto_regenerate_underperformers}
              onChange={e => update({ auto_regenerate_underperformers: e.target.checked })}
              className="mt-0.5"
            />
            <div className="flex-1">
              <span className="text-[12px] text-slate-700">🔁 저성과 글 자동 재생성 (7일 GSC 클릭 0건)</span>
              <p className="text-[10px] text-slate-400">매일 09 KST 최대 5건 — 무료 (Gemini)</p>
            </div>
          </label>
        </div>

        {/* Webhook */}
        <div className="border-t border-slate-100 pt-4">
          <label className="text-[12px] font-semibold text-slate-700">일일 발행 요약 Webhook</label>
          <p className="text-[10px] text-slate-400 mb-1">Slack/Discord webhook URL — 매일 09 KST 발송. 비워두면 발송 X</p>
          <input
            type="text"
            value={policy.daily_summary_webhook || ''}
            onChange={e => update({ daily_summary_webhook: e.target.value || null })}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full px-3 py-2 text-[12px] border border-slate-300 rounded font-mono"
          />
        </div>

        {/* enabled */}
        <div className="flex items-center gap-2 border-t border-slate-100 pt-4">
          <input
            type="checkbox" id="enabled"
            checked={policy.enabled}
            onChange={e => update({ enabled: e.target.checked })}
          />
          <label htmlFor="enabled" className="text-[12px] text-slate-700">정책 활성</label>
        </div>

        <div className="flex justify-end items-center gap-3 border-t border-slate-100 pt-4">
          {msg && <span className="text-[11px] text-slate-600">{msg}</span>}
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-indigo-600 text-white text-[13px] rounded font-semibold disabled:opacity-50"
          >
            {saving ? '저장중...' : '저장'}
          </button>
        </div>
      </div>

      {/* 안내 */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-800">
        <p className="font-semibold mb-1">📚 SEO 안전선 가이드</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>하루 8-12편 — Google·Naver 모두 안전. 양보다 품질 우선</li>
          <li>같은 destination 1일 2-3편 이상 발행 시 카니발리제이션 위험</li>
          <li>multi-angle 5각도 × 3일 간격 = 12-15일 분산 (14일 dedup 윈도와 정합)</li>
          <li>최대 발행 노렸다가 quality_gate 실패 누적되면 오히려 도메인 점수 하락</li>
        </ul>
      </div>
    </div>
  );
}
