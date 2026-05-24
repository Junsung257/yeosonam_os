import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envLocalPath = join(__dirname, '..', '.env.local');
const envContent = readFileSync(envLocalPath, 'utf-8');

// Extract GOOGLE_SERVICE_ACCOUNT_JSON value
const match = envContent.match(/^GOOGLE_SERVICE_ACCOUNT_JSON=(.+)$/m);
if (!match) {
  console.error('Not found');
  process.exit(1);
}

const value = match[1].trim();
// Output the value as a single line JavaScript string for CDP
console.log(JSON.stringify(value));
