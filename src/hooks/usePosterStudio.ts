'use client';

import { useState, useCallback } from 'react';
// html-to-image, jszip: 다운로드 시점에만 동적 로드

// ── 캡처 전 이미지 로드 대기 ─────────────────────────────
// 로고/QR/관광지 사진이 로드되기 전에 toJpeg가 실행되면 빈 프레임으로 캡처됨.
// 느린 네트워크·큰 이미지에서 재현되는 깨진 포스터 근본원인.
async function waitForImages(root: HTMLElement, perImageTimeoutMs = 10000): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(imgs.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise<void>(resolve => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });  // 실패해도 진행 (placeholder)
      setTimeout(done, perImageTimeoutMs);                  // 응답 없는 이미지 방어
    });
  }));
}

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
      // 모든 A4 페이지 노드 수집
      const pages = document.querySelectorAll<HTMLElement>('.a4-export-page');

      if (pages.length === 0) {
        alert('캡처할 페이지가 없습니다.');
        setDownloading(false);
        return;
      }

      // 폰트 + 이미지 로드 완료까지 대기 (깨진 프레임 캡처 방지)
      await document.fonts.ready;
      await Promise.all(Array.from(pages).map(p => waitForImages(p)));
      // 레이아웃 안정화 여유 (폰트 치환으로 인한 높이 재계산 방어)
      await new Promise(resolve => setTimeout(resolve, 100));

      const productName = posterData.destination || posterData.title || '여소남';

      const { toJpeg } = await import('html-to-image');
      if (pages.length === 1) {
        // 단일 페이지 → JPG 직접 다운로드
        const dataUrl = await toJpeg(pages[0], { quality: 0.95, pixelRatio: 3, backgroundColor: '#ffffff' });
        const link = document.createElement('a');
        link.download = `${productName}_1페이지.jpg`;
        link.href = dataUrl;
        link.click();
      } else {
        // 다중 페이지 → JSZip으로 묶어 다운로드
        const { default: JSZip } = await import('jszip');
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
        const objectUrl = URL.createObjectURL(blob);
        link.href = objectUrl;
        link.click();
        // 일부 브라우저(Firefox 등)는 click 직후 즉시 revoke하면 다운로드 취소됨. 지연 revoke.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
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
