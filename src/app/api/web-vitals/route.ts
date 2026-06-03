import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { saveWebVital, alertIfPoorVital } from '@/lib/web-vitals-collector';

const VITAL_NAMES = new Set(['LCP', 'CLS', 'INP', 'FCP', 'TTFB']);
const PAGE_TYPES = new Set(['page', 'blog', 'package', 'landing', 'admin']);
const MAX_VALUE_BY_NAME: Record<string, number> = {
  CLS: 10,
  LCP: 120_000,
  INP: 120_000,
  FCP: 120_000,
  TTFB: 120_000,
};

function isSafePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 300
    && value.startsWith('/')
    && !value.startsWith('//');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, value, path, pageType, slug } = body;

    if (!name || value === undefined || !path) {
      return apiResponse({ error: 'missing fields' }, { status: 400 });
    }
    if (!VITAL_NAMES.has(name)) {
      return apiResponse({ error: 'invalid vital name' }, { status: 400 });
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > MAX_VALUE_BY_NAME[name]) {
      return apiResponse({ error: 'invalid vital value' }, { status: 400 });
    }
    if (!isSafePath(path)) {
      return apiResponse({ error: 'invalid path' }, { status: 400 });
    }

    const normalizedPageType = typeof pageType === 'string' && PAGE_TYPES.has(pageType) ? pageType : 'page';
    const normalizedSlug = typeof slug === 'string' && slug.length <= 160 ? slug : undefined;

    const payload = {
      name,
      value: numericValue,
      timestamp: Date.now(),
      path,
      pageType: normalizedPageType,
      slug: normalizedSlug,
    };

    // 비동기 저장 (await 안 함 — 응답 지연 방지)
    void saveWebVital(payload);
    void alertIfPoorVital(payload);

    return apiResponse({ ok: true });
  } catch {
    return apiResponse({ error: 'invalid payload' }, { status: 400 });
  }
}
