// Site Verification API를 통해 서비스 계정을 yeosonam.com 소유권 확인자로 등록
// 이 방법은 GSC UI 버그를 우회합니다
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
const match = envContent.match(/^GOOGLE_SERVICE_ACCOUNT_JSON=(.*)$/m);
const credentials = JSON.parse(match[1].trim());

async function main() {
  console.log('=== Site Verification API 테스트 ===\n');
  
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/siteverification',
      'https://www.googleapis.com/auth/siteverification.verify_only',
    ],
  });

  const sv = google.siteVerification('v1');

  // 1. 현재 소유권 확인된 사이트 목록 조회
  console.log('1. 현재 소유권 확인된 사이트 목록');
  try {
    const res = await sv.webResource.list({ auth });
    console.log('   성공:', JSON.stringify(res.data.items?.map(i => ({ id: i.id, site: i.site?.identifier, type: i.site?.type })) || []));
  } catch (e) {
    console.log('   ❌ 실패:', e.message?.slice(0, 200));
    if (e.message?.includes('not been used') || e.message?.includes('disabled')) {
      console.log('   → Site Verification API가 활성화되어 있지 않습니다');
      console.log('   → https://console.developers.google.com/apis/api/siteverification.googleapis.com/overview?project=993239663859 에서 활성화 필요');
    }
  }

  // 2. 서비스 계정을 소유권 확인자로 등록
  //    (GSC UI와 별개로 API 레벨에서 등록)
  console.log('\n2. yeosonam.com 소유권 확인 시도 (DNS 메서드)');
  try {
    // verify-only: 이미 DNS/HTML로 소유권이 확인된 경우 확인만 수행
    const verifyRes = await sv.webResource.insert({
      auth,
      verificationMethod: 'META',
      requestBody: {
        site: {
          type: 'SITE', // or 'INET_DOMAIN'
          identifier: 'https://yeosonam.com/',
        },
      },
    });
    console.log('   ✅ 성공:', JSON.stringify(verifyRes.data));
  } catch (e) {
    console.log('   ❌ 실패:', e.message?.slice(0, 300));
    if (e.message?.includes('already')) {
      console.log('   → 이미 소유권이 확인되어 있음');
    }
    if (e.message?.includes('permission') || e.message?.includes('not have')) {
      console.log('   → 서비스 계정에 siteverification API 권한이 없음');
    }
  }

  // 3. Search Console API 재시도 (변경 사항 반영 확인)
  console.log('\n3. Search Console API 재시도');
  const scAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  const sc = google.searchconsole({ version: 'v1', auth: scAuth });

  try {
    const sites = await sc.sites.list();
    console.log('   사이트 목록:', JSON.stringify(sites.data.siteEntry?.map(s => s.siteUrl) || []));
  } catch (e) {
    console.log('   ❌ 실패:', e.message?.slice(0, 200));
  }

  console.log('\n=== 완료 ===');
}

main().catch(e => {
  console.error('치명적 에러:', e.message);
  process.exit(1);
});
