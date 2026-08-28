'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { Camera, Check, RefreshCw, X } from 'lucide-react';

type MediaStatus = 'pending' | 'generating' | 'pending_review' | 'approved' | 'rejected' | 'failed' | 'superseded';
type ManualPurpose = 'home_campaign_hero' | 'blog_cover' | 'card_news_background' | 'social_og';

interface MediaAsset {
  id: string;
  owner_type: string;
  owner_id: string;
  purpose: string;
  asset_class: string;
  source_kind: string;
  public_url: string | null;
  variants: Record<string, string> | null;
  provider: string | null;
  model: string | null;
  cost_usd: number | string | null;
  disclosure: string | null;
  status: MediaStatus;
  qa_report: { passed?: boolean; issues?: string[] } | null;
  approval_note: string | null;
  source_metadata: Record<string, unknown> | null;
  created_at: string;
}

const STATUS_LABEL: Record<MediaStatus, string> = {
  pending: '생성 대기',
  generating: 'Codex 생성 중',
  pending_review: '검수 대기',
  approved: '승인',
  rejected: '거절',
  failed: '생성 실패',
  superseded: '교체됨',
};

const STATUS_STYLE: Record<MediaStatus, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  generating: 'bg-sky-50 text-sky-800 border-sky-200',
  pending_review: 'bg-amber-50 text-amber-800 border-amber-200',
  approved: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-800 border-rose-200',
  failed: 'bg-slate-100 text-slate-700 border-slate-200',
  superseded: 'bg-slate-100 text-slate-600 border-slate-200',
};

const PURPOSE_LABEL: Record<ManualPurpose, string> = {
  home_campaign_hero: '홈 캠페인 Hero',
  blog_cover: '블로그 커버',
  card_news_background: '정보형 카드뉴스 배경',
  social_og: 'SNS·OG 원본',
};

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fallback;
  const error = (payload as Record<string, unknown>).error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

