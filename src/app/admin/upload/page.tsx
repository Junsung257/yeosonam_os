'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithSessionRefresh } from '@/lib/fetch-with-session-refresh';
import { STANDARD_PRODUCT_MARKDOWN_TEMPLATE } from '@/lib/standard-product-markdown';

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
  sourceLabel?: string;
  status: 'waiting' | 'processing' | 'done' | 'error';
  dbId?: string;
  dbIds?: string[];
  title?: string;
  confidence?: number;
  landOperator?: string;
  commissionRate?: number;
  trustScore?: {
    score: number;
    grade: 'perfect' | 'review' | 'blocked';
    publishable: boolean;
    blockers: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
  } | null;
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
  /** C3 박제 (2026-05-15): 등록 직후 관광지 매칭/시드 통계 UX 노출 */
  attractionStats?: {
    matched: number;
    unmatched: number;
    seeded: number;
    reflected: number;
  };
  /** Y5 박제 (2026-05-15 SKILL.md Step 7-C): 등록 직후 한 화면 표준 리포트 */
  registerReport?: Array<{
    package_id: string;
    short_code: string | null;
    title: string | null;
    price: number | null;
    airline: string | null;
    status: string | null;
    departure_days: string | null;
    mobile_url: string;
    lp_url: string;
    a4_url: string;
    price_rows_saved?: number | null;
    price_dates_count?: number;
    itinerary_days_count?: number;
    commission_rate?: number | null;
    land_operator?: string | null;
  }>;
  verifyStatus?: 'verifying' | 'clean' | 'warnings' | 'blocked' | 'skipped' | 'error';
  verifyReport?: {
    checks: VerifyCheck[];
    warnCount: number;
    failCount: number;
    packageResults?: PackageVerifyResult[];
  };
  verifyExpanded?: boolean;
  verifyError?: string;
  /** Hybrid v2: 어떤 필드를 결정적으로 회복했는지 (UX 디버그) */
  deterministicRecovered?: string[];
  /** 2026-05-19 박제 (PR #128 + UI 보강):
   *  catalog regex 가 헤더 N개 감지했는데 multiProducts=null 로 1상품 silent fallback.
   *  사장님 인지 보장 — UI 에 빨간 경고 + /admin/alerts 링크.
   */
  catalogSplitWarning?: { headerCount: number; processedCount: number };
}

interface PackageVerifyResult {
  packageId: string;
  status: Exclude<QueueItem['verifyStatus'], 'verifying'>;
  checks: VerifyCheck[];
  warnCount: number;
  failCount: number;
  error?: string;
}

interface PendingTextItem {
  id: string;
  rawText: string;
  sourceLabel?: string;
  landOperator?: string;
  commissionRate?: number;
}

type VerifyDisplayStatus = NonNullable<QueueItem['verifyStatus']>;

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

const MAX_CONCURRENT = 1;

const DESTINATION_HINTS = [
  '백두산', '연길', '장가계', '몽골', '다낭', '나트랑', '푸꾸옥', '보홀', '세부',
  '오사카', '도쿄', '후쿠오카', '대만', '타이페이', '방콕', '파타야', '발리',
  '홍콩', '마카오', '하노이', '호치민', '싱가포르', '코타키나발루',
];

function compactText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function inferTextLabel(rawText: string, fallback: string): string {
  const head = rawText.slice(0, 5000);
  const supplier =
    head.match(/\[([^\]_\n]{2,20})(?:_\d+(?:\.\d+)?%?)?\]/)?.[1] ??
    head.match(/(?:랜드사|공급사|거래처)\s*[:：]\s*([^\n]{2,20})/)?.[1] ??
    null;
  const destination =
    DESTINATION_HINTS.find(dest => head.includes(dest)) ??
    head.match(/(?:여행지|지역|목적지)\s*[:：]\s*([^\n]{2,20})/)?.[1] ??
    null;
  const duration =
    head.match(/(\d+\s*박\s*\d+\s*일)/)?.[1] ??
    head.match(/(\d+\s*일)/)?.[1] ??
    null;
  const airline =
    head.match(/(에어부산|대한항공|아시아나|제주항공|진에어|티웨이|BX\s*\d{3,4}|KE\s*\d{3,4}|OZ\s*\d{3,4}|7C\s*\d{3,4})/)?.[1] ??
    null;
  const parts = [supplier, destination, duration, airline].map(compactText).filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : fallback;
}

function reportLabel(report: QueueItem['registerReport']): string | null {
  if (!report || report.length === 0) return null;
  const first = report[0];
  const title = compactText(first.title);
  const code = compactText(first.short_code);
  const suffix = report.length > 1 ? ` 외 ${report.length - 1}개` : '';
  return [title, code].filter(Boolean).join(' · ') + suffix;
}

function itemLabel(item: QueueItem): string {
  return (
    reportLabel(item.registerReport) ??
    compactText(item.title) ??
    compactText(item.sourceLabel) ??
    compactText(item.file.name) ??
    '상품'
  );
}

