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
  const [textInput, setTextInput] = useState('');
  const [textUploading, setTextUploading] = useState(false);

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
    if (status === 'done') return <span className="text-green-600 text-[13px] font-medium">완료</span>;
    if (status === 'error') return <span className="text-red-600 text-[13px] font-medium">오류</span>;
    if (status === 'processing') return <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />;
    return <span className="text-slate-500 text-[13px]">대기</span>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[16px] font-semibold text-slate-800">문서 업로드</h1>
        <p className="text-[13px] text-slate-500 mt-1">최대 50개 파일을 한꺼번에 드래그하면 AI가 순차적으로 자동 처리합니다</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 업로드 영역 */}
        <div className="space-y-4">
          {/* 드래그 존 */}
          <div className="bg-white p-5 rounded-lg border border-slate-200">
            <div
              onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition cursor-pointer ${
                dragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <svg className="mx-auto h-10 w-10 text-slate-400 mb-3" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                <path d="M28 8H12a4 4 0 00-4 4v20a4 4 0 004 4h24a4 4 0 004-4V20m-18-8v12m0 0l-4-4m4 4l4-4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-slate-800 text-[14px] font-medium mb-1">파일을 드래그하거나 클릭하여 선택</p>
              <p className="text-[11px] text-slate-500 mb-1">PDF, JPG, PNG, HWP -- 최대 50개, 파일당 10MB</p>
              <p className="text-[11px] text-blue-600">[랜드사_커미션%]상품명.pdf 형식으로 파일명 작성 시 자동 추출</p>
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
            <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600">
              <p className="font-semibold mb-1 text-slate-800">파일명 규칙 (선택)</p>
              <p><span className="font-mono bg-slate-100 px-1 rounded">[모두투어_10%]다낭3박4일.pdf</span> -- 랜드사: 모두투어, 커미션: 10%</p>
              <p className="mt-0.5 text-slate-500">규칙 없는 파일도 정상 처리됩니다.</p>
            </div>
          </div>

          {/* 텍스트 직접 붙여넣기 */}
          <div className="bg-white p-5 rounded-lg border border-slate-200">
            <p className="text-[13px] font-semibold text-slate-800 mb-2">또는 텍스트 직접 붙여넣기</p>
            <textarea
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              placeholder="PDF에서 복사한 여행상품 텍스트를 붙여넣으세요..."
              className="w-full h-40 p-3 border border-slate-200 rounded-lg text-[12px] text-slate-700 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] text-slate-400">{textInput.length > 0 ? `${textInput.length}자` : 'PDF 파싱 없이 바로 AI 추출'}</span>
              <button
                onClick={async () => {
                  if (!textInput.trim() || textUploading) return;
                  setTextUploading(true);
                  try {
                    const res = await fetch('/api/upload', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ rawText: textInput.trim() }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || '업로드 실패');
                    const count = data.productCount || 1;
                    const titles = data.titles || [data.data?.extractedData?.title || '상품'];
                    setQueue(prev => [...prev, {
                      file: new File([], '텍스트 입력'),
                      status: 'done',
                      title: count > 1 ? `${count}개 상품 자동 등록` : titles[0],
                      productCount: count,
                      titles,
                    }]);
                    setTextInput('');
                    alert(`${count}개 상품이 등록되었습니다:\n${titles.join('\n')}`);
                  } catch (err) {
                    alert(err instanceof Error ? err.message : '업로드 실패');
                  } finally {
                    setTextUploading(false);
                  }
                }}
                disabled={!textInput.trim() || textUploading}
                className="px-4 py-2 bg-[#001f3f] text-white rounded-lg text-[12px] font-medium hover:bg-[#003366] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {textUploading ? '처리 중...' : '텍스트 업로드'}
              </button>
            </div>
          </div>

          {/* 큐 컨트롤 */}
          {queue.length > 0 && (
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              {/* 프로그레스 바 */}
              <div className="mb-3">
                <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                  <span>
                    {isRunning
                      ? `처리 중: ${doneCount + errorCount}/${queue.length} 완료`
                      : doneCount + errorCount === queue.length
                        ? `완료: ${doneCount}개 성공${errorCount > 0 ? ` / ${errorCount}개 오류` : ''}`
                        : `대기: ${waitingCount}개 파일`}
                  </span>
                  <span>{progressPct}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div
                    className="bg-[#001f3f] h-2 rounded-full transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                {waitingCount > 0 && !isRunning && (
                  <button
                    onClick={startQueue}
                    className="flex-1 bg-[#001f3f] text-white py-2 rounded text-[13px] font-medium hover:bg-blue-900 transition"
                  >
                    {queue.length}개 처리 시작
                  </button>
                )}
                {isRunning && (
                  <div className="flex-1 flex items-center justify-center gap-2 py-2 text-[13px] text-blue-600">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    AI 처리 중...
                  </div>
                )}
                {!isRunning && (
                  <>
                    {doneCount > 0 && (
                      <button
                        onClick={() => router.push('/admin/packages')}
                        className="flex-1 bg-white border border-slate-300 text-slate-700 py-2 rounded text-[13px] hover:bg-slate-50 transition"
                      >
                        상품 목록에서 확인
                      </button>
                    )}
                    <button
                      onClick={resetQueue}
                      className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded text-[13px] hover:bg-slate-50 transition"
                    >
                      초기화
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* AI 추출 항목 안내 */}
          <div className="p-4 bg-white border border-slate-200 rounded-lg">
            <p className="text-[11px] font-semibold text-slate-800 mb-2">AI 자동 추출 항목</p>
            <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-600">
              <span>- 상품명/카테고리/타입</span>
              <span>- 날짜별 성인/아동 가격</span>
              <span>- 발권마감/최소인원</span>
              <span>- 써차지/항공제외일</span>
              <span>- 포함/불포함/선택관광</span>
              <span>- 취소환불 규정</span>
              <span>- 출발요일/항공편</span>
              <span>- 일정표 전체</span>
            </div>
          </div>
        </div>

        {/* 큐 결과 목록 */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800 text-[14px]">처리 목록</h2>
            {queue.length > 0 && (
              <span className="text-[11px] text-slate-500">{queue.length}개 파일</span>
            )}
          </div>

          {queue.length === 0 ? (
            <div className="text-center text-slate-500 py-16 text-[13px]">
              파일을 추가하면 여기에 표시됩니다
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              {queue.map((item, i) => (
                <div key={i} className={`flex items-start gap-3 px-4 py-2 border-b border-slate-200 last:border-b-0 ${item.status === 'processing' ? 'bg-blue-50' : ''}`}>
                  <div className="mt-0.5 flex-shrink-0">{statusIcon(item.status)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-slate-800 truncate">
                      {item.status === 'done' ? (item.title || item.file.name) : item.file.name}
                    </p>
                    {item.status === 'done' && (
                      <div className="mt-0.5">
                        {item.productCount && item.productCount > 1 ? (
                          <div>
                            <span className="text-[11px] font-semibold text-blue-600">{item.productCount}개 상품 자동 등록</span>
                            <ul className="mt-1 space-y-0.5">
                              {item.titles?.map((t, idx) => (
                                <li key={idx} className="text-[11px] text-slate-500">- {t}</li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <div className="flex gap-2 flex-wrap">
                            {item.confidence != null && (
                              <span className={`text-[11px] ${item.confidence >= 0.8 ? 'text-green-600' : item.confidence >= 0.6 ? 'text-yellow-600' : 'text-red-500'}`}>
                                신뢰도 {Math.round(item.confidence * 100)}%
                              </span>
                            )}
                            {item.landOperator && (
                              <span className="text-[11px] text-blue-600">{item.landOperator}</span>
                            )}
                            {item.commissionRate != null && (
                              <span className="text-[11px] text-green-600 font-medium">커미션 {item.commissionRate}%</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {item.status === 'error' && (
                      <p className="text-[11px] text-red-500 mt-0.5">{item.errorMsg}</p>
                    )}
                    {item.status === 'waiting' && (
                      <p className="text-[11px] text-slate-500">대기 중</p>
                    )}
                    {item.status === 'processing' && (
                      <p className="text-[11px] text-blue-500">AI 분석 중...</p>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 flex-shrink-0">
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
