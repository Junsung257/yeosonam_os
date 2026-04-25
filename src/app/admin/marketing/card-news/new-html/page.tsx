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

const ANGLE_OPTIONS = [
  { value: '', label: '자동 (Claude 판단)' },
  { value: 'luxury', label: '럭셔리' },
  { value: 'value', label: '가성비' },
  { value: 'urgency', label: '긴급/마감' },
  { value: 'emotional', label: '감성' },
  { value: 'filial', label: '효도' },
  { value: 'activity', label: '액티비티' },
  { value: 'food', label: '미식' },
] as const;

interface GenerateResponse {
  card_news_id: string;
  html: string;
  thinking: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  costUsd: number;
  durationMs: number;
  faithfulness?: {
    ok: boolean;
    suspicions: Array<{
      pattern: string;
      matched: string;
      reason: string;
      severity: 'high' | 'medium' | 'low';
    }>;
  };
}

interface RenderResponse {
  renders: Array<{ slide_index: number; url: string | null; error?: string }>;
}

export default function CardNewsHtmlNewPage() {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [rawText, setRawText] = useState('');
  const [packageId, setPackageId] = useState('');
  const [angleHint, setAngleHint] = useState('');
  const [toneHint, setToneHint] = useState('');

  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [generating, setGenerating] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [renderResult, setRenderResult] = useState<RenderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const [rawSource, setRawSource] = useState<'normalized_intakes' | 'synthesized' | null>(null);
  const [serverProductMeta, setServerProductMeta] = useState<{
    title?: string | null;
    destination?: string | null;
    duration?: number | null;
    nights?: number | null;
    price?: number | null;
    highlights?: string[];
    departureDates?: string[];
  } | null>(null);

  useEffect(() => {
    fetch('/api/packages?limit=200')
      .then((r) => r.json())
      .then((d) => setPackages(d.packages ?? d.data ?? []))
      .catch(() => setPackages([]));
  }, []);

  // 상품 선택 → 서버에서 원문 + 메타 자동 가져오기
  useEffect(() => {
    if (!packageId) {
      setRawSource(null);
      setServerProductMeta(null);
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
        setServerProductMeta(data.productMeta ?? null);
        if (!title && data.productMeta?.title) {
          setTitle(data.productMeta.title);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : '원문 로드 실패'))
      .finally(() => setLoadingRaw(false));
    // title 의존성은 의도적으로 빼서 사용자가 입력한 제목을 덮어쓰지 않음
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId]);

  const selectedPackage = packages.find((p) => p.id === packageId);
  // 서버 메타 우선, 없으면 클라 selectedPackage 합성
  const productMeta = serverProductMeta
    ? {
        title: serverProductMeta.title ?? undefined,
        destination: serverProductMeta.destination ?? undefined,
        duration: serverProductMeta.duration ?? undefined,
        nights: serverProductMeta.nights ?? undefined,
        price: serverProductMeta.price ?? undefined,
        highlights: serverProductMeta.highlights,
        departureDates: serverProductMeta.departureDates,
      }
    : selectedPackage
      ? {
          title: selectedPackage.title,
          destination: selectedPackage.destination ?? undefined,
          duration: selectedPackage.duration ?? undefined,
          nights: selectedPackage.duration ? selectedPackage.duration - 1 : undefined,
          price: selectedPackage.selling_price ?? undefined,
        }
      : undefined;

  const handleGenerate = async () => {
    if (!rawText.trim()) {
      setError('원문이 비어있습니다');
      return;
    }
    setError(null);
    setGenerating(true);
    setResult(null);
    setRenderResult(null);

    try {
      const res = await fetch('/api/card-news/generate-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText,
          productMeta,
          angleHint: angleHint || undefined,
          toneHint: toneHint || undefined,
          title: title || undefined,
          package_id: packageId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `생성 실패 (HTTP ${res.status})`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setGenerating(false);
    }
  };

  const handleRender = async () => {
    if (!result?.card_news_id) return;
    setError(null);
    setRendering(true);
    setRenderResult(null);

    try {
      const res = await fetch(`/api/card-news/${result.card_news_id}/render-html-to-png`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scale: 2 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `렌더 실패 (HTTP ${res.status})`);
      setRenderResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setRendering(false);
    }
  };

  const allRendered =
    renderResult?.renders.length === 6 && renderResult.renders.every((r) => r.url);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">카드뉴스 — HTML 모드</h1>
          <p className="mt-1 text-sm text-gray-500">
            Claude Sonnet 4.6 으로 6장 carousel HTML 직접 생성. Puppeteer 로 1080×1080 PNG 렌더.
          </p>
        </div>
        <Link
          href="/admin/marketing/card-news"
          className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
        >
          ← 목록으로
        </Link>
      </div>

      {/* 입력 폼 */}
      <section className="space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-semibold">제목 (선택)</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="비우면 상품명 또는 자동 생성"
            className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            disabled={generating}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold">상품 선택 (선택)</label>
          <select
            value={packageId}
            onChange={(e) => setPackageId(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            disabled={generating}
          >
            <option value="">— 상품 미연결 (정보성 또는 직접 입력) —</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} {p.destination ? `· ${p.destination}` : ''}
              </option>
            ))}
          </select>
          {selectedPackage && !loadingRaw && (
            <p className="mt-1 text-xs text-gray-500">
              자동 메타: {selectedPackage.destination} · {selectedPackage.duration}일 ·{' '}
              {selectedPackage.selling_price?.toLocaleString('ko-KR')}원
            </p>
          )}
          {loadingRaw && (
            <p className="mt-1 text-xs text-blue-600">⏳ 상품 원문 불러오는 중...</p>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-sm font-semibold">
              원문 텍스트 <span className="text-red-500">*</span>
            </label>
            {rawSource === 'normalized_intakes' && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                ✓ Phase 1.5 IR 원문 (등록 시 보존)
              </span>
            )}
            {rawSource === 'synthesized' && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                ⓘ DB 정형 필드 합성 — 필요 시 직접 보정
              </span>
            )}
          </div>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="상품 선택 시 자동으로 채워지거나, 직접 붙여넣기.&#10;&#10;⚠️ 원문에 없는 사실(연령제한, 할인조건 등)은 자동으로 제거됩니다."
            rows={12}
            className="w-full rounded-lg border px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none"
            disabled={generating || loadingRaw}
          />
          <p className="mt-1 text-xs text-gray-500">{rawText.length} 자</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-semibold">각도 (선택)</label>
            <select
              value={angleHint}
              onChange={(e) => setAngleHint(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              disabled={generating}
            >
              {ANGLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold">톤 힌트 (선택)</label>
            <input
              type="text"
              value={toneHint}
              onChange={(e) => setToneHint(e.target.value)}
              placeholder="예: 신혼부부 럭셔리 / 효도 안심 / 친구 액티비티"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              disabled={generating}
            />
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating || !rawText.trim()}
          className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {generating ? 'Claude 생성 중... (3~4분 소요)' : 'Claude 로 HTML 생성하기'}
        </button>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            ❌ {error}
          </div>
        )}
      </section>

      {/* 결과 */}
      {result && (
        <section className="mt-6 space-y-4 rounded-xl border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">✅ HTML 생성 완료</h2>
            <Link
              href={`/admin/marketing/card-news/${result.card_news_id}/v2`}
              className="text-sm text-blue-600 hover:underline"
            >
              스튜디오에서 열기 →
            </Link>
          </div>

          <div className="grid gap-2 text-xs text-gray-600 sm:grid-cols-4">
            <div>
              <span className="font-semibold">시간: </span>
              {(result.durationMs / 1000).toFixed(1)}s
            </div>
            <div>
              <span className="font-semibold">출력 토큰: </span>
              {result.usage.output_tokens.toLocaleString()}
            </div>
            <div>
              <span className="font-semibold">캐시 적중: </span>
              {result.usage.cache_read_input_tokens.toLocaleString()}
            </div>
            <div>
              <span className="font-semibold">비용: </span>${result.costUsd.toFixed(4)} ≈{' '}
              {Math.round(result.costUsd * 1400)}원
            </div>
          </div>

          {/* Faithfulness 자동 검증 결과 */}
          {result.faithfulness && !result.faithfulness.ok && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="mb-2 text-sm font-bold text-amber-900">
                ⚠ 환각 의심 항목 {result.faithfulness.suspicions.length}건 — 원문 충실성 자동 검증
              </div>
              <ul className="space-y-1.5 text-xs text-amber-800">
                {result.faithfulness.suspicions.map((s, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        s.severity === 'high'
                          ? 'bg-red-200 text-red-900'
                          : s.severity === 'medium'
                            ? 'bg-amber-200 text-amber-900'
                            : 'bg-yellow-200 text-yellow-900'
                      }`}
                    >
                      {s.severity.toUpperCase()}
                    </span>
                    <span className="flex-1">
                      <code className="rounded bg-white px-1 font-mono">{s.matched}</code>
                      <span className="ml-2 text-[11px] text-amber-700">{s.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-amber-700">
                → 원문에 명시된 사실이라면 무시. 아니면 원문 보정 후 재생성 권장.
              </p>
            </div>
          )}
          {result.faithfulness?.ok && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              ✓ 환각 의심 없음 — 원문 충실성 자동 검증 통과
            </div>
          )}

          <div className="overflow-hidden rounded-lg border">
            <iframe
              srcDoc={result.html}
              className="h-[600px] w-full"
              title="HTML 미리보기"
            />
          </div>

          <button
            onClick={handleRender}
            disabled={rendering}
            className="w-full rounded-lg bg-green-600 py-3 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {rendering ? 'Puppeteer 렌더링 중... (~30초)' : 'PNG 6장으로 렌더 + 저장'}
          </button>
        </section>
      )}

      {/* PNG 결과 */}
      {renderResult && (
        <section className="mt-6 space-y-4 rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">
            {allRendered ? '✅ PNG 6장 저장 완료' : '⚠️ PNG 일부 실패'}
          </h2>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {renderResult.renders
              .sort((a, b) => a.slide_index - b.slide_index)
              .map((r) => (
                <div key={r.slide_index} className="overflow-hidden rounded-lg border">
                  {r.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.url}
                      alt={`Slide ${r.slide_index + 1}`}
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square items-center justify-center bg-red-50 p-4 text-center text-xs text-red-600">
                      {r.slide_index + 1}번 실패
                      <br />
                      {r.error}
                    </div>
                  )}
                  <div className="bg-gray-50 px-2 py-1 text-center text-xs text-gray-600">
                    {String(r.slide_index + 1).padStart(2, '0')} / 06
                  </div>
                </div>
              ))}
          </div>

          {allRendered && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm">
              ✓ 카드뉴스 레코드: <code className="font-mono">{result?.card_news_id}</code>
              <br />✓ Storage 업로드 완료, 인스타 발행 가능 상태
              <button
                onClick={() => router.push(`/admin/marketing/card-news/${result?.card_news_id}/v2`)}
                className="ml-2 inline-block rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700"
              >
                스튜디오로 →
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
