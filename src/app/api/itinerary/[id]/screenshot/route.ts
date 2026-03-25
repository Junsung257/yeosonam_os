import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';

/**
 * POST /api/itinerary/[id]/screenshot
 * Body: { mode: 'summary' | 'detail', departureDate?: '2026-04-05' }
 * Returns: { jpgs: string[] }  — base64-encoded JPEG strings
 *
 * summary  → 1장 (요금표 + 일정 개요)
 * detail   → 2장 (요금표 + 상세 일정표)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const mode: 'summary' | 'detail' = body.mode ?? 'detail';
    const departureDate: string | undefined = body.departureDate;
    const { id } = params;

    // 내부 print 페이지 URL 조합
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const url = new URL(`/itinerary/${id}/print`, baseUrl);
    url.searchParams.set('mode', mode);
    if (departureDate) url.searchParams.set('date', departureDate);

    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none',
      ],
    });

    try {
      const page = await browser.newPage();

      // A4 @ 96dpi: 794 × 1123px (portrait)
      await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });

      await page.goto(url.toString(), { waitUntil: 'networkidle0', timeout: 30000 });

      // 폰트/이미지 로딩 대기
      await page.evaluate(() => document.fonts.ready);

      // 페이지 수만큼 캡처
      const pageCount = mode === 'summary' ? 1 : 2;
      const jpgs: string[] = [];

      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        // 각 A4 페이지의 y 오프셋 계산 (pageBreakAfter: 'always' 사용 시 1123px 단위)
        const clip = {
          x: 0,
          y: pageIndex * 1123,
          width: 794,
          height: 1123,
        };

        const screenshot = await page.screenshot({
          type: 'jpeg',
          quality: 95,
          clip,
          encoding: 'base64',
        });

        jpgs.push(screenshot as string);
      }

      return NextResponse.json({ jpgs, pageCount });
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error('[Screenshot API]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '스크린샷 생성 실패' },
      { status: 500 }
    );
  }
}
