import { type NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { countActiveUnmatched } from '@/lib/unmatched-lifecycle';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const PIPELINE = [
  '/api/cron/unmatched-classify',
  '/api/cron/resweep-unmatched',
  '/api/cron/unmatched-auto-resolve',
  '/api/cron/entity-master-candidates',
  '/api/cron/entity-resolution',
  '/api/cron/promote-internal-candidates',
] as const;

type StepResult = {
  path: string;
  ok: boolean;
  status: number;
  body: unknown;
};

async function callStep(request: NextRequest, path: string): Promise<StepResult> {
  const url = new URL(path, request.nextUrl.origin);
  const limit = request.nextUrl.searchParams.get('limit');
  if (limit) url.searchParams.set('limit', limit);

  const authorization = request.headers.get('authorization');
  const response = await fetch(url, {
    method: 'GET',
    headers: authorization ? { authorization } : undefined,
    cache: 'no-store',
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = await response.text().catch(() => null);
  }

  return { path, ok: response.ok, status: response.status, body };
}

async function handleUnmatchedOrchestrator(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();

  const startedPending = await countActiveUnmatched();
  const steps: StepResult[] = [];
  const errors: string[] = [];

  for (const path of PIPELINE) {
    try {
      const step = await callStep(request, path);
      steps.push(step);
      if (!step.ok) {
        errors.push(`${path}: status=${step.status}`);
        break;
      }
      const stepErrors = (step.body as { errors?: unknown })?.errors;
      if (Array.isArray(stepErrors) && stepErrors.length > 0) {
        errors.push(...stepErrors.slice(0, 3).map(error => `${path}: ${String(error)}`));
      }
    } catch (error) {
      errors.push(sanitizeDbError(error, `${path} failed`));
      break;
    }
  }

  const activePendingAfter = await countActiveUnmatched();
  if (activePendingAfter > 0) {
    errors.push(`active_pending_after=${activePendingAfter}`);
  }

  return {
    ok: errors.length === 0,
    started_active_pending: startedPending,
    active_pending_after: activePendingAfter,
    step_count: steps.length,
    steps,
    errors: errors.slice(0, 20),
  };
}

export const GET = withCronLogging('unmatched-orchestrator', handleUnmatchedOrchestrator);
