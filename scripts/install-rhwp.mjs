import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const VERSION = process.env.RHWP_VERSION?.trim() || '0.8.2';
const ROOT = resolve(process.cwd(), 'vendor', 'rhwp', VERSION);
const platformKey = `${process.platform}-${process.arch}`;
const assets = {
  'win32-x64': `rhwp-v${VERSION}-windows-x86_64.zip`,
  'linux-x64': `rhwp-v${VERSION}-linux-x86_64.tar.gz`,
  'darwin-x64': `rhwp-v${VERSION}-macos-x86_64.tar.gz`,
  'darwin-arm64': `rhwp-v${VERSION}-macos-aarch64.tar.gz`,
};
const asset = assets[platformKey];
if (!asset) throw new Error(`Unsupported rhwp platform: ${platformKey}`);

const baseUrl = `https://github.com/edwardkim/rhwp/releases/download/v${VERSION}`;
const installedTarget = resolve(ROOT, process.platform === 'win32' ? 'rhwp.exe' : 'rhwp');
try {
  await stat(installedTarget);
  console.log(`rhwp ${VERSION} already installed: ${installedTarget}`);
  process.exit(0);
} catch {}

const work = await mkdtemp(join(tmpdir(), 'ysn-rhwp-install-'));
const archive = join(work, asset);
const sumsPath = join(work, 'SHA256SUMS.txt');

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed ${response.status}: ${url}`);
  await mkdir(dirname(destination), { recursive: true });
  const stream = createWriteStream(destination);
  for await (const chunk of response.body) stream.write(chunk);
  await new Promise((resolvePromise, reject) => {
    stream.end(resolvePromise);
    stream.on('error', reject);
  });
}

try {
  await download(`${baseUrl}/${asset}`, archive);
  await download(`${baseUrl}/SHA256SUMS.txt`, sumsPath);
  const sums = await readFile(sumsPath, 'utf8');
  const expectedHash = sums.split(/\r?\n/).find(line => line.includes(asset))?.trim().split(/\s+/)[0];
  const actualHash = createHash('sha256').update(await readFile(archive)).digest('hex');
  if (!expectedHash || expectedHash.toLowerCase() !== actualHash.toLowerCase()) {
    throw new Error(`rhwp checksum mismatch for ${asset}`);
  }

  const extracted = join(work, 'extracted');
  await mkdir(extracted, { recursive: true });
  // bsdtar is available on current Windows, macOS, and Linux runners and
  // avoids shell-specific quoting/encoding behavior for the Windows zip.
  await execFileAsync('tar', ['-xf', archive, '-C', extracted]);
  const { stdout } = await execFileAsync(process.platform === 'win32' ? 'powershell.exe' : 'find', process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', `Get-ChildItem -LiteralPath '${extracted.replace(/'/g, "''")}' -Recurse -File | Where-Object Name -eq 'rhwp.exe' | Select-Object -First 1 -ExpandProperty FullName`]
    : [extracted, '-type', 'f', '-name', 'rhwp', '-print', '-quit']);
  const binary = stdout.trim().split(/\r?\n/).find(Boolean);
  if (!binary) throw new Error('rhwp binary missing from release archive');
  await mkdir(ROOT, { recursive: true });
  await (await import('node:fs/promises')).copyFile(binary, installedTarget);
  if (process.platform !== 'win32') await execFileAsync('chmod', ['0755', installedTarget]);
  console.log(`Installed rhwp ${VERSION}: ${installedTarget}`);
} finally {
  await rm(work, { recursive: true, force: true }).catch(() => undefined);
}
