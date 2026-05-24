import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const supabaseUrl = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/m)?.[1]?.trim();
const supabaseKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/m)?.[1]?.trim();

// 서비스 계정 키 파싱
const saMatch = envContent.match(/GOOGLE_SERVICE_ACCOUNT_JSON=(.+?)(?:\n[a-zA-Z_]|\n$|$)/ms);
if (!saMatch) { console.error('GOOGLE_SERVICE_ACCOUNT_JSON not found'); process.exit(1); }
let saRaw = saMatch[1].trim();
// JSON이 한 줄이거나 여러 줄일 수 있음
try { JSON.parse(saRaw); } catch {
  // 여러 줄인 경우 줄바꿈 유지하며 다시 읽기
  const lines = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n');
  let jsonLines = [];
  let inJson = false;
  for (const line of lines) {
    if (line.startsWith('GOOGLE_SERVICE_ACCOUNT_JSON=')) {
      inJson = true;
      jsonLines.push(line.substring('GOOGLE_SERVICE_ACCOUNT_JSON='.length));
    } else if (inJson) {
      jsonLines.push(line);
      if (line.trim().endsWith('}')) break;
    }
  }
  saRaw = jsonLines.join('\n');
}
const saKey = JSON.parse(saRaw);
console.log('✅ 서비스 계정 키 로드 완료:', saKey.client_email);

// JWT 생성
const now = Math.floor(Date.now() / 1000);
const jwtPayload = {
  iss: saKey.client_email,
  scope: 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/indexing',
  aud: 'https://oauth2.googleapis.com/token',
  exp: now + 3600,
  iat: now,
};
const signedJwt = jwt.sign(jwtPayload, saKey.private_key, { algorithm: 'RS256' });
const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedJwt }),
});
const tokenData = await tokenResp.json();
if (!tokenData.access_token) { console.error('Token failed:', JSON.stringify(tokenData)); process.exit(1); }
const token = tokenData.access_token;
console.log('✅ Access token 획득\n');

// 블로그 글 목록
const res = await fetch(
  `${supabaseUrl}/rest/v1/content_creatives?select=id,slug,seo_title,content_type,status,published_at&order=published_at.desc.nullslast&limit=50`,
  { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
);
const allPosts = await res.json();
const posts = allPosts.filter(p => p.status === 'published' && p.slug);

console.log(`발행된 블로그 글: 총 ${posts.length}개\n`);

// 각 URL 색인 상태 확인
const siteUrl = 'https://yeosonam.com/';
const results = [];

for (let i = 0; i < Math.min(posts.length, 50); i++) {
  const post = posts[i];
  const fullUrl = `https://yeosonam.com/blog/${post.slug}`;
  
  await new Promise(r => setTimeout(r, 400));

  const inspRes = await fetch(
    `https://searchconsole.googleapis.com/v1/urlInspection/index:inspect`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionUrl: fullUrl, siteUrl }),
    }
  );
  const inspData = await inspRes.json();
  const ir = inspData?.inspectionResult?.indexStatusResult;

  const verdict = ir?.verdict || 'UNKNOWN';
  const coverage = ir?.coverageState || 'UNKNOWN';
  const userState = ir?.userState || 'UNKNOWN';

  results.push({ slug: post.slug, title: post.seo_title, url: fullUrl, verdict, coverage, userState });
  
  const emoji = verdict === 'PASS' ? '✅' : verdict === 'PARTIAL' ? '⚠️' : '❌';
  process.stdout.write(`${emoji} ${post.seo_title?.substring(0, 45).padEnd(48)} ${verdict.padEnd(8)} ${coverage.substring(0, 30)}\n`);
}

// 요약
console.log('\n' + '='.repeat(70));
console.log('                  📊 색인 상태 요약');
console.log('='.repeat(70));
const pass = results.filter(r => r.verdict === 'PASS').length;
const partial = results.filter(r => r.verdict === 'PARTIAL').length;
const fail = results.filter(r => r.verdict !== 'PASS' && r.verdict !== 'PARTIAL').length;
console.log(`✅ 완전 색인: ${pass}개`);
if (partial > 0) console.log(`⚠️ 부분 색인: ${partial}개`);
if (fail > 0) console.log(`❌ 미색인: ${fail}개`);
console.log(`📝 전체: ${results.length}개\n`);

// 미색인 글만 출력
const needsIndexing = results.filter(r => r.verdict !== 'PASS');
if (needsIndexing.length > 0) {
  console.log('=== 색인 필요한 글 ===');
  for (const r of needsIndexing) {
    console.log(`  ${r.verdict === 'PARTIAL' ? '⚠️' : '❌'} ${r.title?.substring(0, 50)}`);
    console.log(`     ${r.url}`);
    console.log(`     ${r.verdict} | ${r.coverage}`);
    console.log('');
  }
}

// 색인 필요한 URL 목록을 파일로 저장
const unindexedUrls = needsIndexing.map(r => r.url);
if (unindexedUrls.length > 0) {
  const outPath = path.join(__dirname, '..', 'unindexed-urls.json');
  fs.writeFileSync(outPath, JSON.stringify(unindexedUrls, null, 2));
  console.log(`\n미색인 URL 목록 저장: ${outPath}`);
}
