/**
 * Puppeteer 기반 카드뉴스 PNG 렌더 엔진
 *
 * Satori의 CSS 제약(Grid/Flexbox 제한)을 극복하기 위해
 * 실제 Chromium 브라우저로 HTML→PNG 변환.
 *
 * 기존 Satori 렌더는 fallback으로 유지.
 */
import puppeteer, { Browser, Page } from 'puppeteer';
import type { SlideV2, FormatSpec } from './v2/types';
import { FORMATS, type FormatKey } from './v2/types';
import { TEMPLATE_COMPONENTS } from '@/components/card-news/templates';
import React from 'react';
import { renderToString } from 'react-dom/server';

// 싱글톤 브라우저 (재사용)
let browserInstance: Browser | null = null;
let browserRefCount = 0;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.connected) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
      ],
    });
    browserRefCount = 0;
  }
  browserRefCount++;
  return browserInstance;
}

function releaseBrowser() {
  browserRefCount--;
  if (browserRefCount <= 0 && browserInstance) {
    browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

/**
 * 슬라이드 V2 데이터를 HTML 문자열로 렌더
 */
function slideToHtml(
  slide: SlideV2,
  format: FormatSpec,
  pageIndex: number,
  totalPages: number,
  brandOverrides?: {
    logoUrl?: string;
    brandName?: string;
    accentColor?: string;
    watermark?: string;
  },
): string {
  const { w, h } = format;
  const retinaScale = 2;
  const canvasW = w * retinaScale;
  const canvasH = h * retinaScale;

  const hype = slide.headline || '';
  const body = slide.body || '';
  const badge = slide.badge || null;
  const bgUrl = slide.bg_image_url || '';

  const isCover = pageIndex === 0;
  const isCTA = slide.role === 'cta';
  const variant = isCover ? 'cover' : isCTA ? 'cta' : 'content';

  const watermarkHtml = brandOverrides?.watermark
    ? `<div style="position:absolute;bottom:16px;right:20px;font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:0.05em;font-family:'Pretendard',sans-serif;z-index:10;text-shadow:0 1px 3px rgba(0,0,0,0.3)">${brandOverrides.watermark}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <link rel="preconnect" href="https://cdn.jsdelivr.net" />
  <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" rel="stylesheet" />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { -webkit-font-smoothing: antialiased; overflow: hidden; }
    .slide {
      width: ${canvasW}px;
      height: ${canvasH}px;
      position: relative;
      overflow: hidden;
      font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .bg-image {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      object-fit: cover;
    }
    .bg-gradient {
      position: absolute; inset: 0;
      background: linear-gradient(135deg, #001f3f 0%, #005d90 100%);
    }
    .scrim {
      position: absolute; inset: 0;
      background: linear-gradient(0deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0.05) 100%);
    }
    .content {
      position: absolute; inset: 0;
      display: flex; flex-direction: column;
      justify-content: ${isCover ? 'flex-end' : 'center'};
      padding: ${format.safeInset * retinaScale}px;
      z-index: 2;
    }
    .badge {
      display: inline-block;
      padding: ${6 * retinaScale}px ${14 * retinaScale}px;
      background: ${brandOverrides?.accentColor || '#005d90'};
      color: #fff;
      font-size: ${11 * retinaScale}px;
      font-weight: 700;
      letter-spacing: 0.1em;
      border-radius: ${4 * retinaScale}px;
      margin-bottom: ${12 * retinaScale}px;
      align-self: flex-start;
    }
    .headline {
      color: #fff;
      font-size: ${isCover ? 42 : 34 * retinaScale}px;
      font-weight: 800;
      line-height: 1.25;
      letter-spacing: -0.02em;
      word-break: keep-all;
      max-width: 90%;
    }
    .body {
      color: rgba(255,255,255,0.9);
      font-size: ${18 * retinaScale}px;
      font-weight: 400;
      line-height: 1.6;
      margin-top: ${10 * retinaScale}px;
      max-width: 85%;
      word-break: keep-all;
    }
    .logo-area {
      position: absolute; top: ${20 * retinaScale}px; left: ${format.safeInset * retinaScale}px;
      z-index: 3;
      font-size: ${12 * retinaScale}px;
      color: rgba(255,255,255,0.8);
      font-weight: 700;
      letter-spacing: 0.15em;
      text-shadow: 0 1px 4px rgba(0,0,0,0.4);
    }
    .page-indicator {
      position: absolute; top: ${20 * retinaScale}px; right: ${format.safeInset * retinaScale}px;
      z-index: 3;
      font-size: ${11 * retinaScale}px;
      color: rgba(255,255,255,0.7);
      letter-spacing: 0.1em;
      text-shadow: 0 1px 4px rgba(0,0,0,0.4);
    }
    .cta-badge {
      display: inline-block;
      padding: ${10 * retinaScale}px ${24 * retinaScale}px;
      background: ${brandOverrides?.accentColor || '#005d90'};
      color: #fff;
      font-size: ${16 * retinaScale}px;
      font-weight: 700;
      border-radius: ${8 * retinaScale}px;
      margin-top: ${16 * retinaScale}px;
      align-self: flex-start;
    }
  </style>
</head>
<body>
  <div class="slide">
    ${bgUrl ? `<img class="bg-image" src="${bgUrl}" crossOrigin="anonymous" />` : '<div class="bg-gradient"></div>'}
    <div class="scrim"></div>
    <div class="logo-area">${brandOverrides?.brandName || 'YEOSONAM'}</div>
    <div class="page-indicator">${String(pageIndex + 1).padStart(2, '0')} / ${String(totalPages).padStart(2, '0')}</div>
    <div class="content">
      ${badge ? `<div class="badge">${badge}</div>` : ''}
      <div class="headline">${hype}</div>
      ${body ? `<div class="body">${body}</div>` : ''}
      ${isCTA ? `<div class="cta-badge">${badge || '자세히 보기'}</div>` : ''}
    </div>
    ${watermarkHtml}
  </div>
</body>
</html>`;
}

export interface RenderResult {
  slug: string;
  buffer: Buffer;
  format: FormatKey;
  width: number;
  height: number;
}

export interface RenderOptions {
  format?: FormatKey;
  brandOverrides?: {
    logoUrl?: string;
    brandName?: string;
    accentColor?: string;
    watermark?: string;
  };
}

/**
 * 여러 슬라이드를 Puppeteer로 PNG 렌더링
 */
export async function renderSlidesToPng(
  slides: SlideV2[],
  options: RenderOptions = {},
): Promise<RenderResult[]> {
  const formatKey = options.format || '1x1';
  const format = FORMATS[formatKey];
  const brandName = options.brandOverrides?.brandName || 'YEOSONAM';

  const browser = await getBrowser();

  try {
    const results: RenderResult[] = [];

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const html = slideToHtml(slide, format, i, slides.length, options.brandOverrides);

      const page: Page = await browser.newPage();
      await page.setViewport({
        width: format.w * 2,
        height: format.h * 2,
        deviceScaleFactor: 2,
      });

      await page.setContent(html, { waitUntil: 'networkidle0' });

      // 모든 이미지 로딩 완료 대기
      await page.evaluate(() =>
        Promise.all(
          Array.from(document.images)
            .filter((img) => !img.complete)
            .map(
              (img) =>
                new Promise((resolve, reject) => {
                  img.onload = resolve;
                  img.onerror = resolve; // 이미지 실패는 무시
                }),
            ),
        ),
      );

      // 추가 렌더링 안정화
      await new Promise((r) => setTimeout(r, 200));

      const screenshotBuffer = await page.screenshot({
        type: 'png',
        fullPage: false,
        clip: {
          x: 0,
          y: 0,
          width: format.w * 2,
          height: format.h * 2,
        },
      });

      await page.close();

      const buffer = Buffer.from(screenshotBuffer);

      results.push({
        slug: `slide-${i + 1}-${formatKey}`,
        buffer,
        format: formatKey,
        width: format.w,
        height: format.h,
      });
    }

    return results;
  } finally {
    releaseBrowser();
  }
}

/**
 * 단일 슬라이드 렌더 (빠른 미리보기용)
 */
export async function renderSingleSlideToPng(
  slide: SlideV2,
  options: RenderOptions = {},
): Promise<Buffer | null> {
  try {
    const results = await renderSlidesToPng([slide], options);
    return results[0]?.buffer ?? null;
  } catch (err) {
    console.error('[puppeteer-renderer] 단일 슬라이드 렌더 실패:', err);
    return null;
  }
}
