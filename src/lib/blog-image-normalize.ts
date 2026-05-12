/**
 * 블로그·OG용 이미지 정규화 — EXIF 제거(재인코딩) + 선택적 워터마크
 *
 * - 외부 스톡 URL을 그대로 쓰면 동일 해시·EXIF로 유사문서 처리될 수 있어,
 *   썸네일/OG 생성 파이프에서 한 번 거치는 용도.
 * - 워터마크: 환경변수 BLOG_OG_WATERMARK=1 일 때만 우하단 라벨 합성.
 */

import sharp from 'sharp';

const MAX_BYTES = 12 * 1024 * 1024;

function watermarkSvg(width: number, height: number, label: string): Buffer {
  const safe = label.replace(/</g, '').slice(0, 24);
  const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <style>.t { fill: rgba(255,255,255,0.82); font: bold 14px sans-serif; paint-order: stroke; stroke: rgba(0,0,0,0.45); stroke-width: 3px; }</style>
  <text x="${Math.max(8, width - 140)}" y="${Math.max(24, height - 16)}" class="t">${safe}</text>
</svg>`;
  return Buffer.from(svg.trim());
}

export interface NormalizeImageOptions {
  /** 기본 여소남 */
  watermarkLabel?: string;
}

/**
 * 입력 버퍼을 재인코딩하여 메타데이터 제거. 포맷은 원본에 가깝게 유지(알파 있으면 PNG).
 */
export async function normalizeImageBuffer(
  input: Buffer,
  opts: NormalizeImageOptions = {},
): Promise<{ buffer: Buffer; contentType: string }> {
  if (input.length > MAX_BYTES) {
    throw new Error(`이미지가 너무 큽니다 (${MAX_BYTES}바이트 상한)`);
  }

  const rotated = sharp(input).rotate();
  const meta = await rotated.metadata();
  const w = meta.width ?? 1200;
  const h = meta.height ?? 630;
  const usePng = meta.format === 'png' || meta.hasAlpha;

  let pipeline: sharp.Sharp = rotated;
  if (process.env.BLOG_OG_WATERMARK === '1') {
    const label = opts.watermarkLabel || '여소남';
    pipeline = rotated.composite([{ input: watermarkSvg(w, h, label), top: 0, left: 0 }]);
  }

  if (usePng) {
    const buffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    return { buffer, contentType: 'image/png' };
  }

  const buffer = await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return { buffer, contentType: 'image/jpeg' };
}

export async function normalizeImageFromUrl(
  url: string,
  opts?: NormalizeImageOptions,
): Promise<{ buffer: Buffer; contentType: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return normalizeImageBuffer(buf, opts);
  } finally {
    clearTimeout(t);
  }
}
