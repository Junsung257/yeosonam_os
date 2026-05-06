'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Variant {
  id: string;
  title: string;
  status: 'DRAFT' | 'CONFIRMED' | 'LAUNCHED' | 'ARCHIVED';
  variant_angle: string | null;
  variant_score: number | null;
  variant_score_detail: {
    cards?: Array<{ index: number; score: number; issues: Array<{ severity: string; problem: string }> }>;
    dimensions?: Record<string, number>;
    verdict?: string;
    summary?: string;
    criticCostUsd?: number;
  } | null;
  engagement_score: number | null;
  is_winner: boolean;
  ig_publish_status: string | null;
  ig_slide_urls: string[] | null;
  html_generated: string | null;
  html_usage: { costUsd?: number } | null;
  created_at: string;
}

const ANGLE_LABELS: Record<string, string> = {
  luxury: '럭셔리',
  value: '가성비',
  urgency: '긴급/마감',
  emotional: '감성',
  filial: '효도',
  activity: '액티비티',
  food: '미식',
};

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-slate-400">평가 없음</span>;
  let bg = 'bg-red-100 text-red-700';
  if (score >= 80) bg = 'bg-emerald-100 text-emerald-700';
  else if (score >= 65) bg = 'bg-amber-100 text-amber-700';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${bg}`}>
      {score.toFixed(0)} / 100
    </span>
  );
}

function VerdictPill({ verdict }: { verdict: string | undefined }) {
  if (!verdict) return null;
  const map: Record<string, { label: string; cls: string }> = {
    ship_as_is: { label: '✓ 즉시 발행 OK', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    minor_polish: { label: '미세 보정 권장', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    regenerate: { label: '재생성 권장', cls: 'bg-red-50 text-red-700 border-red-200' },
  };
  const v = map[verdict] ?? { label: verdict, cls: 'bg-slate-50 text-slate-700 border-slate-200' };
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-medium ${v.cls}`}>
      {v.label}
    </span>
  );
}