function packageIdsForItem(item: Partial<Pick<QueueItem, 'dbId' | 'dbIds' | 'registerReport'>>): string[] {
  const ids = [
    ...(Array.isArray(item.dbIds) ? item.dbIds : []),
    ...(item.registerReport ?? []).map(row => row.package_id),
    item.dbId,
  ];
  return [...new Set(ids.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}

function isPublicPackageStatus(status: string | null | undefined): boolean {
  const normalized = (status ?? '').toLowerCase();
  return ['active', 'approved', 'selling', 'available', 'published'].includes(normalized);
}

function verifyStatusLabel(status: VerifyDisplayStatus | undefined): string {
  if (status === 'verifying') return '검증 중';
  if (status === 'clean') return '검증 통과';
  if (status === 'warnings') return '경고';
  if (status === 'blocked') return '차단';
  if (status === 'error') return '검증 오류';
  if (status === 'skipped') return '검증 스킵';
  return '검증 대기';
}

function verifyStatusClass(status: VerifyDisplayStatus | undefined): string {
  if (status === 'verifying') return 'bg-sky-100 text-sky-700 border-sky-200';
  if (status === 'clean') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'warnings') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (status === 'blocked') return 'bg-red-100 text-red-700 border-red-200';
  if (status === 'error') return 'bg-rose-100 text-rose-700 border-rose-200';
  if (status === 'skipped') return 'bg-slate-100 text-slate-600 border-slate-200';
  return 'bg-admin-surface-2 text-admin-muted border-admin-border';
}

function packageRowStatus(
  itemVerifyStatus: QueueItem['verifyStatus'],
  packageVerify: PackageVerifyResult | undefined,
): VerifyDisplayStatus | undefined {
  if (packageVerify) return packageVerify.status;
  if (itemVerifyStatus === 'verifying' || itemVerifyStatus === 'error') return itemVerifyStatus;
  return undefined;
}

function packageRowClass(status: VerifyDisplayStatus | undefined): string {
  if (status === 'blocked' || status === 'error') return 'bg-red-50 border-red-200';
  if (status === 'warnings') return 'bg-amber-50 border-amber-200';
  if (status === 'clean') return 'bg-green-50 border-green-200';
  if (status === 'verifying') return 'bg-sky-50 border-sky-200';
  return 'bg-admin-surface-2 border-admin-border';
}

function isPackageVerifyResult(value: unknown): value is PackageVerifyResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PackageVerifyResult>;
  return (
    typeof candidate.packageId === 'string' &&
    ['clean', 'warnings', 'blocked', 'skipped', 'error'].includes(String(candidate.status)) &&
    Array.isArray(candidate.checks) &&
    typeof candidate.warnCount === 'number' &&
    typeof candidate.failCount === 'number'
  );
}

function packageResultsFromResponse(data: unknown): PackageVerifyResult[] | undefined {
  const results = (data as { packageResults?: unknown } | null)?.packageResults;
  if (!Array.isArray(results)) return undefined;
  const normalized = results.filter(isPackageVerifyResult);
  return normalized.length > 0 ? normalized : undefined;
}

function firstVerifyIssue(result: PackageVerifyResult | undefined): string | null {
  if (!result) return null;
  if (result.error) return result.error;
  const issue = result.checks.find(check => check.status === 'fail' || check.status === 'warn');
  return issue ? `[${issue.id}] ${issue.label}${issue.detail ? ` - ${issue.detail}` : ''}` : null;
}

function uploadFailureMessage(data: any): string {
  const errors = Array.isArray(data?.errors)
    ? data.errors
        .map((e: any) => [e?.title, e?.error].filter(Boolean).join(': '))
        .filter(Boolean)
    : [];
  const message = data?.error || errors.join(' / ') || data?.message || '상품 등록에 실패했습니다.';
  return data?.uploadRequestId ? `${message} (uploadRequestId: ${data.uploadRequestId})` : message;
}

function uploadExceptionMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed to fetch|NetworkError|Load failed|The network connection was lost/i.test(message)) {
    return [
      '업로드 요청이 서버 응답 전에 끊겼습니다.',
      '같은 원문은 중복 방지 후 재시도되므로 잠시 후 다시 처리하세요.',
      '반복되면 최근 등록 상품/업로드 로그의 uploadRequestId 기준으로 확인해야 합니다.',
    ].join(' ');
  }
  return message;
}

