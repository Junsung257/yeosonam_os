// Indexing API 실제 호출 테스트
// 블로그 발행 파이프라인에서 사용하는 requestGoogleIndexing 함수를 직접 호출
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
const match = envContent.match(/^GOOGLE_SERVICE_ACCOUNT_JSON=(.*)$/m);
const credentials = JSON.parse(match[1].trim());

// src/lib/gsc-client.ts의 requestGoogleIndexing 함수와 동일한 로직
async function requestGoogleIndexing(url, type = 'URL_UPDATED') {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/indexing'],
    });
    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;
    if (!accessToken) {
      return { url, ok: false, error: 'access token 발급 실패' };
    }

    const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, type }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return { url, ok: false, error: `HTTP ${res.status}: ${errBody.slice(0, 300)}` };
    }

    const data = await res.json();
    return {
      url,
      ok: true,
      notify_time: data?.urlNotificationMetadata?.latestUpdate?.notifyTime,
    };
  } catch (err) {
    return {
      url,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  console.log('=== Indexing API 실제 호출 테스트 ===\n');
  console.log('참고: 요청 자체의 성공 여부만 확인합니다 (URL이 실제로 존재하지 않아도 OK).\n');

  // 테스트 URL (실제 존재할 필요 없음 - API 자체 연결 테스트)
  const testUrl = 'https://yeosonam.com/';

  console.log(`1. URL 업데이트 알림 요청: ${testUrl}`);
  const result = await requestGoogleIndexing(testUrl, 'URL_UPDATED');
  
  if (result.ok) {
    console.log('   ✅ 성공!');
    console.log(`   notify_time: ${result.notify_time || 'N/A'}`);
    console.log('\n   → 이 메시지가 뜨면 Indexing API가 완전히 정상 작동하는 것입니다.');
    console.log('   → 블로그 발행 시 requestGoogleIndexing()이 문제없이 동작합니다.\n');
  } else {
    console.log(`   ❌ 실패: ${result.error}`);
    
    if (result.error?.includes('400')) {
      console.log('   → 400 에러는 URL이 잘못되었거나 요청 형식 문제입니다.');
      console.log('   → 실제 블로그 URL로 테스트하면 해결될 수 있습니다.');
    }
    if (result.error?.includes('403')) {
      console.log('   → 403 에러: 서비스 계정이 GSC Owner가 아니면 Indexing API도 실패합니다.');
      console.log('   → 구글 버그(#429538961) 픽스가 필요합니다.');
    }
    if (result.error?.includes('429')) {
      console.log('   → 일일 할당량 초과 (200 URL/일). 내일 다시 시도.');
    }
  }

  console.log('\n=== 테스트 완료 ===');
}

main().catch(console.error);
