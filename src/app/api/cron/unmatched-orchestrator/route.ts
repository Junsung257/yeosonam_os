import { type NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { countActiveUnmatched } from '@/lib/unmatched-lifecycle';
import { GET as entityMasterCandidatesGet } from '../entity-master-candidates/route';
import { GET as entityResolutionGet } from '../entity-resolution/route';
import { GET as promoteInternalCandidatesGet } from '../promote-internal-candidates/route';
import { GET as resweepUnmatchedGet } from '../resweep-unmatched/route';
import { GET as unmatchedAutoResolveGet } from '../unmatched-auto-resolve/route';
import { GET as unmatchedClassifyGet } from '../unmatched-classify/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

type StepResult = {
  path: string;
  ok: boolean;
  status: number;
  body: unknown;
};

type PipelineStep = {
  path: string;
  run: (request: NextRequest) => Promise<Response> | Response;
};

const PIPELINE: PipelineStep[] = [
  {
    path: '/api/cron/unmatched-classify',
    run: unmatchedClassifyGet,
  },
  {
    path: '/api/cron/resweep-unmatched',
    run: resweepUnmatchedGet,
  },
  {
    path: '/api/cron/unmatched-auto-resolve',
    run: unmatchedAutoResolveGet,
  },
  {
    path: '/api/cron/entity-master-candidates',
    run: entityMasterCandidatesGet,
  },
  {
    path: '/api/cron/entity-resolution',
    run: entityResolutionGet,
  },
  {
    path: '/api/cron/promote-internal-candidates',
    run: promoteInternalCandidatesGet,
  },
];

async function runStep(step: PipelineStep, request: NextRequest): Promise<StepResult> {
  const response = await step.run(request);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = await response.text().catch(() => null);
  }
  const bodyOk = (body as { ok?: unknown } | null)?.ok !== false;
  return { path: step.path, ok: response.ok && bodyOk, status: response.status, body };
}

async function handleUnmatchedOrchestrator(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();

  const startedPending = await countActiveUnmatched();
  const steps: StepResult[] = [];
  const errors: string[] = [];

  for (const stepConfig of PIPELINE) {
    try {
      const step = await runStep(stepConfig, request);
      steps.push(step);
      if (!step.ok) {
        errors.push(`${step.path}: status=${step.status}`);
        break;
      }
      const stepErrors = (step.body as { errors?: unknown })?.errors;
      if (Array.isArray(stepErrors) && stepErrors.length > 0) {
        errors.push(...stepErrors.slice(0, 3).map(error => `${step.path}: ${String(error)}`));
      }
    } catch (error) {
      errors.push(sanitizeDbError(error, `${stepConfig.path} failed`));
      break;
    }
  }

  const activePendingAfter = await countActiveUnmatched();

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
