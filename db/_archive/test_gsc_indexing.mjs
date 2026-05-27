// GSC Indexing API 직접 테스트 스크립트
// parseServiceAccountJson 로직을 그대로 따라감: JSON.parse 먼저, private_key.replace(/\\n/g, '\n')
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const TEST_URL = 'https://yeosonam.com/blog/fukuoka-6';

function parseServiceAccountJson(raw) {
  const parsed = JSON.parse(raw);
  if (parsed.private_key && typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

async function main() {
  console.log('=== GSC Indexing API 직접 테스트 ===\n');

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.error('오류: GOOGLE_SERVICE_ACCOUNT_JSON 환경변수가 설정되지 않았습니다.');
    console.error('.env.local 파일에 GOOGLE_SERVICE_ACCOUNT_JSON=... 가 있는지 확인하세요.');
    process.exit(1);
  }
  console.log('[1] GOOGLE_SERVICE_ACCOUNT_JSON 로드됨');
  console.log(`    문자열 길이: ${raw.length}자`);
  console.log(`    첫 50자: ${raw.slice(0, 50)}...\n`);

  // parseServiceAccountJson
  let credentials;
  try {
    credentials = JSON.parse(raw);
    console.log('[2] JSON.parse(raw) 성공');
    console.log(`    project_id: ${credentials.project_id}`);
    console.log(`    client_email: ${credentials.client_email}`);

    const beforeReplace = credentials.private_key;
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    console.log(`\n[3] private_key.replace(/\\\\n/g, '\n') 완료`);
    console.log(`    변환 전 \\n 포함: ${beforeReplace.includes('\\n')}`);
    console.log(`    변환 후 실제 개행 포함: ${credentials.private_key.includes('\n')}`);
    console.log(`    -----BEGIN (최종): ${credentials.private_key.includes('-----BEGIN PRIVATE KEY-----')}`);
  } catch (err) {
    console.error(`\n[오류] JSON.parse 실패:`, err.message);
    process.exit(1);
  }

  // Google Auth
  console.log('\n[4] Google Auth 인증 시도...');
  const { google } = await import('googleapis');

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/indexing'],
    });
    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;
    if (!accessToken) {
      console.error('[오류] access token 발급 실패');
      process.exit(1);
    }
    console.log('[5] Access Token 발급 성공');
    console.log(`    Token (첫 20자): ${accessToken.slice(0, 20)}...\n`);
  } catch (err) {
    console.error(`[오류] Google Auth 실패: ${err.message}`);
    process.exit(1);
  }

  // Indexing API 호출
  console.log(`[6] Indexing API 호출: ${TEST_URL}`);
  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/indexing'],
    });
    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;

    const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: TEST_URL,
        type: 'URL_UPDATED',
      }),
    });

    const responseBody = await res.text();
    console.log(`    HTTP 상태 코드: ${res.status}`);

    if (res.ok) {
      const data = JSON.parse(responseBody);
      console.log('\n>>> 성공! <<<');
      console.log(`    notify_time: ${data?.urlNotificationMetadata?.latestUpdate?.notifyTime || 'N/A'}`);
    } else {
      console.log(`\n>>> 실패 (HTTP ${res.status}) <<<`);
      console.log(`    응답 본문: ${responseBody.slice(0, 500)}`);
    }
  } catch (err) {
    console.error(`[오류] Indexing API 요청 실패: ${err.message}`);
  }

  console.log('\n=== 테스트 완료 ===');
}

main().catch(console.error);
