import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { listMockConfigs, updateMockConfig, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';

type MockMode = 'success' | 'fail' | 'timeout';

function parseMockUpdates(body: { mode?: unknown; delay_ms?: unknown }) {
  const updates: { mode?: MockMode; delay_ms?: number } = {};

  if (body.mode !== undefined) {
    if (!['success', 'fail', 'timeout'].includes(String(body.mode))) {
      return { error: 'mode는 success/fail/timeout 중 하나여야 합니다.' };
    }
    updates.mode = body.mode as MockMode;
  }

  if (body.delay_ms !== undefined) {
    const delay = Number(body.delay_ms);
    if (!Number.isFinite(delay) || delay < 0) {
      return { error: 'delay_ms는 0 이상의 숫자여야 합니다.' };
    }
    updates.delay_ms = delay;
  }

  return { updates };
}

// GET /api/admin/mock-configs
const getMockConfigs = async () => {
  if (!isSupabaseConfigured) {
    return apiResponse({ configs: [] });
  }
  try {
    const configs = await listMockConfigs();
    return apiResponse({ configs });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err) }, { status: 500 });
  }
};

export const GET = withAdminGuard(getMockConfigs);

// PUT /api/admin/mock-configs  body: { api_name, mode, delay_ms }
const putMockConfigs = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }
  let body: { api_name?: string; mode?: unknown; delay_ms?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: '잘못된 JSON' }, { status: 400 });
  }

  const { api_name, mode, delay_ms } = body;
  if (!api_name) return apiResponse({ error: 'api_name 필수' }, { status: 400 });
  const parsed = parseMockUpdates({ mode, delay_ms });
  if ('error' in parsed) return apiResponse({ error: parsed.error }, { status: 400 });

  try {
    await updateMockConfig(api_name, parsed.updates);
    return apiResponse({ ok: true });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err) }, { status: 500 });
  }
};

export const PUT = withAdminGuard(putMockConfigs);
