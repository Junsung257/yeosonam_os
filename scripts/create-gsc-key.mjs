// GSC 서비스 계정 JSON 키 생성 스크립트
// 사용법: node scripts/create-gsc-key.mjs
//
// 전제: Google Cloud ADC(Application Default Credentials)가 설정되어 있어야 함
//       (gcloud auth application-default login)
import { google } from 'googleapis';

const PROJECT_ID = 'gen-lang-client-0264824193';
const SERVICE_ACCOUNT_EMAIL = 'yeosonam-os-bot@gen-lang-client-0264824193.iam.gserviceaccount.com';

async function main() {
  try {
    // ADC로 인증 (사용자 로그인 기반)
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    const iam = google.iam('v1');

    const name = `projects/${PROJECT_ID}/serviceAccounts/${SERVICE_ACCOUNT_EMAIL}`;

    console.log('서비스 계정 키 생성 중...');
    console.log(`  계정: ${SERVICE_ACCOUNT_EMAIL}`);
    console.log(`  프로젝트: ${PROJECT_ID}`);

    const res = await iam.projects.serviceAccounts.keys.create({
      name,
      requestBody: {
        keyAlgorithm: 'KEY_ALG_RSA_2048',
        privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE',
      },
    });

    const keyData = res.data;
    
    // privateKeyData는 base64로 인코딩된 JSON 키
    if (!keyData.privateKeyData) {
      console.error('키 생성 실패: privateKeyData 없음');
      console.error(JSON.stringify(keyData, null, 2));
      process.exit(1);
    }

    const decodedJson = Buffer.from(keyData.privateKeyData, 'base64').toString('utf-8');
    
    console.log('\n✅ 키 생성 성공!');
    console.log(`  키 ID: ${keyData.name?.split('/').pop() || 'unknown'}`);
    
    // JSON 키 내용 출력 (한 줄로)
    const singleLine = decodedJson.replace(/\n/g, '\\n');
    console.log('\n=== .env.local에 추가할 내용 ===');
    console.log(`GOOGLE_SERVICE_ACCOUNT_JSON=${singleLine}`);
    console.log('\n또는 JSON 형식 그대로:');
    console.log(decodedJson);

    // 키 내용을 파일로도 저장
    const fs = await import('fs');
    const path = await import('path');
    const keyFile = path.join(process.cwd(), 'yeosonam-os-bot-key.json');
    fs.writeFileSync(keyFile, decodedJson, 'utf-8');
    console.log(`\n키 파일 저장: ${keyFile}`);

  } catch (err) {
    console.error('❌ 키 생성 실패:', err.message);
    if (err.response?.data) {
      console.error('상세:', JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }
}

main();
