/**
 * POST /api/ops/blog-normalize-image
 * body: { url: string, watermarkLabel?: string }
 *
 * 원격 이미지를 받아 EXIF 제거·재인코딩(+선택 워터마크) 후 base64 반환.
 * 인증: Bearer CRON_SECRET (서버·스크립트용)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { normalizeImageFromUrl } from '@/lib/blog-image-normalize';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const cronSecret = getSecret('CRON_SECRET');
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: '유효한 https url 필요' }, { status: 400 });
    }

    const { buffer, contentType } = await normalizeImageFromUrl(url, {
      watermarkLabel: typeof body?.watermarkLabel === 'string' ? body.watermarkLabel : undefined,
    });

    return NextResponse.json({
      ok: true,
      contentType,
      dataBase64: buffer.toString('base64'),
      byteLength: buffer.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'normalize 실패' },
      { status: 500 },
    );
  }
}
