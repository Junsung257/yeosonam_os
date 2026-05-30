import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const STATUSES = new Set(['pending', 'active', 'archived']);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin required' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { id } = await params;
  const body = await request.json();
  const status = typeof body.status === 'string' ? body.status : null;
  if (!status || !STATUSES.has(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('qa_learning_scenarios')
    .update({ status, updated_at: new Date().toISOString() } as never)
    .eq('id', id)
    .select('id, status')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ scenario: data });
}

