import { NextRequest, NextResponse } from 'next/server';
import { saveWebVital, alertIfPoorVital } from '@/lib/web-vitals-collector';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, value, path, pageType, slug } = body;

    if (!name || value === undefined || !path) {
      return NextResponse.json({ error: 'missing fields' }, { status: 400 });
    }

    const payload = {
      name,
      value,
      timestamp: Date.now(),
      path,
      pageType: pageType || 'page',
      slug: slug || null,
    };

    // 비동기 저장 (await 안 함 — 응답 지연 방지)
    void saveWebVital(payload);
    void alertIfPoorVital(payload);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }
}
