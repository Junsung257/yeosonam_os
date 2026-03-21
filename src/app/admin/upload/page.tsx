'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface QueueItem {
  file: File;
  status: 'waiting' | 'processing' | 'done' | 'error';
  dbId?: string;
  title?: string;
  confidence?: number;
  landOperator?: string;
  commissionRate?: number;
  errorMsg?: string;
  // 복수 상품 추출 결과
  productCount?: number;
  titles?: string[];
}

export default function UploadPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [archiveMode, setArchiveMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp'];
    const valid = arr.filter(f => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      return allowed.includes(ext);
    }).slice(0, 50);

    setQueue(prev => [
      ...prev,
      ...valid.map(f => ({ file: f, status: 'waiting' as const })),
    ]);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const uploadSingle = async (file: File): Promise<Partial<QueueItem>> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '업로드 실패');

    const ed = data.data?.extractedData;
    // 파일명에서 커미션 파싱 (로컬 미리보기용)
    const match = file.name.match(/^\[([^_\]]+)_(\d+(?:\.\d+)?)%?\]/);
    return {
      dbId: data.dbId,
      title: data.productCount > 1 ? `${data.productCount}개 상품` : (ed?.title || file.name),
      confidence: data.data?.confidence,
      landOperator: match ? match[1] : ed?.land_operator,
      commissionRate: match ? parseFloat(match[2]) : undefined,
      productCount: data.productCount,
      titles: data.titles,
    };
  };

  const startQueue = async () => {
    if (isRunning) return;
    setIsRunning(true);

    const items = [...queue];
    for (let i = 0; i < items.length; i++) {
      if (items[i].status !== 'waiting') continue;

      setQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'processing' } : it));

      try {
        const result = await uploadSingle(items[i].file);
        setQueue(prev => prev.map((it, idx) =>
          idx === i ? { ...it, status: 'done', ...result } : it
        ));
      } catch (err) {
        setQueue(prev => prev.map((it, idx) =>
          idx === i ? { ...it, status: 'error', errorMsg: err instanceof Error ? err.message : '오류' } : it
        ));
      }
    }

    setIsRunning(false);
  };

  const resetQueue = () => {
    if (isRunning) return;
    setQueue([]);
  };

  const doneCount = queue.filter(q => q.status === 'done').length;
  const errorCount = queue.filter(q => q.status === 'error').length;
  const waitingCount = queue.filter(q => q.status === 'waiting').length;
  const progressPct = queue.length > 0 ? Math.round((doneCount + errorCount) / queue.length * 100) : 0;

  const statusIcon = (status: QueueItem['status']) => {
    if (status === 'done') return <span className="text-green-500 text-base">✅</span>;
    if (status === 'error') return <span className="text-red-500 text-base">❌</span>;
    if (status === 'processing') return <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />;
    return <span className="text-gray-300 text-base">⬜</span>;
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">문서 업로드</h1>
        <p className="text-sm text-gray-500 mt-1">최대 50개 파일을 한꺼번에 드래그하면 AI가 순차적으로 자동 처리합니다</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 업로드 영역 */}
        <div className="space-y-4">
          {/* 드래그 존 */}
          <div className="bg-white p-5 rounded-xl border border-gray-200">
            <div
              onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition cursor-pointer ${
                dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:border-gray-400'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <svg className="mx-auto h-10 w-10 text-gray-400 mb-3" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                <path d="M28 8H12a4 4 0 00-4 4v20a4 4 0 004 4h24a4 4 0 004-4V20m-18-8v12m0 0l-4-4m4 4l4-4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-gray-900 font-medium mb-1">파일을 드래그하거나 클릭하여 선택</p>
              <p className="text-xs text-gray-500 mb-1">PDF, JPG, PNG, HWP — 최대 50개, 파일당 10MB</p>
              <p className="text-xs text-blue-600">[랜드사_커미션%]상품명.pdf 형식으로 파일명 작성 시 자동 추출</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.hwp"
                onChange={e => e.target.files && addFiles(e.target.files)}
                className="hidden"
              />
            </div>

            {/* 파일명 규칙 안내 */}
            <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
              <p className="font-semibold mb-1">파일명 규칙 (선택)</p>
              <p><span className="font-mono bg-yellow-100 px-1 rounded">[모두투어_10%]다낭3박4일.pdf</span> → 랜드사: 모두투어, 커미션: 10%</p>
              <p className="mt-0.5 text-yellow-600">규칙 없는 파일도 정상 처리됩니다.</p>
            </div>
          </div>

          {/* 큐 컨트롤 */}
          {queue.length > 0 && (
            <div className="bg-white p-4 rounded-xl border border-gray-200">
              {/* 프로그레스 바 */}
              <div className="mb-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>
                    {isRunning
                      ? `처리 중: ${doneCount + errorCount}/${queue.length} 완료`
                      : doneCount + errorCount === queue.length
                        ? `완료: ${doneCount}개 성공${errorCount > 0 ? ` / ${errorCount}개 오류` : ''}`
                        : `대기: ${waitingCount}개 파일`}
                  </span>
                  <span>{progressPct}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                {waitingCount > 0 && !isRunning && (
                  <button
                    onClick={startQueue}
                    className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
                  >
                    {queue.length}개 처리 시작
                  </button>
                )}
                {isRunning && (
                  <div className="flex-1 flex items-center justify-center gap-2 py-2 text-sm text-blue-600">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    AI 처리 중...
                  </div>
                )}
                {!isRunning && (
                  <>
                    {doneCount > 0 && (
                      <button
                        onClick={() => router.push('/admin/packages')}
                        className="flex-1 border border-green-500 text-green-700 py-2 rounded-lg text-sm hover:bg-green-50 transition"
                      >
                        상품 목록에서 확인 →
                      </button>
                    )}
                    <button
                      onClick={resetQueue}
                      className="px-4 py-2 border border-gray-300 text-gray-500 rounded-lg text-sm hover:bg-gray-50 transition"
                    >
                      초기화
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* AI 추출 항목 안내 */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs font-semibold text-blue-800 mb-2">AI 자동 추출 항목</p>
            <div className="grid grid-cols-2 gap-1 text-xs text-blue-700">
              <span>✓ 상품명/카테고리/타입</span>
              <span>✓ 날짜별 성인/아동 가격</span>
              <span>✓ 발권마감/최소인원</span>
              <span>✓ 써차지/항공제외일</span>
              <span>✓ 포함/불포함/선택관광</span>
              <span>✓ 취소환불 규정</span>
              <span>✓ 출발요일/항공편</span>
              <span>✓ 일정표 전체</span>
            </div>
          </div>
        </div>

        {/* 큐 결과 목록 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 text-sm">처리 목록</h2>
            {queue.length > 0 && (
              <span className="text-xs text-gray-400">{queue.length}개 파일</span>
            )}
          </div>

          {queue.length === 0 ? (
            <div className="text-center text-gray-400 py-16 text-sm">
              파일을 추가하면 여기에 표시됩니다
            </div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
              {queue.map((item, i) => (
                <div key={i} className={`flex items-start gap-3 px-4 py-3 ${item.status === 'processing' ? 'bg-blue-50' : ''}`}>
                  <div className="mt-0.5 flex-shrink-0">{statusIcon(item.status)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {item.status === 'done' ? (item.title || item.file.name) : item.file.name}
                    </p>
                    {item.status === 'done' && (
                      <div className="mt-0.5">
                        {item.productCount && item.productCount > 1 ? (
                          <div>
                            <span className="text-xs font-semibold text-blue-600">{item.productCount}개 상품 자동 등록 ✅</span>
                            <ul className="mt-1 space-y-0.5">
                              {item.titles?.map((t, idx) => (
                                <li key={idx} className="text-xs text-gray-500">• {t}</li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <div className="flex gap-2 flex-wrap">
                            {item.confidence != null && (
                              <span className={`text-xs ${item.confidence >= 0.8 ? 'text-green-600' : item.confidence >= 0.6 ? 'text-yellow-600' : 'text-red-500'}`}>
                                신뢰도 {Math.round(item.confidence * 100)}%
                              </span>
                            )}
                            {item.landOperator && (
                              <span className="text-xs text-blue-600">{item.landOperator}</span>
                            )}
                            {item.commissionRate != null && (
                              <span className="text-xs text-green-600 font-medium">커미션 {item.commissionRate}%</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {item.status === 'error' && (
                      <p className="text-xs text-red-500 mt-0.5">{item.errorMsg}</p>
                    )}
                    {item.status === 'waiting' && (
                      <p className="text-xs text-gray-400">대기 중</p>
                    )}
                    {item.status === 'processing' && (
                      <p className="text-xs text-blue-500">AI 분석 중...</p>
                    )}
                  </div>
                  <div className="text-xs text-gray-300 flex-shrink-0">
                    {(item.file.size / 1024).toFixed(0)}KB
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
