/**
 * Durable blog feature flag.
 *
 * Reservation, provider execution, and receipt settlement intentionally live
 * only in `invokeAi`; this adapter must not grow a second budget path.
 */
export function isBlogAiControlPlaneEnabled(): boolean {
  return process.env.BLOG_AI_CONTROL_PLANE_ENABLED === '1';
}
