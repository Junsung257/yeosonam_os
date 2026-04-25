'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface PackageOption {
  id: string;
  title: string;
  destination: string | null;
  duration: number | null;
  selling_price: number | null;
}

const PRESET_ANGLES: Array<{
  value: 'luxury' | 'value' | 'urgency' | 'emotional' | 'filial' | 'activity' | 'food';
  label: string;
}> = [
  { value: 'luxury', label: '럭셔리' },
  { value: 'value', label: '가성비' },
  { value: 'urgency', label: '긴급/마감' },
  { value: 'emotional', label: '감성' },
  { value: 'filial', label: '효도' },
  { value: 'activity', label: '액티비티' },
  { value: 'food', label: '미식' },
];

interface VariantsResponse {
  variant_group_id: string;
  variants: Array<{
    card_news_id?: string;
    variant_angle?: string;
    variant_score?: number | null;
    verdict?: string | null;
    error?: string;
  }>;
  success_count: number;
  total_count: number;
  totalCostUsd: number;
  durationMs: number;
}

export default function CardNewsVariantsNewPage() {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [rawText, setRawText] = useState('');
  const [packageId, setPackageId] = useState('');
  const [toneHint, setToneHint] = useState('');
  const [selectedAngles, setSelectedAngles] = useState<string[]>([
    'luxury',
    'value',
    'urgency',
    'emotional',
    'activity',
  ]);
  const [skipCritic, setSkipCritic] = useState(false);

  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const [rawSource, setRawSource] = useState<'normalized_intakes' | 'synthesized' | null>(null);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VariantsResponse | null>(null);

  useEffect(() => {
    fetch('/api/packages?limit=200')
      .then((r) => r.json())
      .then((d) => setPackages(d.packages ?? d.data ?? []))
      .catch(() => setPackages([]));
  }, []);

  useEffect(() => {
    if (!packageId) {
      setRawSource(null);
      return;
    }
    setLoadingRaw(true);
    setError(null);
    fetch(`/api/packages/${packageId}/raw-text`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || '원문 로드 실패');
        setRawText(data.rawText ?? '');
        setRawSource(data.source ?? null);
        if (!title && data.productMeta?.title) setTitle(data.productMeta.title);
      })
      .catch((err) => setError(err instanceof Error ? err.message : '원문 로드 실패'))
      .finally(() => setLoadingRaw(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId]);

  const toggleAngle = (val: string) => {
    setSelectedAngles((prev) =>
      prev.includes(val) ? prev.filter((a) => a !== val) : [...prev, val],
    );
  };

  const expectedCost = (selectedAngles.length * (skipCritic ? 0.28 : 0.32)).toFixed(2);

  const handleGenerate = async () => {
    if (!rawText.trim()) {
      setError('원문이 비어있습니다');
      return;
    }
    if (selectedAngles.length === 0) {
      setError('최소 1개 각도를 선택하세요');
      return;
    }
    if (
      !confirm(
        `${selectedAngles.length}개 변형을 병렬 생성합니다.\n\n예상 비용: ~$${expectedCost} (≈ ${Math.round(Number(expectedCost) * 1400)}원)\n예상 시간: 3~5분\n\n진행할까요?`,
      )
    ) {
      return;
    }

    setError(null);
    setGenerating(true);
    setResult(null);

    try {
      const selectedPackage = packages.find((p) => p.id === packageId);
      const productMeta = selectedPackage
        ? {
            title: selectedPackage.title,
            destination: selectedPackage.destination ?? undefined,
            duration: selectedPackage.duration ?? undefined,
            nights: selectedPackage.duration ? selectedPackage.duration - 1 : undefined,
            price: selectedPackage.selling_price ?? undefined,
          }
        : undefined;

      const res = await fetch('/api/card-news/generate-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText,
          productMeta,
          angles: selectedAngles,
          count: selectedAngles.length,
          toneHint: toneHint || undefined,
          title: title || undefined,
          package_id: packageId || undefined,
          skipCritic,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `생성 실패 (HTTP ${res.status})`);
      setResult(data);

      // 자동으로 비교 페이지로 이동
      setTimeout(() => {
        router.push(`/admin/marketing/card-news/variants/${data.variant_group_id}`);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '생성 실패');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">변형 5장 생성 (A/B 테스트)</h1>
          <p className="mt-1 text-sm text-gray-500">
            한 상품에 여러 각도 동시 생성 → 사전 점수 비교 → 좋은 것만 발행. AdCreative.ai 패턴.
          </p>
        </div>
        <Link
          href="/admin/marketing/card-news"
          className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
        >
          ← 목록
        </Link>
      </div>

      <section className="space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-semibold">제목</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="비우면 상품명 자동"
            className="w-full rounded-lg border px-3 py-2 text-sm"
            disabled={generating}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold">상품 (자동 원문 채움)</label>
          <select
            value={packageId}
            onChange={(e) => setPackageId(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            disabled={generating}
          >
            <option value="">— 상품 미연결 —</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} {p.destination ? `· ${p.destination}` : ''}
              </option>
            ))}
          </select>
          {loadingRaw && (
            <p className="mt-1 text-xs text-blue-600">⏳ 원문 불러오는 중...</p>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-sm font-semibold">
              원문 텍스트 <span className="text-red-500">*</span>
            </label>
            {rawSource === 'normalized_intakes' && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                ✓ Phase 1.5 IR 원문
              </span>
            )}
            {rawSource === 'synthesized' && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                ⓘ DB 합성
              </span>
            )}
          </div>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="상품 원문을 붙여넣거나 상품 선택 시 자동 채움"
            rows={8}
            className="w-full rounded-lg border px-3 py-2 font-mono text-sm"
            disabled={generating || loadingRaw}
          />
          <p className="mt-1 text-xs text-gray-500">{rawText.length} 자</p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold">
            각도 선택 ({selectedAngles.length}개) — 선택한 각도마다 1장씩 생성
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PRESET_ANGLES.map((a) => (
              <label
                key={a.value}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer text-sm ${
                  selectedAngles.includes(a.value)
                    ? 'border-purple-500 bg-purple-50 text-purple-900'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedAngles.includes(a.value)}
                  onChange={() => toggleAngle(a.value)}
                  className="h-4 w-4"
                  disabled={generating}
                />
                <span className="font-medium">{a.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold">톤 힌트 (선택)</label>
          <input
            type="text"
            value={toneHint}
            onChange={(e) => setToneHint(e.target.value)}
            placeholder="예: 신혼 럭셔리 / 효도 안심"
            className="w-full rounded-lg border px-3 py-2 text-sm"
            disabled={generating}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={skipCritic}
            onChange={(e) => setSkipCritic(e.target.checked)}
            disabled={generating}
            className="h-4 w-4"
          />
          Cover Critic 점수 평가 건너뛰기 (변형당 ~$0.04 절감)
        </label>

        <div className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <div>
            예상 비용: <strong>~${expectedCost}</strong> (≈ {Math.round(Number(expectedCost) * 1400)}원)
            {skipCritic && <span className="ml-1 text-amber-600">— critic 생략</span>}
          </div>
          <div>예상 시간: 3~5분 (3개씩 배치 생성, OTPM 보호)</div>
          <div className="mt-1 text-[11px] text-slate-500">
            * 같은 시스템 프롬프트 + 같은 원문 → 캐시 적중으로 input 비용 90% 절감
          </div>
        </div>

        {generating && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            ⏳ 백그라운드에서 변형이 계속 생성됩니다. 페이지를 닫거나 네트워크가 끊어져도
            서버에서 작업은 끝까지 진행되며, 잠시 후{' '}
            <Link href="/admin/marketing/card-news" className="underline font-semibold">
              카드뉴스 목록
            </Link>
            에서 확인할 수 있습니다.
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={generating || !rawText.trim() || selectedAngles.length === 0}
          className="w-full rounded-lg bg-purple-600 py-3 font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {generating
            ? `생성 중... (${selectedAngles.length}개 병렬, ~3분)`
            : `🚀 ${selectedAngles.length}장 변형 생성`}
        </button>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            ❌ {error}
          </div>
        )}
      </section>

      {result && (
        <section className="mt-6 rounded-xl border bg-emerald-50 p-6">
          <h2 className="mb-2 text-lg font-bold text-emerald-900">
            ✅ 생성 완료 — {result.success_count}/{result.total_count} 성공
          </h2>
          <p className="text-sm text-emerald-800">
            총 비용: ${result.totalCostUsd.toFixed(4)} · 시간:{' '}
            {(result.durationMs / 1000).toFixed(1)}s
          </p>
          <p className="mt-2 text-sm text-emerald-700">
            ⏩ 비교 페이지로 이동 중...
          </p>
        </section>
      )}
    </div>
  );
}
