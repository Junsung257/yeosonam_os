export type ShadowPilotEnvironment = {
  mode: 'production' | 'preview' | 'local';
  enabled: boolean;
  code: 'SHADOW_PILOT_PRODUCTION_BLOCKED' | 'SHADOW_PILOT_DISABLED' | 'SHADOW_PILOT_ENABLED';
};

/**
 * Resolve the execution boundary without importing the worker, Supabase, or
 * runtime adapter. Keeping this decision in a small module lets readiness
 * endpoints stay cheap and prevents a disabled pilot from inflating the
 * production server bundle.
 */
export function resolveTechnologyScoutShadowPilotEnvironment(input?: {
  nodeEnv?: string;
  vercelEnv?: string;
  enabledFlag?: string;
}): ShadowPilotEnvironment {
  const nodeEnv = input?.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const vercelEnv = input?.vercelEnv ?? process.env.VERCEL_ENV ?? '';
  // Vercel Preview also runs with NODE_ENV=production. The deployment
  // environment is authoritative when present; an unlabelled local
  // production process remains blocked by default.
  const production = vercelEnv === 'production' || (nodeEnv === 'production' && !vercelEnv);
  const enabled = (input?.enabledFlag ?? process.env.AGENT_OFFICE_SHADOW_PILOT_ENABLED) === '1';
  if (production) {
    return { mode: 'production', enabled: false, code: 'SHADOW_PILOT_PRODUCTION_BLOCKED' };
  }
  if (!enabled) {
    return { mode: vercelEnv === 'preview' ? 'preview' : 'local', enabled: false, code: 'SHADOW_PILOT_DISABLED' };
  }
  return { mode: vercelEnv === 'preview' ? 'preview' : 'local', enabled: true, code: 'SHADOW_PILOT_ENABLED' };
}
