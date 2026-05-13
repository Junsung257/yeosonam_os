import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { runUploadVerify } from '@/lib/upload-verify';

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const { packageId } = await request.json();
    if (!packageId) return NextResponse.json({ error: 'packageId 필요' }, { status: 400 });

    const result = await runUploadVerify(packageId);
    if (!result) return NextResponse.json({ error: '검증 실패 — 상품 없음 또는 DB 오류' }, { status: 404 });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '검증 실패' },
      { status: 500 },
    );
  }
};

export const POST = withAdminGuard(postHandler);
