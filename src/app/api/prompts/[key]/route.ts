import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

type Params = { params: Promise<{ key: string }> };

async function requireAdminUser(request: NextRequest): Promise<string | null> {
  const token =
    request.cookies.get('sb-access-token')?.value ??
    request.headers.get('Authorization')?.replace('Bearer ', '');
  const { data: userData } = await supabaseAdmin.auth.getUser(token ?? '');
  return userData?.user?.id ?? null;
}

export async function GET(req: NextRequest, { params }: Params) {
  if (!isSupabaseConfigured) return NextResponse.json({ data: [] });

  const userId = await requireAdminUser(req);
  if (!userId) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { key } = await params;

  try {
    const { data, error } = await supabaseAdmin
      .from('llm_prompts')
      .select('id, key, version, is_active, task_type, metadata, created_at, created_by, change_note, body')
      .eq('key', key)
      .order('version', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}

// PATCH — 특정 버전으로 롤백 (body: { version: number })
export async function PATCH(request: NextRequest, { params }: Params) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const userId = await requireAdminUser(request);
  if (!userId) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { key } = await params;

  try {
    const { version } = (await request.json()) as { version: number };
    if (!version) return NextResponse.json({ error: 'version 필수' }, { status: 400 });

    const { data, error } = await supabaseAdmin.rpc('rollback_prompt', {
      p_key: key,
      p_version: version,
      p_by: 'admin',
    });

    if (error) throw error;
    if (!data?.ok) {
      return NextResponse.json({ error: data?.error ?? '롤백 실패' }, { status: 400 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '롤백 실패' },
      { status: 500 },
    );
  }
}
