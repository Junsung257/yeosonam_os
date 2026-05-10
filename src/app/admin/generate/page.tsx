'use client';

import { useState, useEffect } from 'react';
import { PageHeader, FormRow } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Sparkles, GitCompare } from 'lucide-react';

// AI 모델 타입
type AIModel = 'openai' | 'claude' | 'gemini';

// 여행 상품 데이터 인터페이스
interface TravelPackage {
  id: string;
  title: string;
  destination: string;
  duration: number;
  price: number;
  description?: string;
  itinerary?: string[];
  inclusions?: string[];
  exclusions?: string[];
  parsedData?: {
    요금: string;
    일정: string;
    써차지: string;
    [key: string]: string;
  };
}

export default function GeneratePage() {
  const [packages, setPackages] = useState<TravelPackage[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<TravelPackage | null>(null);
  const [contentType, setContentType] = useState<string>('description');
  const [selectedModel, setSelectedModel] = useState<AIModel>('gemini');
  const [generatedContent, setGeneratedContent] = useState<string>('');
  const [comparisonResults, setComparisonResults] = useState<Record<AIModel, string> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [error, setError] = useState<string>('');

  // DB에서 승인된 패키지 로드 (없으면 샘플 데이터 사용)
  useEffect(() => {
    const samplePackages: TravelPackage[] = [
      {
        id: 'sample-1',
        title: '제주도 3박 4일 패키지 (샘플)',
        destination: '제주도',
        duration: 4,
        price: 450000,
        parsedData: {
          요금: '450,000원',
          일정: '제주공항 도착 → 성산일출봉 → 우도 → 한라산 등반 → 용두암 → 공항 출발',
          써차지: '항공료, 숙박비, 식사 3회, 가이드비 포함',
        },
      },
      {
        id: 'sample-2',
        title: '부산 해운대 2박 3일 (샘플)',
        destination: '부산',
        duration: 3,
        price: 320000,
        parsedData: {
          요금: '320,000원',
          일정: '부산역 도착 → 해운대 해수욕장 → 태종대 → 감천문화마을 → 출발',
          써차지: '기차표, 호텔 숙박, 조식 포함',
        },
      },
    ];

    fetch('/api/packages')
      .then((res) => res.json())
      .then((data) => {
        if (data.packages && data.packages.length > 0) {
          setPackages(
            data.packages.map((p: any) => ({
              id: p.id,
              title: p.title,
              destination: p.destination || '',
              duration: p.duration || 0,
              price: p.price || 0,
              itinerary: p.itinerary,
              inclusions: p.inclusions,
              parsedData: p.raw_text
                ? { 요금: `${(p.price || 0).toLocaleString()}원`, 일정: p.itinerary?.join(' → ') || '', 써차지: '' }
                : undefined,
            }))
          );
        } else {
          setPackages(samplePackages);
        }
      })
      .catch(() => setPackages(samplePackages));
  }, []);

  const handleGenerate = async () => {
    if (!selectedPackage) {
      setError('여행 상품을 선택해주세요.');
      return;
    }

    setIsLoading(true);
    setError('');
    setGeneratedContent('');

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          packageData: selectedPackage,
          contentType,
          model: selectedModel,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '생성 실패');
      }

      setGeneratedContent(data.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : '콘텐츠 생성에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompare = async () => {
    if (!selectedPackage) {
      setError('여행 상품을 선택해주세요.');
      return;
    }

    setIsComparing(true);
    setError('');
    setComparisonResults(null);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          packageData: selectedPackage,
          contentType,
          compare: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '비교 실패');
      }

      setComparisonResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : '비교 생성에 실패했습니다.');
    } finally {
      setIsComparing(false);
    }
  };

  const contentTypeOptions = [
    { value: 'description', label: '상품 소개글' },
    { value: 'itinerary', label: '상세 일정' },
    { value: 'inclusions', label: '포함/불포함 사항' },
    { value: 'highlights', label: '주요 하이라이트' }
  ];

  const modelOptions: { value: AIModel; label: string }[] = [
    { value: 'openai', label: 'OpenAI GPT-4' },
    { value: 'claude', label: 'Anthropic Claude' },
    { value: 'gemini', label: 'Google Gemini' }
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI 콘텐츠 생성"
        subtitle="여행 상품을 선택하고 AI로 자동 콘텐츠를 생성하세요"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 설정 패널 */}
        <div className="admin-card p-5">
          <h2 className="text-admin-h3 text-admin-text mb-5">생성 설정</h2>

          <div className="space-y-4 mb-5">
            <FormRow label="여행 상품 선택">
              <select
                value={selectedPackage?.id || ''}
                onChange={(e) => {
                  const pkg = packages.find(p => p.id === e.target.value);
                  setSelectedPackage(pkg || null);
                }}
                className="w-full h-9 px-3 text-admin-base border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
              >
                <option value="">상품을 선택하세요</option>
                {packages.map(pkg => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.title} — {pkg.price.toLocaleString()}원
                  </option>
                ))}
              </select>
            </FormRow>

            <FormRow label="콘텐츠 타입">
              <select
                value={contentType}
                onChange={(e) => setContentType(e.target.value)}
                className="w-full h-9 px-3 text-admin-base border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
              >
                {contentTypeOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormRow>

            <FormRow label="AI 모델">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as AIModel)}
                className="w-full h-9 px-3 text-admin-base border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
              >
                {modelOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormRow>
          </div>

          {/* 버튼들 */}
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={handleGenerate}
              disabled={isLoading || !selectedPackage}
              className="flex-1"
            >
              <Sparkles size={14} />
              {isLoading ? '생성 중…' : '콘텐츠 생성'}
            </Button>
            <Button
              variant="secondary"
              onClick={handleCompare}
              disabled={isComparing || !selectedPackage}
              className="flex-1"
            >
              <GitCompare size={14} />
              {isComparing ? '비교 중…' : '모델 비교'}
            </Button>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-danger-light border border-danger/20 text-danger rounded-admin-sm text-admin-sm">
              {error}
            </div>
          )}
        </div>

        {/* 결과 패널 */}
        <div className="admin-card p-5">
          <h2 className="text-admin-h3 text-admin-text mb-5">생성 결과</h2>

          {generatedContent && (
            <div className="mb-5">
              <h3 className="text-admin-base font-medium text-admin-text-2 mb-2">생성된 콘텐츠</h3>
              <div className="p-4 bg-admin-surface-2 border border-admin-border-mid rounded-admin-sm whitespace-pre-wrap text-admin-sm text-admin-text-2 leading-relaxed">
                {generatedContent}
              </div>
            </div>
          )}

          {comparisonResults && (
            <div>
              <h3 className="text-admin-base font-medium text-admin-text-2 mb-2">모델 비교 결과</h3>
              <div className="space-y-2">
                {Object.entries(comparisonResults).map(([model, content]) => (
                  <div key={model} className="border border-admin-border-mid rounded-admin-sm p-4 bg-admin-surface-2">
                    <h4 className="font-semibold text-brand text-admin-xs mb-2 uppercase tracking-wider">
                      {model === 'openai' ? 'OpenAI GPT-4' :
                       model === 'claude' ? 'Anthropic Claude' :
                       'Google Gemini'}
                    </h4>
                    <div className="text-admin-text-2 whitespace-pre-wrap text-admin-sm leading-relaxed">
                      {content}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!generatedContent && !comparisonResults && (
            <div className="text-center text-admin-muted py-12 text-admin-base">
              생성된 콘텐츠가 여기에 표시됩니다
            </div>
          )}
        </div>
      </div>

      {/* 선택된 상품 정보 */}
      {selectedPackage && (
        <div className="admin-card p-5">
          <h2 className="text-admin-h3 text-admin-text mb-4">선택된 상품 정보</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="font-medium text-admin-text text-admin-base">{selectedPackage.title}</h3>
              <p className="text-admin-muted text-admin-sm">{selectedPackage.destination} · <span className="admin-num">{selectedPackage.duration}</span>일</p>
              <p className="text-admin-base font-semibold text-brand mt-1 admin-num">{selectedPackage.price.toLocaleString()}원</p>
            </div>
            {selectedPackage.parsedData && (
              <div>
                <h4 className="font-medium text-admin-text text-admin-base mb-2">파싱된 데이터</h4>
                <div className="text-admin-sm text-admin-muted space-y-1">
                  {Object.entries(selectedPackage.parsedData).map(([key, value]) => (
                    <div key={key}>
                      <span className="font-medium text-admin-text-2">{key}:</span> {value}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