export default function VariantGroupComparePage() {
  const router = useRouter();
  const params = useParams<{ group_id: string }>();
  const groupId = params.group_id;

  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderingId, setRenderingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [decidingWinner, setDecidingWinner] = useState(false);
  const [winnerReport, setWinnerReport] = useState<{
    decided: boolean;
    reason: string;
    winner?: { id: string; variant_angle: string | null } | null;
    archived_ids?: string[];
  } | null>(null);

  const fetchVariants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/card-news/generate-variants?group_id=${groupId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `로드 실패`);
      setVariants(data.variants ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '로드 실패');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    fetchVariants();
  }, [fetchVariants]);

  const handleRender = async (id: string) => {
    setRenderingId(id);
    try {
      const res = await fetch(`/api/card-news/${id}/render-html-to-png`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scale: 2 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `렌더 실패`);
      await fetchVariants();
      alert(`PNG ${(data.renders ?? []).filter((r: { url?: string }) => r.url).length}/6 렌더 완료`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '렌더 실패');
    } finally {
      setRenderingId(null);
    }
  };

  const handleDecideWinner = async (archiveLosers: boolean) => {
    if (
      archiveLosers &&
      !confirm('Winner 외 변형을 모두 ARCHIVED 처리합니다. 계속할까요?')
    )
      return;
    setDecidingWinner(true);
    setWinnerReport(null);
    try {
      const res = await fetch(
        `/api/card-news/variants/${groupId}/decide-winner`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archiveLosers, dryRun: false }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'winner 결정 실패');
      setWinnerReport({
        decided: data.decided,
        reason: data.reason,
        winner: data.winner ?? null,
        archived_ids: data.archived_ids ?? [],
      });
      if (data.decided) await fetchVariants();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'winner 결정 실패');
    } finally {
      setDecidingWinner(false);
    }
  };

  const handleArchive = async (id: string) => {
    if (!confirm('이 변형을 ARCHIVED 처리할까요?')) return;
    setArchivingId(id);
    try {
      const res = await fetch(`/api/card-news/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ARCHIVED' }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'archive 실패');
      }
      await fetchVariants();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'archive 실패');
    } finally {
      setArchivingId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-6 bg-slate-100 rounded animate-pulse w-48" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="aspect-[9/16] bg-slate-100 animate-pulse" />
              <div className="p-2 space-y-1.5">
                <div className="h-3 bg-slate-100 rounded animate-pulse w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
      </div>
    );
  }

  const sorted = [...variants].sort(
    (a, b) => (b.variant_score ?? -1) - (a.variant_score ?? -1),
  );
  const totalCost = variants.reduce(
    (sum, v) => sum + (v.html_usage?.costUsd ?? 0) + (v.variant_score_detail?.criticCostUsd ?? 0),
    0,
  );
  const top = sorted[0];

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-purple-600">
            Variant Group · A/B Compare
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            변형 비교 ({variants.length}개)
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            점수순 정렬 · 총 비용 ${totalCost.toFixed(4)} · group_id: <code className="font-mono text-xs">{groupId.slice(0, 8)}…</code>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchVariants}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
          >
            🔄 새로고침
          </button>
          <Link
            href="/admin/marketing/card-news"
            className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
          >
            ← 목록
          </Link>
        </div>
      </div>

      {/* 추천 winner 배너 (사전 점수) */}
      {top && top.variant_score != null && top.variant_score >= 70 && (
        <div className="mb-6 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4">
          <div className="text-sm font-bold text-emerald-900">
            🏆 사전 점수 추천 — {ANGLE_LABELS[top.variant_angle ?? ''] ?? top.variant_angle} 각도
          </div>
          <div className="mt-1 text-sm text-emerald-800">
            점수 <strong>{top.variant_score.toFixed(0)}/100</strong> ·{' '}
            {top.variant_score_detail?.summary ?? ''}
          </div>
        </div>
      )}

      {/* Auto-winner 결정 패널 (engagement 기반) */}
      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-blue-900">
              🤖 Auto-winner Loop
              <span className="ml-2 text-xs font-normal text-blue-700">
                — 발행 후 24h+ 경과 + 1.2배 변별력 시 winner 결정
              </span>
            </div>
            <p className="mt-1 text-xs text-blue-800">
              매일 05:00 UTC 자동 실행 · 수동 트리거도 가능 (engagement·좋아요·댓글·공유·저장 가중)
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleDecideWinner(false)}
              disabled={decidingWinner}
              className="rounded-lg border border-blue-400 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              title="DB 변경 없이 분석만"
            >
              {decidingWinner ? '판정 중…' : '🔍 winner 분석'}
            </button>
            <button
              onClick={() => handleDecideWinner(true)}
              disabled={decidingWinner}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              title="winner 결정 + 나머지 ARCHIVED"
            >
              ⚡ winner 결정 + 정리
            </button>
          </div>
        </div>
        {winnerReport && (
          <div className="mt-3 rounded-lg bg-white p-3 text-xs">
            <div
              className={`font-semibold ${
                winnerReport.decided ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {winnerReport.decided
                ? `✅ Winner 결정: ${ANGLE_LABELS[winnerReport.winner?.variant_angle ?? ''] ?? winnerReport.winner?.variant_angle}`
                : '⏸ 미결정'}
            </div>
            <div className="mt-1 text-slate-600">{winnerReport.reason}</div>
            {(winnerReport.archived_ids?.length ?? 0) > 0 && (
              <div className="mt-1 text-slate-500">
                Archived {winnerReport.archived_ids?.length}건
              </div>
            )}
          </div>
        )}
      </div>

      {/* 변형 그리드 */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((v, idx) => {
          const isTop = idx === 0 && (v.variant_score ?? 0) >= 70;
          const archived = v.status === 'ARCHIVED';
          const detail = v.variant_score_detail;
          return (
            <div
              key={v.id}
              className={`overflow-hidden rounded-xl border bg-white shadow-sm ${
                isTop ? 'border-2 border-emerald-400 shadow-emerald-100' : 'border-slate-200'
              } ${archived ? 'opacity-50' : ''}`}
            >
              {/* 헤더 */}
              <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {idx + 1}위 · {ANGLE_LABELS[v.variant_angle ?? ''] ?? v.variant_angle ?? 'auto'}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <ScoreBadge score={v.variant_score} />
                    {v.is_winner && (
                      <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">
                        🏆 WINNER
                      </span>
                    )}
                    {!v.is_winner && isTop && (
                      <span className="text-xs font-bold text-emerald-700">사전 TOP</span>
                    )}
                    {v.engagement_score != null && (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                        engagement {v.engagement_score.toFixed(0)}
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                    v.status === 'CONFIRMED'
                      ? 'bg-emerald-100 text-emerald-700'
                      : v.status === 'LAUNCHED'
                        ? 'bg-blue-100 text-blue-700'
                        : v.status === 'ARCHIVED'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {v.status}
                </span>
              </div>

              {/* 미리보기 — 렌더된 PNG 또는 HTML iframe */}
              <div className="aspect-square w-full overflow-hidden bg-slate-100">
                {v.ig_slide_urls?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={v.ig_slide_urls[0]}
                    alt={`${v.variant_angle} 1번 카드`}
                    className="h-full w-full object-cover"
                  />
                ) : v.html_generated ? (
                  <iframe
                    srcDoc={v.html_generated}
                    title={`${v.variant_angle} 미리보기`}
                    sandbox=""
                    className="h-full w-full border-0"
                    style={{ pointerEvents: 'none' }}
                    scrolling="no"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-slate-400">
                    HTML 없음
                  </div>
                )}
              </div>

              {/* verdict + 요약 */}
              <div className="space-y-2 px-4 py-3">
                <VerdictPill verdict={detail?.verdict} />
                {detail?.summary && (
                  <p className="text-xs leading-relaxed text-slate-600">{detail.summary}</p>
                )}

                {/* 차원별 점수 */}
                {detail?.dimensions && (
                  <div className="grid grid-cols-5 gap-1 pt-1">
                    {Object.entries(detail.dimensions).map(([k, val]) => (
                      <div key={k} className="text-center" title={k}>
                        <div className="text-[9px] uppercase text-slate-400">
                          {k.replace(/_/g, ' ').slice(0, 6)}
                        </div>
                        <div className="text-xs font-bold text-slate-700">{val}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 비용 */}
                <div className="border-t pt-2 text-[10px] text-slate-400">
                  비용 ${((v.html_usage?.costUsd ?? 0) + (detail?.criticCostUsd ?? 0)).toFixed(4)}
                  {v.engagement_score != null && (
                    <span className="ml-2 font-semibold text-blue-600">
                      · engagement {v.engagement_score.toFixed(0)}
                    </span>
                  )}
                </div>
              </div>

              {/* 액션 */}
              <div className="flex gap-1 border-t border-slate-100 bg-slate-50 px-3 py-2">
                <button
                  onClick={() => router.push(`/admin/marketing/card-news/${v.id}/v2`)}
                  className="flex-1 rounded bg-white border border-slate-200 px-2 py-1.5 text-xs font-medium hover:bg-slate-100"
                >
                  스튜디오
                </button>
                <button
                  onClick={() => handleRender(v.id)}
                  disabled={renderingId === v.id || archived}
                  className="flex-1 rounded bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                  title="Puppeteer PNG 렌더 (~30초)"
                >
                  {renderingId === v.id ? '렌더 중…' : v.ig_slide_urls?.length ? '🔄 재렌더' : '🖼 PNG 렌더'}
                </button>
                <button
                  onClick={() => handleArchive(v.id)}
                  disabled={archivingId === v.id || archived}
                  className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs hover:bg-slate-100 disabled:opacity-40"
                  title="이 변형 ARCHIVED 처리"
                >
                  {archivingId === v.id ? '…' : '🗑'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {variants.length === 0 && (
        <div className="py-20 text-center text-sm text-slate-400">
          변형이 없습니다.
        </div>
      )}
    </div>
  );
}
