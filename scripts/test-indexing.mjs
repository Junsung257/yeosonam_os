import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

const match = envContent.match(/GOOGLE_SERVICE_ACCOUNT_JSON=(.+)/);
if (!match) {
  console.error('GOOGLE_SERVICE_ACCOUNT_JSON not found');
  process.exit(1);
}

let keyRaw = match[1].trim();
if (keyRaw.startsWith('"') && keyRaw.endsWith('"')) {
  keyRaw = keyRaw.slice(1, -1);
}
const key = JSON.parse(keyRaw);

console.log('=== 서비스 계정 정보 ===');
console.log('Email:', key.client_email);

const scopes = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/indexing',
].join(' ');

const now = Math.floor(Date.now() / 1000);
const jwtPayload = {
  iss: key.client_email,
  scope: scopes,
  aud: 'https://oauth2.googleapis.com/token',
  exp: now + 3600,
  iat: now,
};

const signedJwt = jwt.sign(jwtPayload, key.private_key, { algorithm: 'RS256' });
const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: signedJwt,
  }),
});
const tokenData = await tokenResp.json();

if (!tokenData.access_token) {
  console.error('Token exchange failed:', JSON.stringify(tokenData, null, 2));
  process.exit(1);
}
console.log('✅ Access token obtained!\n');

// Search Console: 검색 데이터 조회 (최근 7일)
console.log('=== Search Console 검색 데이터 (최근 7일) ===');

const siteUrl = 'https://yeosonam.com/';
const today = new Date();
const sevenDaysAgo = new Date(today);
sevenDaysAgo.setDate(today.getDate() - 7);

const formatDate = (d) => d.toISOString().split('T')[0];

const queryResp = await fetch(
  `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + tokenData.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      startDate: formatDate(sevenDaysAgo),
      endDate: formatDate(today),
      dimensions: ['query'],
      rowLimit: 5,
    }),
  }
);
const queryData = await queryResp.json();

if (queryData.error) {
  console.error('검색 데이터 조회 실패:', JSON.stringify(queryData, null, 2));
} else {
  console.log(`✅ 검색 데이터 조회 성공!`);
  console.log(`   총 ${queryData.rows?.length || 0}개 검색어\n`);
  if (queryData.rows) {
    for (const row of queryData.rows) {
      console.log(`   [${row.keys?.[0] || 'N/A'}]`);
      console.log(`      클릭: ${row.clicks}, 노출: ${row.impressions}`);
      console.log(`      CTR: ${(row.ctr * 100).toFixed(2)}%, 순위: ${row.position.toFixed(1)}`);
    }
  }
}

console.log('\n=== Indexing API 테스트 (최종 확인) ===');
const indexResp = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + tokenData.access_token,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://yeosonam.com/',
    type: 'URL_UPDATED',
  }),
});
const indexData = await indexResp.json();

if (indexData.error) {
  console.error('Indexing API 실패:', JSON.stringify(indexData, null, 2));
} else {
  console.log('✅ Indexing API 성공!');
  console.log('   URL:', indexData.urlNotificationMetadata?.url);
}

console.log('\n🎉 모든 API 정상 작동!');
