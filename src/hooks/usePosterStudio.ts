'use client';

import { useState, useCallback } from 'react';
import { toJpeg } from 'html-to-image';
import JSZip from 'jszip';

// ── 타입 ─────────────────────────────────────────────────
export type PosterFormat = 'A4' | 'MOBILE';

export interface PosterData {
  title: string;
  price: string;
  highlights: string[];
  destination: string;
  duration: string;
  inclusions: string[];
  vendorName: string;
}

// ── 훅 ──────────────────────────────────────────────────
export function usePosterStudio() {
  const [posterOpen, setPosterOpen] = useState(false);
  const [posterFormat, setPosterFormat] = useState<PosterFormat>('A4');
  const [posterData, setPosterData] = useState<PosterData>({
    title: '', price: '', highlights: [], destination: '', duration: '', inclusions: [], vendorName: '',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [posterPkg, setPosterPkg] = useState<any>(null);
  const [downloading, setDownloading] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openPoster = useCallback((pkg: any, format: PosterFormat) => {
    setPosterFormat(format);
    setPosterPkg(pkg);
    setPosterData({
      title: (pkg.display_name || pkg.title || '') as string,
      price: ((pkg.selling_price || pkg.price || 0) as number).toLocaleString(),
      highlights: (pkg.ai_tags || pkg.theme_tags || []) as string[],
      destination: (pkg.destination || '') as string,
      duration: pkg.duration ? `${pkg.duration}일` : '',
      inclusions: (pkg.inclusions || []) as string[],
      vendorName: (pkg.supplier_name || '여소남') as string,
    });
    setPosterOpen(true);
  }, []);

  const closePoster = useCallback(() => {
    setPosterOpen(false);
    setPosterPkg(null);
  }, []);

  const updateField = useCallback((field: keyof PosterData, value: string | string[]) => {
    setPosterData(prev => ({ ...prev, [field]: value }));
  }, []);

  // ═══ 다중 캡처 다운로드 엔진 ═══
  const downloadPoster = useCallback(async () => {
    setDownloading(true);

    try {
      // 폰트 및 렌더 대기
      await document.fonts.ready;
      await new Promise(resolve => setTimeout(resolve, 500));

      // 모든 A4 페이지 노드 수집
      const pages = document.querySelectorAll<HTMLElement>('.a4-export-page');

      if (pages.length === 0) {
        alert('캡처할 페이지가 없습니다.');
        setDownloading(false);
        return;
      }

      const productName = posterData.destination || posterData.title || '여소남';

      if (pages.length === 1) {
        // 단일 페이지 → JPG 직접 다운로드
        const dataUrl = await toJpeg(pages[0], { quality: 0.95, pixelRatio: 3, backgroundColor: '#ffffff' });
        const link = document.createElement('a');
        link.download = `${productName}_1페이지.jpg`;
        link.href = dataUrl;
        link.click();
      } else {
        // 다중 페이지 → JSZip으로 묶어 다운로드
        const zip = new JSZip();

        for (let i = 0; i < pages.length; i++) {
          const dataUrl = await toJpeg(pages[i], { quality: 0.95, pixelRatio: 3, backgroundColor: '#ffffff' });
          // dataUrl에서 base64 데이터 추출
          const base64 = dataUrl.split(',')[1];
          zip.file(`${productName}_${i + 1}페이지.jpg`, base64, { base64: true });
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.download = `${productName}_일정표_${pages.length}페이지.zip`;
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);
      }
    } catch (err) {
      console.error('포스터 다운로드 실패:', err);
      alert('다운로드에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setDownloading(false);
    }
  }, [posterData.destination, posterData.title]);

  return {
    posterOpen,
    posterFormat,
    posterData,
    posterPkg,
    downloading,
    openPoster,
    closePoster,
    updateField,
    downloadPoster,
  };
}
