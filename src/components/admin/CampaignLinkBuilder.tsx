'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import QRCode from 'react-qr-code';
import {
  X, Copy, Download, Link2, Tag, Megaphone, Users2,
  ChevronDown, CheckCircle2,
} from 'lucide-react';

// ─── 상품 목록 (Mock) ────────────────────────────────────────────────────────
const PRODUCTS = [
  { id: 'jangjiajie-special-0605', label: '장가계 5박 6일 특가 (6/5 출발)' },
  { id: 'phoenix-tour-0612',       label: '봉황고성 4박 5일 (6/12 출발)' },
  { id: 'guilin-summer-0620',      label: '계림 황산 5박 6일 (6/20 출발)' },
  { id: 'beijing-classic-0701',    label: '북경 클래식 4박 5일 (7/1 출발)' },
];

const SOURCES = [
  { value: 'insta',   label: '인스타그램' },
  { value: 'kakao',   label: '카카오톡' },
  { value: 'blog',    label: '블로그' },
  { value: 'offline', label: '오프라인/인쇄물' },
  { value: 'youtube', label: '유튜브' },
  { value: 'naver',   label: '네이버' },
];

const BASE_URL = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.host}`
  : 'https://yeosonam.com';

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CampaignLinkBuilder({ open, onClose }: Props) {
  const [productId, setProductId] = useState(PRODUCTS[0].id);
  const [source, setSource]       = useState('insta');
  const [campaign, setCampaign]   = useState('');
  const [ref, setRef]             = useState('');
  const [copied, setCopied]       = useState(false);
  const [showQr, setShowQr]       = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  // ESC 닫기
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // 최종 URL 실시간 생성
  const finalUrl = (() => {
    const params = new URLSearchParams();
    params.set('source', source);
    if (campaign.trim()) params.set('utm_campaign', campaign.trim());
    if (ref.trim())      params.set('ref', ref.trim());
    return `${BASE_URL}/lp/${productId}?${params.toString()}`;
  })();

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(finalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = finalUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }, [finalUrl]);

  // QR → PNG 다운로드
  const handleQrDownload = useCallback(() => {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg) return;

    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // 흰 배경
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    const svgData = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size);
      const a = document.createElement('a');
      a.download = `qr-${productId}-${source}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;
  }, [productId, source, qrRef]);

  if (!open) return null;

  return (
    <>
      {/* 백드롭 */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={onClose}
        aria-hidden
      />

      {/* 우측 사이드 드로어 */}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex flex-col bg-white shadow-2xl
          w-full max-w-[540px] transition-transform duration-300 ease-out
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* ── 헤더 ── */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Link2 className="w-5 h-5 text-blue-600" />
              캠페인 링크 빌더
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">3초 만에 UTM 링크 & QR 코드 생성</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition text-gray-400 hover:text-gray-700"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── 폼 영역 ── */}
        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-6">

          {/* 1. 연결 상품 */}
          <FormField icon={<Tag className="w-4 h-4 text-gray-400" />} label="연결 랜딩페이지 상품">
            <div className="relative">
              <select
                value={productId}
                onChange={e => setProductId(e.target.value)}
                className="w-full appearance-none border-2 border-gray-200 rounded-xl px-4 py-3 text-base text-gray-800 focus:outline-none focus:border-blue-500 transition pr-10 bg-white"
              >
                {PRODUCTS.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </FormField>

          {/* 2. 유입 소스 */}
          <FormField icon={<Megaphone className="w-4 h-4 text-gray-400" />} label="유입 소스 (Source)">
            <div className="grid grid-cols-3 gap-2">
              {SOURCES.map(s => (
                <button
                  key={s.value}
                  onClick={() => setSource(s.value)}
                  className={`py-2.5 px-3 rounded-xl text-sm font-medium border-2 transition-all ${
                    source === s.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </FormField>

          {/* 3. 캠페인 이름 */}
          <FormField icon={<Megaphone className="w-4 h-4 text-gray-400" />} label="캠페인 이름 (utm_campaign)">
            <input
              type="text"
              value={campaign}
              onChange={e => setCampaign(e.target.value)}
              placeholder="예: summer_sale_2026"
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-blue-500 transition"
            />
          </FormField>

          {/* 4. 파트너 코드 */}
          <FormField icon={<Users2 className="w-4 h-4 text-gray-400" />} label="파트너/어필리에이터 코드 (ref)">
            <input
              type="text"
              value={ref}
              onChange={e => setRef(e.target.value)}
              placeholder="예: partner_001"
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-blue-500 transition"
            />
          </FormField>

          {/* ── 생성된 URL 프리뷰 ── */}
          <div className="rounded-2xl bg-gray-950 p-5 space-y-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">생성된 URL</p>
            <p className="text-sm text-green-400 font-mono break-all leading-relaxed select-all">
              {finalUrl}
            </p>

            {/* 액션 버튼 */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={handleCopy}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all ${
                  copied
                    ? 'bg-green-500 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {copied
                  ? <><CheckCircle2 size={16} /> 복사됨!</>
                  : <><Copy size={16} /> 링크 복사</>
                }
              </button>
              <button
                onClick={() => setShowQr(v => !v)}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm bg-white/10 hover:bg-white/20 text-white transition"
              >
                <Download size={16} />
                {showQr ? 'QR 숨기기' : 'QR 코드 생성'}
              </button>
            </div>
          </div>

          {/* ── QR 코드 ── */}
          {showQr && (
            <div className="flex flex-col items-center gap-4 p-6 bg-white border-2 border-dashed border-gray-200 rounded-2xl">
              <div ref={qrRef} className="bg-white p-3 rounded-xl shadow-md">
                <QRCode value={finalUrl} size={200} />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-700">
                  {PRODUCTS.find(p => p.id === productId)?.label}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {SOURCES.find(s => s.value === source)?.label} 채널
                  {ref && ` · ${ref}`}
                </p>
              </div>
              <button
                onClick={handleQrDownload}
                className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition"
              >
                <Download size={15} />
                PNG 다운로드 (A4 인쇄용)
              </button>
            </div>
          )}

          {/* ── 사용 팁 ── */}
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3.5 text-sm text-amber-800 space-y-1">
            <p className="font-semibold">💡 사용 팁</p>
            <ul className="list-disc list-inside space-y-0.5 text-amber-700 text-xs leading-relaxed">
              <li>인스타/카카오 광고 링크는 반드시 소스를 구분해서 성과를 추적하세요</li>
              <li>오프라인 영업지에는 QR 코드를 PNG로 인쇄해 사용하세요</li>
              <li>파트너 코드 입력 시 어필리에이터별 성과 분리가 가능합니다</li>
            </ul>
          </div>
        </div>
      </aside>
    </>
  );
}

function FormField({ icon, label, children }: {
  icon: React.ReactNode; label: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
        {icon}
        {label}
      </label>
      {children}
    </div>
  );
}