export default function MediaLibraryClient() {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [status, setStatus] = useState<'all' | MediaStatus>('all');
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [purpose, setPurpose] = useState<ManualPurpose>('home_campaign_hero');
  const [subject, setSubject] = useState('여소남과 함께 시작하는 프리미엄 여행의 설렘');
  const [destination, setDestination] = useState('');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (status !== 'all') params.set('status', status);
      const response = await fetch(`/api/admin/media?${params}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(payload, '미디어 목록을 불러오지 못했습니다.'));
      setAssets(Array.isArray(payload.assets) ? payload.assets : []);
    } catch (loadError) {
      setAssets([]);
      setError(loadError instanceof Error ? loadError.message : '미디어 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  async function reloadAllAssets() {
    if (status === 'all') {
      await loadAssets();
      return;
    }
    setStatus('all');
  }

  async function generateAsset() {
    if (subject.trim().length < 4) {
      setError('생성 주제를 4자 이상 입력하세요.');
      return;
    }
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/media/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose, subject, destination }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(payload, '이미지 생성에 실패했습니다.'));
      setNotice('ChatGPT 구독 이미지 작업을 등록했습니다. 로컬 Codex가 처리한 뒤 검수할 수 있습니다.');
      await reloadAllAssets();
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : '이미지 생성에 실패했습니다.');
    } finally {
      setGenerating(false);
    }
  }

  async function reviewAsset(id: string, decision: 'approved' | 'rejected') {
    setWorkingId(id);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/admin/media/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: reviewNotes[id] ?? '' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(payload, '검수 결과를 저장하지 못했습니다.'));
      setNotice(decision === 'approved' ? '승인했습니다.' : '거절했습니다.');
      setReviewNotes((current) => ({ ...current, [id]: '' }));
      await loadAssets();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : '검수 결과를 저장하지 못했습니다.');
    } finally {
      setWorkingId(null);
    }
  }

  async function regenerateAsset(id: string) {
    setWorkingId(id);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/admin/media/${id}/regenerate`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(payload, '이미지를 다시 생성하지 못했습니다.'));
      setNotice('새 구독 이미지 작업을 등록했습니다. 승인 전까지 기존 승인 이미지는 유지됩니다.');
      await reloadAllAssets();
    } catch (regenerateError) {
      setError(regenerateError instanceof Error ? regenerateError.message : '이미지를 다시 생성하지 못했습니다.');
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-5 md:p-8">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-admin-muted">Marketing media</p>
          <h1 className="mt-1 text-2xl font-bold text-admin-text">AI 미디어 검수</h1>
          <p className="mt-1 text-sm text-admin-muted">
            콘셉트 이미지만 생성합니다. 호텔·객실·항공·식사·관광지 실사는 공급사·공식 사진을 사용하세요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAssets()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm font-semibold text-admin-text hover:bg-admin-surface-2 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </button>
      </header>

      {(error || notice) && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {error || notice}
        </div>
      )}

      <section className="rounded-xl border border-admin-border bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Camera className="h-5 w-5 text-admin-primary" />
          <h2 className="font-bold text-admin-text">새 콘셉트 이미지</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-[220px_1fr_180px_auto] md:items-end">
          <label className="space-y-1.5 text-sm font-medium text-admin-text">
            사용 위치
            <select
              value={purpose}
              onChange={(event) => setPurpose(event.target.value as ManualPurpose)}
              className="w-full rounded-lg border border-admin-border bg-white px-3 py-2.5"
            >
              {Object.entries(PURPOSE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-admin-text">
            생성 주제
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={240}
              className="w-full rounded-lg border border-admin-border px-3 py-2.5"
              placeholder="예: 여름 휴가를 준비하는 설렘"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-admin-text">
            목적지 맥락(선택)
            <input
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              maxLength={100}
              className="w-full rounded-lg border border-admin-border px-3 py-2.5"
              placeholder="예: 베트남"
            />
          </label>
          <button
            type="button"
            onClick={() => void generateAsset()}
            disabled={generating}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-admin-primary px-4 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            {generating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {generating ? '작업 등록 중' : '작업 등록'}
          </button>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-bold text-admin-text">자산 목록</h2>
            <p className="text-xs text-admin-muted">현재 목록 {assets.length}건 · ChatGPT 구독량 기반</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['all', 'pending', 'generating', 'approved', 'rejected', 'failed'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${status === value ? 'border-admin-primary bg-admin-primary text-white' : 'border-admin-border bg-white text-admin-muted'}`}
              >
                {value === 'all' ? '전체' : STATUS_LABEL[value]}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="h-[360px] animate-pulse rounded-xl bg-admin-surface-2" />)}
          </div>
        ) : assets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-admin-border bg-white px-6 py-14 text-center">
            <p className="font-semibold text-admin-text">조건에 맞는 미디어가 없습니다.</p>
            <p className="mt-1 text-sm text-admin-muted">위 생성 폼에서 첫 콘셉트 이미지를 만들어 보세요.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {assets.map((asset) => (
              <article key={asset.id} className="overflow-hidden rounded-xl border border-admin-border bg-white shadow-sm">
                <div className="relative aspect-video bg-admin-surface-2">
                  {asset.public_url ? (
                    <Image src={asset.public_url} alt={`${asset.purpose} 미디어 미리보기`} fill unoptimized sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-admin-muted">이미지 없음</div>
                  )}
                </div>
                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-admin-text">{PURPOSE_LABEL[asset.purpose as ManualPurpose] || asset.purpose}</p>
                      <p className="mt-0.5 text-xs text-admin-muted">{asset.provider || asset.source_kind} · {asset.model || '—'}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${STATUS_STYLE[asset.status]}`}>
                      {STATUS_LABEL[asset.status]}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div><dt className="text-admin-muted">소유</dt><dd className="truncate font-medium text-admin-text">{asset.owner_type}:{asset.owner_id}</dd></div>
                    <div><dt className="text-admin-muted">실행</dt><dd className="font-medium text-admin-text">{asset.provider === 'codex_builtin' ? 'ChatGPT 구독' : asset.provider || '코드 생성'}</dd></div>
                  </dl>
                  {asset.disclosure && <p className="rounded-md bg-admin-surface-2 px-2.5 py-2 text-[11px] text-admin-muted">{asset.disclosure}</p>}
                  {asset.status === 'pending' && !asset.public_url && (
                    <p className="rounded-md bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                      로컬 Codex 예약 작업을 기다리고 있습니다.
                    </p>
                  )}
                  {asset.status === 'pending_review' && Boolean(asset.public_url) && (
                    <div className="space-y-2 border-t border-admin-border pt-3">
                      <input
                        value={reviewNotes[asset.id] ?? ''}
                        onChange={(event) => setReviewNotes((current) => ({
                          ...current,
                          [asset.id]: event.target.value,
                        }))}
                        maxLength={500}
                        className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                        placeholder="검수 메모(선택)"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => void reviewAsset(asset.id, 'approved')}
                          disabled={workingId === asset.id}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        ><Check className="h-4 w-4" />승인</button>
                        <button
                          type="button"
                          onClick={() => void reviewAsset(asset.id, 'rejected')}
                          disabled={workingId === asset.id}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"
                        ><X className="h-4 w-4" />거절</button>
                      </div>
                    </div>
                  )}
                  {asset.source_kind === 'openai_generated'
                    && asset.status !== 'superseded'
                    && Number(asset.source_metadata?.regeneration_count ?? 0) < 1
                    && (
                      <button
                        type="button"
                        onClick={() => void regenerateAsset(asset.id)}
                        disabled={workingId === asset.id}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm font-semibold text-admin-text hover:bg-admin-surface-2 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-4 w-4 ${workingId === asset.id ? 'animate-spin' : ''}`} />
                        1회 다시 생성
                      </button>
                    )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
