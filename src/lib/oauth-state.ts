import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getSecret } from '@/lib/secret-registry';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isUuid } from '@/lib/uuid';

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthStateProvider = 'google' | 'meta' | 'naver' | 'threads' | 'clobe';
export type OAuthStateScope = 'tenant' | 'platform';

export type OAuthStatePayload = {
  provider: OAuthStateProvider;
  scope: OAuthStateScope;
  tenant_id?: string;
  nonce: string;
  ts: number;
};

export class OAuthStateConfigurationError extends Error {
  constructor() {
    super('OAUTH_STATE_SECRET is not configured');
    this.name = 'OAuthStateConfigurationError';
  }
}

function stateSecret(): string {
  const secret = getSecret('OAUTH_STATE_SECRET')?.trim();
  if (!secret) throw new OAuthStateConfigurationError();
  return secret;
}

function stateHash(rawState: string): string {
  return createHash('sha256').update(rawState).digest('hex');
}

function normalizeActorUserId(actorUserId?: string | null): string | null | undefined {
  if (actorUserId === undefined) return undefined;
  if (actorUserId === null) return null;
  return isUuid(actorUserId) ? actorUserId : null;
}

function encodePayload(payload: OAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', stateSecret())
    .update(encodedPayload)
    .digest()
    .toString('base64url');
}

function parseAndVerify(rawState: string, now: number): OAuthStatePayload | null {
  try {
    const dotIndex = rawState.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex === rawState.length - 1) return null;
    const encodedPayload = rawState.slice(0, dotIndex);
    const suppliedSignature = Buffer.from(rawState.slice(dotIndex + 1), 'base64url');
    const expectedSignature = Buffer.from(sign(encodedPayload), 'base64url');
    if (
      suppliedSignature.length !== expectedSignature.length
      || !timingSafeEqual(suppliedSignature, expectedSignature)
    ) return null;

    const decoded = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as Partial<OAuthStatePayload>;
    if (
      !decoded.provider
      || !decoded.scope
      || !decoded.nonce
      || typeof decoded.ts !== 'number'
      || !Number.isSafeInteger(decoded.ts)
      || !/^[a-z0-9_-]{32}$/i.test(decoded.nonce)
    ) return null;
    if (decoded.scope !== 'tenant' && decoded.scope !== 'platform') return null;
    if (decoded.scope === 'tenant' && (!decoded.tenant_id || !isUuid(decoded.tenant_id))) return null;
    if (decoded.scope === 'platform' && decoded.tenant_id !== undefined) return null;
    if (now - decoded.ts > OAUTH_STATE_TTL_MS || decoded.ts - now > 60_000) return null;
    return decoded as OAuthStatePayload;
  } catch {
    return null;
  }
}

