// GSC API 연결 테스트 스크립트
// 사용법: node scripts/test-gsc.mjs
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');

// .env.local 파일 읽기 (dotenv 대신 수동 파싱)
const envContent = readFileSync(envPath, 'utf-8');

// GOOGLE_SERVICE_ACCOUNT_JSON 값 추출
const match = envContent.match(/^GOOGLE_SERVICE_ACCOUNT_JSON=(.*)$/m);
if (!match) {
  console.error('❌ .env.local에 GOOGLE_SERVICE_ACCOUNT_JSON이 없습니다');
  process.exit(1);
}

const jsonContent = match[1].trim();

// JSON 파싱 시도
let credentials;
try {
  credentials = JSON.parse(jsonContent);
  console.log('✅ JSON 키 파싱 성공');
  console.log(`  client_email: ${credentials.client_email}`);
  console.log(`  project_id: ${credentials.project_id}`);
  console.log(`  private_key_id: ${credentials.private_key_id}`);
} catch (e) {
  console.error('❌ JSON 파싱 실패:', e.message);
  process.exit(1);
}

async function main() {
  try {
    // 1. Search Console API 연결 테스트
    console.log('\n--- 1. Search Console API 테스트 ---');
    const auth1 = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    const searchconsole = google.searchconsole({ version: 'v1', auth: auth1 });

    // 사이트 목록 조회 (연결만 확인)
    const sites = await searchconsole.sites.list();
    const siteList = sites.data.siteEntry || [];
    console.log(`  등록된 사이트 수: ${siteList.length}`);
    for (const site of siteList) {
      console.log(`  - ${site.siteUrl} (${site.permissionLevel})`);
    }

    if (siteList.length === 0) {
      console.log('  ⚠️  등록된 사이트가 없습니다. yeosonam.com을 Search Console에 먼저 등록해야 합니다.');
    }

    // 2. Indexing API 테스트
    console.log('\n--- 2. Indexing API 토큰 발급 테스트 ---');
    const auth2 = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/indexing'],
    });
    const client = await auth2.getClient();
    const token = (await client.getAccessToken()).token;
    if (token) {
      console.log('  ✅ Indexing API 액세스 토큰 발급 성공');
      console.log(`  토큰 (앞 20자): ${token.substring(0, 20)}...`);
    } else {
      console.log('  ❌ Indexing API 액세스 토큰 발급 실패');
    }

    console.log('\n✅ 모든 테스트 완료!');
    
    // 결과 요약
    console.log('\n=== 결과 요약 ===');
    if (siteList.length > 0) {
      console.log('✅ Search Console API: 정상 (사이트 연동됨)');
    } else {
      console.log('⚠️  Search Console: 키는 정상이나 사이트 등록이 필요합니다.');
    }
    console.log('✅ Indexing API: 키 정상');

  } catch (err) {
    console.error('\n❌ 테스트 실패:', err.message);
    if (err.response?.data?.error) {
      const e = err.response.data.error;
      console.error(`  code: ${e.code}`);
      console.error(`  message: ${e.message}`);
      console.error(`  status: ${e.status}`);
      
      if (e.message?.includes('not been verified') || e.message?.includes('not found')) {
        console.log('\n👉 Search Console에 yeosonam.com 사이트가 등록되어 있어야 합니다.');
        console.log('   https://search.google.com/search-console 에서 사이트 추가 필요');
      }
      if (e.message?.includes('permission') || e.message?.includes('Owner')) {
        console.log('\n👉 Service Account를 Search Console의 소유주(Owner)로 등록해야 합니다.');
        console.log('   https://search.google.com/search-console/settings > 사용자 추가');
      }
    }
    process.exit(1);
  }
}

main();
