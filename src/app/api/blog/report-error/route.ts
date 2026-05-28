import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * POST /api/blog/report-error
 *
 * 블로그 error.tsx에서 클라이언트 사이드 에러 리포팅.
 * Server Components render 에러의 digest와 stack을 admin_alerts에 기록.
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: false }, { status: 503 });

  try {
    const body = await request.json();
    const { digest, stack, code } = body as {
      digest?: string;
      stack?: string;
      code?: string;
    };

    if (!digest) return NextResponse.json({ ok: false }, { status: 400 });

    await supabaseAdmin.from('admin_alerts').insert({
      category: 'general',
      severity: 'error',
      title: `blog render error (${code || 'unknown'})`,
      message: `digest=${digest}`,
      meta: { digest, stack, code },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
