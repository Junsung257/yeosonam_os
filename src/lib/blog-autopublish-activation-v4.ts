export type BlogAutopublishActivationProbeV4 = {
  status: number | null;
  body: unknown;
  error?: string | null;
};

export type BlogAutopublishActivationCheckV4 = {
  status: 'ready' | 'blocked' | 'unavailable';
  reason: string;
  evidence: Record<string, unknown>;
};

export type BlogAutopublishActivationReportV4 = {
  version: 'blog-autopublish-activation-v4';
  readOnly: true;
  ready: boolean;
  generation: BlogAutopublishActivationCheckV4;
  publication: BlogAutopublishActivationCheckV4;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function endpointCheck(
  probe: BlogAutopublishActivationProbeV4,
  kind: 'generation' | 'publication',
): BlogAutopublishActivationCheckV4 {
  if (probe.error) {
    return {
      status: 'unavailable',
      reason: 'endpoint_unavailable',
      evidence: { error: probe.error },
    };
  }
  if (probe.status !== 200) {
    return {
      status: 'blocked',
      reason: probe.status === 401 || probe.status === 403
        ? 'cron_auth_required'
        : `endpoint_http_${probe.status ?? 'unknown'}`,
      evidence: { httpStatus: probe.status },
    };
  }

  const body = record(probe.body);
  const reason = typeof body.reason === 'string' ? body.reason : null;
  const policy = record(body.policy);

  if (kind === 'generation') {
    if (reason === 'blog_generation_cron_paused' || body.generationCronEnabled === false) {
      return {
        status: 'blocked',
        reason: 'generation_cron_disabled',
        evidence: {
          skipped: body.skipped === true,
          generationCronEnabled: body.generationCronEnabled ?? null,
          autopublishMode: body.autopublishMode ?? null,
          nextAction: body.nextAction ?? null,
        },
      };
    }
    if (reason === 'outside_kst_offpeak_generation_window') {
      return {
        status: 'ready',
        reason: 'generation_enabled_outside_window',
        evidence: { skipped: true, reason },
      };
    }
  }

  if (kind === 'publication') {
    const provenance = record(policy.deploymentProvenance);
    if (provenance.passed === false) {
      return {
        status: 'blocked',
        reason: 'deployment_provenance_failed',
        evidence: {
          mode: policy.mode ?? null,
          requestedMode: policy.requestedMode ?? null,
          reasons: Array.isArray(provenance.reasons) ? provenance.reasons : [],
          source: provenance.source ?? 'missing',
          expectedGitRef: provenance.expectedGitRef ?? null,
          expectedCommitSha: provenance.expectedCommitSha ?? null,
          actualGitRef: provenance.actualGitRef ?? null,
          commitSha: provenance.commitSha ?? null,
        },
      };
    }
    if (reason === 'autopublish_mode_draft_only') {
      return {
        status: 'blocked',
        reason: 'autopublish_not_live',
        evidence: {
          skipped: true,
          mode: policy.mode ?? null,
          requestedMode: policy.requestedMode ?? null,
          nextAction: 'set BLOG_AUTOPUBLISH_MODE=live only after the V4 readiness report passes',
        },
      };
    }
    if (reason === 'supabase_not_configured' || reason?.startsWith('publication_rollout_state_unavailable')) {
      return {
        status: 'blocked',
        reason: 'publication_runtime_unavailable',
        evidence: { skipped: true, reason },
      };
    }
  }

  if (body.skipped === true && reason) {
    return {
      status: 'ready',
      reason: 'configured_but_not_due',
      evidence: {
        skipped: true,
        reason,
        policyMode: policy.mode ?? null,
        rollout: body.rollout ?? null,
      },
    };
  }

  return {
    status: 'ready',
    reason: 'endpoint_operational',
    evidence: {
      skipped: body.skipped === true,
      policyMode: policy.mode ?? body.autopublishMode ?? null,
      route: body.route ?? null,
    },
  };
}

export function evaluateBlogAutopublishActivationV4(input: {
  generation: BlogAutopublishActivationProbeV4;
  publication: BlogAutopublishActivationProbeV4;
}): BlogAutopublishActivationReportV4 {
  const generation = endpointCheck(input.generation, 'generation');
  const publication = endpointCheck(input.publication, 'publication');
  return {
    version: 'blog-autopublish-activation-v4',
    readOnly: true,
    ready: generation.status === 'ready' && publication.status === 'ready',
    generation,
    publication,
  };
}
