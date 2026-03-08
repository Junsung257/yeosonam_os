'use client';

import { useState, useEffect } from 'react';

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

  // 샘플 데이터 (실제로는 Supabase에서 가져옴)
  useEffect(() => {
    const samplePackages: TravelPackage[] = [
      {
        id: '1',
        title: '제주도 3박 4일 패키지',
        destination: '제주도',
        duration: 4,
        price: 450000,
        parsedData: {
          요금: '450,000원',
          일정: '제주공항 도착 → 성산일출봉 → 우도 → 한라산 등반 → 용두암 → 공항 출발',
          써차지: '항공료, 숙박비, 식사 3회, 가이드비 포함'
        }
      },
      {
        id: '2',
        title: '부산 해운대 2박 3일',
        destination: '부산',
        duration: 3,
        price: 320000,
        parsedData: {
          요금: '320,000원',
          일정: '부산역 도착 → 해운대 해수욕장 → 태종대 → 감천문화마을 → 출발',
          써차지: '기차표, 호텔 숙박, 조식 포함'
        }
      }
    ];
    setPackages(samplePackages);
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
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">AI 콘텐츠 생성</h1>
          <p className="text-gray-600">여행 상품을 선택하고 AI로 자동 콘텐츠를 생성하세요</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 설정 패널 */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-6">생성 설정</h2>

            {/* 여행 상품 선택 */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                여행 상품 선택
              </label>
              <select
                value={selectedPackage?.id || ''}
                onChange={(e) => {
                  const pkg = packages.find(p => p.id === e.target.value);
                  setSelectedPackage(pkg || null);
                }}
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">상품을 선택하세요</option>
                {packages.map(pkg => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.title} - {pkg.price.toLocaleString()}원
                  </option>
                ))}
              </select>
            </div>

            {/* 콘텐츠 타입 선택 */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                콘텐츠 타입
              </label>
              <select
                value={contentType}
                onChange={(e) => setContentType(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {contentTypeOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* AI 모델 선택 */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                AI 모델
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as AIModel)}
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {modelOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 버튼들 */}
            <div className="flex gap-4">
              <button
                onClick={handleGenerate}
                disabled={isLoading || !selectedPackage}
                className="flex-1 bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
              >
                {isLoading ? '생성 중...' : '콘텐츠 생성'}
              </button>

              <button
                onClick={handleCompare}
                disabled={isComparing || !selectedPackage}
                className="flex-1 bg-green-600 text-white py-3 px-4 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
              >
                {isComparing ? '비교 중...' : '모델 비교'}
              </button>
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                {error}
              </div>
            )}
          </div>

          {/* 결과 패널 */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-6">생성 결과</h2>

            {generatedContent && (
              <div className="mb-6">
                <h3 className="text-lg font-medium mb-3">생성된 콘텐츠</h3>
                <div className="p-4 bg-gray-50 rounded-md whitespace-pre-wrap text-gray-800">
                  {generatedContent}
                </div>
              </div>
            )}

            {comparisonResults && (
              <div>
                <h3 className="text-lg font-medium mb-3">모델 비교 결과</h3>
                <div className="space-y-4">
                  {Object.entries(comparisonResults).map(([model, content]) => (
                    <div key={model} className="border rounded-md p-4">
                      <h4 className="font-medium text-gray-900 mb-2 capitalize">
                        {model === 'openai' ? 'OpenAI GPT-4' :
                         model === 'claude' ? 'Anthropic Claude' :
                         'Google Gemini'}
                      </h4>
                      <div className="text-gray-700 whitespace-pre-wrap text-sm">
                        {content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!generatedContent && !comparisonResults && (
              <div className="text-center text-gray-500 py-12">
                생성된 콘텐츠가 여기에 표시됩니다
              </div>
            )}
          </div>
        </div>

        {/* 선택된 상품 정보 */}
        {selectedPackage && (
          <div className="mt-8 bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">선택된 상품 정보</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-medium text-gray-900">{selectedPackage.title}</h3>
                <p className="text-gray-600">{selectedPackage.destination} - {selectedPackage.duration}일</p>
                <p className="text-lg font-semibold text-blue-600">{selectedPackage.price.toLocaleString()}원</p>
              </div>
              {selectedPackage.parsedData && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">파싱된 데이터</h4>
                  <div className="text-sm text-gray-600 space-y-1">
                    {Object.entries(selectedPackage.parsedData).map(([key, value]) => (
                      <div key={key}>
                        <span className="font-medium">{key}:</span> {value}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}