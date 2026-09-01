const PROVIDER_ENV = {
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_AI_API_KEY'],
  vertex: ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'VERTEX_PROJECT_ID', 'VERTEX_LOCATION'],
  openai: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORGANIZATION', 'OPENAI_ORG_ID', 'OPENAI_PROJECT'],
  anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'],
  azureopenai: ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_API_HOST', 'AZURE_OPENAI_API_VERSION', 'AZURE_OPENAI_BASE_URL'],
};

const PROCESS_ENV = [
  'PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'ComSpec',
  'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'NODE_OPTIONS',
  'SSL_CERT_FILE',
];

export function parseLiveProvider(input) {
  if (typeof input !== 'string') throw new Error('HARNESS_LIVE_PROVIDER must be a string.');
  const match = input.match(/^(google|vertex|openai|anthropic|azureopenai):([A-Za-z0-9][A-Za-z0-9._/-]{0,127})$/u);
  if (!match) {
    throw new Error('HARNESS_LIVE_PROVIDER must be a credential-free model ID from an approved hosted provider.');
  }
  return { id: input, family: match[1], model: match[2] };
}

export function buildLiveProviderEnv(source, family) {
  if (!Object.hasOwn(PROVIDER_ENV, family)) throw new Error(`Unsupported live provider family: ${family}`);
  const allowed = new Set([...PROCESS_ENV, ...PROVIDER_ENV[family]]);
  const env = {};
  for (const key of allowed) {
    if (typeof source[key] === 'string') env[key] = source[key];
  }
  return {
    ...env,
    PROMPTFOO_DISABLE_TELEMETRY: '1',
    PROMPTFOO_DISABLE_UPDATE: '1',
    PROMPTFOO_DISABLE_SHARING: '1',
  };
}
