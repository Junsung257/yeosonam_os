'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithSessionRefresh } from '@/lib/fetch-with-session-refresh';

interface VerifyCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  detail?: string;
}

interface QueueItem {
  id: string;
  file: File;
  rawText?: string;
  status: 'waiting' | 'processing' | 'done' | 'error';
  dbId?: string;
  title?: string;
  confidence?: number;
  landOperator?: string;
  commissionRate?: number;
  errorMsg?: string;
  productCount?: number;
  titles?: string[];
  tokenUsage?: {
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cacheHitTokens: number;
    costUsd: number;
    elapsed_ms?: number;
  };
  gate?: string;
  verifyStatus?: 'verifying' | 'clean' | 'warnings' | 'blocked';
  verifyReport?: { checks: VerifyCheck[]; warnCount: number; failCount: number };
  verifyExpanded?: boolean;
}

// 서버가 비-JSON 응답(오류 페이지, 게이트웨이 타임아웃 등)을 반환할 때도 안전하게 파싱
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeResJson(res: Response): Promise<any> {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return res.json().catch(() => {
      throw new Error(`서버 응답 파싱 오류 (HTTP ${res.status})`);
    });
  }
  const text = await res.text().catch(() => '');
  const preview = text.slice(0, 200).replace(/<[^>]+>/g, '').trim();
  throw new Error(preview || `서버 오류 (HTTP ${res.status})`);
}

const MAX_CONCURRENT = 5;