export default function UploadPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  // 2026-05-15 박제: 강제 재처리 — 같은 텍스트 hash 가 archived/inactive 상품이 아니어도 재처리
  const [forceReprocess, setForceReprocess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [textInput, setTextInput] = useState('');
  const [textLandOperator, setTextLandOperator] = useState('');
  const [textCommissionRate, setTextCommissionRate] = useState('10');

  const activeCountRef = useRef(0);
  const pendingTextRef = useRef<PendingTextItem[]>([]);
  const bulkModeRef = useRef(false);
  bulkModeRef.current = bulkMode;
  const forceReprocessRef = useRef(false);
  forceReprocessRef.current = forceReprocess;

  /** 업로드 URL 생성 — bulk/force 옵션 query 조합 */
  const buildUploadUrl = (): string => {
    const params: string[] = [];
    if (bulkModeRef.current) params.push('mode=bulk');
    if (forceReprocessRef.current) params.push('force=1');
    return params.length > 0 ? `/api/upload?${params.join('&')}` : '/api/upload';
  };
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
    const uploadUrl = buildUploadUrl();
    const res = await fetchWithSessionRefresh(uploadUrl, { method: 'POST', body: formData });
    const data = await safeResJson(res);
    if (!res.ok) throw new Error(uploadFailureMessage(data));
    if (data?.success === false) throw new Error(uploadFailureMessage(data));

    const ed = data.data?.extractedData;
    const match = file.name.match(/^\[([^_\]]+)_(\d+(?:\.\d+)?)%?\]/);
    return {
      dbId: data.dbId,
      dbIds: Array.isArray(data.dbIds) ? data.dbIds : (data.dbId ? [data.dbId] : []),
      title: data.productCount > 1 ? `${data.productCount}개 상품` : (ed?.title || file.name),
      confidence: data.finalConfidence ?? data.data?.confidence,
      landOperator: data.uploadMetadata?.landOperator ?? (match ? match[1] : ed?.land_operator),
      commissionRate: data.uploadMetadata?.commissionRate ?? (match ? parseFloat(match[2]) : undefined),
      productCount: data.productCount,
      titles: data.titles,
      tokenUsage: data.tokenUsage ?? null,
      gate: data.gate ?? null,
      trustScore: data.trustScore ?? null,
      attractionStats: data.attractionStats ?? null,
      registerReport: data.registerReport ?? null,
      catalogSplitWarning: data.catalogSplitWarning ?? null,
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
        const packageIds = packageIdsForItem(result);
        if (packageIds.length > 0) runVerify(items[i].id, packageIds);
      } catch (err) {
        setQueue(prev => prev.map(it =>
          it.id === items[i].id ? { ...it, status: 'error', errorMsg: uploadExceptionMessage(err) } : it
        ));
      }
    }

    setIsRunning(false);
  };

  const runVerify = useCallback(async (id: string, packageIdsOrId: string[] | string) => {
    const packageIds = Array.isArray(packageIdsOrId) ? packageIdsOrId : [packageIdsOrId];
    setQueue(prev => prev.map(it => it.id === id ? { ...it, verifyStatus: 'verifying', verifyError: undefined } : it));
    try {
      const res = await fetchWithSessionRefresh('/api/admin/upload/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(packageIds.length === 1 ? { packageId: packageIds[0] } : { packageIds }),
      });
      const data = await res.json().catch(() => ({}));
      const packageResults = packageResultsFromResponse(data);
      if (!res.ok) {
        if (packageResults) {
          setQueue(prev => prev.map(it => it.id === id ? {
            ...it,
            verifyStatus: 'error' as QueueItem['verifyStatus'],
            verifyReport: {
              checks: packageResults.flatMap(result => result.checks),
              warnCount: packageResults.reduce((sum, result) => sum + result.warnCount, 0),
              failCount: packageResults.reduce((sum, result) => sum + result.failCount, 0),
              packageResults,
            },
            verifyError: data.error || `HTTP ${res.status}`,
          } : it));
          return;
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setQueue(prev => prev.map(it => it.id === id ? {
        ...it,
        verifyStatus: data.status as QueueItem['verifyStatus'],
        verifyReport: {
          checks: data.checks ?? [],
          warnCount: data.warnCount ?? 0,
          failCount: data.failCount ?? 0,
          packageResults,
        },
        verifyError: undefined,
      } : it));
    } catch (err) {
      // 401/네트워크/타임아웃 등 — UI 에 재시도 버튼 띄우기 위해 sentinel 상태로 표시
      setQueue(prev => prev.map(it => it.id === id ? {
        ...it,
        verifyStatus: 'error' as QueueItem['verifyStatus'],
        verifyError: err instanceof Error ? err.message : '검증 결과 수신 실패',
      } : it));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 텍스트 아이템 병렬 처리 — refs만 사용하므로 deps 불필요
  const processTextItem = useCallback(async (item: PendingTextItem) => {
    const { id, rawText } = item;
    setQueue(prev => prev.map(it => it.id === id ? { ...it, status: 'processing' } : it));

    try {
      const uploadUrl = buildUploadUrl();
      const res = await fetchWithSessionRefresh(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText,
          sourceLabel: item.sourceLabel,
          landOperator: item.landOperator,
          commissionRate: item.commissionRate,
        }),
      });
      const data = await safeResJson(res);
      if (!res.ok) throw new Error(uploadFailureMessage(data));
      if (data?.success === false) throw new Error(uploadFailureMessage(data));

      const ed = data.data?.extractedData;
      const count = data.productCount || 1;
      const titles = data.titles || [ed?.title || '상품'];
      const dbId: string | undefined = data.dbId;
      const dbIds = Array.isArray(data.dbIds) ? data.dbIds : (dbId ? [dbId] : []);
      const registerReport = data.registerReport ?? null;
      const labelFromReport = reportLabel(registerReport);

      setQueue(prev => prev.map(it => it.id === id ? {
        ...it,
        status: 'done',
        title: labelFromReport ?? (count > 1 ? `${count}개 상품 · ${it.sourceLabel ?? titles[0] ?? '상품'}` : (titles[0] || it.sourceLabel || '상품')),
        productCount: count,
        titles,
        dbId,
        dbIds,
        confidence: data.finalConfidence ?? data.data?.confidence,
        landOperator: data.uploadMetadata?.landOperator ?? item.landOperator ?? ed?.land_operator,
        commissionRate: data.uploadMetadata?.commissionRate ?? item.commissionRate,
        tokenUsage: data.tokenUsage ?? null,
        gate: data.gate ?? null,
        trustScore: data.trustScore ?? null,
        attractionStats: data.attractionStats ?? null,
        registerReport,
        catalogSplitWarning: data.catalogSplitWarning ?? null,
      } : it));

      const packageIds = packageIdsForItem({ dbId, dbIds, registerReport });
      if (packageIds.length > 0) runVerify(id, packageIds);
    } catch (err) {
      setQueue(prev => prev.map(it => it.id === id ? {
        ...it,
        status: 'error',
        errorMsg: uploadExceptionMessage(err),
      } : it));
    } finally {
      activeCountRef.current--;
      const next = pendingTextRef.current.shift();
      if (next) {
        activeCountRef.current++;
        processTextItem(next);
      }
    }
  }, [runVerify]); // eslint-disable-line react-hooks/exhaustive-deps

  const addTextToQueue = () => {
    if (!textInput.trim()) return;
    const chunks = textInput.split(/={3,}/).map(s => s.trim()).filter(s => s.length > 50);
    if (chunks.length === 0) { alert('텍스트가 너무 짧습니다.'); return; }

    const now = Date.now();
    const landOperator = textLandOperator.trim() || undefined;
    const commissionRate = Number(textCommissionRate);
    const safeCommissionRate = Number.isFinite(commissionRate) ? commissionRate : undefined;
    const newItems: QueueItem[] = chunks.map((chunk, i) => {
      itemSeqRef.current++;
      const fallback = `텍스트 #${itemSeqRef.current}`;
      const sourceLabel = inferTextLabel(chunk, fallback);
      return {
        id: `text-${now}-${i}`,
        file: new File([], sourceLabel),
        rawText: chunk,
        sourceLabel,
        landOperator,
        commissionRate: safeCommissionRate,
        status: 'waiting',
        title: sourceLabel,
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
        processTextItem({
          id: item.id,
          rawText: item.rawText!,
          sourceLabel: item.sourceLabel,
          landOperator: item.landOperator,
          commissionRate: item.commissionRate,
        });
      } else {
        pendingTextRef.current.push({
          id: item.id,
          rawText: item.rawText!,
          sourceLabel: item.sourceLabel,
          landOperator: item.landOperator,
          commissionRate: item.commissionRate,
        });
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
      processTextItem({
        id: item.id,
        rawText: item.rawText,
        sourceLabel: item.sourceLabel,
        landOperator: item.landOperator,
        commissionRate: item.commissionRate,
      });
    } else {
      pendingTextRef.current.push({
        id: item.id,
        rawText: item.rawText,
        sourceLabel: item.sourceLabel,
        landOperator: item.landOperator,
        commissionRate: item.commissionRate,
      });
    }
  }, [processTextItem]);

  const doneCount = queue.filter(q => q.status === 'done').length;
  const errorCount = queue.filter(q => q.status === 'error').length;
  const waitingFileCount = queue.filter(q => q.status === 'waiting' && !q.rawText).length;
  const processingCount = queue.filter(q => q.status === 'processing').length;
  const progressPct = queue.length > 0 ? Math.round((doneCount + errorCount) / queue.length * 100) : 0;

  const statusIcon = (status: QueueItem['status']) => {
    if (status === 'done') return <span className="text-green-600 text-admin-sm font-medium">업로드됨</span>;
    if (status === 'error') return <span className="text-red-600 text-admin-sm font-medium">오류</span>;
    if (status === 'processing') return <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />;
    return <span className="text-admin-muted text-admin-sm">대기</span>;
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
        <h1 className="text-admin-lg font-semibold text-admin-text-2">문서 업로드</h1>
        <p className="text-admin-sm text-admin-muted mt-1">
          텍스트를 붙여넣고 &ldquo;큐에 추가&rdquo;를 누르면 즉시 처리 시작 — 처리 중에도 계속 추가 가능, 최대 {MAX_CONCURRENT}개 병렬
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          {/* 드래그 존 */}
          <div className="bg-white p-5 rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <div
              onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition cursor-pointer ${
                dragActive ? 'border-blue-500 bg-blue-50' : 'border-admin-border-mid bg-admin-bg hover:border-admin-border-strong'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <svg className="mx-auto h-10 w-10 text-admin-muted-2 mb-3" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                <path d="M28 8H12a4 4 0 00-4 4v20a4 4 0 004 4h24a4 4 0 004-4V20m-18-8v12m0 0l-4-4m4 4l4-4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-admin-text-2 text-admin-base font-medium mb-1">파일을 드래그하거나 클릭하여 선택</p>
              <p className="text-[11px] text-admin-muted mb-1">PDF, JPG, PNG, HWP, HWPX — 최대 50개, 파일당 10MB</p>
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

            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={bulkMode} onChange={e => setBulkMode(e.target.checked)}
                  className="w-4 h-4 rounded border-admin-border-strong text-blue-600 focus:ring-blue-500" />
                <span className="text-sm font-medium text-admin-text-2">⚡ 벌크 모드</span>
              </label>
              <span className="text-[11px] text-admin-muted">{bulkMode ? '분류/마케팅/관광지 스킵 → 2배 빠름' : '전체 처리 (기본)'}</span>
              <label className="flex items-center gap-2 cursor-pointer ml-3 pl-3 border-l border-admin-border">
                <input type="checkbox" checked={forceReprocess} onChange={e => setForceReprocess(e.target.checked)}
                  className="w-4 h-4 rounded border-admin-border-strong text-orange-600 focus:ring-orange-500" />
                <span className="text-sm font-medium text-admin-text-2">🔁 강제 재처리</span>
              </label>
              <span className="text-[11px] text-admin-muted">{forceReprocess ? '중복 해시 차단 우회 (같은 텍스트도 새로 등록)' : 'archived 상품은 자동 재처리 OK'}</span>
            </div>

            <div className="mt-3 p-3 bg-admin-bg border border-admin-border-mid rounded-lg text-[11px] text-admin-muted">
              <p className="font-semibold mb-1 text-admin-text-2">파일명 규칙 (선택)</p>
              <p><span className="font-mono bg-admin-surface-2 px-1 rounded">[모두투어_10%]다낭3박4일.pdf</span> — 랜드사: 모두투어, 커미션: 10%</p>
              <p className="mt-0.5 text-admin-muted">규칙 없는 파일도 정상 처리됩니다.</p>
            </div>
          </div>

          {/* 텍스트 병렬 처리 영역 */}
          <div className="bg-white p-5 rounded-lg border border-blue-200 ring-1 ring-blue-100">
            <div className="flex items-center justify-between mb-1">
              <p className="text-admin-sm font-semibold text-admin-text-2">텍스트 직접 붙여넣기</p>
              {processingCount > 0 && (
                <span className="text-[11px] text-blue-600 font-medium flex items-center gap-1.5">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  {processingCount}개 처리 중
                </span>
              )}
            </div>
            <p className="text-[11px] text-admin-muted-2 mb-2">
              <span className="font-mono bg-admin-surface-2 px-1 rounded">===</span>로 구분해서 한번에 여러 개 추가 가능.{' '}
              <span className="text-blue-600 font-medium">처리 중에도 계속 추가</span> — 최대 {MAX_CONCURRENT}개 동시 처리
            </p>
            {addedFlash && (
              <div className="mb-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg text-admin-xs text-green-700 font-medium flex items-center gap-1.5 animate-pulse">
                <span>✓</span> 큐에 추가됨 — 다음 상품 붙여넣기 가능
              </div>
            )}
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-admin-border-mid bg-admin-bg px-3 py-2">
              <div>
                <p className="text-admin-xs font-semibold text-admin-text-2">YSN 표준 마크다운</p>
                <p className="text-[11px] text-admin-muted-2">이 형식은 AI 파싱을 건너뛰고 고객 랜딩용 구조로 바로 처리합니다.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setTextInput(prev => prev.trim() ? `${prev.trim()}\n\n===\n\n${STANDARD_PRODUCT_MARKDOWN_TEMPLATE}` : STANDARD_PRODUCT_MARKDOWN_TEMPLATE);
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }}
                className="flex-shrink-0 px-3 py-1.5 bg-admin-surface-2 text-admin-text-2 text-xs rounded-lg hover:bg-slate-200"
              >
                템플릿 넣기
              </button>
            </div>
            <div className="mb-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] font-medium text-admin-text-2 mb-1">랜드사</span>
                <input
                  value={textLandOperator}
                  onChange={e => setTextLandOperator(e.target.value)}
                  placeholder="예: 투어폰"
                  className="w-full rounded-lg border border-admin-border-mid px-3 py-2 text-admin-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-medium text-admin-text-2 mb-1">수수료율(%)</span>
                <input
                  value={textCommissionRate}
                  onChange={e => setTextCommissionRate(e.target.value)}
                  inputMode="decimal"
                  placeholder="예: 9"
                  className="w-full rounded-lg border border-admin-border-mid px-3 py-2 text-admin-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <p className="sm:col-span-2 text-[10px] text-admin-muted-2">
                내부 메타 전용입니다. 고객 화면, 모바일 LP, A4, 블로그/카드뉴스에는 노출하지 않습니다.
              </p>
            </div>
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
              className={`w-full h-48 p-3 border rounded-lg text-admin-xs text-admin-text-2 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                addedFlash ? 'border-green-300 bg-green-50/30' : 'border-admin-border-mid'
              }`}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] text-admin-muted-2">
                {textInput.length > 0
                  ? `${textInput.length}자 · ${textChunkCount}개 감지 · Ctrl+Enter로 빠른 추가`
                  : '원문 그대로 붙여넣기 — 랜드사명·커미션은 자동 마스킹'}
              </span>
              <button
                onClick={addTextToQueue}
                disabled={!textInput.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-admin-xs font-medium hover:bg-[#003366] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                큐에 추가 →
                {textChunkCount > 0 && (
                  <span className="bg-white text-blue-600 text-[10px] font-bold px-1.5 py-0.5 rounded">
                    {textChunkCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* 큐 컨트롤 */}
          {queue.length > 0 && (
            <div className="bg-white p-4 rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
              <div className="mb-3">
                <div className="flex justify-between text-[11px] text-admin-muted mb-1">
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
                    className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                {waitingFileCount > 0 && !isRunning && (
                  <button
                    onClick={startQueue}
                    className="flex-1 bg-blue-600 text-white py-2 rounded text-admin-sm font-medium hover:bg-blue-700 transition"
                  >
                    파일 {waitingFileCount}개 처리 시작
                  </button>
                )}
                {isRunning && (
                  <div className="flex-1 flex items-center justify-center gap-2 py-2 text-admin-sm text-blue-600">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    파일 AI 처리 중...
                  </div>
                )}
                {!isRunning && (
                  <>
                    {doneCount > 0 && (
                      <button
                        onClick={() => router.push('/admin/packages')}
                        className="flex-1 bg-white border border-admin-border-strong text-admin-text-2 py-2 rounded text-admin-sm hover:bg-admin-bg transition"
                      >
                        상품 목록에서 확인
                      </button>
                    )}
                    <button
                      onClick={resetQueue}
                      className="px-4 py-2 bg-white border border-admin-border-strong text-admin-text-2 rounded text-admin-sm hover:bg-admin-bg transition"
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
            <div className="bg-white p-4 rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
              <p className="text-[11px] font-semibold text-admin-text-2 mb-2 flex items-center gap-1.5">
                {dominantProvider === 'deepseek' ? '🔵' : '🟡'} 세션 비용 요약
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                <span className="text-admin-muted">처리 완료</span>
                <span className="font-medium text-admin-text-2">{totalProducts}개 상품 ({completedItems.length}건)</span>

                <span className="text-admin-muted">총 비용</span>
                <span className="font-mono font-semibold text-admin-text-2">
                  ${totalCostUsd.toFixed(5)}
                </span>

                <span className="text-admin-muted">상품당 평균</span>
                <span className="font-mono text-admin-text-2">${avgCostPerProduct.toFixed(5)}</span>

                {cacheSavedUsd > 0 && (
                  <>
                    <span className="text-admin-muted">캐시 절감</span>
                    <span className="font-mono text-green-600">
                      ${cacheSavedUsd.toFixed(5)}
                      {totalCostUsd + cacheSavedUsd > 0 && (
                        <span className="text-[10px] text-admin-muted-2 ml-1">
                          ({Math.round(cacheSavedUsd / (totalCostUsd + cacheSavedUsd) * 100)}% 절약)
                        </span>
                      )}
                    </span>
                  </>
                )}
              </div>
              <p className="text-[10px] text-admin-muted-2 mt-2">Phase 1·2 LLM 응답 토큰 × 단가 추정. 실제 청구금액 ≠. attractions Gemini·CoVe·embedding·verify 미포함.</p>
            </div>
          )}

          {/* AI 추출 항목 안내 */}
          <div className="p-4 bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs">
            <p className="text-[11px] font-semibold text-admin-text-2 mb-2">AI 자동 추출 항목</p>
            <div className="grid grid-cols-2 gap-1 text-[11px] text-admin-muted">
              <span>- 상품명/카테고리/타입</span>
              <span>- 날짜별 성인/아동 가격</span>
              <span>- 발권마감/최소인원</span>
              <span>- 써차지/항공제외일</span>
              <span>- 포함/불포함/선택관광</span>
              <span>- 취소환불 규정</span>
              <span>- 출발요일/항공편</span>
              <span>- 일정표 전체</span>
            </div>
            <p className="text-[10px] text-admin-muted-2 mt-2">
              랜드사명·커미션·원가 등 민감정보는 내부 필드에만 저장 — 블로그/카드뉴스용 원문에서 자동 마스킹
            </p>
          </div>
        </div>

        {/* 처리 목록 — 최신순 */}
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-admin-border-mid flex items-center justify-between">
            <h2 className="font-semibold text-admin-text-2 text-admin-base">처리 목록</h2>
            {queue.length > 0 && (
              <span className="text-[11px] text-admin-muted">{queue.length}개 · 완료 {doneCount}</span>
            )}
          </div>

          {queue.length === 0 ? (
            <div className="text-center text-admin-muted py-16 text-admin-sm">
              텍스트를 붙여넣고 &ldquo;큐에 추가 →&rdquo;를 누르세요
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              {[...queue].reverse().map((item) => (
                <div
                  key={item.id}
                  className={`flex items-start gap-3 px-4 py-2 border-b border-admin-border-mid last:border-b-0 ${item.status === 'processing' ? 'bg-blue-50' : ''}`}
                >
                  <div className="mt-0.5 flex-shrink-0">{statusIcon(item.status)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-admin-sm font-medium text-admin-text-2 truncate">
                      {item.status === 'done' ? itemLabel(item) : (item.sourceLabel || item.file.name)}
                    </p>
                    {item.status === 'done' && (
                      <div className="mt-0.5">
                        {item.productCount && item.productCount > 1 ? (
                          <div>
                            <span className="text-[11px] font-semibold text-blue-600">{item.productCount}개 상품 자동 등록</span>
                            <ul className="mt-1 space-y-0.5">
                              {item.titles?.map((t, idx) => (
                                <li key={idx} className="text-[11px] text-admin-muted">- {t}</li>
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
                            {item.trustScore && (
                              <span
                                className={`text-[11px] font-semibold ${
                                  item.trustScore.score === 100
                                    ? 'text-green-700'
                                    : item.trustScore.grade === 'blocked'
                                      ? 'text-red-600'
                                      : 'text-orange-600'
                                }`}
                                title={[
                                  ...item.trustScore.blockers.map(b => `BLOCK: ${b.code}`),
                                  ...item.trustScore.warnings.map(w => `WARN: ${w.code}`),
                                ].join('\n')}
                              >
                                등록신뢰도 {item.trustScore.score}점
                              </span>
                            )}
                            {item.dbId && (item.gate === 'BLOCKED' || item.gate === 'REVIEW_NEEDED') && (
                              <a
                                href={`/admin/packages?status=REVIEW_NEEDED&q=${encodeURIComponent(item.title ?? '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] font-medium text-blue-600 hover:text-blue-800 underline"
                                title="상품관리에서 destination/가격 보완 후 승인"
                              >
                                상품관리에서 보완 →
                              </a>
                            )}
                            {item.landOperator && (
                              <span className="text-[11px] text-blue-600">{item.landOperator}</span>
                            )}
                            {item.commissionRate != null && (
                              <span className="text-[11px] text-green-600 font-medium">커미션 {item.commissionRate}%</span>
                            )}
                            {item.tokenUsage && (
                              <span className="text-[11px] text-admin-muted-2" title={`in:${item.tokenUsage.inputTokens} out:${item.tokenUsage.outputTokens} cache:${item.tokenUsage.cacheHitTokens}`}>
                                {item.tokenUsage.provider === 'deepseek' ? '🔵' : '🟡'} ${item.tokenUsage.costUsd.toFixed(5)}{item.tokenUsage.cacheHitTokens > 0 ? ' ⚡캐시' : ''}
                              </span>
                            )}
                            {item.attractionStats && (item.attractionStats.matched + item.attractionStats.seeded + item.attractionStats.unmatched) > 0 && (
                              <span
                                className="text-[11px] text-admin-muted-2"
                                title={`매칭 ${item.attractionStats.matched} · 시드 ${item.attractionStats.seeded} · 즉시반영 ${item.attractionStats.reflected} · 미매칭 ${item.attractionStats.unmatched}`}
                              >
                                🗺️ {item.attractionStats.matched}
                                {item.attractionStats.seeded > 0 && <span className="text-blue-600">+{item.attractionStats.seeded}</span>}
                                {item.attractionStats.unmatched > 0 && <span className="text-orange-500">·미{item.attractionStats.unmatched}</span>}
                              </span>
                            )}
                          </div>
                        )}
                        {/* Y5 박제 (2026-05-15 SKILL.md Step 7-C): 등록 직후 한 화면 표준 리포트 */}
                        {item.registerReport && item.registerReport.length > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {item.registerReport.map((r) => {
                              const packageVerify = item.verifyReport?.packageResults?.find(result => result.packageId === r.package_id);
                              const displayStatus = packageRowStatus(item.verifyStatus, packageVerify);
                              const verifyIssue = firstVerifyIssue(packageVerify);
                              return (
                                <div
                                  key={r.package_id}
                                  className={`px-2 py-1.5 rounded-lg text-[11px] border ${packageRowClass(displayStatus)}`}
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono text-green-700 font-bold">{r.short_code ?? r.package_id.slice(0, 8)}</span>
                                    <span className={`px-1.5 py-0.5 rounded font-medium ${r.status === 'approved' ? 'bg-green-200 text-green-800' : 'bg-yellow-200 text-yellow-800'}`}>
                                      {r.status === 'approved' ? '✅ 판매중' : '⏳ 검토'}
                                    </span>
                                    <span className={`px-1.5 py-0.5 rounded border font-semibold ${verifyStatusClass(displayStatus)}`}>
                                      {verifyStatusLabel(displayStatus)}
                                      {packageVerify && packageVerify.warnCount + packageVerify.failCount > 0
                                        ? ` ${packageVerify.warnCount + packageVerify.failCount}건`
                                        : ''}
                                    </span>
                                    {r.price != null && <span className="text-admin-muted">₩{r.price.toLocaleString()}</span>}
                                    {r.airline && <span className="text-blue-600">{r.airline}</span>}
                                    {r.departure_days && <span className="text-admin-muted-2">{r.departure_days}</span>}
                                    <a href={`/admin/packages/${r.package_id}/review`} target="_blank" rel="noopener noreferrer" className="text-slate-700 hover:underline font-medium ml-auto">상품검수</a>
                                    {isPublicPackageStatus(r.status) ? (
                                      <>
                                        <a href={r.mobile_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">📱 상세</a>
                                        <a href={r.lp_url} target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:underline font-medium">🔗 LP</a>
                                      </>
                                    ) : (
                                      <span className="text-orange-600 font-medium" title="검토 상태라 고객 공개 URL은 NOT_FOUND가 정상입니다.">📱 고객 비공개</span>
                                    )}
                                    <a href={r.a4_url} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline font-medium">📄 A4</a>
                                  </div>
                                  {verifyIssue && (
                                    <p className={`mt-1 text-[10px] ${packageVerify?.status === 'blocked' || packageVerify?.status === 'error' ? 'text-red-700' : 'text-amber-700'}`}>
                                      {verifyIssue}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {/* 2026-05-19 박제: catalog split silent fallback 경고 (PR #128 UI 보강) */}
                        {item.catalogSplitWarning && (
                          <div className="mt-2 px-2.5 py-2 bg-rose-50 border border-rose-300 rounded-lg text-[11px]">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-rose-700 font-bold">⚠️ 카탈로그 분리 실패</span>
                              <span className="text-rose-600">
                                — 원문에서 헤더 <strong>{item.catalogSplitWarning.headerCount}개</strong> 감지됐는데 <strong>{item.catalogSplitWarning.processedCount}개</strong>만 처리됨
                              </span>
                            </div>
                            <p className="text-[10px] text-rose-700 leading-relaxed">
                              사장님이 직접 텍스트를 <code className="bg-rose-100 px-1 rounded">===</code> 로 분할해서 다시 paste 하거나,
                              <a href="/admin/alerts?category=catalog-split-fallback" target="_blank" rel="noopener noreferrer" className="text-rose-700 underline font-medium ml-1">/admin/alerts</a>
                              에서 상세 확인하세요.
                            </p>
                          </div>
                        )}
                        {/* 원문 대조 검증 결과 */}
                        {item.verifyStatus === 'verifying' && (
                          <div className="flex items-center gap-1 mt-1">
                            <div className="w-2.5 h-2.5 border border-slate-400 border-t-transparent rounded-full animate-spin" />
                            <span className="text-[10px] text-admin-muted-2">원문 대조 검증 중...</span>
                          </div>
                        )}
                        {item.verifyStatus === 'clean' && (
                          <span className="inline-block mt-1 text-[10px] text-green-600 font-medium">✓ 원문 대조 통과</span>
                        )}
                        {item.verifyStatus === 'error' && packageIdsForItem(item).length > 0 && (
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-[10px] text-red-500">⚠ 원문 대조 결과 못 받음 {item.verifyError ? `(${item.verifyError})` : ''}</span>
                            <button
                              type="button"
                              onClick={() => runVerify(item.id, packageIdsForItem(item))}
                              className="text-[10px] font-medium text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-1.5 py-0.5 hover:bg-blue-50 transition"
                            >
                              재시도
                            </button>
                          </div>
                        )}
                        {(item.verifyStatus === 'warnings' || item.verifyStatus === 'blocked') && item.verifyReport && (
                          <div className="mt-1">
                            <button
                              onClick={() => setQueue(prev => prev.map(it => it.id === item.id ? { ...it, verifyExpanded: !it.verifyExpanded } : it))}
                              className={`text-[10px] font-medium flex items-center gap-1 ${item.verifyStatus === 'blocked' ? 'text-red-500' : 'text-yellow-600'}`}
                            >
                              {item.verifyStatus === 'blocked' ? '✗' : '⚠'} 원문 대조 {item.verifyReport.warnCount + item.verifyReport.failCount}건
                              <span className="text-admin-muted-2">{item.verifyExpanded ? '▲' : '▼'}</span>
                            </button>
                            {item.verifyExpanded && (
                              <ul className="mt-1 space-y-0.5 pl-2 border-l-2 border-admin-border-mid">
                                {item.verifyReport.checks.filter(c => c.status === 'warn' || c.status === 'fail').map(c => (
                                  <li key={c.id} className="text-[10px] text-admin-muted">
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
                      <p className="text-[11px] text-admin-muted">대기 중</p>
                    )}
                    {item.status === 'processing' && (
                      <p className="text-[11px] text-blue-500">AI 분석 중...</p>
                    )}
                  </div>
                  {!item.rawText && (
                    <div className="text-[11px] text-admin-muted flex-shrink-0">
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
