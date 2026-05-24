// Vercel CLI를 사용하여 GOOGLE_SERVICE_ACCOUNT_JSON 환경 변수 설정
// 사용법: node scripts/set-vercel-env.mjs
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const envLocalPath = join(rootDir, '.env.local');

// Read the GOOGLE_SERVICE_ACCOUNT_JSON value
const envContent = readFileSync(envLocalPath, 'utf-8');
const match = envContent.match(/^GOOGLE_SERVICE_ACCOUNT_JSON=(.+)$/m);
if (!match) {
  console.error('GOOGLE_SERVICE_ACCOUNT_JSON not found in .env.local');
  process.exit(1);
}

const value = match[1].trim();

// Write value to a temp file for Vercel CLI to read
const tmpDir = mkdtempSync(join(rootDir, 'scripts', 'tmp-'));
const tmpFile = join(tmpDir, 'google-sa-value.txt');
writeFileSync(tmpFile, value, 'utf-8');
console.log(`Value written to ${tmpFile} (${value.length} chars)`);

// Check Vercel login
try {
  const whoami = execSync('npx --yes vercel whoami --token', { 
    cwd: rootDir, 
    encoding: 'utf-8', 
    timeout: 30000 
  });
  console.log('Vercel user:', whoami.trim());
} catch (e) {
  console.log('Checking login status...');
}

// Set env vars using the file approach - write directly via Vercel CLI
const environments = ['production', 'preview', 'development'];
for (const env of environments) {
  try {
    console.log(`Setting ${env}...`);
    const result = execSync(
      `cmd /c type "${tmpFile}" | npx vercel env add GOOGLE_SERVICE_ACCOUNT_JSON ${env}`,
      { 
        cwd: rootDir, 
        encoding: 'utf-8', 
        timeout: 60000,
        shell: 'cmd.exe'
      }
    );
    console.log(`  ${env}: ${result.trim()}`);
  } catch (err) {
    console.log(`  ${env}: ${err.stdout?.trim() || err.message}`);
  }
}

// Cleanup
try { unlinkSync(tmpFile); } catch {}
try { 
  const fs = await import('fs');
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {}

console.log('\nDone! Check Vercel dashboard for confirmation.');
