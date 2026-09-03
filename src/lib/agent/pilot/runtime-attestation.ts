import { resolve } from 'node:path';
import { AGENT_CONTRACT_SCHEMA_REGISTRY } from '@/lib/agent/contracts';
import {
  buildCodexAppServerArguments,
  createCodexAppServerStdioFactory,
  type CodexAppServerConnection,
  type CodexAppServerConnectionFactory,
} from '@/lib/agent/runtime';
import {
  TechnologyScoutProtocolAttestationV1Schema,
  type TechnologyScoutProtocolAttestationV1,
} from './technology-scout-eval';

const READ_ONLY_PROFILE = ':read-only';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, key: string): string | null {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] as string : null;
}

function hasReadOnlyProfile(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasReadOnlyProfile);
  if (!isRecord(value)) return false;
  if (value.id === READ_ONLY_PROFILE || value.name === READ_ONLY_PROFILE || value.profile === READ_ONLY_PROFILE) {
    return true;
  }
  return Object.values(value).some((child) => hasReadOnlyProfile(child));
}

function activeReadOnlyProfile(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const candidates = [value.activePermissionProfile, value.permissionProfile, value.permissions, value.sandbox];
  return candidates.some((candidate) => hasReadOnlyProfile(candidate));
}

function networkDisabled(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const candidates = [value.sandbox, value.sandboxPolicy, value.permissionProfile, value.permissions];
  return candidates.some((candidate) => {
    if (!isRecord(candidate)) return false;
    return candidate.networkAccess === false
      || (isRecord(candidate.network) && candidate.network.enabled === false);
  });
}

async function initialize(connection: CodexAppServerConnection): Promise<unknown> {
  const result = await connection.request('initialize', {
    clientInfo: {
      name: 'yeosonam_agent_office_attestation',
      title: 'Yeosonam Agent Office Runtime Attestation',
      version: '1.0.0',
    },
    capabilities: { experimentalApi: true },
  }, 8_000);
  connection.notify('initialized', {});
  return result;
}

/**
 * Performs a no-turn protocol attestation. It never sends a model turn and
 * returns only booleans and hashes suitable for an operator readiness report.
 */
export async function attestTechnologyScoutRuntime(options?: {
  connectionFactory?: CodexAppServerConnectionFactory;
  workspaceRoot?: string;
  now?: () => Date;
}): Promise<TechnologyScoutProtocolAttestationV1> {
  const now = options?.now ?? (() => new Date());
  const workspaceRoot = resolve(options?.workspaceRoot ?? process.cwd());
  const connectionFactory = options?.connectionFactory ?? createCodexAppServerStdioFactory();
  const generatedSchemaHash = AGENT_CONTRACT_SCHEMA_REGISTRY.technologyRadarEntry.ref.schemaHash;
  let connection: CodexAppServerConnection | null = null;
  try {
    connection = await connectionFactory.open({ cwd: workspaceRoot });
    const initializeResult = await initialize(connection);
    const codexVersion = (readString(initializeResult, 'userAgent')
      ?? readString(initializeResult, 'version')
      ?? 'codex-app-server').slice(0, 120);
    const account = await connection.request('account/read', { refreshToken: false }, 8_000);
    const authMode = isRecord(account) && isRecord(account.account) && account.account.type === 'chatgpt'
      ? 'chatgpt' as const
      : null;
    if (!authMode) {
      return TechnologyScoutProtocolAttestationV1Schema.parse({
        schemaVersion: 'technology-scout-protocol-attestation-v1',
        codexVersion,
        generatedSchemaHash,
        authMode: 'chatgpt',
        restrictedReadableRootsSupported: false,
        permissionProfileId: null,
        networkAccessDisabled: false,
        ephemeralThreadSupported: false,
        optionalCapabilitySurfacesDisabled: false,
        errorCode: 'RUNTIME_AUTH_INVALID',
        checkedAt: now().toISOString(),
      });
    }

    let profileList: unknown = null;
    try {
      profileList = await connection.request('permissionProfile/list', {}, 8_000);
    } catch {
      // Older servers may not expose the inventory method. The thread response
      // below remains the authoritative compatibility check.
    }
    const profileListed = hasReadOnlyProfile(profileList);
    const thread = await connection.request('thread/start', {
      model: 'gpt-5.4-mini',
      cwd: workspaceRoot,
      runtimeWorkspaceRoots: [workspaceRoot],
      approvalPolicy: 'never',
      permissions: READ_ONLY_PROFILE,
      serviceName: 'yeosonam_agent_office_attestation',
      ephemeral: true,
      baseInstructions: 'No turn. Read-only protocol attestation only.',
    }, 8_000);
    const threadRecord = isRecord(thread) && isRecord(thread.thread) ? thread.thread : null;
    const ephemeral = threadRecord?.ephemeral === true;
    const readOnly = profileListed || activeReadOnlyProfile(thread);
    const restricted = ephemeral && readOnly && networkDisabled(thread);
    return TechnologyScoutProtocolAttestationV1Schema.parse({
      schemaVersion: 'technology-scout-protocol-attestation-v1',
      codexVersion,
      generatedSchemaHash,
      authMode,
      restrictedReadableRootsSupported: restricted,
      permissionProfileId: readOnly ? READ_ONLY_PROFILE : null,
      networkAccessDisabled: networkDisabled(thread),
      ephemeralThreadSupported: ephemeral,
      optionalCapabilitySurfacesDisabled: buildCodexAppServerArguments().includes('--disable'),
      errorCode: restricted ? null : 'CODEX_RESTRICTED_READ_ROOTS_UNSUPPORTED',
      checkedAt: now().toISOString(),
    });
  } catch (error) {
    const errorCode = isRecord(error) && Array.isArray(error.issues)
      ? `RUNTIME_ATTESTATION_SCHEMA_INVALID_${error.issues
        .map((issue) => isRecord(issue) && typeof issue.code === 'string' ? issue.code : 'unknown')
        .join('_')}`.slice(0, 120)
      : isRecord(error) && typeof error.code === 'string'
      ? error.code
      : error instanceof Error && error.message.length < 120 ? error.message : 'RUNTIME_ATTESTATION_FAILED';
    return TechnologyScoutProtocolAttestationV1Schema.parse({
      schemaVersion: 'technology-scout-protocol-attestation-v1',
      codexVersion: 'unavailable',
      generatedSchemaHash,
      authMode: 'chatgpt',
      restrictedReadableRootsSupported: false,
      permissionProfileId: null,
      networkAccessDisabled: false,
      ephemeralThreadSupported: false,
      optionalCapabilitySurfacesDisabled: false,
      errorCode,
      checkedAt: now().toISOString(),
    });
  } finally {
    await connection?.close();
  }
}
