import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const urls = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'unindexed-urls.json'), 'utf8'));

// 서비스 계정 키 파싱
const envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const match = envContent.match(/^GOOGLE_SERVICE_ACCOUNT_JSON=(\{.*\})$/m);
if (!match) { console.error('GOOGLE_SERVICE_ACCOUNT_JSON not found'); process.exit(1); }
let saRaw = match[1];
const saKey = JSON.parse(saRaw);
console.log('✅ 서비스 계정 키 로드:', saKey.client_email);
console.log(`📍 색인 요청 대상: ${urls.length}개\n`);

// JWT
const now = Math.floor(Date.now() / 1000);
const signedJwt = jwt.sign({
  iss: saKey.client_email,
  scope: 'https://www.googleapis.com/auth/indexing',
  aud: 'https://oauth2.googleapis.com/token',
  exp: now + 3600,
  iat: now,
}, saKey.private_key, { algorithm: 'RS256' });
const tr = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedJwt }),
});
const td = await tr.json();
if (!td.access_token) { console.error('Token failed:', JSON.stringify(td)); process.exit(1); }
const token = td.access_token;
console.log('✅ Access token 획득\n');

let success = 0;
let fail = 0;

// Indexing API: URL_UPDATED = 신규/업데이트 요청
for (let i = 0; i < urls.length; i++) {
  const url = urls[i];
  const body = JSON.stringify({ url, type: 'URL_UPDATED' });

  // rate limit ~200/qps → 0.5초 간격으로 충분
  await new Promise(r => setTimeout(r, 600));

  const resp = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  });
  const data = await resp.json();

  if (resp.ok && !data.error) {
    success++;
    process.stdout.write(`  [${String(i + 1).padStart(2, '0')}/${urls.length}] ✅ ${url.substring(0, 60)}\n`);
  } else {
    fail++;
    const reason = data?.error?.message || JSON.stringify(data);
    process.stdout.write(`  [${String(i + 1).padStart(2, '0')}/${urls.length}] ❌ ${url.substring(0, 60)}\n`);
    process.stdout.write(`      → ${reason}\n`);

    // 429 rate limit → 더 오래 대기
    if (resp.status === 429) {
      console.log('      → Rate limit 도달, 60초 대기 후 재시도...');
      await new Promise(r => setTimeout(r, 60000));
    }
  }
}

console.log('\n' + '='.repeat(60));
console.log(`✅ 성공: ${success}개`);
console.log(`❌ 실패: ${fail}개`);
console.log(`📝 전체: ${urls.length}개`);
