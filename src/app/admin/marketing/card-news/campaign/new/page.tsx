'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const ANGLES = [
  { key: 'value', label: '가성비', emoji: '💰' },
  { key: 'luxury', label: '럭셔리', emoji: '✨' },
  { key: 'urgency', label: '긴급', emoji: '⏰' },
  { key: 'emotional', label: '감성', emoji: '💕' },
  { key: 'filial', label: '효도', emoji: '🙏' },
  { key: 'activity', label: '액티비티', emoji: '🎯' },
  { key: 'food', label: '미식', emoji: '🍜' },
] as const;

const FAMILIES = [
  { key: 'editorial', label: 'Editorial', desc: '깔끔·신뢰감' },
  { key: 'cinematic', label: 'Cinematic', desc: '영화같은 비주얼' },
  { key: 'premium', label: 'Premium', desc: '고급스러운 느낌' },
  { key: 'bold', label: 'Bold', desc: '강렬·임팩트' },
] as const;

type StepKey = 'brief' | 'slides' | 'render' | 'confirm';
interface StepState {
  status: 'pending' | 'running' | 'done' | 'failed';
  label: string;
  detail?: string;
}

interface Package { id: string; title: string; destination: string; status: string; }

export default function CampaignNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillPackageId = searchParams.get('package_id') ?? '';

  const [packages, setPackages] = useState<Package[]>([]);
  const [pkgLoading, setPkgLoading] = useState(true);
  const [selectedPkg, setSelectedPkg] = useState(prefillPackageId);
  const [angle, setAngle] = useState<string>('value');
  const [family, setFamily] = useState<string>('editorial');
  const [autoConfirm, setAutoConfirm] = useState(false);

  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [cardNewsId, setCardNewsId] = useState<string | null>(null);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);
  const [slideUrls, setSlideUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [steps, setSteps] = useState<Record<StepKey, StepState>>({
    brief: { status: 'pending', label: 'ContentBrief 생성' },
    slides: { status: 'pending', label: 'AI 슬라이드 카피 생성' },
    render: { status: 'pending', label: 'Satori 렌더링' },
    confirm: { status: 'pending', label: '블로그 큐 등록' },
  });

  useEffect(() => {
    fetch('/api/card-news/campaign').catch(() => null); // warm
    fetch('/api/admin/packages?status=approved&limit=200')
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((d) => {
        const pkgs = (d?.data ?? d?.packages ?? []) as Package[];
        setPackages(pkgs);
        if (prefillPackageId && !selectedPkg) setSelectedPkg(prefillPackageId);
      })
      .catch(() => setPackages([]))
      .finally(() => setPkgLoading(false));
  }, [prefillPackageId]); // eslint-disable-line

  function setStep(key: StepKey, status: StepState['status'], detail?: string) {
    setSteps((prev) => ({ ...prev, [key]: { ...prev[key], status, detail } }));
  }

  async function startCampaign() {
    if (!selectedPkg) { setError('상품을 선택해주세요.'); return; }
    setError(null);
    setRunning(true);
    setJobId(null);
    setCardNewsId(null);
    setSlideUrls([]);
    setFinalStatus(null);
    setSteps({
      brief: { status: 'running', label: 'ContentBrief 생성' },
      slides: { status: 'pending', label: 'AI 슬라이드 카피 생성' },
      render: { status: 'pending', label: 'Satori 렌더링' },
      confirm: { status: 'pending', label: '블로그 큐 등록' },
    });

    try {
      // brief + slides는 campaign API 내부에서 순차 처리
      setStep('brief', 'running');
      const res = await fetch('/api/card-news/campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_id: selectedPkg,
          angle,
          template_family: family,
          auto_confirm: autoConfirm,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(errData.error ?? '캠페인 생성 실패');
      }

      setStep('brief', 'done');
      setStep('slides', 'done');
      setStep('render', 'running');

      const data = await res.json() as {
        card_news_id: string;
        job_id: string | null;
        status: string;
        render_ok: boolean;
        card_news: { slide_image_urls?: string[] };
      };

      if (data.render_ok) {
        setStep('render', 'done');
      } else {
        setStep('render', 'failed', '렌더 실패 — 편집기에서 재시도');
      }

      setCardNewsId(data.card_news_id);
      setJobId(data.job_id);
      setFinalStatus(data.status);
      setSlideUrls(data.card_news?.slide_image_urls ?? []);

      if (autoConfirm && data.status === 'CONFIRMED') {
        setStep('confirm', 'done', '블로그 큐 자동 등록 완료');
      } else {
        setStep('confirm', 'pending', autoConfirm ? '렌더 실패로 큐 미등록' : '수동 CONFIRMED 전환 시 자동 등록');
      }

      // job 폴링 시작 (content_factory_jobs 실시간 반영)
      if (data.job_id) {
        pollRef.current = setInterval(async () => {
          const jobRes = await fetch(`/api/card-news/campaign?job_id=${data.job_id}`).catch(() => null);
          if (!jobRes?.ok) return;
          const { card_news: cn } = await jobRes.json() as { card_news?: { status?: string; slide_image_urls?: string[] } };
          if (cn?.status) setFinalStatus(cn.status);
          if (cn?.slide_image_urls?.length) setSlideUrls(cn.slide_image_urls);
          if (cn?.status === 'CONFIRMED' || cn?.status === 'LAUNCHED') {
            clearInterval(pollRef.current!);
          }
        }, 4000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류');
      setStep('brief', 'failed');
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const stepColor = (s: StepState['status']) => ({
    pending: 'text-gray-400',
    running: 'text-blue-600 font-semibold',
    done: 'text-green-600',
    failed: 'text-red-500',
  }[s]);

  const stepIcon = (s: StepState['status']) => ({
    pending: '○',
    running: '⏳',
    done: '✅',
    failed: '❌',
  }[s]);

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin/marketing/card-news" className="text-gray-500 hover:text-gray-800 text-sm">
            ← 카드뉴스 목록
          </Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-xl font-bold text-gray-900">원클릭 캠페인 생성</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 왼쪽: 옵션 패널 */}
          <div className="space-y-5">
            {/* 상품 선택 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">대상 상품</h2>
              {pkgLoading ? (
                <div className="text-sm text-gray-400">상품 목록 로딩 중...</div>
              ) : (
                <select
                  value={selectedPkg}
                  onChange={(e) => setSelectedPkg(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={running}
                >
                  <option value="">상품을 선택해주세요</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} — {p.destination}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* 각도 선택 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">카피 각도</h2>
              <div className="flex flex-wrap gap-2">
                {ANGLES.map((a) => (
                  <button
                    key={a.key}
                    onClick={() => setAngle(a.key)}
                    disabled={running}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      angle === a.key
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {a.emoji} {a.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 템플릿 선택 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">템플릿 스타일</h2>
              <div className="grid grid-cols-2 gap-2">
                {FAMILIES.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFamily(f.key)}
                    disabled={running}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      family === f.key
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-900">{f.label}</div>
                    <div className="text-xs text-gray-500">{f.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 자동 컨펌 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoConfirm}
                  onChange={(e) => setAutoConfirm(e.target.checked)}
                  disabled={running}
                  className="w-4 h-4 rounded"
                />
                <div>
                  <div className="text-sm font-medium text-gray-800">렌더 완료 후 자동 CONFIRMED</div>
                  <div className="text-xs text-gray-500">블로그 큐 자동 등록 포함</div>
                </div>
              </label>
            </div>

            {/* 시작 버튼 */}
            <button
              onClick={startCampaign}
              disabled={running || !selectedPkg}
              className="w-full py-3 rounded-xl bg-blue-600 text-white font-bold text-base hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {running ? '캠페인 생성 중...' : '🚀 캠페인 시작'}
            </button>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          {/* 오른쪽: 진행 패널 */}
          <div className="space-y-5">
            {/* 단계 진행 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">실시간 진행 상황</h2>
              <div className="space-y-3">
                {(Object.entries(steps) as [StepKey, StepState][]).map(([key, s]) => (
                  <div key={key} className="flex items-start gap-3">
                    <span className="text-lg leading-none mt-0.5">{stepIcon(s.status)}</span>
                    <div>
                      <div className={`text-sm ${stepColor(s.status)}`}>{s.label}</div>
                      {s.detail && (
                        <div className="text-xs text-gray-400 mt-0.5">{s.detail}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {finalStatus && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">카드뉴스 상태:</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      finalStatus === 'CONFIRMED' ? 'bg-blue-100 text-blue-700' :
                      finalStatus === 'RENDERING' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {finalStatus}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* 슬라이드 미리보기 */}
            {slideUrls.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">
                  생성된 슬라이드 ({slideUrls.length}장)
                </h2>
                <div className="grid grid-cols-3 gap-2">
                  {slideUrls.slice(0, 6).map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt={`슬라이드 ${i + 1}`}
                      className="w-full aspect-square object-cover rounded-lg border border-gray-200"
                    />
                  ))}
                </div>
                {cardNewsId && (
                  <div className="mt-4 flex gap-2">
                    <a
                      href={`/admin/marketing/card-news/${cardNewsId}`}
                      className="flex-1 text-center py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-700"
                    >
                      편집하기 →
                    </a>
                    <a
                      href={`/admin/marketing/content-hub/${cardNewsId}`}
                      className="flex-1 text-center py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
                    >
                      콘텐츠 허브
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* 빈 상태 안내 */}
            {!running && slideUrls.length === 0 && !error && (
              <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
                <div className="text-3xl mb-2">🎨</div>
                <div className="text-sm text-gray-500">
                  상품과 각도를 선택 후<br />캠페인 시작 버튼을 클릭하세요
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
