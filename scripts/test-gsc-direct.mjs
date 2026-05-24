// GSC API 직접 호출 테스트 (yeosonam.com 데이터 읽기)
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
const match = envContent.match(/^GOOGLE_SERVICE_ACCOUNT_JSON=(.*)$/m);
const credentials = JSON.parse(match[1].trim());

console.log('=== GSC API 직접 호출 테스트 ===\n');

async function test() {
  // 1. Search Console API - 사이트 목록
  console.log('1. Search Console API - sites.list');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  const sc = google.searchconsole({ version: 'v1', auth });

  try {
    const sites = await sc.sites.list();
    console.log('   사이트 목록:', JSON.stringify(sites.data.siteEntry?.map(s => ({ url: s.siteUrl, level: s.permissionLevel })) || []));
  } catch (e) {
    console.log('   ❌ sites.list 실패:', e.message?.slice(0, 200));
  }

  // 2. 직접 yeosonam.com 데이터 조회 시도
  console.log('\n2. yeosonam.com 검색 데이터 조회 시도');
  try {
    const res = await sc.searchanalytics.query({
      siteUrl: 'sc_domain:yeosonam.com',
      requestBody: {
        startDate: '2026-05-17',
        endDate: '2026-05-24',
        dimensions: ['query'],
        rowLimit: 10,
      },
    });
    console.log('   ✅ 성공! 데이터 수:', res.data.rows?.length || 0);
    if (res.data.rows?.length > 0) {
      console.log('   첫 3개:', res.data.rows.slice(0, 3).map(r => ({ query: r.keys?.[0], clicks: r.clicks, impressions: r.impressions })));
    }
  } catch (e) {
    console.log('   ❌ 실패:', e.message?.slice(0, 250));
    if (e.message?.includes('not found') || e.message?.includes('not a registered site')) {
      console.log('   → 사이트가 GSC에 등록되어 있지 않음');
    }
    if (e.message?.includes('permission')) {
      console.log('   → 권한 부족 (서비스 계정이 GSC 사용자로 등록 안 됨)');
    }
  }

  // 3. URL prefix로도 시도
  console.log('\n3. https://yeosonam.com/ (URL prefix)');
  try {
    const res2 = await sc.searchanalytics.query({
      siteUrl: 'https://yeosonam.com/',
      requestBody: {
        startDate: '2026-05-17',
        endDate: '2026-05-24',
        dimensions: ['query'],
        rowLimit: 10,
      },
    });
    console.log('   ✅ 성공! 데이터 수:', res2.data.rows?.length || 0);
  } catch (e) {
    console.log('   ❌ 실패:', e.message?.slice(0, 250));
  }

  // 4. Indexing API 테스트
  console.log('\n4. Indexing API 액세스 토큰');
  const auth2 = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/indexing'],
  });
  const client = await auth2.getClient();
  const token = (await client.getAccessToken()).token;
  console.log('   ✅ 토큰 발급:', token?.substring(0, 30) + '...');

  console.log('\n=== 테스트 완료 ===');
}

test().catch(console.error);