export default function UploadPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [textInput, setTextInput] = useState('');

  const activeCountRef = useRef(0);
  const pendingTextRef = useRef<Array<{ id: string; rawText: string }>>([]);
  const bulkModeRef = useRef(false);
  bulkModeRef.current = bulkMode;
  const itemSeqRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [addedFlash, setAddedFlash] = useState(false);

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.hwpx'];
    const valid = arr.filter(f => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      return allowed.includes(ext);
    }).slice(0, 50);

    setQueue(prev => [
      ...prev,
      ...valid.map(f => ({
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f,
        status: 'waiting' as const,
      })),
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
    const uploadUrl = bulkModeRef.current ? '/api/upload?mode=bulk' : '/api/upload';
    const res = await fetchWithSessionRefresh(uploadUrl, { method: 'POST', body: formData });
    const data = await safeResJson(res);
    if (!res.ok) throw new Error(data.error || '업로드 실패');

    const ed = data.data?.extractedData;
    const match = file.name.match(/^\[([^_\]]+)_(\d+(?:\.\d+)?)%?\]/);
    return {
      dbId: data.dbId,
      title: data.productCount > 1 ? `${data.productCount}개 상품` : (ed?.title || file.name),
      confidence: data.data?.confidence,
      landOperator: match ? match[1] : ed?.land_operator,
      commissionRate: match ? parseFloat(match[2]) : undefined,
      productCount: data.productCount,
      titles: data.titles,
      tokenUsage: data.tokenUsage ?? null,
      gate: data.gate ?? null,
    };
  };

  const startQueue = async () => {
    if (isRunning) return;
    setIsRunning(true);

    const items = [...queue];
    for (let i = 0; i < items.length; i++) {
      if (items[i].status !== 'waiting' || items[i].rawText) continue;

      setQueue(prev => prev.map(it => it.id === items[i].id ? { ...it, status: 'processing' } : it));

      try {
        const result = await uploadSingle(items[i].file);
        setQueue(prev => prev.map(it => it.id === items[i].id ? { ...it, status: 'done', ...result } : it));
        if (result.dbId) runVerify(items[i].id, result.dbId);
      } catch (err) {
        setQueue(prev => prev.map(it =>
          it.id === items[i].id ? { ...it, status: 'error', errorMsg: err instanceof Error ? err.message : '오류' } : it
        ));
      }
    }

    setIsRunning(false);
  };

  const runVerify = useCallback(async (id: string, dbId: string) => {
    setQueue(prev => prev.map(it => it.id === id ? { ...it, verifyStatus: 'verifying' } : it));
    try {
      const res = await fetchWithSessionRefresh('/api/admin/upload/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: dbId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setQueue(prev => prev.map(it => it.id === id ? {
        ...it,
        verifyStatus: data.status as QueueItem['verifyStatus'],
        verifyReport: { checks: data.checks, warnCount: data.warnCount, failCount: data.failCount },
      } : it));
    } catch {
      setQueue(prev => prev.map(it => it.id === id ? { ...it, verifyStatus: undefined } : it));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 텍스트 아이템 병렬 처리 — refs만 사용하므로 deps 불필요
  const processTextItem = useCallback(async (id: string, rawText: string) => {
    setQueue(prev => prev.map(it => it.id === id ? { ...it, status: 'processing' } : it));

    try {
      const uploadUrl = bulkModeRef.current ? '/api/upload?mode=bulk' : '/api/upload';
      const res = await fetchWithSessionRefresh(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText }),
      });
      const data = await safeResJson(res);
      if (!res.ok) throw new Error((data.error as string) || '처리 실패');

      const ed = data.data?.extractedData;
      const count = data.productCount || 1;
      const titles = data.titles || [ed?.title || '상품'];
      const dbId: string | undefined = data.dbId;

      setQueue(prev => prev.map(it => it.id === id ? {
        ...it,
        status: 'done',
        title: count > 1 ? `${count}개 상품` : (titles[0] || '상품'),
        productCount: count,
        titles,
        dbId,
        confidence: data.data?.confidence,
        landOperator: ed?.land_operator,
        tokenUsage: data.tokenUsage ?? null,
        gate: data.gate ?? null,
      } : it));

      if (dbId) runVerify(id, dbId);
    } catch (err) {
      setQueue(prev => prev.map(it => it.id === id ? {
        ...it,
        status: 'error',
        errorMsg: err instanceof Error ? err.message : '오류',
      } : it));
    } finally {
      activeCountRef.current--;
      const next = pendingTextRef.current.shift();
      if (next) {
        activeCountRef.current++;
        processTextItem(next.id, next.rawText);
      }
    }
  }, [runVerify]); // eslint-disable-line react-hooks/exhaustive-deps

  const addTextToQueue = () => {
    if (!textInput.trim()) return;
    const chunks = textInput.split(/={3,}/).map(s => s.trim()).filter(s => s.length > 50);
    if (chunks.length === 0) { alert('텍스트가 너무 짧습니다.'); return; }

    const now = Date.now();
    const newItems: QueueItem[] = chunks.map((chunk, i) => {
      itemSeqRef.current++;
      return {
        id: `text-${now}-${i}`,
        file: new File([], `텍스트 #${itemSeqRef.current}`),
        rawText: chunk,
        status: 'waiting',
        title: '대기 중...',
      };
    });

    setQueue(prev => [...prev, ...newItems]);
    setTextInput('');
    // 성공 피드백: 짧은 flash 후 textarea 자동 포커스
    setAddedFlash(true);
    setTimeout(() => {
      setAddedFlash(false);
      textareaRef.current?.focus();
    }, 800);

    for (const item of newItems) {
      if (activeCountRef.current < MAX_CONCURRENT) {
        activeCountRef.current++;
        processTextItem(item.id, item.rawText!);
      } else {
        pendingTextRef.current.push({ id: item.id, rawText: item.rawText! });
      }
    }
  };

  const resetQueue = () => {
    if (isRunning) return;
    pendingTextRef.current = [];
    setQueue([]);
  };

  // 실패 아이템 재시도
  const retryItem = useCallback((item: QueueItem) => {
    if (!item.rawText) return; // 파일 아이템은 별도 처리
    setQueue(prev => prev.map(it => it.id === item.id ? { ...it, status: 'waiting', errorMsg: undefined, verifyStatus: undefined } : it));
    if (activeCountRef.current < MAX_CONCURRENT) {
      activeCountRef.current++;
      processTextItem(item.id, item.rawText);
    } else {
      pendingTextRef.current.push({ id: item.id, rawText: item.rawText });
    }
  }, [processTextItem]);

  const doneCount = queue.filter(q => q.status === 'done').length;
  const errorCount = queue.filter(q => q.status === 'error').length;
  const waitingFileCount = queue.filter(q => q.status === 'waiting' && !q.rawText).length;
  const processingCount = queue.filter(q => q.status === 'processing').length;
  const progressPct = queue.length > 0 ? Math.round((doneCount + errorCount) / queue.length * 100) : 0;

  const statusIcon = (status: QueueItem['status']) => {
    if (status === 'done') return <span className="text-green-600 text-[13px] font-medium">완료</span>;
    if (status === 'error') return <span className="text-red-600 text-[13px] font-medium">오류</span>;
    if (status === 'processing') return <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />;
    return <span className="text-slate-500 text-[13px]">대기</span>;
  };

  const textChunkCount = textInput.split(/={3,}/).filter(s => s.trim().length > 50).length || (textInput.trim().length > 50 ? 1 : 0);

  // 세션 비용 집계 (파생값 — 별도 state 불필요)
  const completedItems = queue.filter(q => q.status === 'done' && q.tokenUsage);
  const totalCostUsd = completedItems.reduce((s, q) => s + (q.tokenUsage?.costUsd ?? 0), 0);
  const totalProducts = completedItems.reduce((s, q) => s + (q.productCount ?? 1), 0);
  const avgCostPerProduct = totalProducts > 0 ? totalCostUsd / totalProducts : 0;
  const cacheSavedUsd = completedItems.reduce((s, q) => {
    if (!q.tokenUsage || q.tokenUsage.cacheHitTokens === 0) return s;
    const rate = q.tokenUsage.provider === 'deepseek' ? (0.14 - 0.014) : (0.30 - 0.019);
    return s + q.tokenUsage.cacheHitTokens / 1_000_000 * rate;
  }, 0);
  const dominantProvider = completedItems.length > 0
    ? (completedItems.filter(q => q.tokenUsage?.provider === 'deepseek').length >= completedItems.length / 2 ? 'deepseek' : 'gemini')
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[16px] font-semibold text-slate-800">문서 업로드</h1>
        <p className="text-[13px] text-slate-500 mt-1">
          텍스트를 붙여넣고 &ldquo;큐에 추가&rdquo;를 누르면 즉시 처리 시작 — 처리 중에도 계속 추가 가능, 최대 {MAX_CONCURRENT}개 병렬
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
              <p className="text-[11px] text-slate-500 mb-1">PDF, JPG, PNG, HWP, HWPX — 최대 50개, 파일당 10MB</p>
              <p className="text-[11px] text-blue-600">[랜드사_커미션%]상품명.pdf 형식으로 파일명 작성 시 자동 추출</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.hwp,.hwpx"
                onChange={e => e.target.files && addFiles(e.target.files)}
                className="hidden"
              />
            </div>

            <div className="mt-3 flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={bulkMode} onChange={e => setBulkMode(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <span className="text-sm font-medium text-slate-700">⚡ 벌크 모드</span>
              </label>
              <span className="text-[11px] text-slate-500">{bulkMode ? '분류/마케팅/관광지 스킵 → 2배 빠름' : '전체 처리 (기본)'}</span>
            </div>

            <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600">
              <p className="font-semibold mb-1 text-slate-800">파일명 규칙 (선택)</p>
              <p><span className="font-mono bg-slate-100 px-1 rounded">[모두투어_10%]다낭3박4일.pdf</span> — 랜드사: 모두투어, 커미션: 10%</p>
              <p className="mt-0.5 text-slate-500">규칙 없는 파일도 정상 처리됩니다.</p>
            </div>
          </div>

          {/* 텍스트 병렬 처리 영역 */}
          <div className="bg-white p-5 rounded-lg border border-blue-200 ring-1 ring-blue-100">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[13px] font-semibold text-slate-800">텍스트 직접 붙여넣기</p>
              {processingCount > 0 && (
                <span className="text-[11px] text-blue-600 font-medium flex items-center gap-1.5">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  {processingCount}개 처리 중
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mb-2">
              <span className="font-mono bg-slate-100 px-1 rounded">===</span>로 구분해서 한번에 여러 개 추가 가능.{' '}
              <span className="text-blue-600 font-medium">처리 중에도 계속 추가</span> — 최대 {MAX_CONCURRENT}개 동시 처리
            </p>
            {addedFlash && (
              <div className="mb-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg text-[12px] text-green-700 font-medium flex items-center gap-1.5 animate-pulse">
                <span>✓</span> 큐에 추가됨 — 다음 상품 붙여넣기 가능
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  addTextToQueue();
                }
              }}
              placeholder={"상품1 원문 (랜드사명·커미션 포함해도 자동 마스킹)\n\n===\n\n상품2 원문...\n\n===\n\n상품3 원문..."}
              className={`w-full h-48 p-3 border rounded-lg text-[12px] text-slate-700 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                addedFlash ? 'border-green-300 bg-green-50/30' : 'border-slate-200'
              }`}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] text-slate-400">
                {textInput.length > 0
                  ? `${textInput.length}자 · ${textChunkCount}개 감지 · Ctrl+Enter로 빠른 추가`
                  : '원문 그대로 붙여넣기 — 랜드사명·커미션은 자동 마스킹'}
              </span>
              <button
                onClick={addTextToQueue}
                disabled={!textInput.trim()}
                className="px-4 py-2 bg-[#001f3f] text-white rounded-lg text-[12px] font-medium hover:bg-[#003366] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                큐에 추가 →
                {textChunkCount > 0 && (
                  <span className="bg-white text-[#001f3f] text-[10px] font-bold px-1.5 py-0.5 rounded">
                    {textChunkCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* 큐 컨트롤 */}
          {queue.length > 0 && (
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <div className="mb-3">
                <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                  <span>
                    {processingCount > 0
                      ? `${processingCount}개 병렬 처리 중 · 완료 ${doneCount}/${queue.length}`
                      : doneCount + errorCount === queue.length
                        ? `완료: ${doneCount}개 성공${errorCount > 0 ? ` / ${errorCount}개 오류` : ''}`
                        : `파일 대기: ${waitingFileCount}개`}
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
                {waitingFileCount > 0 && !isRunning && (
                  <button
                    onClick={startQueue}
                    className="flex-1 bg-[#001f3f] text-white py-2 rounded text-[13px] font-medium hover:bg-blue-900 transition"
                  >
                    파일 {waitingFileCount}개 처리 시작
                  </button>
                )}
                {isRunning && (
                  <div className="flex-1 flex items-center justify-center gap-2 py-2 text-[13px] text-blue-600">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    파일 AI 처리 중...
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

          {/* 세션 비용 요약 */}
          {completedItems.length > 0 && (
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <p className="text-[11px] font-semibold text-slate-800 mb-2 flex items-center gap-1.5">
                {dominantProvider === 'deepseek' ? '🔵' : '🟡'} 세션 비용 요약
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                <span className="text-slate-500">처리 완료</span>
                <span className="font-medium text-slate-800">{totalProducts}개 상품 ({completedItems.length}건)</span>

                <span className="text-slate-500">총 비용</span>
                <span className="font-mono font-semibold text-slate-800">
                  ${totalCostUsd.toFixed(5)}
                </span>

                <span className="text-slate-500">상품당 평균</span>
                <span className="font-mono text-slate-700">${avgCostPerProduct.toFixed(5)}</span>

                {cacheSavedUsd > 0 && (
                  <>
                    <span className="text-slate-500">캐시 절감</span>
                    <span className="font-mono text-green-600">
                      ${cacheSavedUsd.toFixed(5)}
                      {totalCostUsd + cacheSavedUsd > 0 && (
                        <span className="text-[10px] text-slate-400 ml-1">
                          ({Math.round(cacheSavedUsd / (totalCostUsd + cacheSavedUsd) * 100)}% 절약)
                        </span>
                      )}
                    </span>
                  </>
                )}
              </div>
              <p className="text-[10px] text-slate-400 mt-2">파싱 AI 비용 기준 (DeepSeek/Gemini). 관광지 매칭 등 부가 비용 미포함.</p>
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
            <p className="text-[10px] text-slate-400 mt-2">
              랜드사명·커미션·원가 등 민감정보는 내부 필드에만 저장 — 블로그/카드뉴스용 원문에서 자동 마스킹
            </p>
          </div>
        </div>

        {/* 처리 목록 — 최신순 */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800 text-[14px]">처리 목록</h2>
            {queue.length > 0 && (
              <span className="text-[11px] text-slate-500">{queue.length}개 · 완료 {doneCount}</span>
            )}
          </div>

          {queue.length === 0 ? (
            <div className="text-center text-slate-500 py-16 text-[13px]">
              텍스트를 붙여넣고 &ldquo;큐에 추가 →&rdquo;를 누르세요
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              {[...queue].reverse().map((item) => (
                <div
                  key={item.id}
                  className={`flex items-start gap-3 px-4 py-2 border-b border-slate-200 last:border-b-0 ${item.status === 'processing' ? 'bg-blue-50' : ''}`}
                >
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
                            {item.gate && item.gate !== 'CLEAN' && (
                              <span className={`text-[11px] font-medium ${item.gate === 'BLOCKED' ? 'text-red-600' : item.gate === 'REVIEW_NEEDED' ? 'text-orange-500' : 'text-yellow-600'}`}>
                                {item.gate}
                              </span>
                            )}
                            {item.landOperator && (
                              <span className="text-[11px] text-blue-600">{item.landOperator}</span>
                            )}
                            {item.commissionRate != null && (
                              <span className="text-[11px] text-green-600 font-medium">커미션 {item.commissionRate}%</span>
                            )}
                            {item.tokenUsage && (
                              <span className="text-[11px] text-slate-400" title={`in:${item.tokenUsage.inputTokens} out:${item.tokenUsage.outputTokens} cache:${item.tokenUsage.cacheHitTokens}`}>
                                {item.tokenUsage.provider === 'deepseek' ? '🔵' : '🟡'} ${item.tokenUsage.costUsd.toFixed(5)}{item.tokenUsage.cacheHitTokens > 0 ? ' ⚡캐시' : ''}
                              </span>
                            )}
                          </div>
                        )}
                        {/* 원문 대조 검증 결과 */}
                        {item.verifyStatus === 'verifying' && (
                          <div className="flex items-center gap-1 mt-1">
                            <div className="w-2.5 h-2.5 border border-slate-400 border-t-transparent rounded-full animate-spin" />
                            <span className="text-[10px] text-slate-400">원문 대조 검증 중...</span>
                          </div>
                        )}
                        {item.verifyStatus === 'clean' && (
                          <span className="inline-block mt-1 text-[10px] text-green-600 font-medium">✓ 원문 대조 통과</span>
                        )}
                        {(item.verifyStatus === 'warnings' || item.verifyStatus === 'blocked') && item.verifyReport && (
                          <div className="mt-1">
                            <button
                              onClick={() => setQueue(prev => prev.map(it => it.id === item.id ? { ...it, verifyExpanded: !it.verifyExpanded } : it))}
                              className={`text-[10px] font-medium flex items-center gap-1 ${item.verifyStatus === 'blocked' ? 'text-red-500' : 'text-yellow-600'}`}
                            >
                              {item.verifyStatus === 'blocked' ? '✗' : '⚠'} 원문 대조 {item.verifyReport.warnCount + item.verifyReport.failCount}건
                              <span className="text-slate-400">{item.verifyExpanded ? '▲' : '▼'}</span>
                            </button>
                            {item.verifyExpanded && (
                              <ul className="mt-1 space-y-0.5 pl-2 border-l-2 border-slate-200">
                                {item.verifyReport.checks.filter(c => c.status === 'warn' || c.status === 'fail').map(c => (
                                  <li key={c.id} className="text-[10px] text-slate-500">
                                    <span className={c.status === 'fail' ? 'text-red-500' : 'text-yellow-600'}>[{c.id}] {c.label}</span>
                                    {c.detail && ` — ${c.detail}`}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {item.status === 'error' && (
                      <div className="mt-0.5 flex items-start gap-2">
                        <p className="text-[11px] text-red-500 flex-1 leading-snug">{item.errorMsg}</p>
                        {item.rawText && (
                          <button
                            onClick={() => retryItem(item)}
                            className="flex-shrink-0 text-[10px] font-medium text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-1.5 py-0.5 hover:bg-blue-50 transition"
                          >
                            재시도
                          </button>
                        )}
                      </div>
                    )}
                    {item.status === 'waiting' && (
                      <p className="text-[11px] text-slate-500">대기 중</p>
                    )}
                    {item.status === 'processing' && (
                      <p className="text-[11px] text-blue-500">AI 분석 중...</p>
                    )}
                  </div>
                  {!item.rawText && (
                    <div className="text-[11px] text-slate-500 flex-shrink-0">
                      {(item.file.size / 1024).toFixed(0)}KB
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
