/**
 * POST /api/free-travel/mylink
 *
 * MRT 어필리에이트 링크 배치 생성.
 * 5개씩 청크 처리 (Partner API Rate Limit 방어).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { mrtProvider } from '@/lib/travel-providers';

const RequestSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(50),
});

async function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export async function POST(request: NextRequest) {
  if (!mrtProvider.createAffiliateLink) {
    return NextResponse.json({ error: 'MRT 어필리에이트 링크 기능 미설정' }, { status: 503 });
  }
  const createLink = mrtProvider.createAffiliateLink.bind(mrtProvider);

  try {
    const body = await request.json();
    const { urls } = RequestSchema.parse(body);

    const CHUNK = 5;
    const results: { original: string; affiliate: string }[] = [];

    for (let i = 0; i < urls.length; i += CHUNK) {
      const chunk = urls.slice(i, i + CHUNK);
      const links = await Promise.all(
        chunk.map(async url => ({
          original:  url,
          affiliate: await createLink(url),
        })),
      );
      results.push(...links);
      if (i + CHUNK < urls.length) await delay(300);
    }

    return NextResponse.json({ links: results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
