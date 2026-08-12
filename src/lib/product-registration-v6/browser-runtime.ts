import { existsSync } from 'node:fs';

export type BrowserProofRuntimeMode = 'remote-cdp' | 'local-chrome' | 'serverless-chromium';

export type BrowserProofRuntimeCapability = {
  available: boolean;
  mode: BrowserProofRuntimeMode | null;
  reason: string;
};

export function browserProofLocalChromeCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return [
    env.PRODUCT_REGISTRATION_CHROME_EXECUTABLE_PATH,
    env.CHROME_EXECUTABLE_PATH,
    platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null,
    platform === 'win32' ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' : null,
    platform === 'linux' ? '/usr/bin/google-chrome-stable' : null,
    platform === 'linux' ? '/usr/bin/google-chrome' : null,
    platform === 'linux' ? '/usr/bin/chromium' : null,
  ].filter((value): value is string => Boolean(value));
}

/** Mirrors every launch path used by browser-proof without importing Puppeteer. */
export function browserProofRuntimeCapability(input: {
  platform?: NodeJS.Platform;
  browserWSEndpoint?: string | null;
  executableCandidates?: string[];
  pathExists?: (path: string) => boolean;
} = {}): BrowserProofRuntimeCapability {
  const platform = input.platform ?? process.platform;
  const browserWSEndpoint = input.browserWSEndpoint
    ?? process.env.PRODUCT_REGISTRATION_BROWSER_WS_ENDPOINT?.trim()
    ?? null;
  if (browserWSEndpoint) {
    return { available: true, mode: 'remote-cdp', reason: 'REMOTE_CDP_CONFIGURED' };
  }
  const pathExists = input.pathExists ?? existsSync;
  const candidates = input.executableCandidates ?? browserProofLocalChromeCandidates(platform);
  if (candidates.some(candidate => pathExists(candidate))) {
    return { available: true, mode: 'local-chrome', reason: 'LOCAL_CHROME_AVAILABLE' };
  }
  if (platform === 'linux') {
    return { available: true, mode: 'serverless-chromium', reason: 'BUNDLED_SERVERLESS_CHROMIUM' };
  }
  return { available: false, mode: null, reason: 'NO_BROWSER_RUNTIME' };
}
