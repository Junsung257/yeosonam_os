import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-guard';
import { isSupabaseConfigured } from '@/lib/supabase';
import { runActiveQaLearningScenarios } from '@/lib/qa-scenario-regression';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin required' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const limit = typeof body.limit === 'number' ? body.limit : undefined;
  const result = await runActiveQaLearningScenarios({ limit });

  return NextResponse.json(result);
}
