import { z } from 'zod';

const rawServerFeatureFlagsSchema = z.object({
  JARVIS_STREAM_ENABLED: z.string().optional(),
  IR_CANARY_ENABLED: z.string().optional(),
  IR_CANARY_ROLLOUT_PCT: z.string().optional(),
  IR_CANARY_MULTI: z.string().optional(),
  IR_CANARY_MAX_PRODUCTS: z.string().optional(),
  IR_CANARY_CONCURRENCY: z.string().optional(),
}).passthrough();

export interface ServerFeatureFlags {
  jarvisStreamEnabled: boolean;
  irCanaryEnabled: boolean;
  irCanaryRolloutPct: number;
  irCanaryMultiEnabled: boolean;
  irCanaryMaxProducts: number;
  irCanaryConcurrency: number;
}

function boundedNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min) return fallback;
  return Math.min(max, value);
}

/**
 * Parse non-authority runtime flags with their historical fail-safe defaults.
 *
 * This intentionally excludes publication freezes, payment authority, and
 * other domain safety gates. Those remain in their domain-owned SSOT config.
 */
export function readServerFeatureFlags(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): ServerFeatureFlags {
  const raw = rawServerFeatureFlagsSchema.parse(source);
  return Object.freeze({
    // Existing behavior: only the exact string "false" disables streaming.
    jarvisStreamEnabled: raw.JARVIS_STREAM_ENABLED !== 'false',
    // Existing behavior: the canary is opt-in with the exact string "true".
    irCanaryEnabled: raw.IR_CANARY_ENABLED === 'true',
    irCanaryRolloutPct: boundedNumber(raw.IR_CANARY_ROLLOUT_PCT, 1, 0, 100),
    irCanaryMultiEnabled: raw.IR_CANARY_MULTI !== '0',
    irCanaryMaxProducts: boundedInteger(raw.IR_CANARY_MAX_PRODUCTS, 8, 1, 16),
    irCanaryConcurrency: boundedInteger(raw.IR_CANARY_CONCURRENCY, 2, 1, 6),
  });
}
