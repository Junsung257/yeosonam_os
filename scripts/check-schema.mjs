import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const supabaseUrl = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/m)?.[1]?.trim();
const supabaseKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/m)?.[1]?.trim();

// content_creatives 컬럼 확인 (1개 row)
const res = await fetch(`${supabaseUrl}/rest/v1/content_creatives?select=*&limit=1`, {
  headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
});
const data = await res.json();
console.log('content_creatives 컬럼:');
if (data && data.length > 0) {
  console.log(Object.keys(data[0]).join(', '));
} else {
  console.log('데이터 없음');
  console.log(JSON.stringify(data).slice(0, 200));
}
