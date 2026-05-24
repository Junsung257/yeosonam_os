// Site Verification API를 통해 서비스 계정을 yeosonam.com 소유권 확인자로 등록
// GSC UI 버그 우회: API를 직접 호출하여 등록
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
  console.log('=== Site Verification API를 통한 소유권 확인 ===\n');
  
  // Site Verification API scope
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/siteverification',
      'https://www.googleapis.com/auth/siteverification.verify_only',
    ],
  });

  const sv = google.siteVerification('v1');

  // 1. 현재 서비스 계정으로 확인된 사이트 목록 조회
  console.log('1. 현재 서비스 계정으로 확인된 사이트 목록');
  try {
    const listRes = await sv.webResource.list({ auth });
    console.log('   ✅ 성공:');
    if (listRes.data.items && listRes.data.items.length > 0) {
      listRes.data.items.forEach(item => {
        console.log(`   - ${item.site?.identifier} (${item.site?.type})`);
        console.log(`     owners: ${item.owners?.join(', ')}`);
      });
    } else {
      console.log('   (확인된 사이트 없음)');
    }
  } catch (e) {
    console.log(`   ❌ 실패: ${e.message?.slice(0, 300)}`);
  }

  // 2. yeosonam.com 소유권 확인 시도 (insert via verification)
  //    먼저 META 태그 방식으로 시도 (HTML 소스에 meta 태그 필요)
  //    그 다음 DNS TXT 레코드 방식 (도메인 DNS 설정 필요)
  console.log('\n2. yeosonam.com 소유권 확인 시도');
  
  // 시도 1: SITE 타입 (URL 접두사) - META 태그 방식
  console.log('\n   [시도 1] SITE 타입 (URL 접두사) - FILE 방식');
  try {
    const res = await sv.webResource.insert({
      auth,
      verificationMethod: 'FILE',
      requestBody: {
        site: {
          type: 'SITE',
          identifier: 'https://yeosonam.com/',
        },
      },
    });
    console.log(`   ✅ 성공: ${JSON.stringify(res.data)}`);
  } catch (e) {
    console.log(`   ❌ 실패: ${e.message?.slice(0, 300)}`);
    if (e.message?.includes('already')) {
      console.log('   → 이미 확인됨');
    } else if (e.message?.includes('permission') || e.message?.includes('403')) {
      console.log('   → 권한 없음 (서비스 계정 자체의 소유권 확인 불가)');
      console.log('   → 이 API는 인증된 사용자(=서비스 계정) 자신의 소유권만 확인합니다');
    }
  }

  // 시도 2: INET_DOMAIN 타입 (도메인) - DNS TXT 레코드 방식
  console.log('\n   [시도 2] INET_DOMAIN 타입 - DNS_CNAME 방식');
  try {
    const res = await sv.webResource.insert({
      auth,
      verificationMethod: 'DNS_CNAME',
      requestBody: {
        site: {
          type: 'INET_DOMAIN',
          identifier: 'yeosonam.com',
        },
      },
    });
    console.log(`   ✅ 성공: ${JSON.stringify(res.data)}`);
  } catch (e) {
    console.log(`   ❌ 실패: ${e.message?.slice(0, 300)}`);
    if (e.message?.includes('already')) {
      console.log('   → 이미 확인됨');
    } else if (e.message?.includes('verification') && e.message?.includes('token')) {
      console.log('   → DNS 레코드에 인증 토큰을 추가해야 합니다');
    }
  }
  
  // 3. getToken으로 인증 토큰 조회 (나중에 DNS에 추가할 토큰)
  console.log('\n3. 소유권 인증 토큰 조회 (DNS에 추가 가능)');
  try {
    const tokenRes = await sv.webResource.getToken({
      auth,
      requestBody: {
        site: {
          type: 'INET_DOMAIN',
          identifier: 'yeosonam.com',
        },
        verificationMethod: 'DNS_CNAME',
      },
    });
    console.log(`   ✅ 성공!`);
    console.log(`   token: ${tokenRes.data.token}`);
    console.log(`   DNS 레코드: ${tokenRes.data.token}`);
    console.log(`   → DNS 설정에 이 TXT/CNAME 레코드를 추가해야 함`);
  } catch (e) {
    console.log(`   ❌ 실패: ${e.message?.slice(0, 300)}`);
    if (e.message?.includes('already')) {
      console.log('   → 이미 소유권이 확인되어 있음');
    }
  }

  console.log('\n=== 완료 ===');
}

main().catch(e => {
  console.error('치명적 에러:', e.message);
  process.exit(1);
});
