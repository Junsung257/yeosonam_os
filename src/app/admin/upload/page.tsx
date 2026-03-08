'use client';

import { useState } from 'react';

interface ParsedData {
  title?: string;
  destination?: string;
  duration?: number;
  price?: number;
  itinerary?: string[];
  inclusions?: string[];
  excludes?: string[];
  accommodations?: string[];
  specialNotes?: string;
  rawText: string;
}

interface UploadResult {
  filename: string;
  fileType: 'pdf' | 'image' | 'hwp';
  extractedData: ParsedData;
  confidence: number;
  parsedAt: string;
}

export default function UploadPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      handleFile(files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (file: File) => {
    if (!file) return;

    setIsLoading(true);
    setError('');
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '업로드 실패');
      }

      setUploadResult(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '파일 처리 실패');
    } finally {
      setIsLoading(false);
    }
  };

  const ConfidenceBadge = ({ confidence }: { confidence: number }) => {
    const percentage = Math.round(confidence * 100);
    const color =
      percentage >= 80 ? 'bg-green-100 text-green-800' :
      percentage >= 60 ? 'bg-yellow-100 text-yellow-800' :
      'bg-red-100 text-red-800';

    return (
      <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${color}`}>
        신뢰도: {percentage}%
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">문서 업로드</h1>
          <p className="text-gray-600">여행사 일정표, 상품금액표를 업로드하면 자동으로 데이터를 추출합니다</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 업로드 영역 */}
          <div className="bg-white p-8 rounded-lg shadow">
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition ${
                dragActive
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300 bg-gray-50 hover:border-gray-400'
              }`}
            >
              <div className="mb-4">
                <svg
                  className="mx-auto h-12 w-12 text-gray-400"
                  stroke="currentColor"
                  fill="none"
                  viewBox="0 0 48 48"
                  aria-hidden="true"
                >
                  <path
                    d="M28 8H12a4 4 0 00-4 4v20a4 4 0 004 4h24a4 4 0 004-4V20m-18-8v12m0 0l-4-4m4 4l4-4"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <p className="text-gray-900 font-medium mb-2">
                파일을 여기에 드래그하거나 클릭하여 선택
              </p>
              <p className="text-sm text-gray-500 mb-4">
                PDF, JPG, PNG, HWP (최대 10MB)
              </p>

              <input
                type="file"
                onChange={handleFileInput}
                accept=".pdf,.jpg,.jpeg,.png,.hwp"
                className="hidden"
                id="file-input"
                disabled={isLoading}
              />
              <label htmlFor="file-input">
                <button
                  onClick={() => document.getElementById('file-input')?.click()}
                  disabled={isLoading}
                  className="inline-block bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
                >
                  {isLoading ? '처리 중...' : '파일 선택'}
                </button>
              </label>
            </div>

            {error && (
              <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
                {error}
              </div>
            )}
          </div>

          {/* 결과 영역 */}
          <div className="bg-white p-8 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-6">추출 결과</h2>

            {uploadResult ? (
              <div className="space-y-6">
                <div>
                  <h3 className="font-medium text-gray-900 mb-2">파일 정보</h3>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>
                      <span className="font-medium">파일명:</span> {uploadResult.filename}
                    </p>
                    <p>
                      <span className="font-medium">파일 타입:</span>{' '}
                      {uploadResult.fileType.toUpperCase()}
                    </p>
                    <p className="mt-2">
                      <ConfidenceBadge confidence={uploadResult.confidence} />
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="font-medium text-gray-900 mb-2">추출된 데이터</h3>
                  <div className="bg-gray-50 p-4 rounded space-y-3 text-sm">
                    {uploadResult.extractedData.title && (
                      <div>
                        <span className="font-medium">상품명:</span>{' '}
                        {uploadResult.extractedData.title}
                      </div>
                    )}

                    {uploadResult.extractedData.destination && (
                      <div>
                        <span className="font-medium">목적지:</span>{' '}
                        {uploadResult.extractedData.destination}
                      </div>
                    )}

                    {uploadResult.extractedData.duration && (
                      <div>
                        <span className="font-medium">기간:</span>{' '}
                        {uploadResult.extractedData.duration}일
                      </div>
                    )}

                    {uploadResult.extractedData.price && (
                      <div>
                        <span className="font-medium">가격:</span>{' '}
                        {uploadResult.extractedData.price.toLocaleString()}원
                      </div>
                    )}

                    {uploadResult.extractedData.specialNotes && (
                      <div>
                        <span className="font-medium">특별 안내:</span>{' '}
                        {uploadResult.extractedData.specialNotes}
                      </div>
                    )}
                  </div>
                </div>

                {uploadResult.extractedData.itinerary && uploadResult.extractedData.itinerary.length > 0 && (
                  <div>
                    <h3 className="font-medium text-gray-900 mb-2">일정</h3>
                    <ul className="text-sm text-gray-600 space-y-1">
                      {uploadResult.extractedData.itinerary.map((item, idx) => (
                        <li key={idx}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {uploadResult.extractedData.inclusions && uploadResult.extractedData.inclusions.length > 0 && (
                  <div>
                    <h3 className="font-medium text-gray-900 mb-2">포함 사항</h3>
                    <ul className="text-sm text-gray-600 space-y-1">
                      {uploadResult.extractedData.inclusions.slice(0, 5).map((item, idx) => (
                        <li key={idx}>✓ {item}</li>
                      ))}
                      {uploadResult.extractedData.inclusions.length > 5 && (
                        <li>... 외 {uploadResult.extractedData.inclusions.length - 5}개</li>
                      )}
                    </ul>
                  </div>
                )}

                <button
                  onClick={() => setUploadResult(null)}
                  className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 transition"
                >
                  데이터 저장 및 새 파일 업로드
                </button>
              </div>
            ) : (
              <div className="text-center text-gray-500 py-12">
                {isLoading ? '파일을 처리 중입니다...' : '업로드된 파일이 없습니다'}
              </div>
            )}
          </div>
        </div>

        {/* 팁 섹션 */}
        <div className="mt-8 bg-blue-50 border border-blue-200 p-6 rounded-lg">
          <h3 className="font-semibold text-blue-900 mb-3">💡 최상의 결과를 위한 팁</h3>
          <ul className="text-sm text-blue-800 space-y-2">
            <li>• PDF는 스캔 문서보다 텍스트 기반 PDF가 더 정확합니다</li>
            <li>• 이미지는 선명하고 잘 보이는 것을 사용해주세요</li>
            <li>• 한글과 숫자가 명확하게 보이는 문서를 추천합니다</li>
            <li>• 복잡한 표는 텍스트로 변환되지 않을 수 있습니다</li>
          </ul>
        </div>
      </div>
    </div>
  );
}