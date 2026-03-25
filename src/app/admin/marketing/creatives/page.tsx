'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { AdCreative, AiModel, CreativePlatform } from '@/types/meta-ads';

const PLATFORM_LABELS: Record<CreativePlatform, string> = {
  thread: '🧵 스레드',
  instagram: '📸 인스타그램',
  blog: '📝 블로그',
};

const MODEL_LABELS: Record<AiModel, string> = {
  openai: 'GPT-4o',
  claude: 'Claude 3.5',
  gemini: 'Gemini',
};

interface Package {
  id: string;
  title: string;
  destination: string;
}

interface Campaign {
  id: string;
  name: string;
}

export default function CreativesPage() {
  const router = useRouter();
  const [packages, setPackages] = useState<Package[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [creatives, setCreatives] = useState<AdCreative[]>([]);
  const [activeTab, setActiveTab] = useState<CreativePlatform>('thread');
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [aiModel, setAiModel] = useState<AiModel>('openai');
  const [generating, setGenerating] = useState(false);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/packages?status=approved&limit=100')
      .then(r => r.json())
      .then(d => setPackages(d.packages ?? []));
    fetch('/api/meta/campaigns')
      .then(r => r.json())
      .then(d => setCampaigns(d.campaigns ?? []));
  }, []);

  const fetchCreatives = useCallback(async (packageId: string) => {
    if (!packageId) return;
    const res = await fetch(`/api/meta/creatives?package_id=${packageId}`);
    const data = await res.json();
    setCreatives(data.creatives ?? []);
  }, []);

  const handleGenerate = async () => {
    if (!selectedPackageId) {
      setError('상품을 먼저 선택해주세요.');
      return;
    }
    setError('');
    setGenerating(true);
    try {
      const res = await fetch('/api/meta/creatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package_id: selectedPackageId, ai_model: aiModel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '생성 실패');
        return;
      }
      setCreatives(data.creatives ?? []);
    } finally {
      setGenerating(false);
    }
  };

  const handleDeploy = async (creativeId: string, campaignId: string) => {
    if (!campaignId) {
      alert('배포할 캠페인을 선택해주세요.');
      return;
    }
    setDeploying(creativeId);
    try {
      const res = await fetch('/api/meta/creatives/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creative_id: creativeId, campaign_id: campaignId }),
      });
      const data = await res.json();
      if (res.ok) {
        fetchCreatives(selectedPackageId);
        alert('Meta에 배포 완료!');
      } else {
        alert(`배포 실패: ${data.error}`);
      }
    } finally {
      setDeploying(null);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const tabCreatives = creatives.filter(c => c.platform === activeTab);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI 광고 소재 생성기</h1>
          <p className="text-sm text-gray-500">상품 데이터 기반 플랫폼별 30종 카피 자동 생성</p>
        </div>
        <button
          onClick={() => router.push('/admin/marketing')}
          className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          ← 대시보드
        </button>
      </div>

      {/* 생성 컨트롤 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">소재 생성 설정</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-600">상품 선택 *</label>
            <select
              value={selectedPackageId}
              onChange={e => {
                setSelectedPackageId(e.target.value);
                fetchCreatives(e.target.value);
              }}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">상품 선택...</option>
              {packages.map(p => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.destination})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600">AI 모델</label>
            <select
              value={aiModel}
              onChange={e => setAiModel(e.target.value as AiModel)}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              {(Object.entries(MODEL_LABELS) as [AiModel, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={handleGenerate}
              disabled={generating || !selectedPackageId}
              className="w-full py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {generating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⏳</span> 생성 중 (최대 30초)...
                </span>
              ) : (
                '🎨 30개 변형 생성'
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>
        )}

        {generating && (
          <div className="mt-3 bg-blue-50 text-blue-600 text-sm p-3 rounded-lg">
            💡 스레드(10) + 인스타그램(10) + 블로그(10) 변형을 동시에 생성하고 있습니다...
          </div>
        )}
      </div>

      {/* 소재 목록 */}
      {creatives.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* 플랫폼 탭 */}
          <div className="flex border-b border-gray-100">
            {(['thread', 'instagram', 'blog'] as CreativePlatform[]).map(p => {
              const cnt = creatives.filter(c => c.platform === p).length;
              return (
                <button
                  key={p}
                  onClick={() => setActiveTab(p)}
                  className={`px-5 py-3 text-sm font-medium transition-colors ${
                    activeTab === p
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {PLATFORM_LABELS[p]} ({cnt})
                </button>
              );
            })}
          </div>

          {/* 소재 카드 목록 */}
          <div className="p-4 space-y-4">
            {tabCreatives.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                이 플랫폼의 소재가 없습니다.
              </p>
            ) : (
              tabCreatives.map(creative => (
                <CreativeCard
                  key={creative.id}
                  creative={creative}
                  campaigns={campaigns}
                  deploying={deploying}
                  copied={copied}
                  onCopy={handleCopy}
                  onDeploy={handleDeploy}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CreativeCard({
  creative,
  campaigns,
  deploying,
  copied,
  onCopy,
  onDeploy,
}: {
  creative: AdCreative;
  campaigns: Campaign[];
  deploying: string | null;
  copied: string | null;
  onCopy: (id: string, text: string) => void;
  onDeploy: (creativeId: string, campaignId: string) => void;
}) {
  const [selectedCampaign, setSelectedCampaign] = useState('');

  const fullText = creative.headline
    ? `${creative.headline}\n\n${creative.body_copy}`
    : creative.body_copy;

  return (
    <div className={`border rounded-xl p-4 ${creative.is_deployed ? 'border-green-200 bg-green-50' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-gray-400">#{creative.variant_index}</span>
            {creative.is_deployed && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                ✓ 배포됨
              </span>
            )}
            <span className="text-xs text-gray-400">{creative.ai_model}</span>
          </div>
          {creative.headline && (
            <p className="text-sm font-semibold text-gray-800 mb-1">{creative.headline}</p>
          )}
          <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">
            {creative.body_copy}
          </p>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <button
            onClick={() => onCopy(creative.id, fullText)}
            className="text-xs px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50"
          >
            {copied === creative.id ? '✓ 복사됨' : '복사'}
          </button>
        </div>
      </div>

      {/* 배포 섹션 */}
      {!creative.is_deployed && (
        <div className="mt-3 flex items-center gap-2 pt-3 border-t border-gray-100">
          <select
            value={selectedCampaign}
            onChange={e => setSelectedCampaign(e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
          >
            <option value="">캠페인 선택...</option>
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            onClick={() => onDeploy(creative.id, selectedCampaign)}
            disabled={deploying === creative.id || !selectedCampaign}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
          >
            {deploying === creative.id ? '배포 중...' : 'Meta에 배포'}
          </button>
        </div>
      )}
    </div>
  );
}
