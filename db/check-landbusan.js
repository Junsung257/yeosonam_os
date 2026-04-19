const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data, error } = await sb.from('land_operators').select('*').ilike('name', '%랜드부산%');
  if (error) console.error('query error:', error);
  console.log('랜드부산 레코드:');
  for (const r of data || []) console.log(JSON.stringify(r, null, 2));
  // 기존 랜드부산 상품의 commission_rate 분포
  const { data: pkgs } = await sb.from('travel_packages').select('commission_rate, title').eq('land_operator_id', data?.[0]?.id).limit(10);
  console.log('\n랜드부산 상품 commission_rate 분포 (최근 10건):');
  for (const p of pkgs || []) console.log(`  ${p.commission_rate} | ${p.title}`);
})().catch(e => { console.error(e); process.exit(1); });
