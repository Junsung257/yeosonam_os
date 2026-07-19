import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { invalidatePromptCache } from '@/lib/prompt-loader';

type Params = { params: Promise<{ key: string }> };

// POST — 해당 key 의 인메모리 캐시 즉시 삭제
export async function POST(request: NextRequest, { params }: Params) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  const { key } = await params;
  invalidatePromptCache(key);
  return NextResponse.json({ ok: true, key });
}