export function createOAuthState(input: {
  provider: OAuthStateProvider;
  tenantId?: string;
  scope?: OAuthStateScope;
  now?: number;
}): string {
  const scope = input.scope ?? 'tenant';
  if (scope === 'tenant' && (!input.tenantId || !isUuid(input.tenantId))) {
    throw new Error('A valid tenant UUID is required for tenant OAuth state');
  }
  if (scope === 'platform' && input.tenantId !== undefined) {
    throw new Error('Platform OAuth state cannot contain tenant_id');
  }
  const payload: OAuthStatePayload = {
    provider: input.provider,
    scope,
    ...(scope === 'tenant' ? { tenant_id: input.tenantId } : {}),
    nonce: randomBytes(24).toString('base64url').slice(0, 32),
    ts: input.now ?? Date.now(),
  };
  const encodedPayload = encodePayload(payload);
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyOAuthState(
  rawState: string,
  expectedProvider: OAuthStateProvider,
  now = Date.now(),
): OAuthStatePayload | null {
  const payload = parseAndVerify(rawState, now);
  return payload?.provider === expectedProvider ? payload : null;
}

export async function registerOAuthState(input: {
  rawState: string;
  provider: OAuthStateProvider;
  tenantId?: string;
  actorUserId?: string;
  now?: number;
}): Promise<void> {
  const payload = verifyOAuthState(input.rawState, input.provider, input.now);
  if (!payload) throw new Error('Invalid OAuth state');
  if (payload.scope === 'tenant' && payload.tenant_id !== input.tenantId) {
    throw new Error('OAuth state tenant mismatch');
  }
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin client is required for OAuth state storage');
  const now = input.now ?? Date.now();
  const actorUserId = normalizeActorUserId(input.actorUserId);
  if (payload.scope === 'platform' && !actorUserId) {
    throw new Error('Platform OAuth state requires a human admin actor');
  }
  let cleanup = admin
    .from('oauth_states')
    .delete()
    .eq('provider', input.provider)
    .eq('scope', payload.scope);
  cleanup = payload.tenant_id
    ? cleanup.eq('tenant_id', payload.tenant_id)
    : cleanup.is('tenant_id', null);
  cleanup = actorUserId
    ? cleanup.eq('actor_user_id', actorUserId)
    : cleanup.is('actor_user_id', null);
  await cleanup;
  const { error } = await admin.from('oauth_states').insert({
    state_hash: stateHash(input.rawState),
    provider: input.provider,
    scope: payload.scope,
    tenant_id: payload.tenant_id ?? null,
    actor_user_id: actorUserId ?? null,
    expires_at: new Date(now + OAUTH_STATE_TTL_MS).toISOString(),
  } as never);
  if (error) throw new Error(`OAuth state registration failed: ${error.message}`);
}

/** Register an encrypted provider-specific state (for example Clobe PKCE). */
export async function registerOpaqueOAuthState(input: {
  rawState: string;
  provider: OAuthStateProvider;
  tenantId: string;
  actorUserId?: string;
  now?: number;
}): Promise<void> {
  if (!isUuid(input.tenantId)) throw new Error('A valid tenant UUID is required for OAuth state storage');
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin client is required for OAuth state storage');
  const now = input.now ?? Date.now();
  const actorUserId = normalizeActorUserId(input.actorUserId);
  let cleanup = admin
    .from('oauth_states')
    .delete()
    .eq('provider', input.provider)
    .eq('scope', 'tenant')
    .eq('tenant_id', input.tenantId);
  cleanup = actorUserId
    ? cleanup.eq('actor_user_id', actorUserId)
    : cleanup.is('actor_user_id', null);
  await cleanup;
  const { error } = await admin.from('oauth_states').insert({
    state_hash: stateHash(input.rawState),
    provider: input.provider,
    scope: 'tenant',
    tenant_id: input.tenantId,
    actor_user_id: actorUserId ?? null,
    expires_at: new Date(now + OAUTH_STATE_TTL_MS).toISOString(),
  } as never);
  if (error) throw new Error(`OAuth state registration failed: ${error.message}`);
}

export async function consumeOAuthState(
  rawState: string,
  expectedProvider: OAuthStateProvider,
  now = Date.now(),
  actorUserId?: string | null,
): Promise<OAuthStatePayload | null> {
  const payload = verifyOAuthState(rawState, expectedProvider, now);
  if (!payload) return null;
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const normalizedActorUserId = normalizeActorUserId(actorUserId);
  if (payload.scope === 'platform' && !normalizedActorUserId) return null;

  let query = admin
    .from('oauth_states')
    .update({ consumed_at: new Date(now).toISOString() } as never)
    .eq('state_hash', stateHash(rawState))
    .eq('provider', expectedProvider);
  if (normalizedActorUserId === null) query = query.is('actor_user_id', null);
  else if (normalizedActorUserId) query = query.eq('actor_user_id', normalizedActorUserId);
  const { data, error } = await query
    .is('consumed_at', null)
    .gt('expires_at', new Date(now).toISOString())
    .select('state_hash')
    .maybeSingle();
  if (error || !data) return null;
  return payload;
}

/** Atomically consume an encrypted provider-specific state after decryption. */
export async function consumeOpaqueOAuthState(
  rawState: string,
  expectedProvider: OAuthStateProvider,
  now = Date.now(),
  actorUserId?: string | null,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  const normalizedActorUserId = normalizeActorUserId(actorUserId);
  let query = admin
    .from('oauth_states')
    .update({ consumed_at: new Date(now).toISOString() } as never)
    .eq('state_hash', stateHash(rawState))
    .eq('provider', expectedProvider)
    .eq('scope', 'tenant');
  if (normalizedActorUserId === null) query = query.is('actor_user_id', null);
  else if (normalizedActorUserId) query = query.eq('actor_user_id', normalizedActorUserId);
  const { data, error } = await query
    .is('consumed_at', null)
    .gt('expires_at', new Date(now).toISOString())
    .select('state_hash')
    .maybeSingle();
  return !error && Boolean(data);
}

// Compatibility aliases for callers that only need tenant state creation.
export function createTenantOAuthState(tenantId: string, now = Date.now()): string {
  return createOAuthState({ provider: 'google', tenantId, now });
}

export function verifyTenantOAuthState(stateRaw: string, now = Date.now()): string | null {
  const payload = verifyOAuthState(stateRaw, 'google', now);
  return payload?.scope === 'tenant' ? payload.tenant_id ?? null : null;
}
