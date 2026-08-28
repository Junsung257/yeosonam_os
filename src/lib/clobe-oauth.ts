import { randomBytes, createHash } from 'crypto';
import { decrypt, encrypt } from '@/lib/encryption';
import { getSecret } from '@/lib/secret-registry';
import { isUuid } from '@/lib/uuid';

const DEFAULT_CLOBE_MCP_URL = 'https://api.clobe.ai/mcp';
const STATE_TTL_MS = 10 * 60 * 1000;

export interface ClobeOAuthMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint?: string;
  scopes_supported?: string[];
}

export interface ClobeOAuthState {
  tenant_id: string;
  client_id: string;
  code_verifier: string;
  token_endpoint: string;
  resource: string;
  ts: number;
}

export interface ClobeClientRegistration {
  client_id: string;
}

export interface ClobeTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export function getClobeMcpUrl(): string {
  return getSecret('CLOBE_MCP_URL') || DEFAULT_CLOBE_MCP_URL;
}

export function getClobeSiteUrl(): string | null {
  return getSecret('NEXT_PUBLIC_SITE_URL') || getSecret('NEXT_PUBLIC_BASE_URL') || getSecret('NEXT_PUBLIC_APP_URL');
}

export function buildClobeRedirectUri(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/api/auth/clobe-callback`;
}

export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function sealClobeOAuthState(state: ClobeOAuthState): string {
  return encrypt(JSON.stringify(state));
}

export function unsealClobeOAuthState(rawState: string): ClobeOAuthState | null {
  try {
    const parsed = JSON.parse(decrypt(rawState)) as Partial<ClobeOAuthState>;
    if (
      !parsed.tenant_id ||
      !isUuid(parsed.tenant_id) ||
      !parsed.client_id ||
      !parsed.code_verifier ||
      !parsed.token_endpoint ||
      !parsed.resource ||
      typeof parsed.ts !== 'number'
    ) {
      return null;
    }
    if (Date.now() - parsed.ts > STATE_TTL_MS || parsed.ts - Date.now() > 60_000) return null;
    return parsed as ClobeOAuthState;
  } catch {
    return null;
  }
}

export async function discoverClobeOAuthMetadata(): Promise<ClobeOAuthMetadata> {
  const issuer = new URL(getClobeMcpUrl()).origin;
  const response = await fetch(`${issuer}/.well-known/oauth-authorization-server`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Clobe OAuth metadata lookup failed: ${response.status}`);
  }
  const metadata = await response.json() as Partial<ClobeOAuthMetadata>;
  if (!metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.registration_endpoint) {
    throw new Error('Clobe OAuth metadata is missing required endpoints');
  }
  return {
    issuer: metadata.issuer || issuer,
    authorization_endpoint: metadata.authorization_endpoint,
    token_endpoint: metadata.token_endpoint,
    registration_endpoint: metadata.registration_endpoint,
    revocation_endpoint: metadata.revocation_endpoint,
    scopes_supported: metadata.scopes_supported,
  };
}

export async function registerClobeOAuthClient(
  metadata: ClobeOAuthMetadata,
  redirectUri: string,
): Promise<ClobeClientRegistration> {
  const response = await fetch(metadata.registration_endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_name: 'Yeosonam OS Clobe Sync',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'mcp offline_access',
    }),
  });
  if (!response.ok) {
    throw new Error(`Clobe OAuth client registration failed: ${response.status}`);
  }
  const registration = await response.json() as Partial<ClobeClientRegistration>;
  if (!registration.client_id) {
    throw new Error('Clobe OAuth client registration did not return client_id');
  }
  return { client_id: registration.client_id };
}

export function buildClobeAuthorizationUrl(input: {
  metadata: ClobeOAuthMetadata;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(input.metadata.authorization_endpoint);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'mcp offline_access');
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', getClobeMcpUrl());
  return url.toString();
}

export async function exchangeClobeAuthorizationCode(input: {
  tokenEndpoint: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  resource: string;
}): Promise<ClobeTokenResponse> {
  const response = await fetch(input.tokenEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: input.clientId,
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
      resource: input.resource,
    }),
  });

  const tokenJson = await response.json().catch(() => ({})) as ClobeTokenResponse;
  if (!response.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.error_description || tokenJson.error || `Clobe token exchange failed: ${response.status}`);
  }
  return tokenJson;
}
