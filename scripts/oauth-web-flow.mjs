// OAuth2 웹 서버 플로우로 개인 계정 인증 후 Site Verification API 호출
// 실행: node scripts/oauth-web-flow.mjs
// 브라우저에서 http://localhost:3000 으로 접속
import http from 'http';
import { randomBytes } from 'crypto';
import { google } from 'googleapis';

const CLIENT_ID = '778786828639044-7jj5lnm4mk0jfa12he86mgdsoef6h54s.apps.googleusercontent.com';
// 네이티브 앱용 (OAuth2 desktop)
const REDIRECT_URI = 'http://localhost:3000/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/siteverification',
  'https://www.googleapis.com/auth/webmasters',
];

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, null, REDIRECT_URI);

function generateState() {
  return randomBytes(16).toString('hex');
}

const state = generateState();
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  state,
  prompt: 'consent',
  // desktop app용 - code verifier
});

console.log('\n=== OAuth2 인증 필요 ===');
console.log('\n아래 URL을 브라우저에서 열고 yeosonam.official@gmail.com 계정으로 로그인하세요:');
console.log('\n' + authUrl);

// 서버 시작
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    
    if (returnedState !== state) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('State mismatch');
      return;
    }

    if (!code) {
      const error = url.searchParams.get('error') || 'unknown';
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Error: ' + error);
      return;
    }

    try {
      // Not needed for OAuth2 client with client_secret omitted
      // Just use the code directly
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.write('<html><body><h1>토큰 수신 중...</h1><pre id="log"></pre>');
      res.write('<script>');
      
      // Use token exchange via Google's endpoint
      res.write(`
        (async function() {
          const log = document.getElementById('log');
          log.textContent += '\\n코드 수신 완료. 토큰 교환 중...';
          
          try {
            // token exchange
            const resp = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: {'Content-Type': 'application/x-www-form-urlencoded'},
              body: new URLSearchParams({
                code: '${code}',
                client_id: '${CLIENT_ID}',
                redirect_uri: '${REDIRECT_URI}',
                grant_type: 'authorization_code',
              })
            });
            const data = await resp.json();
            
            if (data.error) {
              log.textContent += '\\n❌ 토큰 교환 실패: ' + data.error + ' - ' + (data.error_description || '');
              return;
            }
            
            const token = data.access_token;
            log.textContent += '\\n✅ 토큰 획득 성공!';
            log.textContent += '\\n\\n=== Site Verification API 호출 ===';
            
            // 1. 인증된 사이트 목록 조회
            log.textContent += '\\n\\n1. 사이트 목록 조회 중...';
            const listResp = await fetch('https://www.googleapis.com/siteVerification/v1/webResource', {
              headers: {'Authorization': 'Bearer ' + token}
            });
            const listData = await listResp.json();
            
            if (!listResp.ok) {
              log.textContent += '\\n❌ 목록 조회 실패: ' + JSON.stringify(listData);
              return;
            }
            
            const sites = listData.items || [];
            log.textContent += '\\n   총 ' + sites.length + '개 사이트 발견';
            
            const SERVICE_ACCOUNT_EMAIL = 'yeosonam-os-bot@gen-lang-client-0264824193.iam.gserviceaccount.com';
            const TARGET_SITES = ['https://yeosonam.com/', 'sc-domain:yeosonam.com', 'yeosonam.com'];
            
            for (const targetSite of TARGET_SITES) {
              const site = sites.find(s => s.site.identifier === targetSite || s.id.includes('yeosonam.com'));
              if (site) {
                log.textContent += '\\n\\n2. 대상 사이트: ' + site.site.identifier;
                const currentOwners = site.owners || [];
                log.textContent += '\\n   현재 소유자: ' + currentOwners.join(', ');
                
                if (currentOwners.includes(SERVICE_ACCOUNT_EMAIL)) {
                  log.textContent += '\\n✅ 이미 소유자입니다!';
                  continue;
                }
                
                log.textContent += '\\n3. "' + SERVICE_ACCOUNT_EMAIL + '" 추가 중...';
                const updateResp = await fetch(
                  'https://www.googleapis.com/siteVerification/v1/webResource/' + encodeURIComponent(site.id),
                  {
                    method: 'PUT',
                    headers: {
                      'Authorization': 'Bearer ' + token,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ owners: [...currentOwners, SERVICE_ACCOUNT_EMAIL] })
                  }
                );
                const updateData = await updateResp.json();
                
                if (!updateResp.ok) {
                  log.textContent += '\\n❌ 실패: ' + JSON.stringify(updateData);
                } else {
                  log.textContent += '\\n✅ 성공!';
                  log.textContent += '\\n   업데이트된 소유자: ' + (updateData.owners || []).join(', ');
                }
              }
            }
            
            log.textContent += '\\n\\n=== 완료! ===';
            
          } catch(e) {
            log.textContent += '\\n❌ 오류: ' + e.message;
          }
        })();
      `);
      
      res.write('</script></body></html>');
      res.end();
      
      // 서버 종료
      setTimeout(() => server.close(), 5000);
      
    } catch (err) {
      console.error('Error:', err);
      res.writeHead(500);
      res.end('Error: ' + err.message);
    }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OAuth2 callback server running');
});

server.listen(3000, () => {
  console.log('\n인증 서버가 http://localhost:3000 에서 실행 중입니다.');
  console.log('위 URL을 브라우저에서 열어 yeosonam.official@gmail.com 계정으로 로그인하세요.');
  console.log('\n(30초 후 자동 종료됩니다)');
});

setTimeout(() => {
  server.close();
  console.log('\n서버 종료 (timeout)');
  process.exit(0);
}, 120000);
