// Google API 활성화 스크립트
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
const match = envContent.match(/^GOOGLE_SERVICE_ACCOUNT_JSON=(.*)$/m);
const jsonContent = match[1].trim();
const credentials = JSON.parse(jsonContent);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

async function main() {
  // 프로젝트 번호 확인
  const cloudResourceManager = google.cloudresourcemanager('v1');
  const projectRes = await cloudResourceManager.projects.get({ projectId: credentials.project_id });
  const projectNumber = projectRes.data.projectNumber;
  console.log('프로젝트 번호:', projectNumber);

  const serviceUsage = google.serviceusage('v1');
  const services = [
    'searchconsole.googleapis.com',
    'indexing.googleapis.com',
  ];

  for (const svc of services) {
    const name = `projects/${projectNumber}/services/${svc}`;
    try {
      await serviceUsage.services.enable({ name });
      console.log(`✅ ${svc} 활성화됨`);
    } catch (e) {
      if (e.message?.includes('already been enabled')) {
        console.log(`✅ ${svc} 이미 활성화됨`);
      } else {
        console.log(`❌ ${svc}: ${e.message?.slice(0, 150)}`);
      }
    }
  }

  console.log('\n완료! 1-2분 후 GSC API 테스트를 다시 실행해보세요.');
}

main().catch(e => {
  console.error('에러:', e.message);
  process.exit(1);
});
