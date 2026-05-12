import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

async function requireAdminUser(request: NextRequest): Promise<string | null> {
  const token =
    request.cookies.get('sb-access-token')?.value ??
    request.headers.get('Authorization')?.replace('Bearer ', '');
  const { data: userData } = await supabaseAdmin.auth.getUser(token ?? '');
  return userData?.user?.id ?? null;
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ data: [] });

  const userId = await requireAdminUser(request);
  if (!userId) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  try {
    const { data, error } = await supabaseAdmin
      .from('llm_prompts')
      .select('id, key, version, is_active, task_type, metadata, created_at, created_by, change_note')
      .eq('is_active', true)
      .order('key');

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const userId = await requireAdminUser(request);
  if (!userId) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  try {
    const body = await request.json();
    const { key, body: promptBody, task_type, metadata, change_note } = body as {
      key: string;
      body: string;
      task_type?: string;
      metadata?: Record<string, unknown>;
      change_note?: string;
    };

    if (!key || !promptBody) {
      return NextResponse.json({ error: 'key, body 필수' }, { status: 400 });
    }

    // 현재 최신 버전 번호 조회
    const { data: existing } = await supabaseAdmin
      .from('llm_prompts')
      .select('version')
      .eq('key', key)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = (existing?.version ?? 0) + 1;

    // 기존 활성 버전 비활성화
    await supabaseAdmin
      .from('llm_prompts')
      .update({ is_active: false })
      .eq('key', key)
      .eq('is_active', true);

    // 새 버전 삽입
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('llm_prompts')
      .insert({
        key,
        body: promptBody,
        version: nextVersion,
        is_active: true,
        task_type: task_type ?? null,
        metadata: metadata ?? {},
        change_note: change_note ?? null,
        created_by: 'admin',
      })
      .select('id, key, version')
      .single();

    if (insertError) throw insertError;
    return NextResponse.json({ data: inserted });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '저장 실패' },
      { status: 500 },
    );
  }
}
