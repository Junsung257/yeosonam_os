import { NextRequest, NextResponse } from 'next/server';
import { invalidatePromptCache } from '@/lib/prompt-loader';

type Params = { params: Promise<{ key: string }> };

// POST — 해당 key 의 인메모리 캐시 즉시 삭제
export async function POST(_req: NextRequest, { params }: Params) {
  const { key } = await params;
  invalidatePromptCache(key);
  return NextResponse.json({ ok: true, key });
}
