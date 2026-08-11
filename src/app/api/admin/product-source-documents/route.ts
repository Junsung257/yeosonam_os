import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { ensureSourceDocumentStored, inferProductSourceType } from '@/lib/product-registration-v4/source-documents';
import { PRODUCT_REGISTRATION_V4_MAX_BYTES } from '@/lib/product-registration-v4/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json(
      { success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE', error: '상품 원본 보관을 위한 서버 저장소가 구성되지 않았습니다.' },
      { status: 503 },
    );
  }

  const contentType = request.headers.get('content-type') ?? '';
  let filename = 'text-input.txt';
  let declaredMime: string | null = 'text/plain';
  let buffer: Buffer;

  if (contentType.includes('application/json')) {
    const body = await request.json() as { rawText?: unknown; filename?: unknown; sourceLabel?: unknown };
    const rawText = typeof body.rawText === 'string' ? body.rawText : '';
    if (!rawText.trim()) {
      return NextResponse.json({ success: false, code: 'SOURCE_EMPTY', error: '원본 텍스트가 비어 있습니다.' }, { status: 400 });
    }
    filename = typeof body.filename === 'string' && body.filename.trim()
      ? body.filename.trim()
      : typeof body.sourceLabel === 'string' && body.sourceLabel.trim()
        ? body.sourceLabel.trim().endsWith('.txt') ? body.sourceLabel.trim() : `${body.sourceLabel.trim()}.txt`
        : filename;
    buffer = Buffer.from(rawText, 'utf8');
    if (buffer.byteLength > PRODUCT_REGISTRATION_V4_MAX_BYTES) {
      return NextResponse.json({ success: false, code: 'SOURCE_TOO_LARGE', error: '?곹뭹 ?먮낯 ?띿뒪?멸? 50MB ?댄븯?댁뼱???⑸땲??' }, { status: 413 });
    }
  } else {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, code: 'SOURCE_FILE_REQUIRED', error: '상품 원본 파일이 필요합니다.' }, { status: 400 });
    }
    filename = file.name;
    // Chromium/Edge report legacy HWP files as application/octet-stream.
    // Extension inference remains authoritative for this admin-only intake;
    // leave the stored MIME nullable so the private bucket allow-list is not
    // bypassed with an arbitrary content type.
    declaredMime = file.type === 'application/octet-stream' ? null : (file.type || null);
    if (file.size > PRODUCT_REGISTRATION_V4_MAX_BYTES) {
      return NextResponse.json({ success: false, code: 'SOURCE_TOO_LARGE', error: '상품 원본 파일은 50MB 이하이어야 합니다.' }, { status: 413 });
    }
    buffer = Buffer.from(await file.arrayBuffer());
  }

  const sourceType = inferProductSourceType(filename, declaredMime);
  if (!sourceType) {
    return NextResponse.json({ success: false, code: 'SOURCE_TYPE_UNSUPPORTED', error: '지원하지 않는 상품 원본 형식입니다.' }, { status: 400 });
  }

  try {
    const sourceDocument = await ensureSourceDocumentStored({
      supabase: supabaseAdmin,
      buffer,
      filename,
      declaredMime,
      sourceType,
    });
    return NextResponse.json({ success: true, sourceDocument }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Product Registration V4] source document store failed:', error);
    return NextResponse.json(
      { success: false, code: 'SOURCE_ARCHIVE_FAILED', error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
};

export const POST = withAdminGuard(postHandler);
