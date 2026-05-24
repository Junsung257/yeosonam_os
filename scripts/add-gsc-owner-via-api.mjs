// Site Verification API update 메서드로 서비스 계정을 GSC 소유자로 추가
// 이 방법은 GSC UI의 "email not found" 버그를 우회합니다.
// Site Verification API의 update 메서드는 이미 인증된 리소스의 owners 배열을 수정합니다.
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
const match = envContent.match(/^GOOGLE_SERVICE_ACCOUNT_JSON=(.*)$/m);
const credentials = JSON.parse(match[1].trim());

const SERVICE_ACCOUNT_EMAIL = credentials.client_email;
const TARGET_SITE = 'https://yeosonam.com/';  // URL-prefix property
// 도메인 속성인 경우: 'sc-domain:yeosonam.com'

async function listVerifiedSites(auth) {
  const sv = google.siteVerification({ version: 'v1', auth });
  const res = await sv.webResource.list();
  return res.data.items || [];
}

async function updateOwners(auth, resourceId, owners) {
  const sv = google.siteVerification({ version: 'v1', auth });
  const res = await sv.webResource.update({
    id: encodeURIComponent(resourceId),
    requestBody: { owners },
  });
  return res.data;
}

async function addOwnerByUpdate(auth, resourceId, ownerEmail) {
  // 먼저 현재 소유자 목록 조회
  const sv = google.siteVerification({ version: 'v1', auth });
  const current = await sv.webResource.get({ id: encodeURIComponent(resourceId) });
  const currentOwners = current.data.owners || [];
  console.log('현재 소유자 목록:', currentOwners);

  if (currentOwners.includes(ownerEmail)) {
    console.log(`✅ "${ownerEmail}"은(는) 이미 소유자 목록에 있습니다.`);
    return current.data;
  }

  // 소유자 추가
  const newOwners = [...currentOwners, ownerEmail];
  console.log(`\n소유자 "${ownerEmail}" 추가 중...`);
  const result = await updateOwners(auth, resourceId, newOwners);
  console.log(`✅ 소유자 추가 성공!`);
  console.log('업데이트된 소유자 목록:', result.owners);
  return result;
}

async function main() {
  console.log('=== Site Verification API: 소유자 위임 ===\n');

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/siteverification'],
  });

  const client = await auth.getClient();

  // 1. 인증된 모든 사이트 목록 조회
  console.log('1. 인증된 사이트 목록 조회 중...');
  const sites = await listVerifiedSites(client);
  console.log(`   총 ${sites.length}개 사이트 인증됨\n`);

  for (const site of sites) {
    console.log(`   - ${site.site?.identifier} (id: ${site.id?.slice(0, 50)}...)`);
    console.log(`     소유자: ${site.owners?.join(', ') || '없음'}`);
  }

  // 2. 대상 사이트 찾기
  const targetSite = sites.find(s => s.site?.identifier === TARGET_SITE);
  if (!targetSite) {
    console.log(`\n⚠️ "${TARGET_SITE}"을(를) 찾을 수 없습니다.`);
    console.log('   도메인 속성(sc-domain)으로도 검색해봅니다...');
    
    // 도메인 속성 확인
    const domainSite = sites.find(s => s.site?.identifier === 'yeosonam.com' || s.id?.includes('yeosonam.com'));
    if (domainSite) {
      console.log(`   찾음: ${domainSite.site?.identifier}`);
      console.log(`\n2. "${SERVICE_ACCOUNT_EMAIL}"을(를) 소유자로 추가 중...`);
      const result = await addOwnerByUpdate(client, domainSite.id, SERVICE_ACCOUNT_EMAIL);
      console.log('\n✅ 최종 결과:', JSON.stringify(result, null, 2));
    } else {
      console.log('   일치하는 사이트를 찾을 수 없습니다.');
      console.log('\n   가능한 원인:');
      console.log('   - 이 서비스 계정으로는 어떤 사이트도 인증되지 않았습니다.');
      console.log('   - Site Verification API가 이 프로젝트에서 활성화되어 있는지 확인하세요.');
      console.log('   - 이미 yeosonam.official@gmail.com 계정으로 인증되었을 수 있습니다.');
      console.log('     (서비스 계정이 아닌 개인 계정으로 로그인해야 합니다)');
    }
    return;
  }

  // 3. 소유자 추가
  console.log(`\n2. "${SERVICE_ACCOUNT_EMAIL}"을(를) 소유자로 추가 중...`);
  const result = await addOwnerByUpdate(client, targetSite.id, SERVICE_ACCOUNT_EMAIL);
  console.log('\n✅ 최종 결과:', JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error('\n❌ 오류:', err.message);
  if (err.response?.data) {
    console.error('   상세:', JSON.stringify(err.response.data, null, 2));
  }
});
