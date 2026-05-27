/**
 * attractions.photos 실제 구조 디버그
 */
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data } = await sb.from('attractions').select('name, photos').in('name', ['머라이언 공원', 'KLCC 페트로나스 트윈타워', '메르데카 광장', '왕궁']);
  for (const a of data) {
    console.log(`\n=== ${a.name} ===`);
    console.log('photos is array:', Array.isArray(a.photos));
    if (Array.isArray(a.photos)) {
      console.log('length:', a.photos.length);
      console.log('first item:', JSON.stringify(a.photos[0], null, 2));
    } else {
      console.log('raw value:', JSON.stringify(a.photos).slice(0, 500));
    }
  }
})();
