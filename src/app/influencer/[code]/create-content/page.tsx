'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { useInfluencerAuth } from '../auth-context';

interface Package {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  price?: number;
  airline?: string;
  status?: string;
  product_summary?: string;
  product_highlights?: string[];
}

type Platform = 'blog_body' | 'instagram_caption' | 'threads_post';

interface GeneratedPayload {
  markdown?: string;
  caption?: string;
  hashtags?: string[];
  first_comment?: string | null;
  main?: string;
  thread?: string[];
  word_count?: number;
}

interface GenerateResponse {
  distribution_id: string;
  payload: GeneratedPayload & { _cobrand?: Record<string, unknown> };
  share_url: string;
  affiliate: { name: string; referral_code: string; logo_url: string | null };
}

const PLATFORMS: { key: Platform; label: string; icon: string; desc: string }[] = [
  { key: 'blog_body', label: '블로그 본문', icon: '📝', desc: '네이버/티스토리 1500자+ SEO 최적화' },
  { key: 'instagram_caption', label: '인스타그램 캡션', icon: '📷', desc: '해시태그 + 프리뷰 훅 + CTA' },
  { key: 'threads_post', label: '스레드 포스트', icon: '🧵', desc: '메인 + 스레드 시퀀스' },
];

export default function CreateContentPage() {
  const params = useParams();
  const code = params.code as string;
  const { authenticated, affiliate } = useInfluencerAuth();

  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Package | null>(null);
  const [platform, setPlatform] = useState<Platform>('blog_body');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/packages');
      const json = await res.json();
      setPackages((json.packages || []).filter((p: Package) => p.status === 'approved'));
    } catch {
      /* */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) load();
  }, [authenticated, load]);

  const filtered = packages.filter(p =>
    !search || p.title?.toLowerCase().includes(search.toLowerCase()),
  );

  const handleGenerate = async () => {
    if (!selected) return;
    let pin = '';
    try { pin = sessionStorage.getItem(`inf_pin_${code}`) || ''; } catch { /* */ }
    if (!pin) {
      showToast('대시보드에서 다시 로그인해주세요 (PIN 세션 만료)');
      return;
    }
    setGenerating(true);
    setResult(null);
    try {
      const res = await fetch('/api/influencer/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referral_code: code,
          pin,
          product_id: selected.id,
          platform,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || '생성 실패');
        return;
      }
      setResult(json as GenerateResponse);
      showToast('콘텐츠가 생성되었습니다');
    } catch {
      showToast('서버 연결 실패');
    } finally {
      setGenerating(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    showToast(`${label} 복사됨`);
  };

  if (!authenticated) {
    return <p className="text-center text-gray-400 py-20">먼저 대시보드에서 인증해주세요</p>;
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">콘텐츠 자동 생성</h1>
          <p className="text-sm text-gray-500">
            상품 → 플랫폼 선택 → 발행자 <b>{affiliate?.name}</b> × <b className="text-blue-600">여소남</b> 자동 co-branding
          </p>
        </div>
        {result && (
          <a
            href={`/api/settlements?affiliate_referral_code=${code}`}
            className="text-xs text-gray-400 hover:text-gray-600"
            onClick={e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          >
            ↑ 처음부터
          </a>
        )}
      </div>

      {!result && (
        <>
          {/* Step 1. 상품 선택 */}
          <section className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-gray-900 text-sm">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] mr-2">1</span>
                상품 선택
              </h2>
              {selected && (
                <button onClick={() => setSelected(null)} className="text-xs text-gray-400 hover:text-gray-600">
                  변경
                </button>
              )}
            </div>

            {selected ? (
              <div className="border border-blue-200 bg-blue-50 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-gray-900 text-sm">{selected.title}</h3>
                  {selected.price && (
                    <span className="text-blue-600 font-extrabold text-sm shrink-0">
                      ₩{selected.price.toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {selected.destination && (
                    <span className="px-1.5 py-0.5 bg-white text-gray-600 text-[10px] rounded font-medium">
                      {selected.destination}
                    </span>
                  )}
                  {selected.duration && (
                    <span className="px-1.5 py-0.5 bg-white text-gray-600 text-[10px] rounded font-medium">
                      {selected.duration}일
                    </span>
                  )}
                  {selected.airline && (
                    <span className="px-1.5 py-0.5 bg-white text-gray-600 text-[10px] rounded font-medium">
                      {selected.airline}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="상품명 검색..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
                {loading ? (
                  <p className="text-center text-gray-400 py-6 text-sm">상품 로드 중...</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto space-y-1.5">
                    {filtered.slice(0, 30).map(pkg => (
                      <button
                        key={pkg.id}
                        onClick={() => setSelected(pkg)}
                        className="w-full text-left p-2.5 rounded-lg border border-gray-100 hover:border-blue-300 hover:bg-blue-50 transition"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium text-gray-900 line-clamp-1">{pkg.title}</span>
                          {pkg.price && (
                            <span className="text-blue-600 font-bold text-xs shrink-0">
                              ₩{pkg.price.toLocaleString()}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {[pkg.destination, pkg.duration && `${pkg.duration}일`, pkg.airline].filter(Boolean).join(' · ')}
                        </p>
                      </button>
                    ))}
                    {filtered.length === 0 && (
                      <p className="text-center text-gray-400 py-6 text-sm">검색 결과가 없습니다</p>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {/* Step 2. 플랫폼 선택 */}
          {selected && (
            <section className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
              <h2 className="font-bold text-gray-900 text-sm">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] mr-2">2</span>
                플랫폼 선택
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {PLATFORMS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setPlatform(p.key)}
                    className={`p-3 rounded-lg border-2 text-left transition ${
                      platform === p.key
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    <div className="text-xl mb-1">{p.icon}</div>
                    <div className="font-bold text-sm text-gray-900">{p.label}</div>
                    <p className="text-[11px] text-gray-500 mt-0.5">{p.desc}</p>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Step 3. Co-branding 미리보기 + 생성 */}
          {selected && (
            <section className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
              <h2 className="font-bold text-gray-900 text-sm">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] mr-2">3</span>
                Co-branding 확인 & 생성
              </h2>
              <div className="bg-gradient-to-r from-blue-50 to-rose-50 rounded-lg p-3 text-sm">
                <p className="text-gray-700">
                  <b>발행자:</b> {affiliate?.name} × <b className="text-blue-600">여소남</b>
                </p>
                <p className="text-[11px] text-amber-700 mt-1">
                  ⚠️ 공정위 표시지침에 따라 본 콘텐츠 첫 줄과 마지막 줄에 <b>"여소남 제휴 콘텐츠 (광고)"</b>가 자동 삽입됩니다.
                </p>
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
              >
                {generating ? 'AI 생성 중... (~30초)' : '✨ 콘텐츠 생성하기'}
              </button>
            </section>
          )}
        </>
      )}

      {/* 결과 */}
      {result && (
        <section className="bg-white rounded-xl p-5 shadow-sm border border-blue-200 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-gray-900">✅ 생성 완료</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                내 채널에 그대로 붙여넣고 발행하세요. 클릭/예약은 자동 추적됩니다.
              </p>
            </div>
            <button
              onClick={() => { setResult(null); setSelected(null); }}
              className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
            >
              새로 만들기
            </button>
          </div>

          {/* 추천 링크 */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-[11px] font-semibold text-amber-700 uppercase mb-1">내 추천 링크 (자동 트래킹)</p>
            <div className="flex gap-2 items-center">
              <code className="flex-1 text-xs font-mono text-gray-700 truncate">{result.share_url}</code>
              <button
                onClick={() => copyText(result.share_url, '링크')}
                className="px-2 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-700 shrink-0"
              >
                복사
              </button>
            </div>
          </div>

          {/* 본문 미리보기 */}
          {platform === 'blog_body' && result.payload.markdown && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-gray-500 uppercase">
                  블로그 본문 ({result.payload.word_count}단어)
                </p>
                <button
                  onClick={() => copyText(result.payload.markdown!, '본문')}
                  className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  본문 전체 복사
                </button>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-96 overflow-y-auto">
                <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans">{result.payload.markdown}</pre>
              </div>
            </div>
          )}

          {platform === 'instagram_caption' && result.payload.caption && (
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">캡션</p>
                  <button
                    onClick={() => copyText(result.payload.caption!, '캡션')}
                    className="text-xs px-2 py-1 bg-blue-600 text-white rounded"
                  >복사</button>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm whitespace-pre-wrap">{result.payload.caption}</div>
              </div>
              {result.payload.hashtags && result.payload.hashtags.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase">해시태그</p>
                    <button
                      onClick={() => copyText(result.payload.hashtags!.join(' '), '해시태그')}
                      className="text-xs px-2 py-1 bg-blue-600 text-white rounded"
                    >복사</button>
                  </div>
                  <p className="text-xs text-blue-600">{result.payload.hashtags.join(' ')}</p>
                </div>
              )}
            </div>
          )}

          {platform === 'threads_post' && result.payload.main && (
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-semibold text-gray-500 uppercase mb-1">메인 포스트</p>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm whitespace-pre-wrap">{result.payload.main}</div>
              </div>
              {result.payload.thread && result.payload.thread.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase mb-1">이어지는 스레드</p>
                  <div className="space-y-1.5">
                    {result.payload.thread.map((t, i) => (
                      <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 text-xs">
                        <span className="text-gray-400 mr-2">#{i + 2}</span>{t}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={() => {
                  const all = [result.payload.main, ...(result.payload.thread || [])].join('\n\n---\n\n');
                  copyText(all, '전체 스레드');
                }}
                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
              >전체 스레드 복사</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
